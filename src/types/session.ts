/**
 * Session data structure for conversation state management
 * Stored in Redis with 24-hour TTL
 */
export interface SessionData {
  /**
   * Current state in the conversation state machine
   * - idle: No active conversation
   * - collecting_lead: Gathering user information
   * - confirming: Confirming collected data before submission
   */
  conversationState: 'idle' | 'collecting_lead' | 'confirming';

  /**
   * Partial lead data collected during conversation
   * Fields are filled progressively as user provides information
   */
  leadData: {
    name?: string;
    email?: string;
    phone?: string;
    additional_info?: string;
  };

  /**
   * Message history for conversation context
   * Maintained as sliding window (last N messages) to manage context size
   */
  messageHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;

  /**
   * Compressed summary for long conversations
   * Generated when messageHistory exceeds threshold
   */
  conversationSummary?: string;

  /**
   * Last activity timestamp for session management
   * Updated on each message, used for TTL and analytics
   */
  lastActivityAt: Date;

  /**
   * Message counter for testing session persistence
   * Increments across messages to verify Redis storage working
   */
  messageCount?: number;

  /**
   * Flag indicating if the lead information has already been collected and sent
   * to avoid duplicate webhook/notification spam
   */
  leadCollected?: boolean;

  /**
   * Flag to limit contact request spam
   */
  hasRequestedContacts?: boolean;

  /**
   * Selected items/cart for the user's order
   */
  cart?: string;
}
