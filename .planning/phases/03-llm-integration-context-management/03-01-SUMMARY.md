# Plan 03-01 Summary: LLM Service and Context Management

**Status:** ✓ Complete
**Wave:** 1
**Duration:** ~10 minutes
**Autonomous:** Yes

## What Was Built

Implemented Claude API integration with intelligent context management that balances RAG-retrieved documents and conversation history within token limits.

### Task 1: LLM Service with Claude API Integration
- Created `LLMService` class with Anthropic SDK integration
- Configured claude-sonnet-4-5-20250929 model with streaming API
- Implemented token usage tracking via API response `usage` field
- Added comprehensive error handling with Russian user messages for all status codes (400, 401, 429, 500, 529)
- Auto-retry configured (maxRetries: 2) for transient failures

### Task 2: Context Management Service
- Created `ContextManager` class for dynamic token budget allocation
- Enforced 80% safe usage limit (160K of 200K context window)
- Implemented dynamic split strategy:
  - Conversational queries (>3 turns): 50/50 RAG/history split
  - Simple queries (≤3 turns): 70/30 RAG/history split
- Added `truncateHistory()` to preserve recent messages within budget
- Token estimation: 1 token ≈ 4 characters

### Task 3: System Prompts and Prompt Builder
- Defined three bot personas: consultant (default), support, orderTaker
- Each persona has goals (5 items) and behavior rules (4 items)
- Implemented `buildSystemPrompt()` with current date injection
- Created `buildPrompt()` for dynamic message assembly
- RAG context placed at end before user query (avoid lost-in-middle problem)

## Files Created/Modified

**Created:**
- `src/services/llm.ts` (115 lines) - Claude API integration with streaming
- `src/services/context-manager.ts` (144 lines) - Token budget allocation
- `src/prompts/system-prompts.ts` (102 lines) - Bot persona templates
- `src/prompts/prompt-builder.ts` (33 lines) - Dynamic prompt assembly

## Key Decisions

1. **Streaming API over standard:** Prevents timeout on long responses (>30s)
2. **Token tracking via API response:** Client-side tokenizers inaccurate for Claude 3+
3. **80% context limit:** Conservative buffer prevents edge-case overflow
4. **Dynamic RAG/history split:** Optimizes for query type (conversational vs simple)
5. **Three personas now:** Establishes pattern for Phase 4 configurability

## Deviations

None. Plan executed exactly as written.

## Integration Points

**Ready for:**
- Plan 03-03 (Bot Integration) to use `LLMService.generateResponse()`
- `ContextManager.calculateBudget()` for token allocation
- `buildSystemPrompt('consultant')` for default persona
- `buildPrompt()` to assemble RAG + history into messages

**Dependencies on:**
- @anthropic-ai/sdk (already installed)
- `src/config/env.ts` (ANTHROPIC_API_KEY)
- `src/utils/logger.ts` (logging)

## Verification

- [x] npm run build passes without errors
- [x] All 4 files created with required exports
- [x] Token usage logging present (usage.input_tokens, usage.output_tokens)
- [x] Error handling covers all specified status codes
- [x] Context budget enforces 80% limit (SAFE_USAGE_PERCENT = 0.80)
- [x] Three system prompts defined (consultant, support, orderTaker)

## Commits

- `568b280` - feat(03-01): implement LLM service with Claude API integration
- `4f1d692` - feat(03-01): implement context management service
- `eecb4b6` - feat(03-01): implement system prompts and prompt builder

## Success Criteria

All 6 LLM requirements addressed:
- ✅ LLM-01: Claude API integration with Sonnet 4.5
- ✅ LLM-02: System prompt templates (consultant, support, orderTaker)
- ✅ LLM-03: RAG context inclusion via prompt builder
- ✅ LLM-04: Conversation history management
- ✅ LLM-05: Context window monitoring (80% limit)
- ✅ LLM-06: Graceful error handling with Russian user messages

**Ready for Wave 2:** Plan 03-03 can now integrate these services into bot message handler.
