/**
 * Common types for LLM providers
 */

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMGenerateRequest {
  messages: LLMMessage[];
  systemPrompt?: string;
  maxTokens: number;
  temperature?: number;
}

export interface LLMGenerateResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Provider interface that all LLM implementations must satisfy
 */
export interface LLMProvider {
  name: string;
  generateResponse(request: LLMGenerateRequest): Promise<LLMGenerateResponse>;
  testConnection(): Promise<boolean>;
}

/**
 * Supported AI models
 */
export type ModelName =
  | 'claude-sonnet-4-5'
  | 'claude-sonnet-3-5'
  | 'gpt-4o'
  | 'gpt-4o-mini';
