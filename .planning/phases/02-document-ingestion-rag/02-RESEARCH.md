# Phase 2: Document Ingestion & RAG Pipeline - Research

**Researched:** 2026-02-28
**Domain:** RAG (Retrieval-Augmented Generation), Document Processing, Vector Embeddings
**Confidence:** MEDIUM-HIGH

## Summary

This phase requires implementing a complete document ingestion and RAG retrieval pipeline that handles PDF, DOCX, and URL content, chunks documents efficiently, generates embeddings, stores vectors in PostgreSQL with pgvector, and retrieves relevant context for user queries in under 500ms.

The standard stack in 2026 combines LangChain for document loading and text splitting, sentence-transformers (specifically all-MiniLM-L6-v2) for local embeddings, and PostgreSQL with pgvector extension for vector storage and similarity search. This stack provides production-ready performance for 10K+ document chunks while fitting in <1GB RAM constraints.

Critical success factors: proper chunking strategy (1000 chars with 20% overlap prevents context loss), using RecursiveCharacterTextSplitter to respect document structure, comprehensive metadata tracking (source, page, timestamp, doc_type) for citation support, and IVFFlat indexing for 10K documents (HNSW is overkill at this scale).

**Primary recommendation:** Use LangChain's langchain-postgres integration with sentence-transformers embedding model, implement async document processing in FastAPI, store metadata separately for filtering/citations, and monitor retrieval latency with observability from day one.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DOC-01 | Администратор может загружать PDF документы через API | LangChain PyPDFLoader (langchain-community), async FastAPI endpoint for file upload |
| DOC-02 | Администратор может загружать DOCX документы через API | LangChain Docx2txtLoader, Unstructured library for advanced parsing |
| DOC-03 | Администратор может добавлять URL для индексации контента | LangChain WebBaseLoader (BeautifulSoup-based), Trafilatura for better content extraction |
| DOC-04 | Документы автоматически разбиваются на чанки (1000 символов, 20% overlap) | RecursiveCharacterTextSplitter with chunk_size=1000, chunk_overlap=200 |
| DOC-05 | Чанки эмбеддятся через локальную модель (all-MiniLM-L6-v2) | sentence-transformers library, 384-dimensional embeddings, 22MB model size |
| DOC-06 | Эмбеддинги сохраняются в PostgreSQL с pgvector extension | pgvector 0.8.0+, IVFFlat index for 10K scale, psycopg3 driver |
| DOC-07 | Метаданные документов сохраняются (source, page, date, doc_type) | Store in JSONB column alongside vectors for filtering, use LangChain Document.metadata |
| RAG-01 | Бот эмбеддит вопрос пользователя через ту же модель | Same sentence-transformers model for query encoding ensures embedding space consistency |
| RAG-02 | Бот находит Top-5 релевантных чанков через vector similarity search | pgvector cosine distance (<=>), ORDER BY embedding <=> query_embedding LIMIT 5 |
| RAG-03 | Бот фильтрует результаты по метаданным (опционально) | SQL WHERE clauses on metadata JSONB fields before vector search |
| RAG-04 | Бот цитирует источники в ответах (документ, страница) | Extract from metadata: source filename, page number tracked during chunking |
| RAG-05 | Retrieval работает < 500ms на базе 10K документов | IVFFlat index with lists=100 (sqrt of 10K), shared_buffers tuning, avoid HNSW overhead |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| langchain-community | latest | Document loaders (PDF, DOCX, Web) | De facto standard for document ingestion, supports 50+ formats |
| langchain-text-splitters | latest | RecursiveCharacterTextSplitter | Industry-standard chunking with semantic boundary preservation |
| langchain-postgres | latest | PGVector integration | Official pgvector integration replacing deprecated langchain_community.vectorstores.pgvector |
| sentence-transformers | 3.3.1+ | Local embedding generation | State-of-the-art embeddings, no API costs, runs offline |
| pgvector | 0.8.0+ | Vector similarity search in Postgres | Production-proven vector DB extension, 2026 release with HNSW improvements |
| psycopg[binary] | 3.x | PostgreSQL driver | Required for langchain-postgres (psycopg3), async support |
| unstructured[docx] | 0.21.5+ | Advanced DOCX/PDF parsing | Better structure preservation than basic loaders, semantic chunking |
| trafilatura | 2.0.0+ | Web content extraction | 95.8% F1 score vs 86% for BeautifulSoup, removes boilerplate/ads |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| PyMuPDF (fitz) | latest | Advanced PDF parsing | When PyPDF fails on complex layouts, OCR support |
| python-docx | 1.2.0 | Direct DOCX manipulation | When Unstructured over-processes simple documents |
| beautifulsoup4 | 4.13.5+ | Fallback HTML parsing | When Trafilatura fails on JavaScript-heavy sites |
| celery | latest | Async document processing | For background ingestion tasks on large document sets |
| redis | latest | Task queue for Celery | Document processing job queue |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| all-MiniLM-L6-v2 | all-mpnet-base-v2 | Better accuracy (768 dims vs 384) but 5x larger model, slower inference |
| pgvector | Qdrant, Pinecone, Weaviate | Dedicated vector DBs have better scaling but require separate service (violates 1GB RAM constraint) |
| LangChain | LlamaIndex | Similar features but less mature for production, smaller ecosystem |
| RecursiveCharacterTextSplitter | Semantic chunking | Better boundary detection but 3-5x slower, complex tuning |
| IVFFlat index | HNSW index | HNSW has better recall but uses more RAM, overkill for 10K docs |

**Installation:**
```bash
pip install langchain-community langchain-text-splitters langchain-postgres
pip install sentence-transformers psycopg[binary]
pip install "unstructured[docx]" trafilatura
pip install pypdf python-docx beautifulsoup4 lxml
```

**PostgreSQL Extension:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── services/
│   ├── document_ingestion.py    # Document upload, parsing, chunking
│   ├── embedding_service.py      # Embedding generation with batching
│   └── retrieval_service.py      # Vector search, metadata filtering
├── loaders/
│   ├── pdf_loader.py             # PDF-specific loading logic
│   ├── docx_loader.py            # DOCX-specific loading logic
│   └── web_loader.py             # URL content extraction
├── models/
│   ├── document.py               # Document metadata schema
│   └── chunk.py                  # Chunk + embedding schema
├── api/
│   └── documents.py              # FastAPI endpoints for ingestion
└── config/
    └── embeddings.py             # Model loading, caching
```

### Pattern 1: Document Ingestion Pipeline
**What:** Multi-stage async pipeline: Upload → Parse → Chunk → Embed → Store
**When to use:** All document uploads should go through this pipeline for consistency

**Example:**
```python
# Source: Research synthesis from LangChain docs + FastAPI patterns 2026
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from langchain_postgres import PGVector
import asyncio

class DocumentIngestionService:
    def __init__(self):
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,  # 20% overlap
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""],
            add_start_index=True
        )
        self.embedding_model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')

    async def process_pdf(self, file_path: str, metadata: dict):
        # 1. Load document
        loader = PyPDFLoader(file_path, mode="page")
        pages = await asyncio.to_thread(loader.load)

        # 2. Split into chunks with metadata
        chunks = []
        for page in pages:
            page_chunks = self.text_splitter.split_documents([page])
            for chunk in page_chunks:
                chunk.metadata.update({
                    "source": metadata["filename"],
                    "page": page.metadata.get("page", 0),
                    "doc_type": "pdf",
                    "uploaded_at": metadata["timestamp"]
                })
                chunks.append(chunk)

        # 3. Batch embed (efficient)
        texts = [chunk.page_content for chunk in chunks]
        embeddings = await asyncio.to_thread(
            self.embedding_model.encode,
            texts,
            batch_size=32,
            show_progress_bar=False
        )

        # 4. Store in pgvector
        await self._store_chunks(chunks, embeddings)
```

### Pattern 2: Efficient Batched Embedding
**What:** Process multiple texts in single model call to leverage GPU parallelism
**When to use:** When embedding >10 chunks at once, during bulk document ingestion

**Example:**
```python
# Source: sentence-transformers docs + performance optimization research
from sentence_transformers import SentenceTransformer
import asyncio

class EmbeddingService:
    def __init__(self):
        self.model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
        self.model.max_seq_length = 256  # Truncate long inputs

    async def embed_batch(self, texts: list[str], batch_size: int = 32):
        """5-10x faster than single-sentence inference"""
        # Run CPU-bound model in thread pool
        embeddings = await asyncio.to_thread(
            self.model.encode,
            texts,
            batch_size=batch_size,
            convert_to_numpy=True,
            normalize_embeddings=True,  # For cosine similarity
            show_progress_bar=len(texts) > 100
        )
        return embeddings

    async def embed_query(self, query: str):
        """Single query embedding"""
        embedding = await asyncio.to_thread(
            self.model.encode,
            [query],
            convert_to_numpy=True,
            normalize_embeddings=True
        )
        return embedding[0]
```

### Pattern 3: Retrieval with Metadata Filtering
**What:** Combine vector similarity with SQL WHERE clauses for filtered retrieval
**When to use:** When user needs specific document types, date ranges, or sources

**Example:**
```python
# Source: LangChain PGVector docs + RAG metadata filtering patterns 2026
from langchain_postgres import PGVector
from langchain_core.embeddings import Embeddings

class RetrievalService:
    def __init__(self, connection_string: str, embeddings: Embeddings):
        self.vectorstore = PGVector(
            embeddings=embeddings,
            collection_name="document_chunks",
            connection=connection_string,
            use_jsonb=True  # Store metadata as JSONB
        )

    async def retrieve_with_citations(
        self,
        query: str,
        k: int = 5,
        filters: dict = None
    ):
        """Retrieve top-k chunks with source citations"""
        # Build metadata filter
        search_kwargs = {"k": k}
        if filters:
            # Filter by doc_type, date range, source, etc.
            search_kwargs["filter"] = filters

        # Vector similarity search
        results = await self.vectorstore.asimilarity_search_with_score(
            query,
            **search_kwargs
        )

        # Format with citations
        chunks_with_citations = []
        for doc, score in results:
            chunks_with_citations.append({
                "content": doc.page_content,
                "similarity": float(score),
                "citation": {
                    "source": doc.metadata.get("source", "Unknown"),
                    "page": doc.metadata.get("page"),
                    "doc_type": doc.metadata.get("doc_type")
                }
            })

        return chunks_with_citations
```

### Pattern 4: URL Content Extraction with Fallback
**What:** Try Trafilatura first (best quality), fall back to BeautifulSoup if it fails
**When to use:** Processing URLs submitted by administrators

**Example:**
```python
# Source: Trafilatura docs + web extraction best practices 2026
import trafilatura
from langchain_community.document_loaders import WebBaseLoader
from langchain_core.documents import Document

async def extract_url_content(url: str) -> Document:
    """Extract article text from URL with intelligent fallback"""
    # Try Trafilatura first (95.8% F1 score)
    try:
        downloaded = await asyncio.to_thread(trafilatura.fetch_url, url)
        if downloaded:
            text = trafilatura.extract(
                downloaded,
                include_comments=False,
                include_tables=True,
                no_fallback=False
            )
            if text and len(text) > 100:  # Minimum viable content
                metadata = trafilatura.extract_metadata(downloaded)
                return Document(
                    page_content=text,
                    metadata={
                        "source": url,
                        "title": metadata.title if metadata else None,
                        "date": metadata.date if metadata else None,
                        "doc_type": "url"
                    }
                )
    except Exception as e:
        print(f"Trafilatura failed: {e}")

    # Fallback to WebBaseLoader (BeautifulSoup-based)
    loader = WebBaseLoader(url)
    docs = await asyncio.to_thread(loader.load)
    if docs:
        docs[0].metadata["doc_type"] = "url"
        return docs[0]

    raise ValueError(f"Failed to extract content from {url}")
```

### Pattern 5: PGVector Index Configuration
**What:** Optimize pgvector index for 10K document scale and <500ms retrieval
**When to use:** During initial setup and after bulk ingestion

**Example:**
```sql
-- Source: pgvector docs + performance tuning research 2026
-- Create table with vector column
CREATE TABLE document_chunks (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(384),  -- all-MiniLM-L6-v2 dimensions
    metadata JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- For 10K documents, use IVFFlat with ~100 lists (sqrt of row count)
CREATE INDEX ON document_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Performance tuning for queries
SET shared_buffers = '256MB';  -- 25% of 1GB RAM
SET maintenance_work_mem = '128MB';  -- For index builds

-- Query pattern
-- Returns top-5 chunks in <100ms for 10K docs
SELECT
    content,
    metadata->>'source' as source,
    metadata->>'page' as page,
    1 - (embedding <=> '[query_embedding_here]') as similarity
FROM document_chunks
WHERE metadata->>'doc_type' = 'pdf'  -- Optional filter
ORDER BY embedding <=> '[query_embedding_here]'
LIMIT 5;
```

### Anti-Patterns to Avoid

- **Embedding documents without chunking first:** Loses fine-grained retrieval, query matches entire document instead of relevant section
- **Using different embedding models for indexing vs querying:** Embedding spaces won't align, retrieval quality tanks
- **Building HNSW index on small datasets (<50K docs):** Massive memory overhead for minimal recall improvement, wastes resources
- **Chunking after embedding (naive approach):** Loses context dependencies, anaphoric references unresolved, poor embedding quality
- **Storing vectors without metadata:** Cannot cite sources, filter by type/date, or explain retrieval decisions
- **Synchronous document processing in API endpoint:** Blocks request thread, times out on large PDFs, bad UX

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF text extraction | Custom PDF parser with regex | PyPDFLoader or PyMuPDF | Handles edge cases: rotated text, multi-column layouts, embedded fonts, form fields |
| DOCX parsing | XML parsing of .docx internals | Unstructured or python-docx | Office XML is complex: styles, tables, headers/footers, embedded objects |
| Web content extraction | BeautifulSoup with manual selectors | Trafilatura | Heuristics for main content vs ads/navigation refined over thousands of sites |
| Text chunking | Split on every N characters | RecursiveCharacterTextSplitter | Respects semantic boundaries (paragraphs → sentences → words), prevents mid-sentence splits |
| Vector similarity search | Euclidean distance in Python loops | pgvector with IVFFlat index | Indexed search is 100-1000x faster, approximate NN algorithms handle scale |
| Embedding model hosting | Train custom embedding model | sentence-transformers pretrained | Requires millions of examples, months of training, $$$$ GPU costs |
| Metadata filtering | Python post-processing of results | SQL WHERE + vector search | Push-down optimization, 10x faster than fetch-all-then-filter |

**Key insight:** Document processing has decades of edge cases (encoding issues, malformed PDFs, JavaScript-rendered content, tables spanning pages). Mature libraries have solved these through battle-testing. Custom solutions inevitably hit the same issues months later.

## Common Pitfalls

### Pitfall 1: Context Loss at Chunk Boundaries
**What goes wrong:** Fixed-size chunking splits sentences mid-thought, losing semantic coherence. User queries retrieve fragments without context.

**Why it happens:** Naive `text.split()` at character positions ignores natural language structure. A paragraph discussing "authentication flow" gets split, with "authentication" in one chunk and "flow details" in another.

**How to avoid:**
- Use RecursiveCharacterTextSplitter with semantic separators: `["\n\n", "\n", ". ", " ", ""]`
- Set 20% overlap (200 chars for 1000-char chunks) to preserve boundary context
- Add `add_start_index=True` to track original position for debugging

**Warning signs:**
- Retrieved chunks end mid-sentence
- User asks about topic X, retrieves chunks mentioning X but missing explanation
- Low relevance scores despite keyword matches

### Pitfall 2: Stale Embeddings After Model Change
**What goes wrong:** You embed 10K documents with model A, then switch to model B for queries. Retrieval returns random results.

**Why it happens:** Each embedding model creates a unique vector space. Models trained on different data/objectives produce incompatible embeddings. Cosine similarity between cross-model vectors is meaningless.

**How to avoid:**
- Lock embedding model in config at project start: `EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"`
- Version your vector table: `document_chunks_v1`, `document_chunks_v2` when changing models
- Re-embed ALL documents when changing models (no partial migration)

**Warning signs:**
- Retrieval quality suddenly drops after "upgrading" embedding model
- Same query returns completely different results before/after model change
- Similarity scores cluster around 0.5 (random)

### Pitfall 3: Memory Bloat with HNSW on Small Datasets
**What goes wrong:** You create HNSW index on 10K documents. PostgreSQL memory usage spikes from 200MB to 800MB. Queries are only 10ms faster than IVFFlat.

**Why it happens:** HNSW builds in-memory graph structure with 16+ connections per vector. For 10K docs × 384 dims × 16 connections = ~240MB just for graph, plus vector data. Minimal recall improvement over IVFFlat at this scale.

**How to avoid:**
- Use IVFFlat for <50K documents: `USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
- Only switch to HNSW when retrieval latency consistently >500ms and dataset >50K
- Monitor `maintenance_work_mem` during index builds

**Warning signs:**
- PostgreSQL OOM kills during index creation
- Minimal query speedup (<20%) after switching to HNSW
- Memory usage higher than expected for dataset size

### Pitfall 4: Compounding Retrieval Failure
**What goes wrong:** Top-5 retrieved chunks don't contain answer to user query. LLM hallucinates or says "I don't know." User blames bot when retrieval was broken from start.

**Why it happens:** Poor chunking (Pitfall 1) + no relevance threshold + no observability. System retrieves irrelevant chunks but has no way to detect/reject them. 95% retrieval accuracy × 95% generation accuracy = 90% system reliability.

**How to avoid:**
- Log retrieval results BEFORE sending to LLM: similarity scores, chunk content, metadata
- Set minimum similarity threshold (e.g., reject if best match <0.3)
- Monitor retrieval metrics: average similarity, % queries with no good matches
- Implement "retrieval confidence" signal to LLM: "Low confidence context provided"

**Warning signs:**
- Users report bot "making things up"
- High variance in answer quality (some queries perfect, others nonsense)
- No correlation between query complexity and success rate

### Pitfall 5: Synchronous Document Processing Blocking API
**What goes wrong:** Admin uploads 50-page PDF via API. Request times out after 30 seconds. Document half-processed, database in inconsistent state.

**Why it happens:** Processing 50 pages × parsing × chunking × embedding × DB writes takes 60+ seconds. API endpoint processes synchronously, holding request thread. Client timeout or server worker exhaustion.

**How to avoid:**
- Accept upload, return 202 Accepted with job ID immediately
- Process document in background task (Celery, asyncio queue)
- Provide status endpoint: `/documents/{id}/status` returns processing state
- Use transaction: commit to DB only after ALL chunks embedded

**Warning signs:**
- Client timeouts on large document uploads
- Partial documents in database (some pages missing)
- API worker pool exhaustion during bulk uploads

### Pitfall 6: Missing Metadata for Citations
**What goes wrong:** Bot retrieves relevant chunk but can't cite source. User asks "where did you find this?" Bot can't answer. Trust erodes.

**Why it happens:** Metadata not captured during chunking, or not propagated through pipeline. Only storing `(chunk_text, embedding)` without `(source, page, timestamp)`.

**How to avoid:**
- Capture metadata at document load: `loader.load()` → `Document.metadata`
- Preserve metadata through chunking: `splitter.split_documents()` copies metadata to child chunks
- Enrich metadata: add `uploaded_at`, `doc_type`, `page_number` explicitly
- Store metadata as JSONB in pgvector table for filtering/display

**Warning signs:**
- Cannot answer "what document is this from?"
- No way to filter retrieval by document type or date
- All chunks look identical in logs (no distinguishing metadata)

### Pitfall 7: URL Extraction Missing JavaScript Content
**What goes wrong:** Admin adds URL to modern SPA (React/Vue). WebBaseLoader extracts empty content or just navigation menu.

**Why it happens:** WebBaseLoader uses BeautifulSoup on raw HTML. SPAs render content via JavaScript AFTER page load. BeautifulSoup sees `<div id="app"></div>` before JS runs.

**How to avoid:**
- Use Trafilatura first (handles some JS-rendered content)
- For SPAs, switch to SeleniumURLLoader or PlaywrightLoader (executes JS)
- Detect empty/low content: `if len(text) < 100: use_selenium()`
- Document limitation: "Static pages only" or "Requires JavaScript-rendered content support"

**Warning signs:**
- URL ingestion succeeds but creates 1-2 tiny chunks
- Extracted content is navigation links, not article text
- User says "this URL has content but bot didn't index it"

## Code Examples

Verified patterns from official sources:

### Chunking with RecursiveCharacterTextSplitter
```python
# Source: LangChain reference docs 2026
from langchain_text_splitters import RecursiveCharacterTextSplitter

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,  # 20% overlap
    length_function=len,
    separators=["\n\n", "\n", ". ", " ", ""],
    is_separator_regex=False,
    add_start_index=True  # Track original position
)

# Split documents while preserving metadata
chunks = text_splitter.split_documents(documents)
```

### Loading PDF with Page Numbers
```python
# Source: LangChain community loaders docs
from langchain_community.document_loaders import PyPDFLoader

loader = PyPDFLoader(
    file_path="./business-policies.pdf",
    mode="page"  # Each page becomes separate Document
)
pages = loader.load()

# Each page has metadata["page"] for citations
for page in pages:
    print(f"Page {page.metadata['page']}: {len(page.page_content)} chars")
```

### Embedding with sentence-transformers
```python
# Source: HuggingFace sentence-transformers docs
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
sentences = ["This is chunk 1", "This is chunk 2"]

# Batch encoding (5-10x faster)
embeddings = model.encode(
    sentences,
    batch_size=32,
    normalize_embeddings=True,  # For cosine similarity
    convert_to_numpy=True
)
# Returns numpy array of shape (2, 384)
```

### PGVector Integration (2026 Standard)
```python
# Source: LangChain langchain-postgres docs
from langchain_postgres import PGVector
from sentence_transformers import SentenceTransformer

# Wrap sentence-transformers in LangChain Embeddings interface
class SentenceTransformerEmbeddings:
    def __init__(self, model_name: str):
        self.model = SentenceTransformer(model_name)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self.model.encode(texts, normalize_embeddings=True).tolist()

    def embed_query(self, text: str) -> list[float]:
        return self.model.encode([text], normalize_embeddings=True)[0].tolist()

embeddings = SentenceTransformerEmbeddings('sentence-transformers/all-MiniLM-L6-v2')

# Connect to pgvector (requires psycopg3)
vectorstore = PGVector(
    embeddings=embeddings,
    collection_name="document_chunks",
    connection="postgresql+psycopg://user:pass@localhost:5432/dbname",
    use_jsonb=True  # Store metadata as JSONB
)

# Add documents
vectorstore.add_documents(documents)

# Search with metadata filtering
results = vectorstore.similarity_search_with_score(
    query="What is the refund policy?",
    k=5,
    filter={"doc_type": "pdf"}  # Optional metadata filter
)
```

### FastAPI Async Document Upload
```python
# Source: FastAPI + RAG patterns research 2026
from fastapi import FastAPI, UploadFile, BackgroundTasks
from pydantic import BaseModel
import uuid

app = FastAPI()

class UploadResponse(BaseModel):
    job_id: str
    status: str

@app.post("/documents/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile,
    background_tasks: BackgroundTasks
):
    """Accept document, process in background, return immediately"""
    # Generate job ID
    job_id = str(uuid.uuid4())

    # Save file
    file_path = f"/tmp/{job_id}_{file.filename}"
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # Schedule background processing
    background_tasks.add_task(
        process_document_async,
        job_id=job_id,
        file_path=file_path,
        filename=file.filename
    )

    return UploadResponse(
        job_id=job_id,
        status="processing"
    )

async def process_document_async(job_id: str, file_path: str, filename: str):
    """Background task: parse → chunk → embed → store"""
    try:
        # Load and process document
        ingestion_service = DocumentIngestionService()
        await ingestion_service.process_pdf(
            file_path=file_path,
            metadata={"filename": filename, "job_id": job_id}
        )
        # Update job status in DB
        await update_job_status(job_id, "completed")
    except Exception as e:
        await update_job_status(job_id, "failed", error=str(e))
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| langchain_community.vectorstores.pgvector | langchain-postgres package | 2025-2026 | New package uses psycopg3, better async support, pending deprecation of old module |
| BeautifulSoup for all web extraction | Trafilatura with BeautifulSoup fallback | 2024-2025 | 95.8% vs 86% F1 score, removes ads/boilerplate automatically |
| Fixed-size chunking (every N chars) | Recursive + semantic chunking | 2024-2026 | 60% improvement in RAG accuracy by respecting document structure |
| Train custom embedding models | Use pretrained sentence-transformers | 2020-2024 | all-MiniLM-L6-v2 outperforms most custom models, 22MB vs GBs, no training cost |
| IVFFlat only | HNSW for large-scale | pgvector 0.5.0+ (2023) | HNSW better speed-recall tradeoff but needs careful memory tuning |
| Synchronous document processing | Async with background tasks | FastAPI async patterns 2025+ | No request timeouts, better throughput, handles large documents |

**Deprecated/outdated:**
- **langchain_community.vectorstores.pgvector**: Use `langchain-postgres` instead (psycopg3 required)
- **OpenAI embeddings for everything**: Local models (sentence-transformers) now competitive and free
- **Separate vector DB for small datasets**: pgvector sufficient for <1M vectors, simpler architecture
- **No overlap in chunking**: 10-20% overlap is now standard to prevent context loss

## Open Questions

1. **DOCX complex table handling**
   - What we know: Unstructured library struggles with complex tables, python-docx better for structured extraction
   - What's unclear: Which approach works best for business policy documents with nested tables
   - Recommendation: Start with Unstructured, fall back to python-docx if table content is garbled, test with real client documents

2. **Embedding model warm-up time**
   - What we know: sentence-transformers loads model into RAM on first use (~500ms delay)
   - What's unclear: Best practice for FastAPI startup - preload in lifespan or lazy load on first request
   - Recommendation: Preload in FastAPI lifespan event to avoid first-request latency

3. **IVFFlat lists tuning for varying dataset sizes**
   - What we know: Formula is `lists = sqrt(row_count)`, so 10K docs = 100 lists
   - What's unclear: How to dynamically adjust as dataset grows from 1K → 10K → 50K
   - Recommendation: Start with lists=100, rebuild index when dataset 4x larger (40K), monitor query latency

4. **Metadata schema versioning**
   - What we know: JSONB flexible but no schema enforcement
   - What's unclear: How to handle metadata schema evolution (add fields, rename, deprecate)
   - Recommendation: Use consistent keys from day 1, write migration script if schema changes, consider Pydantic validation layer

5. **Retrieval performance with metadata filtering**
   - What we know: SQL WHERE before vector search is efficient
   - What's unclear: Performance impact of complex filters (date ranges + doc_type + source)
   - Recommendation: Add JSONB GIN index on metadata column if filtering is common: `CREATE INDEX ON document_chunks USING gin(metadata)`

## Sources

### Primary (HIGH confidence)
- [pgvector GitHub](https://github.com/pgvector/pgvector) - Installation, index types (IVFFlat vs HNSW), configuration for 10K documents
- [sentence-transformers all-MiniLM-L6-v2 HuggingFace](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) - Model specifications, 384 dimensions, usage examples
- [LangChain Document Loaders Reference](https://reference.langchain.com/python/langchain-community/document_loaders) - PyPDFLoader, Docx2txtLoader, WebBaseLoader APIs
- [LangChain PGVector Integration](https://docs.langchain.com/oss/python/integrations/vectorstores/pgvector) - langchain-postgres usage, psycopg3 requirements
- [Trafilatura Documentation](https://trafilatura.readthedocs.io/) - Web content extraction, F1 score benchmarks

### Secondary (MEDIUM confidence)
- [Best Chunking Strategies for RAG 2026 - Firecrawl](https://www.firecrawl.dev/blog/best-chunking-strategies-rag) - Overlap recommendations (10-20%), performance benchmarks
- [Chunking Strategies for RAG - Weaviate](https://weaviate.io/blog/chunking-strategies-for-rag) - Context loss at boundaries, semantic vs fixed-size
- [RAG Common Pitfalls 2026](https://dasroot.net/posts/2026/02/why-naive-rag-fails-production/) - Stale embeddings, compounding failures, observability
- [pgvector Performance Tuning - Crunchy Data](https://www.crunchydata.com/blog/pgvector-performance-for-developers) - shared_buffers, maintenance_work_mem optimization
- [FastAPI Async RAG - FutureSmart AI](https://blog.futuresmart.ai/rag-system-with-async-fastapi-qdrant-langchain-and-openai) - Background task patterns, async document processing
- [NVIDIA Chunking Strategy Guide](https://developer.nvidia.com/blog/finding-the-best-chunking-strategy-for-accurate-ai-responses/) - 15% overlap optimal for 1024-token chunks
- [Citation-Aware RAG - Tensorlake](https://www.tensorlake.ai/blog/rag-citations) - Metadata tracking for source attribution

### Tertiary (LOW confidence - needs validation)
- [Unstructured DOCX Parsing Issues](https://github.com/Unstructured-IO/unstructured) - User reports of bullet point recognition issues (GitHub discussions)
- [pgvector Memory Issues](https://github.com/pgvector/pgvector/issues/144) - Connection memory consumption reports (single-issue thread, not official docs)

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM-HIGH - Verified with official docs (LangChain, pgvector, sentence-transformers) but some integration details need testing
- Architecture: MEDIUM - Patterns from multiple production sources but not tested in this specific stack combination
- Pitfalls: HIGH - Well-documented in 2026 production RAG reports, consistent across multiple sources
- Performance (<500ms): MEDIUM - pgvector benchmarks confirm but actual latency depends on PostgreSQL tuning

**Research date:** 2026-02-28
**Valid until:** 2026-04-30 (60 days - RAG ecosystem evolving but core technologies stable)
