import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Webhook event types for different bot interactions
 */
export type WebhookEventType = 'lead_collected' | 'conversation_complete' | 'escalation';

/**
 * Structured webhook payload for CRM delivery
 *
 * webhook_id enables idempotent processing - CRMs can deduplicate if retry delivers twice
 */
export interface WebhookPayload {
  /** Type of event triggering the webhook */
  event_type: WebhookEventType;
  /** ISO 8601 timestamp of event */
  timestamp: string;
  /** Unique ID for idempotency (UUID v4) */
  webhook_id: string;
  /** Telegram user ID */
  user_id: string;
  /** Telegram username if available */
  username?: string;
  /** Latest user message or conversation summary */
  message: string;
  /** Optional conversation summary for completed conversations */
  conversation_summary?: string;
  /** Collected lead data */
  collected_data: {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    [key: string]: any;
  };
  /** Optional categorization tags */
  tags?: string[];
  /** Optional lead quality score (0-100) */
  lead_score?: number;
}

/**
 * Webhook delivery service with exponential backoff retry
 *
 * Features:
 * - 5 retries with exponential backoff (covers ~30s of transient downtime)
 * - 10s timeout (prevents blocking user responses)
 * - Retries on network errors and retriable HTTP statuses (408, 429, 500+)
 * - Graceful handling of undefined webhook URL
 * - UUID-based webhook IDs for CRM idempotency
 *
 * Based on Pattern 4 (Webhook Delivery with Retry) from 03-RESEARCH.md
 */
export class WebhookService {
  private client: AxiosInstance | null = null;
  private webhookUrl: string | undefined;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl || env.WEBHOOK_URL;

    if (!this.webhookUrl) {
      logger.warn('WEBHOOK_URL not configured - webhook delivery disabled');
      return;
    }

    // Initialize axios client with retry configuration
    this.client = axios.create({
      timeout: 10000, // 10s timeout prevents blocking user responses
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AI-Assistant-Box/1.0',
      },
    });

    // Configure exponential backoff retry logic
    axiosRetry(this.client, {
      retries: 5, // Covers ~30 seconds of downtime
      retryDelay: axiosRetry.exponentialDelay,
      shouldResetTimeout: true,
      retryCondition: (error: AxiosError) => {
        // Retry on network errors
        if (axiosRetry.isNetworkError(error)) {
          return true;
        }

        // Retry on specific HTTP status codes
        const status = error.response?.status;
        if (!status) return false;

        // Retry on: timeout (408), rate limit (429), server errors (500+)
        return status === 408 || status === 429 || status >= 500;
      },
    });

    logger.info('WebhookService initialized', { webhookUrl: this.webhookUrl });
  }

  /**
   * Send webhook payload to configured CRM endpoint
   *
   * @param payload Structured webhook data
   * @throws Error if all retry attempts fail
   */
  async send(payload: WebhookPayload): Promise<void> {
    if (!this.client || !this.webhookUrl) {
      logger.debug('Webhook delivery skipped - not configured', {
        eventType: payload.event_type,
        userId: payload.user_id,
      });
      return;
    }

    try {
      logger.info('Sending webhook', {
        url: this.webhookUrl,
        eventType: payload.event_type,
        userId: payload.user_id,
        webhookId: payload.webhook_id,
      });

      const response = await this.client.post(this.webhookUrl, payload);

      logger.info('Webhook delivered successfully', {
        status: response.status,
        userId: payload.user_id,
        webhookId: payload.webhook_id,
      });
    } catch (error) {
      const axiosError = error as AxiosError;

      logger.error('Webhook delivery failed after retries', {
        url: this.webhookUrl,
        eventType: payload.event_type,
        userId: payload.user_id,
        webhookId: payload.webhook_id,
        error: axiosError.message,
        status: axiosError.response?.status,
        retries: axiosError.config?.['axios-retry']?.retryCount,
      });

      throw new Error(`Webhook delivery failed: ${axiosError.message}`);
    }
  }

  /**
   * Create webhook payload with auto-generated ID and timestamp
   *
   * Helper method to ensure consistent payload structure
   */
  static createPayload(
    eventType: WebhookEventType,
    userId: string,
    message: string,
    collectedData: WebhookPayload['collected_data'],
    options?: {
      username?: string;
      conversationSummary?: string;
      tags?: string[];
      leadScore?: number;
    }
  ): WebhookPayload {
    return {
      event_type: eventType,
      timestamp: new Date().toISOString(),
      webhook_id: uuidv4(),
      user_id: userId,
      username: options?.username,
      message,
      conversation_summary: options?.conversationSummary,
      collected_data: collectedData,
      tags: options?.tags,
      lead_score: options?.leadScore,
    };
  }
}
