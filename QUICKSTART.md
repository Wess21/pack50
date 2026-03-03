# Quick Start Guide - Pack50 Bot

## ⚡ Fastest Way: Development Mode (Recommended for Testing)

### Prerequisites
- Node.js 20+
- Docker Desktop (for PostgreSQL + Redis only)

### Step 1: Start Database Services
```bash
# Start PostgreSQL with pgvector
docker run -d --name pack50_postgres \
  -e POSTGRES_DB=pack50 \
  -e POSTGRES_USER=pack50 \
  -e POSTGRES_PASSWORD=dev_password \
  -p 15432:5432 \
  pgvector/pgvector:pg16

# Start Redis
docker run -d --name pack50_redis \
  -p 16379:6379 \
  redis:7-alpine redis-server --requirepass dev_password
```

### Step 2: Setup Environment
```bash
# Copy example env
cp .env.example .env

# Edit .env and set your BOT_TOKEN:
# BOT_TOKEN=your_telegram_bot_token_here
# DATABASE_URL=postgresql://pack50:dev_password@localhost:15432/pack50
# REDIS_URL=redis://:dev_password@localhost:16379
# ANTHROPIC_API_KEY=your_key (optional)
# NODE_ENV=development
```

### Step 3: Install and Run
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start bot
npm run dev
```

### Step 4: Test
```bash
# In Telegram, find your bot and send:
/start

# Upload a test document via API:
curl -F "file=@test.pdf" http://localhost:3000/api/documents/upload

# Ask a question in Telegram
```

---

## 🐳 Docker Compose Mode (Production-like)

**⚠️ Known Issue**: ONNX Runtime has compatibility issues on ARM64 (Apple Silicon).

### For Intel/AMD (x86-64):
```bash
# Generate .env
./configure.sh

# Start all services
docker compose up -d

# Check logs
docker compose logs -f bot
```

### For Apple Silicon (M1/M2):
```bash
# Use development mode instead (see above)
# OR build with platform flag:
docker compose build --platform linux/amd64
docker compose up -d
```

---

## 📝 Quick Test Sequence

### 1. Verify Services Running
```bash
# Development mode:
curl http://localhost:3000/health

# Check logs:
tail -f logs/combined.log  # if using pm2
# or
npm run dev  # see console output
```

### 2. Upload Test Document
```bash
echo "Pack50 - это AI-powered Telegram бот для бизнеса." > test.txt

curl -F "file=@test.txt" \
  -H "Content-Type: multipart/form-data" \
  http://localhost:3000/api/documents/upload

# Response: {"jobId":"...","status":"processing"}
```

### 3. Test in Telegram
1. Open bot in Telegram
2. Send: `/start`
3. Ask: "Что такое Pack50?"
4. Bot should respond with info from uploaded document

### 4. Configure API Keys via Web Interface

**Новый интерфейс (рекомендуется):** http://localhost:3000/admin.html

1. **Login**: admin / changeme (or your custom password from .env)
2. **Добавить LLM провайдер**:
   - Нажмите "+ Добавить провайдер"
   - Название: VSE LLM - Claude (или любое)
   - Тип: OpenAI Compatible (или Anthropic Claude)
   - API Key: ваш ключ
   - **Для vsellm.ru**:
     - API Base URL: `https://api.vsellm.ru/v1`
     - Model Name: `anthropic/claude-haiku-4.5`
   - ✅ Сделать активным провайдером
   - Сохранить → Тест
3. **Upload Documents**: PDF, DOCX, or TXT files

**Старый интерфейс (legacy):** http://localhost:3000/index.html

### 5. Test Admin API (Optional)
```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme"}' | jq -r .token)

# Get config
curl -s http://localhost:3000/api/admin/config \
  -H "Authorization: Bearer $TOKEN" | jq .

# Configure OpenAI with custom endpoint (vsellm.ru example)
curl -s -X PUT http://localhost:3000/api/admin/config \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "active_model": "gpt-4o",
    "openai_api_key": "your-key",
    "api_base_url": "https://api.vsellm.ru/v1",
    "llm_model_name": "anthropic/claude-haiku-4.5"
  }' | jq .

# Get analytics
curl -s http://localhost:3000/api/admin/analytics?days=1 \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## 🛠️ Troubleshooting

### Bot не запускается
```bash
# Check if ports are free
lsof -i :3000  # API port
lsof -i :15432  # PostgreSQL
lsof -i :16379  # Redis

# Check database connection
psql postgresql://pack50:dev_password@localhost:15432/pack50 -c "SELECT 1;"

# Check Redis connection
redis-cli -h localhost -p 16379 -a dev_password ping
```

### ONNX Runtime ошибки
```bash
# На Apple Silicon может не работать - это известная проблема
# Решение: использовать development mode (не Docker)

# Или удалить @xenova/transformers и использовать другой embedding provider
```

### TypeScript ошибки
```bash
# Rebuild
npm run build

# Check for errors
npx tsc --noEmit
```

---

## 📊 What Works

✅ **Fully Tested**:
- PostgreSQL + pgvector setup
- Redis session storage
- Document upload API (PDF, DOCX, URL)
- RAG vector search
- Multi-provider LLM (Claude/GPT)
- Admin API (login, config, analytics)
- Encryption & JWT auth

⚠️ **Partially Tested**:
- Docker Compose (works on x86-64, issues on ARM64)
- Admin frontend UI (placeholder only)
- Analytics integration with message handler

---

## 🎯 Recommended Setup for Testing

**BEST:** Development mode with local databases:
```bash
docker run -d --name pack50_postgres -e POSTGRES_DB=pack50 -e POSTGRES_USER=pack50 -e POSTGRES_PASSWORD=dev_password -p 15432:5432 pgvector/pgvector:pg16
docker run -d --name pack50_redis -p 16379:6379 redis:7-alpine redis-server --requirepass dev_password
npm install && npm run build && npm run dev
```

This avoids Docker ONNX issues and gives you full visibility into logs!

---

**Last Updated**: 2026-03-01
**Status**: All 6 phases complete, development mode ready for testing
