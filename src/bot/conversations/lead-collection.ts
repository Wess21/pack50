import type { Conversation } from '@grammyjs/conversations';
import type { MyContext } from '../../types/context.js';
import { extractDataFromMessage } from '../../api/services/data-extraction.js';
import { manageConversationContext, isLeadComplete } from './helpers.js';
import { confirmKeyboard } from '../keyboards.js';
import {
  findOrCreateUser,
  createConversation,
  addMessage,
  updateConversationLeadData,
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

  // Welcome message
  await ctx.reply('Привет! Я помогу вам оставить заявку. Как вас зовут?');

  // Add assistant message to history
  await conversation.external(async () => {
    ctx.session.messageHistory.push({
      role: 'assistant',
      content: 'Привет! Я помогу вам оставить заявку. Как вас зовут?',
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

  // Show confirmation message with inline keyboard
  const confirmationMessage = `Пожалуйста, подтвердите информацию:\n\nИмя: ${leadData.name}\nEmail: ${leadData.email}\nТелефон: ${leadData.phone}`;

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
    await conversation.external(async () => {
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

        // Save lead data
        await updateConversationLeadData(conv.id, ctx.session.leadData);

        logger.info('Lead data persisted to database', {
          userId: user.id,
          conversationId: conv.id,
          leadData: ctx.session.leadData,
        });
      } catch (error) {
        logger.error('Failed to persist lead data', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });

    // Send success message
    await callbackCtx.reply('Спасибо! Ваша заявка принята. Мы свяжемся с вами в ближайшее время.');

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
    await callbackCtx.reply('Хорошо, начнем заново. Используйте /start чтобы начать сначала.');

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
