import { db } from '../db/client.js';

export interface DashboardMetrics {
  totalConversations: number;
  totalMessages: number;
  avgResponseTimeMs: number;
  totalWebhooks: number;
  uniqueUsers: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
  dailyActivity: Array<{ date: string; count: number }>;
}

/**
 * Get aggregated dashboard metrics for date range
 */
export async function getDashboardMetrics(
  startDate: Date,
  endDate: Date
): Promise<DashboardMetrics> {
  // Total conversations
  const conversationsResult = await db.query(
    `SELECT COUNT(*) as count FROM analytics_events
     WHERE event_type = 'conversation_start'
     AND timestamp >= $1 AND timestamp <= $2`,
    [startDate, endDate]
  );

  // Total messages + avg response time
  const messagesResult = await db.query(
    `SELECT COUNT(*) as count,
            COALESCE(AVG((metadata->>'response_time_ms')::numeric), 0) as avg_time
     FROM analytics_events
     WHERE event_type = 'message_sent'
     AND timestamp >= $1 AND timestamp <= $2`,
    [startDate, endDate]
  );

  // Unique users
  const usersResult = await db.query(
    `SELECT COUNT(DISTINCT user_id) as count FROM analytics_events
     WHERE timestamp >= $1 AND timestamp <= $2`,
    [startDate, endDate]
  );

  // Webhook count
  const webhooksResult = await db.query(
    `SELECT COUNT(*) as count FROM analytics_events
     WHERE event_type = 'webhook_triggered'
     AND timestamp >= $1 AND timestamp <= $2`,
    [startDate, endDate]
  );

  // Token usage
  const tokensResult = await db.query(
    `SELECT
       COALESCE(SUM((metadata->>'input_tokens')::numeric), 0) as input_tokens,
       COALESCE(SUM((metadata->>'output_tokens')::numeric), 0) as output_tokens
     FROM analytics_events
     WHERE event_type = 'llm_response'
     AND timestamp >= $1 AND timestamp <= $2`,
    [startDate, endDate]
  );

  // Daily activity (last 30 days)
  const dailyResult = await db.query(
    `SELECT DATE(timestamp) as date, COUNT(*) as count
     FROM analytics_events
     WHERE event_type = 'message_sent'
     AND timestamp >= $1 AND timestamp <= $2
     GROUP BY DATE(timestamp)
     ORDER BY date DESC
     LIMIT 30`,
    [startDate, endDate]
  );

  return {
    totalConversations: parseInt(conversationsResult.rows[0]?.count || '0'),
    totalMessages: parseInt(messagesResult.rows[0]?.count || '0'),
    avgResponseTimeMs: parseFloat(messagesResult.rows[0]?.avg_time || '0'),
    totalWebhooks: parseInt(webhooksResult.rows[0]?.count || '0'),
    uniqueUsers: parseInt(usersResult.rows[0]?.count || '0'),
    tokenUsage: {
      inputTokens: parseInt(tokensResult.rows[0]?.input_tokens || '0'),
      outputTokens: parseInt(tokensResult.rows[0]?.output_tokens || '0'),
    },
    dailyActivity: dailyResult.rows.map((row) => ({
      date: row.date,
      count: parseInt(row.count),
    })),
  };
}
