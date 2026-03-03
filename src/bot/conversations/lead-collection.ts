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
  findLeadByEmail,
} from '../../api/repositories/index.js';
import { logger } from '../../utils/logger.js';

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
  let greetingMsg = 'Привет! Я помогу вам оставить заявку. Как вас зовут?';
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

  // Welcome message
  await ctx.reply(greetingMsg);

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

    // Wait for user message
    const msgCtx = await conversation.waitFor('message:text');

    // Extract data from message (wrapped in external to avoid replay)
    const extracted = await conversation.external(async () => {
      const result = await extractDataFromMessage(
        msgCtx.message.text,
        ctx.session.leadData
      );
      return result;
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

    if (!leadData.name) {
      nextQuestion = 'Отлично! А как мне к вам обращаться?';
    } else if (!leadData.email) {
      nextQuestion = 'Прекрасно! Какой у вас email?';
    } else if (!leadData.phone) {
      nextQuestion = 'Последний вопрос - ваш номер телефона?';
    } else {
      // All data collected
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

  // Check for duplicate lead by email
  const existingLead = await conversation.external(async () => {
    return await findLeadByEmail(leadData.email!);
  });

  if (existingLead) {
    logger.info('Duplicate lead detected', {
      email: leadData.email,
      existingLeadId: existingLead.id,
    });

    // Show duplicate warning with options
    const duplicateKeyboard = new InlineKeyboard()
      .text('✓ Обновить данные', 'update_lead')
      .text('✗ Отмена', 'cancel_lead');

    await ctx.reply(
      `У нас уже есть заявка с email ${leadData.email} от ${existingLead.created_at.toLocaleDateString()}.\n\n` +
      `Хотите обновить информацию?`,
      { reply_markup: duplicateKeyboard }
    );

    const duplicateCallback = await conversation.waitFor('callback_query:data');
    await duplicateCallback.answerCallbackQuery();

    if (duplicateCallback.callbackQuery.data === 'cancel_lead') {
      await duplicateCallback.editMessageText('Заявка не создана. Используйте /start чтобы начать заново.');

      // Reset session
      await conversation.external(async () => {
        ctx.session.conversationState = 'idle';
        ctx.session.leadData = {};
        ctx.session.messageHistory = [];
        ctx.session.lastActivityAt = new Date();
      });

      logger.info('Lead creation cancelled due to duplicate', {
        userId: ctx.from?.id,
        email: leadData.email,
      });

      return; // Exit conversation
    }

    // User chose to update - continue to confirmation
  }

  // Show confirmation message with inline keyboard
  const confirmKeyboard = new InlineKeyboard()
    .text('✓ Подтвердить', 'confirm_lead')
    .text('✗ Начать заново', 'edit_lead');

  const confirmationMessage =
    `Пожалуйста, проверьте информацию:\n\n` +
    `Имя: ${leadData.name}\n` +
    `Email: ${leadData.email}\n` +
    `Телефон: ${leadData.phone}\n\n` +
    `Все верно?`;

  await ctx.reply(confirmationMessage, {
    reply_markup: confirmKeyboard,
  });

  // Wait for callback query (button press)
  const callbackCtx = await conversation.waitFor('callback_query:data');

  // Answer callback query (removes "loading" state from button)
  await callbackCtx.answerCallbackQuery();

  // Handle confirmation
  if (callbackCtx.callbackQuery.data === 'confirm_lead') {
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

        // Create structured lead record
        const lead = await createLead(
          conv.id,
          ctx.session.leadData.name!,
          ctx.session.leadData.email!,
          ctx.session.leadData.phone!,
          ctx.session.leadData.additional_info
        );

        logger.info('Lead data persisted to database', {
          userId: user.id,
          conversationId: conv.id,
          leadId: lead.id,
          leadData: ctx.session.leadData,
        });

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
      await callbackCtx.editMessageText(
        '✓ Спасибо! Ваша заявка принята. Мы свяжемся с вами в ближайшее время.'
      );
    } else {
      await callbackCtx.reply(
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
  } else {
    // User clicked "Edit" - restart conversation
    await callbackCtx.editMessageText('Хорошо, начнем заново. Используйте /start чтобы начать сначала.');

    // Reset session
    await conversation.external(async () => {
      ctx.session.conversationState = 'idle';
      ctx.session.leadData = {};
      ctx.session.messageHistory = [];
      ctx.session.lastActivityAt = new Date();
    });

    logger.info('Lead collection flow cancelled by user', {
      userId: ctx.from?.id,
    });
  }
}
