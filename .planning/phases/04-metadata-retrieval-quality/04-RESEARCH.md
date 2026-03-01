# Phase 4 Research: Metadata & Retrieval Quality + Admin Interface

**Phase Goal**: Bot delivers more accurate answers through enhanced retrieval and administrators can configure bot behavior through interface

**Requirements**: ADM-01, ADM-02, ADM-03, ADM-04, ADM-05

## Context from Previous Phases

### What We Have (Phase 1-3)
- ✅ Telegram bot with stateful conversations (Phase 1)
- ✅ Document ingestion (PDF, DOCX, URL) with chunking (Phase 2)
- ✅ Vector embeddings via all-MiniLM-L6-v2 (Phase 2)
- ✅ RAG retrieval with Top-5 similarity search (Phase 2)
- ✅ Claude API integration (Sonnet 4.5) (Phase 3)
- ✅ Context management with token budgets (Phase 3)
- ✅ 3 system prompt templates: consultant, support, orderTaker (Phase 3)
- ✅ Webhook delivery to CRM with retry logic (Phase 3)

### What Phase 4 Adds
1. **Admin Interface** - Web UI for bot configuration
2. **Model Selection** - Switch between OpenAI/Anthropic models
3. **Prompt Editing** - Customize system prompts via UI
4. **Analytics Dashboard** - View conversation metrics
5. **Retrieval Quality** - Metadata filtering and improved search

## Requirements Analysis

### ADM-01: AI Model Selection
**Requirement**: Администратор выбирает AI модель (OpenAI/Anthropic) через конфиг

**Current State**:
- Hardcoded to Claude Sonnet 4.5 in `src/services/llm.ts`
- Only Anthropic SDK imported

**What's Needed**:
1. Support for OpenAI SDK alongside Anthropic
2. Unified LLM interface (abstraction layer)
3. Model selection stored in database configuration
4. Admin UI dropdown for model selection
5. Dynamic model loading based on config

**Implementation Approach**:
- Create `ILLMProvider` interface
- Implement `AnthropicProvider` and `OpenAIProvider`
- Factory pattern for provider instantiation
- Store active model in `bot_config` table

### ADM-02: API Key Management
**Requirement**: Администратор добавляет свой API ключ для модели

**Current State**:
- API key in .env file only
- No multi-provider key support

**What's Needed**:
1. Encrypted storage of multiple API keys (Anthropic + OpenAI)
2. Admin UI form for key input
3. Key validation (test API call)
4. Secure key retrieval for LLM service

**Security Considerations**:
- Encrypt keys in database (AES-256)
- Never expose keys in API responses
- Validation endpoint doesn't return key

### ADM-03: Prompt Template Selection
**Requirement**: Администратор выбирает шаблон промпта (Консультант/Техподдержка/Прием заказов)

**Current State**:
- 3 templates in `src/prompts/system-prompts.ts`
- Hardcoded to 'consultant' in message-handler.ts

**What's Needed**:
1. Store active template in bot_config
2. Admin UI for template selection
3. Dynamic template loading in message handler
4. Preview functionality in admin UI

### ADM-04: System Prompt Editing
**Requirement**: Администратор редактирует system prompt для шаблона

**Current State**:
- Prompts hardcoded in TypeScript file
- No persistence layer for custom prompts

**What's Needed**:
1. Database table: `system_prompts` (template_name, content, updated_at)
2. Admin UI with textarea editor
3. Template variables support: {{business_name}}, {{current_date}}
4. Fallback to default prompts if custom not found
5. Real-time prompt preview

**Technical Approach**:
- Store prompts in PostgreSQL
- Template interpolation via simple string replacement
- Validation: max length, required variables present

### ADM-05: Analytics Dashboard
**Requirement**: Администратор видит базовую аналитику (количество диалогов, эскалаций, время ответа)

**Current State**:
- No analytics collection
- No metrics storage

**What's Needed**:
1. Metrics collection:
   - Total conversations (daily/weekly/monthly)
   - Average response time
   - Escalation count (webhook triggers)
   - Top queries (by frequency)
   - User retention (returning users)
2. Database table: `analytics_events`
3. Dashboard UI with charts
4. Time-range filtering

**Metrics to Track**:
```sql
CREATE TABLE analytics_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50), -- 'conversation_start', 'message_sent', 'webhook_triggered'
  user_id BIGINT,
  metadata JSONB, -- flexible storage for event-specific data
  timestamp TIMESTAMPTZ DEFAULT NOW()
);
```

## Retrieval Quality Enhancements

### Current RAG Pipeline (Phase 2)
1. Embed user query (all-MiniLM-L6-v2)
2. Vector search: Top-5 by cosine similarity
3. No metadata filtering
4. No re-ranking

### Proposed Enhancements
1. **Metadata Filtering**:
   - Filter by doc_type before vector search
   - Filter by date range (recent documents prioritized)
   - Filter by source (specific URLs/files)

2. **Hybrid Search** (optional, future):
   - Combine vector search + keyword search (PostgreSQL FTS)
   - Weighted combination (0.7 vector + 0.3 keyword)

3. **Re-ranking** (optional, future):
   - Cross-encoder model for Top-5 re-ranking
   - Increases accuracy but adds latency (~100ms)

### Metadata Schema Enhancement
**Current**: `document_chunks` has source, page, doc_type, created_at

**Add**:
- `priority` (INTEGER) - Admin can mark important docs
- `tags` (TEXT[]) - Categorization for filtering
- `language` (VARCHAR) - Multi-language support prep

### Implementation Priority
**Must Have for Phase 4**:
- ✅ Metadata filtering by doc_type
- ✅ Date range filtering (created_at)
- ✅ Admin UI for filter configuration

**Nice to Have (Phase 4 or later)**:
- ⏳ Hybrid search (can defer to v1.1)
- ⏳ Re-ranking (can defer to v1.1)
- ⏳ Priority boosting (can defer to v1.1)

## Admin Interface Architecture

### Technology Stack
**Frontend**:
- React + TypeScript (modern, familiar)
- Vite for build (fast, simple)
- TailwindCSS for styling (utility-first, rapid development)
- React Router for navigation
- Chart.js for analytics graphs

**Backend**:
- Extend existing Express API
- New routes: `/api/admin/*`
- JWT authentication for admin access
- Same PostgreSQL database

### Admin API Endpoints
```
POST   /api/admin/login           - Authenticate admin
GET    /api/admin/config          - Get bot configuration
PUT    /api/admin/config          - Update bot config (model, template, keys)
GET    /api/admin/prompts         - List custom prompts
PUT    /api/admin/prompts/:name   - Update prompt template
GET    /api/admin/analytics       - Get dashboard metrics
POST   /api/admin/test-model      - Validate API key with test call
```

### Database Schema Additions
```sql
-- Bot configuration (singleton table)
CREATE TABLE bot_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active_model VARCHAR(50) DEFAULT 'claude-sonnet-4-5', -- or 'gpt-4o'
  active_template VARCHAR(50) DEFAULT 'consultant',
  anthropic_api_key_encrypted TEXT,
  openai_api_key_encrypted TEXT,
  encryption_iv TEXT, -- for AES decryption
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT singleton CHECK (id = 1)
);

-- Custom system prompts
CREATE TABLE system_prompts (
  template_name VARCHAR(50) PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics events
CREATE TABLE analytics_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  user_id BIGINT,
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_analytics_timestamp ON analytics_events(timestamp);
CREATE INDEX idx_analytics_event_type ON analytics_events(event_type);

-- Admin users (simple auth)
CREATE TABLE admin_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, -- bcrypt
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Admin UI Pages
1. **Dashboard** (`/admin`) - Analytics overview
2. **Configuration** (`/admin/config`) - Model selection, API keys
3. **Prompts** (`/admin/prompts`) - Template selection + editing
4. **Documents** (`/admin/documents`) - Upload status, metadata management
5. **Login** (`/admin/login`) - Simple auth

## Implementation Plan Structure

### Suggested Wave Breakdown

**Wave 1: Database Schema + Config API**
- Plan 04-01: Admin database schema and configuration API
  - Create bot_config, system_prompts, analytics_events, admin_users tables
  - Implement config API endpoints (GET/PUT /api/admin/config)
  - Add API key encryption/decryption utilities
  - Create admin authentication middleware
  - Seed initial admin user

**Wave 2: LLM Provider Abstraction**
- Plan 04-02: Multi-provider LLM service
  - Create ILLMProvider interface
  - Refactor existing LLM service into AnthropicProvider
  - Implement OpenAIProvider
  - Add provider factory with config-based selection
  - Update message-handler to use dynamic provider

**Wave 3: Admin Frontend**
- Plan 04-03: Admin interface frontend
  - Setup React + Vite project in `/admin` directory
  - Implement login page with JWT auth
  - Build configuration page (model selection, API keys)
  - Build prompts page (template editor with preview)
  - Build analytics dashboard with Chart.js
  - Add document metadata management UI

**Wave 4: Analytics Collection + Retrieval Enhancements**
- Plan 04-04: Analytics tracking and enhanced RAG
  - Add analytics event tracking to message-handler
  - Implement analytics aggregation queries
  - Add metadata filtering to vector search
  - Create admin endpoint for analytics data
  - Add export functionality (CSV download)

## Technical Risks & Mitigations

### Risk 1: API Key Security
**Risk**: Encrypted keys in DB could be compromised
**Mitigation**:
- Use environment-based encryption key (not in DB)
- Add key rotation capability
- Admin interface served over HTTPS only

### Risk 2: Frontend Complexity
**Risk**: React frontend adds build complexity
**Mitigation**:
- Keep admin UI separate build (not critical path)
- Simple auth (no OAuth complexity)
- Static file serving via Express

### Risk 3: OpenAI SDK Integration
**Risk**: Different API patterns than Anthropic
**Mitigation**:
- Interface abstraction isolates differences
- Start with GPT-4o (most similar to Claude)
- Test coverage for both providers

### Risk 4: Analytics Performance
**Risk**: Query performance degrades with large analytics_events table
**Mitigation**:
- Indexed timestamp and event_type columns
- Pre-aggregated daily summaries (optional)
- Retention policy (30 days detailed, 1 year aggregated)

## Dependencies

### New npm Packages
**Backend**:
- `openai` - OpenAI SDK
- `crypto` (built-in Node.js) - For key encryption
- `bcrypt` - Password hashing
- `jsonwebtoken` - Admin JWT auth

**Frontend** (new package.json in `/admin`):
- `react` + `react-dom`
- `react-router-dom` - Navigation
- `vite` - Build tool
- `tailwindcss` - Styling
- `chart.js` + `react-chartjs-2` - Analytics graphs
- `axios` - API calls

### External Services
- OpenAI API account (optional, for testing)
- Existing Anthropic API key

## Success Metrics

### Functional Requirements Met
- ✅ ADM-01: Model selection works (switch between Claude/GPT)
- ✅ ADM-02: API keys stored and validated
- ✅ ADM-03: Prompt template selection functional
- ✅ ADM-04: Prompt editing persists and applies
- ✅ ADM-05: Analytics dashboard shows metrics

### Quality Metrics
- Admin UI loads in <2 seconds
- API key encryption/decryption adds <10ms overhead
- Analytics queries return in <500ms (1000 events)
- Model switching takes effect immediately (next message)
- Prompt edits apply within 1 minute (config reload)

### User Experience
- Admin can configure bot without touching code
- API key validation provides immediate feedback
- Prompt preview shows exact bot behavior
- Dashboard updates daily with fresh metrics

## Phase 4 Completion Criteria

**All ADM requirements verified**:
1. Model selection UI exists and switches LLM provider ✓
2. API key input form with encryption and validation ✓
3. Template dropdown loads available prompts ✓
4. Prompt editor persists changes to database ✓
5. Analytics dashboard displays: conversation count, response time, escalations ✓

**Integration verified**:
- Bot uses selected model from config
- Bot loads custom prompts from database
- Analytics events recorded on each message
- Dashboard accessible via `/admin` route

**Deployment ready**:
- Admin frontend builds to static files
- Express serves admin UI from `/admin`
- Database migrations run on startup
- Default admin credentials documented

---

**Next Step**: Create 4 detailed execution plans (04-01 through 04-04) based on this research.
