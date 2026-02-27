# Project Research Summary

**Project:** Pack50 - AI-powered Telegram bot for business requirements gathering
**Domain:** Conversational AI + RAG + Telegram Bot Integration + Lightweight VPS Deployment
**Researched:** 2026-02-27
**Confidence:** MEDIUM

## Executive Summary

Pack50 is an AI chatbot deployed on Telegram that proactively gathers business requirements by asking clarifying questions, then retrieves relevant information from a document knowledge base to provide informed recommendations. The recommended architecture combines four well-established domains: (1) conversational AI with state management, (2) RAG (Retrieval-Augmented Generation) for document-grounded responses, (3) Telegram Bot API integration via grammY framework, and (4) Docker-based per-client VPS deployment.

The critical insight from cross-domain research is that **simplicity and integration coherence trump feature maximization**. A TypeScript-first stack (grammY + LangChain + Node.js API) with PostgreSQL+pgvector enables code sharing and consistent patterns across bot/API/RAG layers. The lightweight deployment model (Alpine-based containers, ~512MB RAM total) makes per-client VPS hosting economically viable ($5-7/month), avoiding multi-tenancy complexity while maximizing security through physical isolation.

Key risks center on **conversation state management** (stateless Telegram API requires explicit session storage), **RAG chunking quality** (poor document splitting destroys retrieval accuracy), and **resource constraints** (1GB VPS requires aggressive optimization). Mitigation strategies include Redis-backed sessions from day one, semantic chunking with 10-20% overlap, and Alpine images with resource limits. The recommended phase structure builds core conversation engine first (validates architecture), adds RAG second (depends on stable bot foundation), then layers deployment automation (after application stability proven).

## Key Findings

### Recommended Stack

The research converged on a cohesive TypeScript-based stack that minimizes context switching and maximizes code reuse across components:

**Core technologies:**
- **grammY (Telegram bot framework)**: Modern TypeScript-first framework with built-in conversation flows, session management, and webhook support. Chosen over Telegraf for superior type safety and conversation plugin architecture.
- **LangChain + sentence-transformers**: Document processing pipeline (loaders, chunking, embedding) with pgvector for vector storage. Enables lightweight RAG without external embedding APIs (all-MiniLM-L6-v2 model runs locally in 80MB).
- **PostgreSQL 16 + pgvector**: Single database for both application data and vector embeddings. Eliminates separate vector DB (ChromaDB/Qdrant), reduces memory overhead to ~200MB, provides ACID guarantees.
- **Redis 7**: Session storage for distributed bot instances (webhook scaling) and conversation state persistence. Lightweight (64-128MB), battle-tested, supports TTL for session expiry.
- **Docker Compose + Alpine images**: Per-client stack isolation on 1GB VPS. Alpine-based Node.js images reduce total stack memory to 512MB-1GB, enabling $5/month hosting.
- **Claude Sonnet 3.5+ (API)**: Primary LLM for conversation generation. 200K token context window accommodates RAG chunks + conversation history, superior instruction-following for proactive questioning.

**Why this stack beats alternatives:**
- TypeScript throughout (grammY + Node.js API) enables shared types and logic
- PostgreSQL+pgvector replaces separate vector DB (ChromaDB/Qdrant), reducing infrastructure complexity
- Local embedding model (sentence-transformers) eliminates OpenAI embedding API costs
- Alpine images fit 4-service stack in 512MB (vs. 2GB+ with standard images)
- Docker Compose simplicity over Kubernetes (appropriate for per-client VPS model)

### Expected Features

**Must have (table stakes):**
- **Telegram bot interface**: Users expect chat-based interaction for convenience
- **Proactive question asking**: Bot must guide conversation, not just answer questions (goal-oriented assistant pattern)
- **Multi-turn conversation memory**: Users must not repeat themselves (session persistence critical)
- **Document knowledge retrieval**: Answers grounded in uploaded docs (PDFs, URLs, DOCX)
- **Context-aware responses**: Combine conversation history + retrieved docs for coherent answers
- **Basic user management**: Track users, conversation history, uploaded documents

**Should have (competitive differentiators):**
- **Semantic document search**: Vector similarity, not keyword matching (RAG advantage)
- **Metadata filtering**: Search within specific doc types, dates, sources
- **Conversation summarization**: Compress long conversations to manage context window
- **Multi-format ingestion**: PDF, DOCX, HTML/URLs with smart content extraction
- **Inline keyboards**: Quick-reply buttons for common choices (better UX than pure text)
- **Webhook deployment**: Low-latency message delivery vs. long polling

**Defer to v2+:**
- **Reranking**: Two-stage retrieval (retrieve 20, rerank to 5) adds 100ms latency, +15% accuracy - test if needed
- **Hybrid search**: Semantic + keyword (BM25) - only if product codes/IDs critical
- **Multi-language support**: i18n complexity deferred until single-language proven
- **Conversation analytics**: Metrics (completion rate, frustration detection) valuable but not MVP
- **Admin dashboard**: Web UI for managing docs/users - CLI acceptable for MVP
- **Voice message support**: Telegram supports audio, but transcription adds complexity

### Architecture Approach

The architecture follows a **layered service model** where each service has a single responsibility, connected via Docker internal networking:

**Core pattern: Bot → API → Database/Vector Store → LLM**

The bot handles Telegram-specific concerns (webhook, session, UI), the API encapsulates business logic (conversation orchestration, RAG pipeline), and the database layer provides persistence. This separation enables independent scaling (multiple bot instances share Redis sessions, single API instance handles logic) and testing (API can be tested without Telegram).

**Major components:**

1. **Telegram Bot (grammY)** - Conversation interface and state management
   - Receives Telegram updates via webhook (production) or long polling (dev)
   - Manages conversation sessions (stored in Redis)
   - Implements conversation flows using grammY conversations plugin
   - Delegates business logic to API layer
   - Handles inline keyboards, message formatting, error recovery

2. **API Service (Node.js/Express)** - Business logic and orchestration
   - Conversation orchestrator: manages dialogue state, intent routing, slot filling
   - RAG pipeline: document ingestion (chunk → embed → store) and retrieval (embed query → search → rerank)
   - LLM integration: builds prompts with context (retrieved docs + conversation history), calls Claude API
   - User/document management: CRUD operations for users, docs, conversations
   - Exposes REST endpoints for bot consumption

3. **Database Layer (PostgreSQL + pgvector)** - Persistence and vector search
   - Application data: users, documents, conversation logs, metadata
   - Vector embeddings: document chunks with 384-dim vectors (all-MiniLM-L6-v2)
   - HNSW indexes for fast approximate nearest neighbor search (<100ms for 100K vectors)
   - Full-text search (ts_vector) for optional hybrid retrieval

4. **Session Store (Redis)** - Distributed state management
   - Conversation sessions: current step, collected data, user context
   - Query caching: frequently asked questions, embedding cache (LRU)
   - Rate limiting: track user message frequency, prevent abuse
   - TTL support: auto-expire inactive sessions (e.g., 24 hours)

**Data flow for typical interaction:**

```
User message (Telegram)
  → Bot receives update, loads session from Redis
  → Bot sends message + session context to API
  → API embeds query, retrieves relevant docs from pgvector
  → API builds prompt (system role + retrieved docs + conversation history)
  → API calls Claude API, receives generated response
  → API updates conversation state, returns response to bot
  → Bot saves session to Redis, sends message to user via Telegram
```

### Critical Pitfalls

Based on cross-domain research, these pitfalls span multiple systems and have cascading consequences:

1. **Conversation state loss (CRITICAL)** - Using in-memory sessions without Redis persistence
   - **Why critical**: Bot restarts/scaling lose user context, breaks multi-turn conversations
   - **Spans**: Telegram integration + architecture design
   - **Prevention**: Redis sessions from Phase 1, never rely on in-memory storage in production
   - **Detection**: User complaints about "bot forgetting" previous answers after deploy/restart

2. **Poor document chunking destroys RAG accuracy (CRITICAL)** - Fixed character splitting without semantic boundaries
   - **Why critical**: Chunks split mid-sentence, no context overlap, wrong size (too large/small)
   - **Spans**: RAG implementation + conversation quality
   - **Prevention**: RecursiveCharacterTextSplitter (semantic-aware), 1000 char chunks with 200 char overlap, test retrieval before full ingestion
   - **Detection**: LLM says "no information" when docs clearly contain answer

3. **Context window overflow (CRITICAL)** - Exceeding LLM token limits with retrieved chunks + conversation history
   - **Why critical**: API errors, degraded quality ("lost in the middle" problem), high cost
   - **Spans**: RAG retrieval + conversation memory + LLM integration
   - **Prevention**: Retrieve Top-10, rerank to Top-3-5, monitor context size (chunks + prompt + history < 80% of window), summarize old conversation turns
   - **Detection**: API errors (context too long), degraded answer quality despite relevant chunks

4. **No webhook validation (CRITICAL)** - Missing secret token check on Telegram webhook endpoint
   - **Why critical**: Anyone can send fake updates, potential for abuse/injection attacks
   - **Spans**: Telegram integration + security + deployment
   - **Prevention**: Set webhook secret token, validate x-telegram-bot-api-secret-token header, verify source IP ranges
   - **Detection**: Unexpected messages in logs, security audit findings

5. **Rate limit violations (MODERATE)** - Broadcasting messages without rate limiting (Telegram: ~30 msg/sec global)
   - **Why moderate**: Temporary ban, messages fail, service disruption
   - **Spans**: Telegram integration + bot design
   - **Prevention**: Message queue (p-queue library), auto-retry middleware, monitor 429 errors
   - **Detection**: 429 Too Many Requests in logs, users report missing messages

6. **Blocking event loop (MODERATE)** - Synchronous operations in bot handlers (long API calls, file processing)
   - **Why moderate**: Bot unresponsive, webhook timeouts, poor UX
   - **Spans**: Telegram integration + API design
   - **Prevention**: Async/await for all I/O, offload heavy processing (document ingestion) to background workers, respond within 1-2 seconds
   - **Detection**: High latency, timeout errors, Telegram webhook warnings

7. **Resource exhaustion on VPS (MODERATE)** - No memory limits on containers, unbounded log growth
   - **Why moderate**: OOM kills, disk full, entire stack crashes
   - **Spans**: Deployment + resource management
   - **Prevention**: Docker resource limits (256MB per container), log rotation (max-size: 10m, max-file: 3), monitor with docker stats
   - **Detection**: Container crashes, slow performance, disk space alerts

## Implications for Roadmap

Based on research, suggested phase structure prioritizes foundational architecture, then layers features:

### Phase 1: Core Conversation Engine
**Rationale:** Establish bot-API-database architecture and validate conversation patterns before adding RAG complexity. The Telegram bot + stateful conversations are the product's foundation - everything else depends on this working.

**Delivers:**
- Working Telegram bot with webhook setup
- grammY conversation flows (multi-turn dialogue)
- Redis-backed session persistence
- Basic API endpoints (echo bot, state management)
- PostgreSQL schema for users, conversations

**Addresses (from FEATURES.md):**
- Telegram bot interface (table stakes)
- Multi-turn conversation memory (table stakes)
- Proactive question asking (table stakes - implement conversation plugin patterns)

**Avoids (from PITFALLS.md):**
- Conversation state loss (Redis from day one)
- Blocking event loop (async/await discipline)
- No webhook validation (secret token required)

**Stack elements (from STACK.md):**
- grammY + conversations plugin
- Redis for sessions
- PostgreSQL for application data
- Docker Compose (dev environment)

**Success criteria:** Bot can maintain 5+ turn conversation, survive restart without losing context

---

### Phase 2: Document Ingestion & RAG Pipeline
**Rationale:** With stable conversation foundation, add knowledge retrieval. RAG requires working API layer (from Phase 1) and introduces vector database complexity. Building this second validates that bot-API separation works.

**Delivers:**
- Document upload/processing (PDF, DOCX, URLs)
- Chunking pipeline (RecursiveCharacterTextSplitter)
- Embedding generation (all-MiniLM-L6-v2 local model)
- pgvector storage with HNSW indexes
- Basic similarity search retrieval

**Addresses (from FEATURES.md):**
- Document knowledge retrieval (table stakes)
- Multi-format ingestion (should have)
- Semantic document search (should have)

**Avoids (from PITFALLS.md):**
- Poor document chunking (semantic splitter with overlap)
- Embedding model mismatch (lock model choice, version collections)

**Stack elements (from STACK.md):**
- LangChain document loaders and splitters
- sentence-transformers (all-MiniLM-L6-v2)
- PostgreSQL pgvector extension

**Success criteria:** Upload PDF, chunk semantically, retrieve relevant chunks for query

---

### Phase 3: LLM Integration & Context Management
**Rationale:** Combine conversation state (Phase 1) + retrieved knowledge (Phase 2) into coherent LLM prompts. This is where product value emerges - proactive, context-aware answers.

**Delivers:**
- Claude API integration
- Prompt engineering (system role, proactive behaviors, goal-oriented)
- Context window management (retrieved docs + conversation history)
- Conversation summarization (compress old turns)
- Response generation with citations

**Addresses (from FEATURES.md):**
- Context-aware responses (table stakes)
- Conversation summarization (should have)

**Avoids (from PITFALLS.md):**
- Context window overflow (Top-K retrieval, summarization, monitoring)
- Over-reliance on LLM (use deterministic code for routing/validation)

**Stack elements (from STACK.md):**
- Claude Sonnet 3.5+ API
- LangChain memory management
- Prompt templates and chains

**Success criteria:** Bot answers questions using docs + conversation history, cites sources

---

### Phase 4: Metadata & Retrieval Quality
**Rationale:** Enhance RAG accuracy with metadata filtering and optional reranking. Requires Phase 2 working to measure baseline quality. This is optimization, not foundation.

**Delivers:**
- Metadata preservation (source, page, date, doc type)
- Filtered retrieval (search within specific sources)
- Query optimization (expansion, pronoun resolution)
- Optional: Two-stage retrieval with reranking

**Addresses (from FEATURES.md):**
- Metadata filtering (should have)

**Avoids (from PITFALLS.md):**
- Metadata pollution (smart content extraction, deduplication)
- No query optimization (expand vague queries, resolve pronouns)
- Ignoring reranking (measure if 15% accuracy gain worth 100ms latency)

**Stack elements (from STACK.md):**
- PostgreSQL JSONB indexes for metadata
- Cross-encoder reranker (optional: ms-marco-MiniLM-L-6-v2)

**Success criteria:** 20%+ improvement in retrieval relevance (measured by eval set)

---

### Phase 5: Production Deployment Automation
**Rationale:** With application stable (Phases 1-3 working), package for VPS deployment. Building deployment last avoids premature optimization while application still changing.

**Delivers:**
- Dockerfiles for bot, API (multi-stage builds, Alpine images)
- Production docker-compose.yml with resource limits
- Install script (install.sh - OS detection, Docker installation)
- Configuration script (configure.sh - interactive setup, secret generation)
- Health checks and restart policies

**Addresses (from FEATURES.md):**
- Webhook deployment (should have)

**Avoids (from PITFALLS.md):**
- Resource exhaustion (memory limits, log rotation)
- No health monitoring (healthcheck directives, depends_on conditions)

**Stack elements (from STACK.md):**
- Docker Compose
- Alpine-based Node.js images
- PostgreSQL 16-alpine, Redis 7-alpine

**Success criteria:** Three-command install on fresh VPS, stack runs in <512MB

---

### Phase 6: Security Hardening & Monitoring
**Rationale:** Final layer before launch. Requires deployed application (Phase 5) to test monitoring, backups, and security measures.

**Delivers:**
- Resource monitoring (docker stats, alerts)
- Backup automation (volumes, database, .env)
- Security hardening (read-only filesystems, capability dropping)
- Update procedures (zero-downtime, migration scripts)
- Operational runbooks

**Avoids (from PITFALLS.md):**
- No error handling (bot.catch, try-catch in handlers)
- Token exposure (environment variables, .gitignore, chmod 600)

**Success criteria:** <500ms p95 latency, 99.9% uptime, automated backups

---

### Phase Ordering Rationale

**Why conversation engine first (Phase 1):**
- Validates architecture (bot-API separation, session storage)
- Enables early user testing (conversation flows without RAG)
- Foundation for everything else (all features depend on stable bot)

**Why RAG second (Phase 2):**
- Requires API layer from Phase 1
- Independent system (can build/test separately from conversation)
- Introduces biggest technical risk (vector search, embeddings) early

**Why LLM integration third (Phase 3):**
- Depends on conversation state (Phase 1) + document retrieval (Phase 2)
- This is where pieces come together - validate integration works

**Why optimization fourth (Phase 4):**
- Needs baseline from Phase 2-3 to measure improvements
- Avoids premature optimization before patterns proven

**Why deployment fifth (Phase 5):**
- Application must be stable before packaging
- Allows iteration without Docker complexity during dev

**Why security/monitoring last (Phase 6):**
- Requires deployed system to monitor
- Builds on stable foundation (avoid securing changing application)

**Dependency chain:**
```
Phase 1 (bot foundation)
  ↓
Phase 2 (RAG - needs API from Phase 1)
  ↓
Phase 3 (LLM - needs Phase 1 + 2)
  ↓
Phase 4 (optimization - needs baseline from Phase 2-3)
  ↓
Phase 5 (deployment - needs stable app from Phase 1-4)
  ↓
Phase 6 (monitoring - needs deployed system from Phase 5)
```

### Research Flags

**Phases likely needing deeper research during planning:**

- **Phase 2 (RAG Pipeline):** Document loaders vary wildly by format quality (OCR for scanned PDFs, HTML boilerplate removal). May need format-specific research once actual client documents examined.

- **Phase 5 (Deployment):** Install script needs OS-specific testing (Ubuntu, Debian, CentOS have different Docker installation paths). Will need research on current distro versions when implementing.

- **Phase 6 (Security):** If compliance requirements emerge (GDPR, HIPAA), will need domain-specific security research (encryption at rest, audit logging).

**Phases with standard patterns (skip research-phase):**

- **Phase 1 (Conversation Engine):** grammY patterns well-documented, standard Telegram bot architecture

- **Phase 3 (LLM Integration):** Claude API patterns well-established, prompt engineering iterative (testing > research)

- **Phase 4 (Retrieval Quality):** Standard RAG optimization techniques, measure-then-improve approach

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (grammY, LangChain, pgvector, Docker) | **MEDIUM** | Technologies mature as of Jan 2025 cutoff, but versions/features not verified against Feb 2026 current state. Core patterns stable. |
| Features (conversation + RAG integration) | **MEDIUM** | Requirements clear from domain research, but actual user needs not validated. Standard features for domain. |
| Architecture (layered services, Docker isolation) | **HIGH** | Well-established patterns for bot + API + DB architecture. Separation of concerns proven approach. |
| Pitfalls (state loss, chunking, context overflow) | **HIGH** | These are known failure modes with documented solutions. Cross-domain pitfalls identified. |

**Overall confidence: MEDIUM**

Confidence limited by:
- Training data cutoff (January 2025) - cannot verify current library versions, API features, or 2026 best practices
- No access to external documentation during research (all findings from training data)
- VPS resource estimates not benchmarked (educated guesses based on Alpine image sizes)
- Telegram Bot API rate limits approximate (official docs don't specify exact thresholds)

Confidence strengthened by:
- Architectural patterns stable across technology generations
- Multiple research documents converged on same stack (TypeScript, PostgreSQL, Docker)
- Pitfalls identified across all 4 research areas (validated by repetition)

### Gaps to Address

**High priority (resolve during Phase planning):**

1. **Current library versions**: Verify grammY, LangChain, pgvector compatibility (research used Jan 2025 versions, now Feb 2026)
   - **How to handle**: Check official repos/docs at phase start, update docker-compose.yml versions

2. **Actual VPS resource usage**: Memory estimates (512MB total) not benchmarked with real workload
   - **How to handle**: Load test in Phase 5, measure with docker stats, adjust limits based on actual usage

3. **Document format quality**: PDF extraction quality varies (OCR, formatting artifacts) - need real client samples
   - **How to handle**: Test ingestion pipeline in Phase 2 with actual documents, iterate on extraction strategy

**Medium priority (validate during implementation):**

4. **Reranking cost/benefit**: 100ms latency vs. 15% accuracy gain - need A/B testing to decide
   - **How to handle**: Implement as optional feature in Phase 4, measure query latency and answer quality

5. **Conversation timeout values**: How long to persist inactive sessions (1 hour? 24 hours? 7 days?)
   - **How to handle**: Start conservative (24 hours), monitor session duration patterns, adjust based on usage

6. **Rate limiting thresholds**: Telegram limits approximate (~30 msg/sec) - need production testing
   - **How to handle**: Implement queue with conservative limits (20 msg/sec), monitor 429 errors, adjust upward

**Low priority (defer to post-MVP):**

7. **Hybrid search value**: Do clients need keyword + semantic search, or is semantic sufficient?
   - **How to handle**: Ship semantic-only in MVP, add keyword if users request exact term matching

8. **Multi-language support**: i18n patterns for bot messages deferred
   - **How to handle**: Hard-code English strings in MVP, extract to i18n library if international users emerge

## Sources

### Primary (training data - MEDIUM confidence)

**Unable to access external sources** due to tool restrictions during research. All findings based on training data (knowledge cutoff: January 2025).

Research domains covered:
- AI Chatbot Architectures (training data on LangChain, conversation patterns, prompt engineering)
- RAG Systems & Vector Databases (training data on pgvector, embeddings, chunking strategies)
- Telegram Bot Development (training data on Bot API, grammY framework, webhook patterns)
- Containerized Deployment (training data on Docker Compose, Alpine images, VPS optimization)

### Verification Required

**Before implementation, validate against official sources:**

1. **grammY Documentation** - Current API, conversation plugin, session adapters
   - https://grammy.dev/

2. **Telegram Bot API** - Rate limits, webhook requirements, message types
   - https://core.telegram.org/bots/api

3. **pgvector Repository** - Current version, HNSW index parameters, performance characteristics
   - https://github.com/pgvector/pgvector

4. **LangChain Documentation** - Document loaders, text splitters, vector store integrations
   - https://python.langchain.com/ (Python) or https://js.langchain.com/ (JavaScript)

5. **Docker Compose Reference** - Current file format (3.8 vs. newer), resource limit syntax
   - https://docs.docker.com/compose/compose-file/

6. **Alpine Docker Images** - Current Node.js, PostgreSQL, Redis image tags and sizes
   - https://hub.docker.com/_/node
   - https://hub.docker.com/_/postgres
   - https://hub.docker.com/_/redis

### Gaps in Source Verification

- **No benchmarks**: VPS memory usage, RAG retrieval latency, embedding generation speed all estimated
- **No current pricing**: VPS costs based on 2024 knowledge, may have changed
- **No version verification**: Library versions (grammY 1.x, LangChain 0.1.x) not checked against current releases
- **No API limit verification**: Telegram rate limits, Claude API pricing not validated

**Recommendation:** Treat research as directional (architecture patterns, pitfall categories) rather than prescriptive (exact versions, specific thresholds). Validate details at each phase start.

---

**Research completed:** 2026-02-27
**Ready for roadmap:** Yes

**Next steps for orchestrator:**
1. Load SUMMARY.md as context for roadmap creation
2. Use suggested phases as starting point (6 phases identified)
3. Expand each phase with detailed tasks (user stories, technical tasks)
4. Identify phase-specific research needs (Phase 2, 5, 6 flagged)
