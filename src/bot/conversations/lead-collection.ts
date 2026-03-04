import { InlineKeyboard } from 'grammy';
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
    ctx.session.conversationState = 'collecting_lead';
    ctx.session.lastActivityAt = new Date();
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
    greetingMsg = `Ваш заказ:\n\n${cart}\n\nДля передачи заявки менеджеру, пожалуйста, напишите ваш контактный номер телефона:`;
  }

  logger.info('Sending greeting message', { userId: ctx.from?.id, greetingMsg });

  // Welcome message
  try {
    await ctx.reply(greetingMsg);
    logger.info('Greeting message sent successfully', { userId: ctx.from?.id });
  } catch (err) {
    logger.error('Failed to send greeting message', { userId: ctx.from?.id, error: err });
  }

  // Add assistant message to history
  await conversation.external(async () => {
    ctx.session.messageHistory.push({
      role: 'assistant',
      content: greetingMsg,
      timestamp: new Date(),
    });
  });

  // Loop until lead is complete
  while (true) {
    // Check if lead is already complete (might be set from previous iteration)
    const complete = await conversation.external(async () => {
      return isLeadComplete(ctx.session.leadData);
    });

    if (complete) {
      break;
    }

    logger.info('Waiting for user contact information...', { userId: ctx.from?.id });
    // Wait for user message
    const msgCtx = await conversation.waitFor('message:text');
    logger.info('Received user contact message', { userId: ctx.from?.id, text: msgCtx.message.text });

    // Extract data from message (wrapped in external to avoid replay)
    logger.info('Extracting data from message...', { userId: ctx.from?.id, text: msgCtx.message.text });
    const extracted = await conversation.external(async () => {
      try {
        const result = await extractDataFromMessage(
          msgCtx.message.text,
          ctx.session.leadData
        );
        logger.info('Extraction result received', { userId: ctx.from?.id, result });
        return result;
      } catch (err) {
        logger.error('Extraction failed', { userId: ctx.from?.id, error: err });
        return {};
      }
    });

    // Update session with extracted data
    await conversation.external(async () => {
      ctx.session.leadData = {
        ...ctx.session.leadData,
        ...extracted,
      };

      // Add user message to history
      ctx.session.messageHistory.push({
        role: 'user',
        content: msgCtx.message.text,
        timestamp: new Date(),
      });

      ctx.session.lastActivityAt = new Date();
    });

    // Manage conversation context (summarize if needed)
    await conversation.external(async () => {
      const managed = await manageConversationContext(ctx.session);
      ctx.session.conversationSummary = managed.summary;
    });

    // Determine next question based on missing fields
    const leadData = await conversation.external(async () => ctx.session.leadData);

    let nextQuestion: string;

    if (!leadData.phone) {
      nextQuestion = 'Оставьте, пожалуйста, ваш контактный номер телефона для оформления заказа.';
    } else {
      // All necessary data (just phone) collected
      break;
    }

    // Send next question
    await msgCtx.reply(nextQuestion);

    // Add assistant message to history
    await conversation.external(async () => {
      ctx.session.messageHistory.push({
        role: 'assistant',
        content: nextQuestion,
        timestamp: new Date(),
      });
    });
  }

  // All data collected - move to confirmation state
  await conversation.external(async () => {
    ctx.session.conversationState = 'confirming';
  });

  const leadData = await conversation.external(async () => ctx.session.leadData);

  // Show confirmation message with inline keyboard
  const confirmKeyboard = new InlineKeyboard()
    .text('✓ Подтвердить', 'confirm_lead')
    .text('✗ Начать заново', 'edit_lead');

  const confirmationCart = await conversation.external(async () => ctx.session.cart);
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
      } else if (responseCtx.callbackQuery.data === 'edit_lead') {
        // Restart conversation by clearing data
        await conversation.external(async () => {
          ctx.session.leadData = {};
        });
        await ctx.reply('Хорошо, давайте начнем заново. Используйте /start или просто напишите ваше имя.');
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

      // If they type something else, just re-ask for the button click
      await responseCtx.reply('Пожалуйста, подтвердите заявку нажатием на кнопку "Подтвердить" или "Начать заново".');
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
        for (const msg of ctx.session.messageHistory) {
          await addMessage(conv.id, msg.role, msg.content);
        }

        // Save lead data to conversation
        await updateConversationLeadData(conv.id, ctx.session.leadData);

        const finalAdditionalInfo = ctx.session.cart
          ? `Корзина клиента:\n${ctx.session.cart}\n\nДоп. инфо: ${ctx.session.leadData.additional_info || ''}`
          : (ctx.session.leadData.additional_info || '');

        // Update the session lead data so the notification service gets the cart!
        ctx.session.leadData.additional_info = finalAdditionalInfo;

        // Create structured lead record
        const lead = await createLead(
          conv.id,
          ctx.session.leadData.name || '',
          ctx.session.leadData.email || '',
          ctx.session.leadData.phone || '',
          finalAdditionalInfo
        );

        logger.info('Lead data persisted to database', {
          userId: user.id,
          conversationId: conv.id,
          leadId: lead.id,
          leadData: ctx.session.leadData,
        });

        // Forward to admin via selected transport
        await processCollectedContact(user.id, ctx.session.leadData, ctx);

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
      ctx.session.conversationState = 'idle';
      ctx.session.leadData = {};
      ctx.session.messageHistory = [];
      ctx.session.lastActivityAt = new Date();
    });

    logger.info('Lead collection flow completed successfully', {
      userId: ctx.from?.id,
    });
  }
}
