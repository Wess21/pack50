import type { LLMMessage } from '../services/llm/types.js';

/**
 * Build prompt for LLM by assembling RAG context and conversation history
 * Places RAG context at the end before user query to avoid "lost-in-middle" problem
 *
 * @param ragContext - Context extracted from RAG retrieval (formatted with sources)
 * @param conversationHistory - Previous messages in the conversation
 * @param userQuery - Current user question
 * @returns Messages array for LLM API
 */
export function buildPrompt(
  ragContext: string,
  conversationHistory: LLMMessage[],
  userQuery: string
): LLMMessage[] {
  // Assemble messages: conversation history + RAG context with user query
  // RAG context placed at end to maximize LLM attention (avoid lost-in-middle)
  const messages: LLMMessage[] = [
    ...conversationHistory,
    {
      role: 'user',
      content: `Context from knowledge base:\n\n${ragContext}\n\n---\n\nUser question: ${userQuery}`
    }
  ];

  return messages;
}
