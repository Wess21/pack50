import { MyContext } from '../../types/context.js';
import { searchDocuments, extractContext } from '../../services/retrieval.js';
import { logger } from '../../utils/logger.js';
import { createLLMProvider } from '../../services/llm/provider-factory.js';
import { ContextManager } from '../../services/context-manager.js';
import { WebhookService } from '../../services/webhook.js';
import { buildSystemPrompt } from '../../prompts/system-prompts.js';
import { buildPrompt } from '../../prompts/prompt-builder.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { processCollectedContact } from '../../api/services/contact-notification.js';

// Initialize services
const contextManager = new ContextManager();
const webhookService = new WebhookService(env.WEBHOOK_URL || '');

/**
 * Smart text truncation - cuts at last complete sentence/paragraph before limit
 */
function smartTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  // Try to cut at paragraph break
  const cutPoint = text.lastIndexOf('\n\n', maxLength);
  if (cutPoint > maxLength * 0.8) {
    return text.substring(0, cutPoint) + '\n\n[...текст обрезан]';
  }

  // Try to cut at line break
  const lineBreak = text.lastIndexOf('\n', maxLength);
  if (lineBreak > maxLength * 0.8) {
    return text.substring(0, lineBreak) + '\n[...текст обрезан]';
  }

  // Try to cut at sentence end
  const sentenceEnd = Math.max(
    text.lastIndexOf('. ', maxLength),
    text.lastIndexOf('! ', maxLength),
    text.lastIndexOf('? ', maxLength)
  );
  if (sentenceEnd > maxLength * 0.8) {
    return text.substring(0, sentenceEnd + 1) + '\n[...текст обрезан]';
  }

  // Fallback: hard cut with ellipsis
  return text.substring(0, maxLength - 20) + '...\n[текст обрезан]';
}

/**
 * Parse cart lines and calculate total price
 * Handles format: "N шт × Model — Price₽" (with comma or dot as decimal separator)
 */
function calculateCartTotal(cart: string): string {
  return `${cart}\n\n📌 Итоговую стоимость вместе со скидками уточнит менеджер.`;
}

/**
 * Handle non-conversation messages with RAG retrieval
 * Called when user sends message outside of active conversation flow
 */
export async function handleMessage(ctx: MyContext) {
  const messageText = ctx.message?.text;

  if (!messageText) {
    return;  // Ignore non-text messages
  }

  // NOTE: We do NOT check conversationState here.
  // grammY conversations middleware handles routing automatically:
  // if there's an active conversation it intercepts first, otherwise we process normally.
  // A stale conversationState check here was causing the bot to go silent after
  // a conversation exited without a clean state reset.

  // Reset any stale non-idle state so session stays consistent
  if (ctx.session.conversationState !== 'idle') {
    ctx.session.conversationState = 'idle';
  }

  // Extract lead data silently in background
  try {
    const { extractDataFromMessage } = await import('../../api/services/data-extraction.js');
    const extracted = await extractDataFromMessage(messageText, ctx.session.leadData);
    ctx.session.leadData = { ...ctx.session.leadData, ...extracted };
  } catch (err) {
    logger.warn('Background lead extraction failed', { error: err });
  }

  try {
    logger.info('Processing RAG query', {
      userId: ctx.from?.id,
      query: messageText.substring(0, 100)  // Log first 100 chars
    });

    // Send typing indicator
    await ctx.replyWithChatAction('typing');

    // 1. Query Expansion: Extract all products and generate synonyms
    let expandedQuery = messageText;
    let productList: string[] = [];
    try {
      const llmProvider = await createLLMProvider();

      const expansionPrompt = `
You are an expert search query expander for a building materials and tools store in Russia.
The user sent this message: "${messageText}"

Your task is to extract ALL products they are looking for and provide professional synonyms or related terms that might be found in a formal price list or catalog.

Examples of expansions:
- "шурик" -> "шуруповерт дрель аккумуляторная"
- "спецзащита" -> "спецодежда СИЗ защита"
- "болгарка" -> "УШМ шлифмашина углошлифовальная"
- "перфик" -> "перфоратор ударная дрель"
- "перчатки" -> "перчатки нитриловые латексные рабочие СИЗ"
- "очки" -> "очки защитные очки строительные"
- "каска" -> "каска защитная шлем строительный"
- "наушники" -> "наушники противошумные беруши защита слуха"
- "лом" -> "лом монтировка инструмент"

If the message contains MULTIPLE products (e.g., "10 ломов, 5 шуриков, 3 перфоратора"), extract EACH product separately on a new line.

Return ONLY the expanded keywords, one product per line. If no expansion is needed, return the original product names.
`;

      const expansionResponse = await llmProvider.generateResponse({
        messages: [{ role: 'user', content: expansionPrompt }],
        systemPrompt: 'You are a helpful search assistant.',
        maxTokens: 200
      });

      const expansions = expansionResponse.content.trim();
      if (expansions && expansions.length > 0 && !expansions.toLowerCase().includes('nothing')) {
        // Split by lines to get individual products
        productList = expansions.split('\n').map(p => p.trim()).filter(p => p.length > 0);
        expandedQuery = `${messageText} ${expansions.replace(/\n/g, ' ')}`;
        logger.info('Expanded search query', {
          original: messageText,
          expanded: expandedQuery,
          productCount: productList.length,
          products: productList
        });
      }
    } catch (expErr) {
      logger.warn('Query expansion failed, using original', { error: expErr });
    }

    // 2. Per-product parallel search — each product gets its own dedicated search
    //    so no single product "drowns out" another in a blended embedding vector.
    let searchResults: Awaited<ReturnType<typeof searchDocuments>> = [];

    if (productList.length > 1) {
      // Run searches in parallel, 5 chunks per product
      const perProductK = 5;
      const perProductResults = await Promise.all(
        productList.map(product =>
          searchDocuments(product, { k: perProductK, minSimilarity: 0.05 }).catch(err => {
            logger.warn('Per-product search failed', { product, error: err });
            return [] as typeof searchResults;
          })
        )
      );

      // Merge: deduplicate by content, keep highest similarity for duplicates
      const seenContent = new Map<string, typeof searchResults[number]>();
      for (const results of perProductResults) {
        for (const r of results) {
          const existing = seenContent.get(r.content);
          if (!existing || r.similarity > existing.similarity) {
            seenContent.set(r.content, r);
          }
        }
      }
      searchResults = Array.from(seenContent.values()).sort((a, b) => b.similarity - a.similarity);

      logger.info('Per-product parallel search completed', {
        userId: ctx.from?.id,
        products: productList,
        totalUniqueChunks: searchResults.length,
        topChunks: searchResults.slice(0, 3).map(r => ({
          source: r.citation.source,
          similarity: r.similarity.toFixed(3),
          preview: r.content.substring(0, 80)
        }))
      });
    } else {
      // Single product or no expansion — use original merged search
      const dynamicK = 10;
      searchResults = await searchDocuments(expandedQuery, {
        k: dynamicK,
        minSimilarity: 0.05
      });

      logger.info('Single-query search completed', {
        userId: ctx.from?.id,
        query: expandedQuery.substring(0, 150),
        chunksFound: searchResults.length
      });
    }

    // Handle no results case
    if (searchResults.length === 0) {
      await ctx.reply(
        'К сожалению, я не нашел информации по вашему вопросу.\n\n' +
        'Пожалуйста, оставьте свой номер телефона или email, и наш менеджер свяжется с вами для помощи!'
      );

      // We still want to send the notification if a lead was collected!
      const leadData = ctx.session.leadData;
      if (leadData.email || leadData.phone) {
        try {
          const userId = ctx.from?.id || 0;
          await processCollectedContact(userId, leadData, ctx);
          ctx.session.leadCollected = true;
        } catch (e) {
          logger.warn('Failed to send lead from empty search', { error: e });
        }
      }
      return;
    }

    // Phase 3: LLM integration with RAG context
    const ragContext = extractContext(searchResults);

    // Load conversation history from session
    const sessionHistory = ctx.session.messageHistory || [];

    // Convert session history to generic message format
    const conversationHistory = sessionHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Calculate token budget
    const budget = contextManager.calculateBudget(
      searchResults.length,
      sessionHistory.length
    );

    // Truncate history to fit budget
    const truncatedHistory = contextManager.truncateHistory(
      conversationHistory,
      budget.conversationHistory
    );

    // Truncate RAG context (rough estimate: 1 token ≈ 4 chars)
    const truncatedRagContext = ragContext.substring(0, budget.ragContext * 4);

    // Build prompt with RAG context + history
    const messages = buildPrompt(truncatedRagContext, truncatedHistory, messageText);

    // Generate AI response with dynamic provider
    let response: string;
    try {
      // Determine active persona from database
      let activeTemplate: string = 'consultant';
      try {
        const configResult = await db.query('SELECT active_template FROM bot_config WHERE id = 1');
        if (configResult.rows.length > 0 && configResult.rows[0].active_template) {
          activeTemplate = configResult.rows[0].active_template;
        }
      } catch (err) {
        logger.warn('Failed to fetch active_template from bot_config, defaulting to consultant', { error: err });
      }

      // Provider already created above for expansion, or recreate if needed
      const llmProvider = await createLLMProvider();

      const llmResponse = await llmProvider.generateResponse({
        messages,
        systemPrompt: buildSystemPrompt(activeTemplate, (ctx.session as any).hasRequestedContacts),
        maxTokens: budget.maxOutput
      });

      response = llmResponse.content;

      // --- AUTONOMOUS ORDER COLLECTION (CHECKOUT TRIGGER) ---
      if (response.includes('[TRIGGER_CHECKOUT]')) {
        logger.info('Checkout trigger detected', { userId: ctx.from?.id });

        // Remove the trigger mark before showing to user
        response = response.replace(/\[TRIGGER_CHECKOUT\]/g, '').trim();

        // Ask LLM to summarize the cart from the order interaction
        try {
          const cartPrompt = `
You are a cart extraction assistant.
Extract ONLY the products that the USER explicitly asked for AND confirmed in this conversation.

CRITICAL RULES:
1. Include ONLY items the user clearly requested (e.g. "возьми 5", "добавь", "оформи", "да" in response to a specific product offer).
2. DO NOT include products that were only mentioned by the assistant as suggestions or search results.
3. DO NOT invent or add any items not explicitly chosen by the user.
4. Use the following simple and clean format for each item. DO NOT use markdown like ** or *:
   ➖ Название товара
      Количество шт × Цена₽

5. Example of correct output:
   ➖ MAKITA DHR165Z
      5 шт × 13,580₽
   
   ➖ Лопата совковая
      2 шт × 250₽

6. IF NO ITEMS WERE SELECTED (e.g., the user just asked for a manager callback), RETURN EXACTLY THIS STRING AND NOTHING ELSE: EMPTY_CART

Conversation (last messages only):
${JSON.stringify(messages.slice(-10))}`;

          const cartResponse = await llmProvider.generateResponse({
            messages: [{ role: 'user', content: cartPrompt }],
            systemPrompt: 'You extract compact product lists. Only include what the user explicitly confirmed.',
            maxTokens: 250
          });

          const rawCart = cartResponse.content.trim();
          if (rawCart.includes('EMPTY_CART') || rawCart === '') {
            (ctx.session as any).cart = undefined;
            logger.info('Cart generated as empty (likely callback request)');
          } else {
            // Append manager clarification message
            (ctx.session as any).cart = calculateCartTotal(rawCart);
            logger.info('Cart generated successfully', { cart: (ctx.session as any).cart });
          }
        } catch (cartErr) {
          logger.warn('Failed to generate cart summary, using fallback', { error: cartErr });
          (ctx.session as any).cart = 'Товары по диалогу (требует уточнения менеджером)';
        }

        // If the LLM generated a friendly response (like "Конечно, переключаю на менеджера"), 
        // save it to session so the lead flow can use it as the greeting.
        if (response) {
          (ctx.session as any).leadGreeting = response;
        }

        // Enter the lead collection flow — it will show the cart and ask for phone.
        // We do NOT send a separate reply here to avoid duplicate messages.
        await ctx.conversation.enter('leadCollectionFlow');
        return; // Break out representing end of message-handling for this turn
      }
      // --- END AUTONOMOUS ORDER COLLECTION ---

      // Track if the bot asked for contacts in this message
      const responseLower = response.toLowerCase();
      if (!(ctx.session as any).hasRequestedContacts &&
        (responseLower.includes('телефон') || responseLower.includes('email') || responseLower.includes('связаться с вами') || responseLower.includes('наш менеджер'))) {
        (ctx.session as any).hasRequestedContacts = true;
        logger.info('Contact request detected, setting flag to true', { userId: ctx.from?.id });
      }
    } catch (error) {
      logger.error('LLM generation failed, falling back to RAG only', {
        userId: ctx.from?.id,
        error: error instanceof Error ? error.message : String(error)
      });

      // Fallback: show friendly error instead of raw RAG data
      await ctx.reply(
        'Извините, сейчас возникли технические трудности. Попробуйте повторить запрос через несколько секунд.\n\n' +
        'Если проблема повторяется — оставьте свой номер телефона, и наш менеджер свяжется с вами!'
      );
      return;
    }

    // Send response (smart truncation to avoid cutting mid-sentence)
    await ctx.reply(smartTruncate(response, 4000));  // Telegram limit is 4096

    // Update conversation history (last 10 turns only)
    const updatedHistory = [
      ...sessionHistory,
      {
        role: 'user' as const,
        content: messageText,
        timestamp: new Date()
      },
      {
        role: 'assistant' as const,
        content: response,
        timestamp: new Date()
      }
    ].slice(-20);  // Keep last 10 turns (20 messages)

    ctx.session.messageHistory = updatedHistory;

    // Only send notification if user provided actual contactable info (email or phone)
    const leadData = ctx.session.leadData;
    if (!ctx.session.leadCollected && (leadData.email || leadData.phone)) {
      {
        try {
          // Forward to admin via selected transport
          const userId = ctx.from?.id || 0;
          await processCollectedContact(userId, leadData, ctx);

          await webhookService.send({
            event_type: 'lead_collected',
            timestamp: new Date().toISOString(),
            webhook_id: crypto.randomUUID(),
            user_id: String(userId),
            username: ctx.from?.username,
            message: messageText,
            collected_data: {
              name: leadData.name,
              email: leadData.email,
              phone: leadData.phone,
              additional_info: leadData.additional_info
            }
          });
          logger.info('Webhook and Notification sent for completed lead', { userId });

          // Mark as collected to prevent spamming notifications on every subsequent message
          ctx.session.leadCollected = true;
        } catch (webhookError) {
          logger.warn('Notification delivery failed (non-critical)', {
            userId: ctx.from?.id,
            error: webhookError instanceof Error ? webhookError.message : String(webhookError)
          });
        }
      }
    }

    logger.info('RAG query completed', {
      userId: ctx.from?.id,
      resultsFound: searchResults.length,
      avgSimilarity: searchResults.reduce((sum, r) => sum + r.similarity, 0) / searchResults.length
    });
  } catch (error: any) {
    logger.error('RAG query failed', {
      userId: ctx.from?.id,
      error: error.message
    });

    await ctx.reply(
      'Произошла ошибка при поиске информации. Пожалуйста, попробуйте позже или обратитесь в поддержку.'
    );
  }
}
