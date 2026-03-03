# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pack50 is an AI-powered Telegram bot for customer service in the Russian SMB market. It features RAG (Retrieval-Augmented Generation) with vector search, multi-provider LLM support (Anthropic Claude & OpenAI GPT), and a web-based admin panel.

**Tech Stack:**
- TypeScript (ESM modules with strict mode)
- Grammy (Telegram bot framework)
- PostgreSQL with pgvector extension for vector similarity search
- Redis (session storage)
- Express (admin API and document upload)
- Docker Compose (production deployment)

## Development Commands

### Local Development
```bash
# Install dependencies
npm install

# Run in development mode (long polling)
npm run dev

# Build TypeScript to dist/
npm run build

# Run production build
npm start
```

### Testing
```bash
# Test RAG pipeline (document ingestion + vector search)
npm run test:rag

# Test LLM integration (Claude/GPT API calls)
npm run test:llm

# Type checking only
npm run build
```

### Docker Operations
```bash
# Build and start all services (postgres, redis, bot)
docker compose up -d

# View logs
docker compose logs -f bot
docker compose logs -f postgres

# Stop services
docker compose down

# Rebuild bot container after code changes
docker compose up -d --build bot
```

## Architecture

### Core Flow: User Message → RAG → LLM → Response

1. **Message Handler** ([src/bot/handlers/message-handler.ts](src/bot/handlers/message-handler.ts)):
   - Entry point for all non-conversation messages
   - Coordinates RAG retrieval + LLM generation
   - Manages conversation history and session state

2. **RAG Pipeline**:
   - **Document Processing** ([src/services/document-processing.ts](src/services/document-processing.ts)): Ingests PDF/DOCX/URL
   - **Embedding** ([src/services/embedding.ts](src/services/embedding.ts)): Uses `@xenova/transformers` (all-MiniLM-L6-v2) for 384-dim vectors
   - **Retrieval** ([src/services/retrieval.ts](src/services/retrieval.ts)): pgvector cosine similarity search (IVFFlat index)
   - **Text Splitter** ([src/services/text-splitter.ts](src/services/text-splitter.ts)): Chunks documents with overlap

3. **LLM Integration** (Multi-Provider):
   - **Provider Factory** ([src/services/llm/provider-factory.ts](src/services/llm/provider-factory.ts)): Dynamically creates provider based on DB config
   - **Anthropic Provider** ([src/services/llm/anthropic-provider.ts](src/services/llm/anthropic-provider.ts)): Claude Sonnet 4.5/3.5
   - **OpenAI Provider** ([src/services/llm/openai-provider.ts](src/services/llm/openai-provider.ts)): GPT-4o/GPT-4o-mini
   - Supports custom API base URLs for OpenAI-compatible endpoints

4. **Context Management** ([src/services/context-manager.ts](src/services/context-manager.ts)):
   - Token budget allocation: 80% of 200K context window
   - Dynamic split: 50/50 (RAG/history) for conversational, 70/30 for queries
   - Truncates history from oldest messages first

### Bot Architecture

**Dual Mode Operation:**
- **Development**: Long polling + separate Express server ([src/index.ts](src/index.ts):68-93)
- **Production**: Webhook mode with integrated Express ([src/index.ts](src/index.ts):45-66, [src/bot/webhook.ts](src/bot/webhook.ts))

**Session Management:**
- Redis-backed sessions ([src/bot/middleware/session.ts](src/bot/middleware/session.ts))
- Stores conversation state, message history (last 20 messages), lead data
- Session type defined in [src/types/session.ts](src/types/session.ts)

**Grammy Conversations:**
- Lead collection flow: [src/bot/conversations/lead-collection.ts](src/bot/conversations/lead-collection.ts)
- Uses `@grammyjs/conversations` for multi-step user interactions

### Database Schema

**Primary Tables** ([src/db/schema.sql](src/db/schema.sql)):
- `users`: Telegram user info (telegram_id, username)
- `conversations`: Conversation tracking with lead_data JSONB
- `messages`: Conversation history
- `leads`: Captured contact information
- `document_chunks`: RAG document storage with vector(384) embeddings
- `bot_config`: Singleton table for active model/template/API keys
- `llm_providers`: Multi-provider support (new table, takes precedence over bot_config)
- `system_prompts`: Custom prompt templates
- `analytics_events`: Usage metrics
- `admin_users`: Admin panel authentication

**Indexes:**
- IVFFlat index on `document_chunks.embedding` (100 lists for 10K docs)
- GIN index on `document_chunks.metadata` for filtering
- Standard B-tree indexes on foreign keys and query patterns

### API Routes

**Document Upload** ([src/api/routes/documents.ts](src/api/routes/documents.ts)):
- `POST /api/documents/upload` - Multipart file upload (PDF/DOCX)
- `POST /api/documents/url` - Ingest from URL

**Admin Panel** ([src/api/routes/admin.ts](src/api/routes/admin.ts)):
- `POST /api/admin/login` - JWT authentication
- `GET /api/admin/config` - Get bot configuration
- `PUT /api/admin/config` - Update model/keys/prompts
- `GET /api/admin/analytics?days=30` - Usage metrics
- All endpoints require JWT auth via middleware ([src/middleware/admin-auth.ts](src/middleware/admin-auth.ts))

**Providers** ([src/api/routes/providers.ts](src/api/routes/providers.ts)):
- `GET /api/providers` - List all LLM providers
- `POST /api/providers` - Add new provider
- `PUT /api/providers/:id/activate` - Set active provider
- `DELETE /api/providers/:id` - Remove provider

### Configuration & Environment

**Environment Variables** ([src/config/env.ts](src/config/env.ts)):
- Validated with Zod schema at startup
- Required: `BOT_TOKEN`, `DATABASE_URL`, `REDIS_URL`
- Optional LLM keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- Optional: `WEBHOOK_URL`, `WEBHOOK_SECRET`, `ENCRYPTION_KEY`, `JWT_SECRET`
- All LLM API keys are optional - can be configured via admin panel instead

**Encryption** ([src/utils/encryption.ts](src/utils/encryption.ts)):
- AES-256-CBC encryption for API keys stored in database
- Uses `ENCRYPTION_KEY` from .env
- IV stored per-key in database for security

**System Prompts** ([src/prompts/system-prompts.ts](src/prompts/system-prompts.ts)):
- Built-in personas: `consultant`, `sales`, `support`, `custom`
- Loaded from `bot_config.active_template` or custom `system_prompts` table
- Can be edited via admin panel

### Key Design Patterns

1. **Provider Factory Pattern**: LLM provider selection is dynamic at runtime
   - First checks `llm_providers` table for `is_active = TRUE`
   - Falls back to `bot_config` table
   - Falls back to environment variables
   - Supports custom API base URLs (e.g., OpenRouter, local proxies)

2. **Graceful Degradation**: If LLM fails, falls back to raw RAG results

3. **Token Budget Management**: Context manager prevents context overflow
   - 80% safe usage of 200K window
   - Prioritizes: system prompt (fixed) > recent history > RAG context

4. **Webhook Validation**: Uses HMAC-SHA256 with `WEBHOOK_SECRET` ([src/bot/webhook.ts](src/bot/webhook.ts):70-86)

5. **Logging**: Structured logging with Winston ([src/utils/logger.ts](src/utils/logger.ts))

## Common Gotchas

### ESM Module Resolution
- All imports must include `.js` extension (not `.ts`)
- Example: `import { foo } from './bar.js'` even for TypeScript files
- tsconfig.json: `"module": "ESNext"`, `"moduleResolution": "node"`

### Provider Configuration Priority
When creating LLM provider, the system checks in order:
1. `llm_providers` table (new multi-provider system)
2. `bot_config` table (legacy single-provider config)
3. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)

### Database Connection
- Connection pool initialized in [src/db/client.ts](src/db/client.ts)
- Schema auto-initialized on startup ([src/index.ts](src/index.ts):33)
- Must call `closeDatabase()` during shutdown

### Embedding Model Preloading
- Embedding model preloaded at startup to avoid cold-start latency ([src/index.ts](src/index.ts):40-42)
- Uses `@xenova/transformers` (runs in Node.js, no Python needed)
- Model: `Xenova/all-MiniLM-L6-v2` (384 dimensions)

### Session State Management
- Session state tracked via `conversationState` field: `'idle' | 'collecting_lead' | 'confirming_lead'`
- Message handler only processes when state is `'idle'` ([src/bot/handlers/message-handler.ts](src/bot/handlers/message-handler.ts):28-30)
- Conversation flows manage their own state transitions

### Vector Search Tuning
- Default similarity threshold: 0.1 (lowered from 0.3 for better recall)
- Default top-k: 5 chunks
- IVFFlat index: 100 lists (optimal for ~10K documents)
- Cosine similarity: `1 - (embedding <=> query_embedding)`

## Deployment

### Production Environment
1. Configure `.env` with secrets (see [README.md](README.md):60-68)
2. Run `docker compose up -d`
3. Bot runs in webhook mode if `WEBHOOK_URL` and `WEBHOOK_SECRET` are set
4. Access admin panel at `http://localhost:3000` (default credentials in logs after first run)

### VPS Deployment
- Use provided `install.sh` and `configure.sh` for automated setup
- Resource limits: < 1GB RAM total (512MB bot + 256MB postgres + 128MB redis)
- Health checks and auto-restart enabled

## File Organization

- **src/bot/**: Grammy bot setup, handlers, keyboards, conversations
- **src/services/**: Core business logic (LLM, RAG, embeddings, context management)
- **src/api/**: Express routes for document upload and admin panel
- **src/db/**: Database client, schema, repositories
- **src/loaders/**: Document loaders (PDF, DOCX, TXT, web scraping)
- **src/prompts/**: System prompts and prompt builders
- **src/middleware/**: Express middleware (auth, rate limiting)
- **src/types/**: TypeScript type definitions
- **src/utils/**: Logging, encryption utilities
- **src/test/**: Integration tests for RAG and LLM
