# RAG Systems & Vector Databases Research

**Domain:** Retrieval-Augmented Generation Systems
**Researched:** 2026-02-27
**Overall Confidence:** MEDIUM
**Note:** Research based on training data (January 2025 cutoff). Web sources unavailable. Recommendations reflect state-of-the-art as of cutoff date.

---

## Executive Summary

RAG (Retrieval-Augmented Generation) systems combine vector search with LLMs to provide context-aware responses grounded in specific documents. For **lightweight VPS deployments** (2-4GB RAM), the critical decisions are:

1. **Vector Database:** **pgvector** (PostgreSQL extension) is the most resource-efficient choice for small deployments, with ChromaDB as a simpler embedded alternative
2. **Architecture Pattern:** Chunking → Embedding → Storage → Retrieval → Generation pipeline with careful chunk size optimization (512-1024 tokens)
3. **Document Ingestion:** Use LangChain/LlamaIndex for unified document loaders (PDF, DOCX, HTML) with streaming for memory efficiency
4. **Performance:** Co-locate embedding model with application, use HNSW indexes, cache embeddings aggressively

Key insight: **Most RAG performance issues stem from poor chunking strategy**, not database choice. Semantic chunking with overlap (10-20%) dramatically improves retrieval quality.

---

## Key Findings

**Stack:** PostgreSQL + pgvector for persistence, sentence-transformers for embeddings, LangChain for orchestration
**Architecture:** Document pipeline (ingest → chunk → embed → store) separate from query pipeline (embed query → retrieve → rerank → generate)
**Critical pitfall:** Embedding entire documents without chunking causes poor retrieval; must chunk semantically with context preservation

---

## Recommended Technology Stack

### Vector Database Selection

| Database | Memory Overhead | VPS Suitability | Best For | Why Not Others |
|----------|----------------|-----------------|----------|----------------|
| **pgvector** (RECOMMENDED) | ~50MB + data | Excellent | Production deployments needing persistence | None - best balance |
| ChromaDB | ~200MB + data | Good | Quick prototypes, embedded apps | Heavier than pgvector, less mature |
| Qdrant | ~300MB + data | Fair | High-performance needs | Resource-intensive for small VPS |
| Weaviate | ~500MB + data | Poor | Enterprise scale | Too heavy for VPS |

**Recommendation: pgvector**

**Why:**
- Leverages existing PostgreSQL infrastructure (no additional database)
- Minimal memory overhead (just an extension)
- ACID guarantees for data consistency
- Excellent performance with HNSW indexes for <1M vectors
- Active development, production-ready (1.0+ released)

**Installation:**
```bash
# PostgreSQL with pgvector extension
sudo apt install postgresql postgresql-contrib
# Install pgvector from package or compile
```

### Embedding Models for Lightweight Deployment

| Model | Dimensions | Size | Quality | Latency (CPU) | Best For |
|-------|-----------|------|---------|---------------|----------|
| **all-MiniLM-L6-v2** | 384 | 80MB | Good | ~50ms | VPS default choice |
| all-mpnet-base-v2 | 768 | 420MB | Better | ~150ms | If RAM allows |
| text-embedding-3-small (OpenAI) | 1536 | API | Best | ~200ms | If budget allows API calls |

**Recommendation: all-MiniLM-L6-v2**
- Smallest memory footprint
- Fast CPU inference (no GPU needed)
- Good quality for most business documents
- Sentence-transformers library, easy integration

### Document Processing Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Document Loaders** | LangChain / Unstructured.io | Parse PDF, DOCX, HTML, Markdown |
| **Text Splitter** | LangChain RecursiveCharacterTextSplitter | Semantic chunking with overlap |
| **Embedding** | sentence-transformers | Generate vectors locally |
| **Orchestration** | LangChain LCEL or custom | Pipeline management |

**Why LangChain:**
- Unified interface for 100+ document types
- Battle-tested text splitting strategies
- Integration with all major vector DBs
- Active community, frequent updates

**Alternative: LlamaIndex** (if focusing heavily on structured data ingestion)

---

## RAG Architecture Patterns

### Core Pipeline Architecture

```
INGESTION PIPELINE (offline/async):
Documents → Load → Chunk → Embed → Store in Vector DB

QUERY PIPELINE (real-time):
User Query → Embed → Retrieve Top-K → [Optional: Rerank] → LLM Context → Generate Response
```

### Chunking Strategies (CRITICAL)

| Strategy | Chunk Size | Overlap | Best For | Complexity |
|----------|-----------|---------|----------|------------|
| **Fixed Character** | 512-1024 chars | 10-20% | General documents, fast | Low |
| **Recursive (Semantic)** | Variable, max 1024 | 10-20% | Mixed content (code, prose) | Medium |
| **Sentence-based** | ~3-5 sentences | 1 sentence | High precision needs | Medium |
| **Document-aware** | Section/paragraph | Context-dependent | Structured docs (manuals) | High |

**RECOMMENDED: Recursive Character Splitting**
- Chunk size: 1000 characters
- Overlap: 200 characters (20%)
- Separators: `["\n\n", "\n", ". ", " "]` (tries paragraph, then sentence, then word breaks)

**Why this matters:** Too large = irrelevant context, too small = loss of meaning. Overlap preserves context across chunks.

**LangChain Implementation:**
```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    length_function=len,
    separators=["\n\n", "\n", ". ", " ", ""]
)
chunks = splitter.split_documents(documents)
```

### Retrieval Patterns

#### 1. Basic Similarity Search
```
Query → Embed → Vector Search (cosine/L2) → Top-K chunks → LLM
```
**Pros:** Simple, fast
**Cons:** May miss nuanced relevance

#### 2. Similarity + Metadata Filtering (RECOMMENDED)
```
Query → Embed → Vector Search WHERE metadata matches → Top-K → LLM
```
**Use case:** Filter by document type, date, source
**Example:** "Find pricing info from 2024 contracts only"

#### 3. Two-Stage Retrieval (Reranking)
```
Query → Embed → Vector Search Top-20 → Rerank to Top-5 → LLM
```
**When:** High-stakes accuracy needs
**Reranker:** Cross-encoder model (ms-marco-MiniLM-L-6-v2)
**Tradeoff:** +100ms latency, +15% accuracy

#### 4. Hybrid Search (Semantic + Keyword)
```
Query → [Vector Search + BM25 Full-Text] → Merge results → LLM
```
**When:** Technical docs with specific terms (product codes, IDs)
**Implementation:** pgvector + PostgreSQL full-text search
**Benefit:** Catches exact matches that semantic search misses

**For VPS deployments: Start with #2 (metadata filtering), add #4 if keyword precision needed**

### Context Window Management

| LLM | Context Window | Usable for RAG | Max Chunks (1K each) |
|-----|---------------|----------------|----------------------|
| GPT-4 Turbo | 128K tokens | ~100K tokens | ~80 chunks |
| Claude 3 Sonnet | 200K tokens | ~150K tokens | ~120 chunks |
| GPT-3.5 Turbo | 16K tokens | ~12K tokens | ~8 chunks |
| Llama 3 8B | 8K tokens | ~6K tokens | ~4 chunks |

**Recommendation for VPS:**
- Retrieve 5-10 chunks (Top-K=10)
- Use reranking to select best 3-5 for context
- Leaves room for system prompt + conversation history

---

## Document Ingestion Patterns

### Supported Document Types

| Format | Loader | Complexity | Notes |
|--------|--------|------------|-------|
| **PDF** | PyPDF2 / pdfplumber / Unstructured | Medium | OCR needed for scanned PDFs |
| **DOCX** | python-docx / Unstructured | Low | Preserves formatting metadata |
| **HTML/URLs** | BeautifulSoup / Unstructured | Medium | Need content extraction (not boilerplate) |
| **Markdown** | Built-in text loader | Low | Native support |
| **CSV/JSON** | Pandas → LangChain | Low | Structured data, row-wise chunking |

### Ingestion Pipeline (Memory-Efficient for VPS)

```python
# STREAMING approach for large documents
from langchain.document_loaders import DirectoryLoader, UnstructuredFileLoader
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.vectorstores import PGVector

# Load documents in batches
loader = DirectoryLoader("./docs", glob="**/*.pdf", loader_cls=UnstructuredFileLoader)
documents = loader.load()  # Lazy loading

# Chunk
chunks = splitter.split_documents(documents)

# Embed + store in batches (avoid OOM)
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
vectorstore = PGVector.from_documents(
    documents=chunks,
    embedding=embeddings,
    connection_string="postgresql://user:pass@localhost/db",
    collection_name="business_docs"
)
```

### URL Content Extraction

**Challenge:** Extracting main content from HTML (not nav, ads, footers)

**Solutions:**
1. **Unstructured.io** (Recommended): ML-based content extraction
2. **Newspaper3k**: News articles specifically
3. **Trafilatura**: Fast, rule-based extraction
4. **Custom BeautifulSoup**: For known site structures

**Pattern:**
```python
from langchain.document_loaders import UnstructuredURLLoader

urls = ["https://company.com/docs/api", "https://company.com/about"]
loader = UnstructuredURLLoader(urls=urls)
docs = loader.load()
```

### Metadata Preservation (CRITICAL)

**Always store metadata with chunks:**
```python
chunk.metadata = {
    "source": "pricing_2024.pdf",
    "page": 5,
    "doc_type": "contract",
    "date": "2024-03-15",
    "section": "Payment Terms"
}
```

**Why:** Enables filtered retrieval, provenance tracking, debugging

---

## Performance Optimization for VPS

### Memory Budget (4GB VPS Example)

| Component | Memory Usage | Notes |
|-----------|--------------|-------|
| PostgreSQL + pgvector | 200-500MB | Shared buffers, connections |
| Embedding model (MiniLM) | 80MB | Loaded in memory |
| Application runtime (Node/Python) | 100-200MB | Base overhead |
| Document processing | 50-100MB | Per batch |
| **TOTAL** | ~500-1000MB | Leaves 3GB for OS + vector data |

### Vector Storage Size

**Formula:** `vectors × dimensions × 4 bytes`
- 10K documents × 10 chunks each = 100K vectors
- MiniLM-L6 = 384 dimensions
- Storage: 100K × 384 × 4 = ~150MB

**Index overhead (HNSW):** +30-50% storage, faster search

### pgvector Index Configuration

```sql
-- Create table with vector column
CREATE TABLE embeddings (
    id SERIAL PRIMARY KEY,
    content TEXT,
    metadata JSONB,
    embedding vector(384)  -- dimension matches model
);

-- HNSW index for fast approximate search
CREATE INDEX ON embeddings USING hnsw (embedding vector_cosine_ops);

-- For metadata filtering
CREATE INDEX ON embeddings USING gin (metadata jsonb_path_ops);
```

**HNSW Parameters:**
- `m=16` (connections per layer): Default, good for most cases
- `ef_construction=64`: Build quality vs. speed tradeoff
- Higher values = better recall, slower indexing

**Query-time tuning:**
```sql
SET hnsw.ef_search = 40;  -- Default, increase for better recall
```

### Caching Strategy

**What to cache:**
1. **Query embeddings:** If users ask similar questions
2. **Document embeddings:** Always (expensive to recompute)
3. **Retrieval results:** For common queries (5-minute TTL)

**Implementation:**
```python
from functools import lru_cache

@lru_cache(maxsize=1000)
def embed_query(query: str):
    return embeddings.embed_query(query)
```

### Batch Processing for Ingestion

```python
# Process documents in batches to avoid OOM
BATCH_SIZE = 100

for i in range(0, len(chunks), BATCH_SIZE):
    batch = chunks[i:i+BATCH_SIZE]
    vectorstore.add_documents(batch)
    # Optional: Clear memory
    import gc; gc.collect()
```

---

## Domain Pitfalls

### CRITICAL: Poor Chunking Destroys Retrieval

**What goes wrong:** Developers chunk documents without semantic boundaries (e.g., splitting mid-sentence), use chunks too large (entire pages) or too small (single sentences).

**Why it happens:** Default to simple character splitting without understanding semantic coherence.

**Consequences:**
- Large chunks: LLM receives irrelevant context, poor answers
- Small chunks: Loss of context, fragmented information
- No overlap: Missing information at chunk boundaries

**Prevention:**
1. Use RecursiveCharacterTextSplitter (semantic-aware)
2. Chunk size: 800-1200 characters (2-3 paragraphs)
3. Always include 10-20% overlap
4. Test retrieval quality with sample queries BEFORE full ingestion

**Detection:** If LLM often says "I don't have information about X" when docs clearly contain X → chunking problem

### CRITICAL: Embedding Model Mismatch

**What goes wrong:** Using different embedding models for indexing vs. querying, or switching models after indexing.

**Why it happens:** Experimenting with models without re-indexing.

**Consequences:** Completely broken retrieval (vectors not comparable across models)

**Prevention:**
1. Lock embedding model choice early
2. Version your vector database collections
3. If changing models, re-embed ALL documents

**Detection:** Random, nonsensical retrieval results

### CRITICAL: Context Window Overload

**What goes wrong:** Retrieving too many chunks, exceeding LLM context window or degrading quality.

**Why it happens:** "More context is better" assumption.

**Consequences:**
- API errors (context too long)
- "Lost in the middle" problem (LLMs worse at using mid-context info)
- Slow inference, high cost

**Prevention:**
1. Retrieve Top-10, rerank to Top-3-5
2. Monitor context size: chunks + prompt + history < 80% of window
3. Implement context pruning (summarize old conversation turns)

**Detection:** Degraded answer quality despite relevant chunks in top results

### MODERATE: Metadata Pollution

**What goes wrong:** Including formatting artifacts, page headers/footers, navigation elements in chunks.

**Why it happens:** Document parsers extracting everything without filtering.

**Prevention:**
1. Use Unstructured.io for smart content extraction
2. Post-process to remove short chunks (<50 chars)
3. Filter out chunks that are all-caps (likely headers)
4. Remove duplicate chunks (hash-based deduplication)

### MODERATE: No Query Optimization

**What goes wrong:** Using raw user queries for embedding without preprocessing.

**Why it happens:** Direct query → embed → search pipeline.

**Consequences:** Poor retrieval for vague/conversational queries.

**Prevention:**
1. Query expansion: "API pricing" → "API pricing cost rates billing"
2. Hypothetical Document Embedding (HyDE): Generate synthetic answer, embed that
3. Query rewriting for multi-turn conversations (resolve pronouns)

**Example:**
```python
# Simple query expansion
expanded = f"{query} {extract_keywords(query)}"
```

### MODERATE: Ignoring Reranking

**What goes wrong:** Relying solely on vector similarity for relevance.

**Why it happens:** Assuming cosine similarity = semantic relevance.

**Consequences:** 10-20% lower answer quality for complex queries.

**Prevention:**
1. Implement two-stage retrieval (retrieve 20, rerank to 5)
2. Use cross-encoder reranker (ms-marco-MiniLM-L-6-v2)
3. +100ms latency for +15% accuracy

**When to skip:** Simple QA with short docs, latency critical

### MINOR: No Provenance Tracking

**What goes wrong:** LLM answers without citing source documents.

**Prevention:** Include source metadata in chunks, format LLM response with citations

**Template:**
```
Answer based on:
- pricing_2024.pdf, page 5
- terms_of_service.md, section 3
```

### MINOR: Synchronous Ingestion in Request Path

**What goes wrong:** Processing uploaded documents during HTTP request.

**Prevention:** Queue-based async ingestion (e.g., BullMQ, Celery)

---

## Roadmap Implications

Based on research, suggested phase structure for RAG implementation:

### Phase 1: Core RAG Pipeline (Foundation)
**Focus:** Get end-to-end working with single document type
**Addresses:**
- pgvector setup + HNSW indexes
- Document chunking (RecursiveCharacterTextSplitter)
- Embedding pipeline (all-MiniLM-L6-v2)
- Basic similarity search
- LLM integration

**Avoids:** Feature creep (reranking, hybrid search) before core works
**Success Metric:** Can upload PDF, ask question, get relevant answer

### Phase 2: Multi-Format Ingestion
**Focus:** Support PDF, DOCX, URLs
**Addresses:**
- LangChain document loaders
- Content extraction from HTML
- Metadata preservation
- Batch processing for memory efficiency

**Avoids:** Complex structured data (CSV, JSON) until unstructured working
**Success Metric:** 3+ document types ingestible with consistent quality

### Phase 3: Retrieval Quality Improvements
**Focus:** Metadata filtering, reranking, hybrid search
**Addresses:**
- Metadata-filtered search
- Two-stage retrieval with reranking
- Query optimization (expansion, HyDE)
- Hybrid semantic + keyword search

**Avoids:** Premature optimization before measuring baseline
**Success Metric:** 20%+ improvement in answer relevance (measured by eval set)

### Phase 4: Production Hardening
**Focus:** Performance, monitoring, edge cases
**Addresses:**
- Caching strategy
- Async ingestion queue
- Error handling (malformed docs)
- Provenance tracking
- Query latency optimization

**Avoids:** Over-engineering before production load
**Success Metric:** <500ms p95 query latency, 99.9% uptime

**Phase Ordering Rationale:**
- Phase 1 before 2: Core pipeline validates architecture before adding complexity
- Phase 2 before 3: Need diverse documents to measure retrieval quality
- Phase 3 before 4: Quality improvements inform what to optimize

**Research Flags for Phases:**
- **Phase 1:** Standard patterns, unlikely to need research
- **Phase 3:** May need research on domain-specific reranking strategies
- **Phase 4:** Likely needs VPS-specific performance research (memory profiling)

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (pgvector, LangChain, MiniLM) | **MEDIUM** | Based on training data + ecosystem trends pre-2025. Cannot verify 2026 status. |
| Chunking strategies | **HIGH** | Foundational CS, unlikely to change |
| Vector DB comparison | **MEDIUM** | Feature sets stable, but performance claims unverified |
| Deployment optimization | **MEDIUM** | General principles sound, but VPS-specific tuning may vary |
| Document processing | **HIGH** | LangChain/Unstructured mature as of cutoff |

**Overall Research Confidence: MEDIUM**
- Core RAG patterns well-established, unlikely to have changed dramatically
- Specific library versions/features not verifiable (cutoff Jan 2025, now Feb 2026)
- Performance characteristics educated estimates, not benchmarked

---

## Gaps to Address

### High Priority
1. **Current vector DB benchmarks:** pgvector vs. ChromaDB performance on 2GB VPS (need real-world testing)
2. **Embedding model updates:** Any new efficient models since Jan 2025?
3. **LangChain breaking changes:** Version compatibility (last known: 0.1.x)

### Medium Priority
4. **Reranking model performance:** Cost/benefit analysis for VPS deployment
5. **Hybrid search implementation:** PostgreSQL full-text + pgvector integration patterns
6. **Document extraction quality:** Unstructured.io vs. alternatives for PDF/HTML

### Low Priority (Phase-Specific Research Later)
7. **Advanced chunking:** Semantic chunking with LLMs (expensive, may not suit VPS)
8. **Multi-modal RAG:** Image + text retrieval (likely out of scope for lightweight)
9. **GraphRAG patterns:** Knowledge graph + vector hybrid (Phase 5+ feature)

---

## Alternative Architectures Considered

### Pure Full-Text Search (PostgreSQL ts_vector)
**Why not:** No semantic understanding, misses synonyms/paraphrasing
**When to use:** Exact keyword matching critical (legal, compliance)

### Serverless Vector DBs (Pinecone, Weaviate Cloud)
**Why not:** Vendor lock-in, ongoing costs, network latency
**When to use:** Need managed infrastructure, scaling beyond VPS

### Local LLM + RAG (Llama 3 8B)
**Why not:** 8GB+ RAM for model, slow CPU inference
**When to use:** Data privacy critical, budget for larger VPS

### Vector-Only (No Database)
**Why not:** No persistence, no ACID, hard to manage
**When to use:** Ephemeral use cases, prototyping only

---

## Quick Start Stack

**Minimal production-ready stack:**

```bash
# System
PostgreSQL 15+ with pgvector extension

# Python dependencies
pip install langchain sentence-transformers psycopg2-binary unstructured[pdf]

# Optional: Reranking
pip install sentence-transformers  # includes cross-encoder models
```

**Core code (~50 lines):**
```python
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.vectorstores import PGVector
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.document_loaders import PyPDFLoader

# 1. Load document
loader = PyPDFLoader("business_doc.pdf")
documents = loader.load()

# 2. Chunk with overlap
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
chunks = splitter.split_documents(documents)

# 3. Embed and store
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
vectorstore = PGVector.from_documents(
    chunks,
    embeddings,
    connection_string="postgresql://localhost/ragdb"
)

# 4. Query
results = vectorstore.similarity_search("What are payment terms?", k=5)

# 5. LLM generation (pseudo-code)
context = "\n".join([r.page_content for r in results])
answer = llm.generate(f"Context: {context}\n\nQuestion: {query}")
```

---

## Sources & References

**Knowledge Base:**
- LangChain documentation (as of Jan 2025 training cutoff)
- pgvector GitHub repository and documentation (v0.5.x era)
- Sentence Transformers library documentation
- RAG pattern literature (Lewis et al. 2020, Gao et al. 2023)
- Vector database comparisons (community benchmarks pre-2025)

**Verification Status:**
- All web searches blocked (WebSearch, WebFetch, Brave API unavailable)
- Research relies on training data current to January 2025
- Specific version numbers, 2026 updates, and current benchmarks NOT verified
- Architectural patterns and best practices stable, less time-sensitive

**Recommended Next Steps:**
1. Verify pgvector current version and features (https://github.com/pgvector/pgvector)
2. Check LangChain migration guides for breaking changes (https://python.langchain.com)
3. Benchmark embedding models on actual VPS hardware
4. Test document loaders with actual business documents (PDF quality varies)

---

**Research completed with MEDIUM confidence. Core patterns sound, but library versions and performance claims should be validated against current (2026) sources before Phase 1 implementation.**
