import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

export type EventType =
  | 'conversation_start'
  | 'message_sent'
  | 'webhook_triggered'
  | 'llm_response'
  | 'rag_search'
  | 'error_occurred';

export interface AnalyticsEvent {
  event_type: EventType;
  user_id: number;
  metadata?: Record<string, any>;
}

/**
 * Analytics service for tracking bot usage and performance metrics
 */
export class AnalyticsService {
  /**
   * Track generic analytics event
   */
  async track(event: AnalyticsEvent): Promise<void> {
    try {
      await db.query(
        'INSERT INTO analytics_events (event_type, user_id, metadata) VALUES ($1, $2, $3)',
        [event.event_type, event.user_id, JSON.stringify(event.metadata || {})]
      );
    } catch (error: any) {
      // Don't fail requests if analytics fails
      logger.error('Analytics tracking failed', { error: error.message, event });
    }
  }

  /**
   * Track conversation start
   */
  async trackConversationStart(userId: number): Promise<void> {
    await this.track({ event_type: 'conversation_start', user_id: userId });
  }

  /**
   * Track message sent with response time
   */
  async trackMessage(
    userId: number,
    metadata: {
      message_length: number;
      response_time_ms: number;
      model_used?: string;
    }
  ): Promise<void> {
    await this.track({
      event_type: 'message_sent',
      user_id: userId,
      metadata,
    });
  }

  /**
   * Track webhook delivery
   */
  async trackWebhook(userId: number, success: boolean): Promise<void> {
    await this.track({
      event_type: 'webhook_triggered',
      user_id: userId,
      metadata: { success },
    });
  }

  /**
   * Track LLM response with token usage
   */
  async trackLLMResponse(
    userId: number,
    metadata: {
      input_tokens: number;
      output_tokens: number;
      model: string;
    }
  ): Promise<void> {
    await this.track({
      event_type: 'llm_response',
      user_id: userId,
      metadata,
    });
  }

  /**
   * Track RAG search performance
   */
  async trackRAGSearch(
    userId: number,
    metadata: {
      query_length: number;
      results_count: number;
      search_time_ms: number;
    }
  ): Promise<void> {
    await this.track({
      event_type: 'rag_search',
      user_id: userId,
      metadata,
    });
  }
}

// Singleton instance
export const analyticsService = new AnalyticsService();
