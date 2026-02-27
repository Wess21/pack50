# Roadmap: AI Assistant Box

## Overview

Six-phase journey from core conversation foundation to production-ready deployment. Phase 1 establishes Telegram bot architecture with stateful conversations. Phase 2 adds document ingestion and RAG retrieval. Phase 3 integrates LLM with context management and outgoing webhooks. Phase 4 enhances retrieval quality with metadata and admin interface. Phase 5 packages everything for three-command VPS deployment. Phase 6 hardens security and adds monitoring for production use.

## Phases

- [ ] **Phase 1: Core Conversation Engine** - Telegram bot with stateful multi-turn conversations
- [ ] **Phase 2: Document Ingestion & RAG Pipeline** - Knowledge base with vector search
- [ ] **Phase 3: LLM Integration & Context Management** - AI-powered responses with webhooks
- [ ] **Phase 4: Metadata & Retrieval Quality** - Enhanced RAG accuracy and admin interface
- [ ] **Phase 5: Production Deployment Automation** - Three-command VPS installation
- [ ] **Phase 6: Security Hardening & Monitoring** - Production-ready security and observability

## Phase Details

### Phase 1: Core Conversation Engine
**Goal**: Users can interact with bot through Telegram, and bot maintains conversation context across multiple messages and restarts

**Depends on**: Nothing (foundation phase)

**Requirements**: BOT-01, BOT-02, BOT-03, BOT-04, BOT-05, BOT-06, CONV-01, CONV-02, CONV-03, CONV-04, CONV-05, CONV-06, CONV-07, DATA-01, DATA-02, DATA-03, DATA-04

**Success Criteria** (what must be TRUE):
1. User can send message to bot via Telegram and receive text response
2. Bot remembers conversation history (5+ messages) within same session
3. Bot asks clarifying questions when information is incomplete
4. Bot extracts and confirms user data (name, email, phone) from messages
5. Conversation state persists across bot restarts (Redis-backed sessions)
6. Inactive conversations expire automatically after 24 hours

**Plans**: 4 plans in 4 waves

Plans:
- [ ] 01-01-PLAN.md — Foundation (database + bot setup + Redis)
- [ ] 01-02-PLAN.md — Session management and command handlers
- [ ] 01-03-PLAN.md — Multi-turn conversations with slot filling
- [ ] 01-04-PLAN.md — Webhook security and verification checkpoint

### Phase 2: Document Ingestion & RAG Pipeline
**Goal**: Bot can retrieve relevant information from uploaded business documents to answer user questions

**Depends on**: Phase 1

**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06, DOC-07, RAG-01, RAG-02, RAG-03, RAG-04, RAG-05

**Success Criteria** (what must be TRUE):
1. Administrator can upload PDF, DOCX, and URL content through API
2. Documents are automatically chunked into 1000-character segments with 20% overlap
3. Bot finds Top-5 relevant document chunks for user questions in <500ms
4. Bot cites sources (document name, page number) when answering from documents
5. Knowledge base contains embedded vectors for 10K+ document chunks

**Plans**: TBD

Plans:
- [ ] 02-01: TBD during planning
- [ ] 02-02: TBD during planning

### Phase 3: LLM Integration & Context Management
**Goal**: Bot generates intelligent, context-aware responses using AI and sends data to external systems via webhooks

**Depends on**: Phase 2

**Requirements**: LLM-01, LLM-02, LLM-03, LLM-04, LLM-05, LLM-06, HOOK-01, HOOK-02, HOOK-03, HOOK-04

**Success Criteria** (what must be TRUE):
1. Bot generates responses using Claude API with system prompt defining behavior
2. Bot includes retrieved documents and conversation history in LLM prompt
3. Bot handles LLM API errors gracefully without crashing
4. Bot sends collected user data to configured CRM webhook URL
5. Failed webhook deliveries retry with exponential backoff

**Plans**: TBD

Plans:
- [ ] 03-01: TBD during planning
- [ ] 03-02: TBD during planning

### Phase 4: Metadata & Retrieval Quality
**Goal**: Bot delivers more accurate answers through enhanced retrieval and administrators can configure bot behavior through interface

**Depends on**: Phase 3

**Requirements**: ADM-01, ADM-02, ADM-03, ADM-04, ADM-05

**Success Criteria** (what must be TRUE):
1. Administrator can select AI provider (OpenAI/Anthropic) and model through config
2. Administrator can choose and edit prompt templates (Consultant/Support/Sales)
3. Administrator can view analytics (conversation count, escalations, response time)
4. Bot retrieval quality shows measurable improvement (tracked via test queries)
5. Metadata filters work (search within specific document types or date ranges)

**Plans**: TBD

Plans:
- [ ] 04-01: TBD during planning
- [ ] 04-02: TBD during planning

### Phase 5: Production Deployment Automation
**Goal**: Client can install complete working system on VPS with three commands

**Depends on**: Phase 4

**Requirements**: DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06, DEP-07, DEP-08, DEP-09, DEP-10

**Success Criteria** (what must be TRUE):
1. Full stack launches with single "docker-compose up -d" command
2. Installation completes in three commands: install.sh, configure.sh, docker compose up
3. configure.sh generates random DB/Redis passwords and requests bot token interactively
4. Entire stack runs in less than 1GB RAM on 1GB VPS
5. Containers have health checks and restart automatically on failure
6. Logs rotate automatically (max 10MB per file, 3 files retained)

**Plans**: TBD

Plans:
- [ ] 05-01: TBD during planning
- [ ] 05-02: TBD during planning

### Phase 6: Security Hardening & Monitoring
**Goal**: System protects sensitive data and provides visibility into production operations

**Depends on**: Phase 5

**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07

**Success Criteria** (what must be TRUE):
1. Bot token never appears in logs or git repository
2. Webhook endpoint validates Telegram secret token before processing
3. PostgreSQL and Redis are only accessible within Docker network (not exposed externally)
4. User input is validated and sanitized before database storage
5. All secrets stored in .env file with 600 permissions
6. System provides monitoring of resource usage and error rates

**Plans**: TBD

Plans:
- [ ] 06-01: TBD during planning

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Conversation Engine | 0/4 | Planning complete | - |
| 2. Document Ingestion & RAG | 0/TBD | Not started | - |
| 3. LLM Integration | 0/TBD | Not started | - |
| 4. Metadata & Admin | 0/TBD | Not started | - |
| 5. Deployment Automation | 0/TBD | Not started | - |
| 6. Security & Monitoring | 0/TBD | Not started | - |

---

## Phase Ordering Rationale

**Phase 1 First (Conversation Engine):**
- Validates bot-API-database architecture before adding complexity
- Enables early testing of conversation patterns
- Foundation that all other phases depend on
- Addresses critical pitfall: conversation state loss (Redis from day one)

**Phase 2 Second (RAG Pipeline):**
- Requires stable API layer from Phase 1
- Independent system that can be built/tested separately
- Introduces biggest technical risk (vector search, embeddings) early
- Addresses critical pitfall: poor document chunking with semantic splitter

**Phase 3 Third (LLM Integration):**
- Depends on conversation state (Phase 1) + document retrieval (Phase 2)
- Integration point where pieces come together
- Product value emerges: context-aware AI responses
- Addresses critical pitfall: context window overflow via monitoring

**Phase 4 Fourth (Optimization):**
- Needs baseline from Phases 2-3 to measure improvements
- Avoids premature optimization before patterns proven
- Adds admin interface for configuration
- Enhancement layer, not foundation

**Phase 5 Fifth (Deployment):**
- Application must be stable before packaging
- Allows iteration without Docker complexity during development
- Addresses pitfall: resource exhaustion with limits and monitoring

**Phase 6 Last (Security/Monitoring):**
- Requires deployed system to test monitoring
- Builds on stable foundation
- Final production-readiness layer
- Addresses critical pitfall: webhook validation, token exposure

---

**Created:** 2026-02-27
**Last updated:** 2026-02-27
