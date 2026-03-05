import { InlineKeyboard, Keyboard } from 'grammy';
import type { Conversation } from '@grammyjs/conversations';
import type { MyContext } from '../../types/context.js';
import { extractDataFromMessage } from '../../api/services/data-extraction.js';
import { manageConversationContext, isLeadComplete } from './helpers.js';
import { db } from '../../db/client.js';
import {
  findOrCreateUser,
  createConversation,
  addMessage,
  updateConversationLeadData,
  createLead,
} from '../../api/repositories/index.js';
import { logger } from '../../utils/logger.js';
import { processCollectedContact } from '../../api/services/contact-notification.js';

/**
 * Lead collection conversation flow
 *
 * Multi-turn dialogue that:
 * 1. Greets user and initiates data collection
 * 2. Loops until all required data (name, email, phone) is collected
 * 3. Asks clarifying questions for missing fields
 * 4. Shows confirmation with inline keyboard
 * 5. Persists conversation and lead data to database
 *
 * CRITICAL: All side effects (DB writes, API calls, session updates) MUST be
 * wrapped in conversation.external() to avoid replay bugs when conversation
 * resumes after waitFor() calls.
 */
export async function leadCollectionFlow(
  conversation: Conversation<MyContext>,
  ctx: MyContext
): Promise<void> {
  logger.info('Lead collection flow started', {
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
  });

  // Set conversation state to collecting
  await conversation.external(async () => {
    conversation.session.conversationState = 'collecting_lead';
    conversation.session.lastActivityAt = new Date();
  });

  // Fetch greeting from config or use default
  let greetingMsg = 'Для оформления заявки оставьте, пожалуйста, ваш номер телефона:';
  try {
    const configResult = await conversation.external(async () => {
      return await db.query('SELECT greeting_message FROM bot_config WHERE id = 1');
    });
    if (configResult.rows.length > 0 && configResult.rows[0].greeting_message) {
      greetingMsg = configResult.rows[0].greeting_message;
    }
  } catch (err) {
    logger.warn('Failed to fetch greeting_message from bot_config, using default', { error: err });
  }

  // Check if there is an active order cart
  const cart = await conversation.external(async () => ctx.session.cart);
  if (cart) {
    greetingMsg = `Ваш заказ:\n\n${cart}\n\nДля передачи заявки менеджеру, пожалуйста, укажите ваш контактный номер телефона:`;
  }

  // Prepend LLM's response if available (e.g., "Конечно, перевожу на менеджера!")
  const leadGreeting = await conversation.external(async () => {
    const lg = (conversation.session as any).leadGreeting;
    (conversation.session as any).leadGreeting = undefined; // clear it
    return lg;
  });

  if (leadGreeting) {
    greetingMsg = `${leadGreeting}\n\n${greetingMsg}`;
  }

  // Check if user already has a phone in session — if so, ask which to use
  const existingPhone = await conversation.external(async () => ctx.session.leadData?.phone);
  if (existingPhone) {
    const maskedPhone = existingPhone.replace(/(\d{1})(\d{3})(\d{3})(\d+)/, '$1($2)$3-$4');
    const useExistingKeyboard = new InlineKeyboard()
      .text(`📞 Использовать ${maskedPhone}`, 'use_existing_phone')
      .text('✏️ Указать другой', 'enter_new_phone');

    await ctx.reply(`У вас уже есть сохранённый номер: ${maskedPhone}\n\u041aакой использовать?`, { reply_markup: useExistingKeyboard });

    const existingPhoneCtx = await conversation.waitFor('callback_query:data');
    await existingPhoneCtx.answerCallbackQuery();

    if (existingPhoneCtx.callbackQuery.data === 'use_existing_phone') {
      // Phone already in session — skip collection loop
      logger.info('User chose existing phone', { userId: ctx.from?.id, phone: existingPhone });
    } else {
      // User wants to enter a different number — clear existing phone
      await conversation.external(async () => {
        conversation.session.leadData = { ...conversation.session.leadData, phone: undefined };
      });
    }
  }

  logger.info('Sending greeting message', { userId: ctx.from?.id });

  // Reply keyboard with "Share phone" button — shown when asking for phone
  const sharePhoneKeyboard = new Keyboard()
    .requestContact('📱 Поделиться номером')
    .resized()
    .oneTime();

  // Welcome message
  try {
    await ctx.reply(greetingMsg, { reply_markup: sharePhoneKeyboard });
    logger.info('Greeting message sent successfully', { userId: ctx.from?.id });
  } catch (err) {
    logger.error('Failed to send greeting message', { userId: ctx.from?.id, error: err });
  }

  // Add assistant message to history
  await conversation.external(async () => {
    conversation.session.messageHistory.push({
      role: 'assistant',
      content: greetingMsg,
      timestamp: new Date(),
    });
  });

  // Loop until lead is complete
  while (true) {
    const complete = await conversation.external(async () => isLeadComplete(ctx.session.leadData));
    if (complete) break;

    logger.info('Waiting for user contact information...', { userId: ctx.from?.id });

    // Accept both typed text and Telegram "Share Contact" button
    const msgCtx = await conversation.waitFor(['message:text', 'message:contact']);

    let phoneFromContact: string | undefined;
    let textInput: string = '';

    if (msgCtx.message?.contact) {
      // Telegram native contact share
      const rawPhone = msgCtx.message.contact.phone_number || '';
      phoneFromContact = rawPhone.startsWith('+') ? rawPhone : '+' + rawPhone;
      textInput = phoneFromContact;
      logger.info('Received contact share', { userId: ctx.from?.id, phone: phoneFromContact });
    } else {
      textInput = msgCtx.message?.text || '';
      logger.info('Received user contact message', { userId: ctx.from?.id, text: textInput });

      // If user typed a command, exit
      if (textInput.startsWith('/')) {
        await ctx.reply('Прерываю оформление заявки...');
        await conversation.external(async () => {
          ctx.session.conversationState = 'idle';
        });
        return;
      }
    }

    // Extract data from message (Name/Email only, phone is disabled in text)
    const extracted = await conversation.external(async () => {
      try {
        if (phoneFromContact) {
          // Direct phone from contact share — no need for LLM extraction
          return { phone: phoneFromContact };
        }
        const result = await extractDataFromMessage(textInput, conversation.session.leadData);
        logger.info('Extraction result received', { userId: ctx.from?.id, result });
        return result;
      } catch (err) {
        logger.error('Extraction failed', { userId: ctx.from?.id, error: err });
        return {};
      }
    });

    // Update session with extracted data
    await conversation.external(async () => {
      conversation.session.leadData = { ...conversation.session.leadData, ...extracted };
      conversation.session.messageHistory.push({
        role: 'user',
        content: textInput,
        timestamp: new Date(),
      });
      conversation.session.lastActivityAt = new Date();
    });

    // Manage conversation context
    await conversation.external(async () => {
      const managed = await manageConversationContext(conversation.session);
      conversation.session.conversationSummary = managed.summary;
    });

    const leadData = await conversation.external(async () => conversation.session.leadData);

    if (!leadData.phone) {
      const nextQuestion = 'Для оформления заказа необходимо получить ваш контактный номер. Пожалуйста, нажмите на кнопку «📱 Поделиться номером» внизу экрана.';
      await ctx.reply(nextQuestion, { reply_markup: sharePhoneKeyboard });
      await conversation.external(async () => {
        conversation.session.messageHistory.push({ role: 'assistant', content: nextQuestion, timestamp: new Date() });
      });
    } else {
      // Phone collected — remove the reply keyboard
      await ctx.reply('Спасибо! Номер получен.', { reply_markup: { remove_keyboard: true } });
      break;
    }
  }

  // All data collected - move to confirmation state
  await conversation.external(async () => {
    conversation.session.conversationState = 'confirming';
  });

  const leadData = await conversation.external(async () => conversation.session.leadData);

  // Show confirmation message with inline keyboard
  const confirmKeyboard = new InlineKeyboard()
    .text('✓ Подтвердить', 'confirm_lead')
    .text('✏️ Изменить', 'change_lead')
    .text('✗ Отменить', 'edit_lead');

  const confirmationCart = await conversation.external(async () => conversation.session.cart);
  let confirmationMessage = `Пожалуйста, проверьте информацию:\n\n`;
  if (confirmationCart) {
    confirmationMessage += `📝 Заказ:\n${confirmationCart}\n\n`;
  }
  confirmationMessage +=
    `📞 Телефон: ${leadData.phone || 'Не указан'}\n\n` +
    `Все верно?`;

  await ctx.reply(confirmationMessage, {
    reply_markup: confirmKeyboard,
  });

  // Wait for callback query (button press) or text message
  let confirmed = false;
  let retryCount = 0;
  let finalCtx: any = null;

  while (!confirmed && retryCount < 5) {
    const responseCtx = await conversation.waitFor(['callback_query:data', 'message:text']);

    // Handle button click (callback query)
    if (responseCtx.callbackQuery) {
      await responseCtx.answerCallbackQuery();
      if (responseCtx.callbackQuery.data === 'confirm_lead') {
        confirmed = true;
        finalCtx = responseCtx;
        break;
      } else if (responseCtx.callbackQuery.data === 'change_lead') {
        // Edit mode: keep cart, exit to RAG handler so user can describe changes
        await conversation.external(async () => {
          ctx.session.conversationState = 'idle';
        });
        await ctx.reply('Хорошо! Опишите, что нужно изменить в заказе — я скорректирую и снова предложу оформить.');
        return;
      } else if (responseCtx.callbackQuery.data === 'edit_lead') {
        // Full cancel: clear cart and all data
        await conversation.external(async () => {
          conversation.session.leadData = {};
          conversation.session.cart = undefined;
          conversation.session.conversationState = 'idle';
          (conversation.session as any).hasRequestedContacts = false;
        });
        await ctx.reply('Заявка отменена. Напишите новый запрос.');
        return;
      }
    }

    // Handle text message
    if (responseCtx.message?.text) {
      const text = responseCtx.message.text;

      // If it's a command, exit and let global handler take over
      if (text.startsWith('/')) {
        await ctx.reply('Прерываю оформление заявки...');
        await conversation.external(async () => {
          ctx.session.conversationState = 'idle';
        });
        return; // Exit conversation
      }

      // Check if user wants to fully cancel OR just edit one item
      const fullCancelKeywords = ['отмена', 'отменить', 'нет', 'начать заново', 'все заново'];
      const editKeywords = ['убрать', 'изменить', 'поменять', 'убери', 'удали', 'удалить', 'хочу изменить', 'переделать', 'скорректировать'];
      const lowerText = text.toLowerCase();

      const wantsFullCancel = fullCancelKeywords.some(kw => lowerText.includes(kw));
      const wantsEdit = editKeywords.some(kw => lowerText.includes(kw));

      if (wantsFullCancel) {
        // Full cancel: clear everything
        await conversation.external(async () => {
          conversation.session.leadData = {};
          conversation.session.cart = undefined;
          conversation.session.conversationState = 'idle';
        });
        await ctx.reply('Хорошо, заявка полностью отменена. Напишите новый запрос.');
        return;
      }

      if (wantsEdit) {
        // Edit mode: keep the cart in session but exit confirmation so RAG handler can process
        // the edit request. The user can describe what to change, bot will reply via RAG.
        await conversation.external(async () => {
          conversation.session.conversationState = 'idle';
          // Keep conversation.session.cart so the RAG handler can use it as context
        });
        await ctx.reply(
          'Понял, выхожу из подтверждения. Опишите, что нужно изменить — я скорректирую заказ и снова предложу оформить.'
        );
        return;
      }

      // Otherwise, remind them to use the buttons
      await responseCtx.reply('Пожалуйста, нажмите кнопку «✓ Подтвердить» или «✗ Начать заново».');
      retryCount++;
    }
  }

  // Handle confirmation logic
  if (confirmed && finalCtx) {
    // Persist to database (wrapped in external)
    const result = await conversation.external(async () => {
      try {
        // Create or update user
        const user = await findOrCreateUser(
          ctx.from!.id,
          ctx.from!.username,
          ctx.from!.first_name,
          ctx.from!.last_name
        );

        // Create conversation record
        const conv = await createConversation(user.id);

        // Save all messages from history
        for (const msg of conversation.session.messageHistory) {
          await addMessage(conv.id, msg.role, msg.content);
        }

        // Save lead data to conversation
        await updateConversationLeadData(conv.id, conversation.session.leadData);

        const finalAdditionalInfo = conversation.session.cart
          ? `Корзина клиента:\n${conversation.session.cart}`
          : (conversation.session.leadData.additional_info || '');

        // Update the session lead data so the notification service gets the cart!
        conversation.session.leadData.additional_info = finalAdditionalInfo;

        // Create structured lead record
        const lead = await createLead(
          conv.id,
          conversation.session.leadData.name || '',
          conversation.session.leadData.email || '',
          conversation.session.leadData.phone || '',
          finalAdditionalInfo
        );

        logger.info('Lead data persisted to database', {
          userId: user.id,
          conversationId: conv.id,
          leadId: lead.id,
          leadData: conversation.session.leadData,
        });

        // Forward to admin via selected transport
        await processCollectedContact(user.id, conversation.session.leadData, ctx);

        return { success: true, leadId: lead.id };
      } catch (error) {
        logger.error('Failed to persist lead data', {
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error };
      }
    });

    if (result.success) {
      // Edit confirmation message to show success (prevents new message)
      await finalCtx.editMessageText(
        '✓ Спасибо! Ваша заявка принята. Мы свяжемся с вами в ближайшее время.'
      );
    } else {
      await finalCtx.reply(
        'Произошла ошибка при сохранении заявки. Попробуйте еще раз позже.'
      );
    }

    // Reset session to idle
    await conversation.external(async () => {
      conversation.session.conversationState = 'idle';
      conversation.session.leadData = { name: undefined, email: undefined, phone: undefined };
      conversation.session.messageHistory = [];
      conversation.session.cart = undefined;
      (conversation.session as any).hasRequestedContacts = false;
      conversation.session.lastActivityAt = new Date();
    });

    logger.info('Lead collection flow completed successfully', {
      userId: ctx.from?.id,
    });
  }
}
