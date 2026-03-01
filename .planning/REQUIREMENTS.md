# Requirements: AI Assistant Box

**Defined:** 2026-02-27
**Core Value:** Умный AI-ассистент, который действительно продуктивно работает на бизнес — качественно отвечает на вопросы клиентов, помнит контекст диалогов, проактивно ведет к решению, снижает нагрузку на операторов и увеличивает конверсию в заявки.

## v1 Requirements

Requirements for MVP (демонстрация потенциальным клиентам). Each maps to roadmap phases.

### Telegram Bot Interface

- [ ] **BOT-01**: Бот получает сообщения от пользователей через Telegram Bot API
- [ ] **BOT-02**: Бот отправляет текстовые ответы пользователям в Telegram
- [ ] **BOT-03**: Бот работает через webhook (продакшн) или long polling (разработка)
- [ ] **BOT-04**: Бот валидирует webhook запросы через secret token
- [ ] **BOT-05**: Бот обрабатывает команды (/start, /help, /cancel)
- [ ] **BOT-06**: Бот поддерживает inline-клавиатуры для быстрых ответов

### Conversation Management

- [ ] **CONV-01**: Бот помнит контекст диалога с каждым пользователем
- [ ] **CONV-02**: Сессии пользователей сохраняются в Redis (переживают рестарт)
- [ ] **CONV-03**: Бот ведет multi-turn диалоги (5+ сообщений подряд)
- [ ] **CONV-04**: Бот задает уточняющие вопросы для сбора информации
- [ ] **CONV-05**: Бот проактивно ведет пользователя к решению/заявке
- [ ] **CONV-06**: Бот суммаризирует длинные диалоги для управления контекстом
- [ ] **CONV-07**: Неактивные сессии автоматически истекают (TTL 24 часа)

### Data Collection

- [ ] **DATA-01**: Бот извлекает имя, email, телефон из сообщений пользователя
- [ ] **DATA-02**: Бот сохраняет историю всех диалогов в базе данных
- [ ] **DATA-03**: Бот формирует структурированные заявки из собранных данных
- [ ] **DATA-04**: Бот подтверждает собранную информацию перед отправкой заявки

### Document Knowledge Base

- [x] **DOC-01**: Администратор может загружать PDF документы через API
- [x] **DOC-02**: Администратор может загружать DOCX документы через API
- [x] **DOC-03**: Администратор может добавлять URL для индексации контента
- [x] **DOC-04**: Документы автоматически разбиваются на чанки (1000 символов, 20% overlap)
- [x] **DOC-05**: Чанки эмбеддятся через локальную модель (all-MiniLM-L6-v2)
- [x] **DOC-06**: Эмбеддинги сохраняются в PostgreSQL с pgvector extension
- [x] **DOC-07**: Метаданные документов сохраняются (source, page, date, doc_type)

### RAG Retrieval

- [x] **RAG-01**: Бот эмбеддит вопрос пользователя через ту же модель
- [x] **RAG-02**: Бот находит Top-5 релевантных чанков через vector similarity search
- [x] **RAG-03**: Бот фильтрует результаты по метаданным (опционально)
- [x] **RAG-04**: Бот цитирует источники в ответах (документ, страница)
- [x] **RAG-05**: Retrieval работает < 500ms на базе 10K документов

### LLM Integration

- [ ] **LLM-01**: Бот использует Claude API (Sonnet 3.5+) для генерации ответов
- [ ] **LLM-02**: Промпт включает system role с целями и поведением
- [ ] **LLM-03**: Промпт включает retrieved документы из RAG
- [ ] **LLM-04**: Промпт включает историю диалога (последние 5-10 сообщений)
- [ ] **LLM-05**: Контекст не превышает 80% от context window (мониторинг)
- [ ] **LLM-06**: Бот обрабатывает ошибки LLM API gracefully

### Webhook Integration

- [ ] **HOOK-01**: Бот отправляет данные в CRM через outgoing webhook
- [ ] **HOOK-02**: Администратор настраивает webhook URL через конфиг
- [ ] **HOOK-03**: Webhook включает user_id, message, timestamp, collected_data
- [ ] **HOOK-04**: Неудачные webhook retry с exponential backoff

### Admin Interface

- [ ] **ADM-01**: Администратор выбирает AI модель (OpenAI/Anthropic) через конфиг
- [ ] **ADM-02**: Администратор добавляет свой API ключ для модели
- [ ] **ADM-03**: Администратор выбирает шаблон промпта (Консультант/Техподдержка/Прием заказов)
- [ ] **ADM-04**: Администратор редактирует system prompt для шаблона
- [ ] **ADM-05**: Администратор видит базовую аналитику (количество диалогов, эскалаций, время ответа)

### Deployment

- [ ] **DEP-01**: Полный стек запускается через docker-compose up -d
- [ ] **DEP-02**: Установка требует максимум 3 команды (install.sh, configure.sh, docker compose up)
- [ ] **DEP-03**: configure.sh генерирует случайные пароли для DB/Redis
- [ ] **DEP-04**: configure.sh запрашивает Telegram bot token интерактивно
- [ ] **DEP-05**: Секреты хранятся в .env с правами 600
- [ ] **DEP-06**: Весь стек работает в < 1GB RAM (на 1GB VPS)
- [ ] **DEP-07**: Контейнеры имеют resource limits (256MB каждый)
- [ ] **DEP-08**: Контейнеры имеют health checks
- [ ] **DEP-09**: Логи ротируются автоматически (max-size: 10m, max-file: 3)
- [ ] **DEP-10**: Docker volumes для PostgreSQL и Redis данных

### Security

- [ ] **SEC-01**: Bot token не попадает в логи
- [ ] **SEC-02**: .env файл в .gitignore
- [ ] **SEC-03**: Webhook endpoint валидирует secret token
- [ ] **SEC-04**: PostgreSQL доступен только внутри Docker network
- [ ] **SEC-05**: Redis доступен только внутри Docker network
- [ ] **SEC-06**: Redis защищен паролем
- [ ] **SEC-07**: User input валидируется перед сохранением в БД

## v2 Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Multi-Channel Support

- **CHAN-01**: WhatsApp интеграция
- **CHAN-02**: VK Max интеграция
- **CHAN-03**: Единый API для всех каналов

### Incoming Webhooks

- **HOOK-05**: Внешняя система может отправить сообщение боту через API
- **HOOK-06**: Бот отправляет сообщение пользователю по запросу от CRM

### Advanced Analytics

- **ANL-01**: Dashboard с графиками диалогов по времени
- **ANL-02**: Отслеживание goal completion rate
- **ANL-03**: Детекция user frustration (повторы, негатив)
- **ANL-04**: A/B тестирование разных промптов

### Retrieval Quality

- **RAG-06**: Two-stage retrieval с reranking (retrieve 20, rerank to 5)
- **RAG-07**: Hybrid search (semantic + keyword BM25)
- **RAG-08**: Query expansion для улучшения retrieval

### Advanced Features

- **FEAT-01**: Поддержка голосовых сообщений с транскрипцией
- **FEAT-02**: Multi-language support (i18n)
- **FEAT-03**: Web-интерфейс для управления документами
- **FEAT-04**: Экспорт истории диалогов

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Мультитенант архитектура (несколько клиентов на одном сервере) | Безопасность требует изоляции — каждый клиент на своем VPS |
| Kubernetes deployment | Оverkill для per-client VPS модели, Docker Compose достаточно |
| Local LLM (Llama 3, etc.) | 8GB+ RAM требование не подходит для 1GB VPS |
| Real-time typing indicators | Telegram API не поддерживает для ботов |
| Serverless deployment (AWS Lambda) | Stateful sessions требуют persistent server |
| GUI для non-technical users | CLI + скрипты достаточно для MVP, web UI в v2 |
| Auto-updates для Docker images | Риск breaking changes, manual updates безопаснее |
| End-to-end encryption для сообщений | Telegram уже шифрует транспорт |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BOT-01 | Phase 1 | Pending |
| BOT-02 | Phase 1 | Pending |
| BOT-03 | Phase 1 | Pending |
| BOT-04 | Phase 1 | Pending |
| BOT-05 | Phase 1 | Pending |
| BOT-06 | Phase 1 | Pending |
| CONV-01 | Phase 1 | Pending |
| CONV-02 | Phase 1 | Pending |
| CONV-03 | Phase 1 | Pending |
| CONV-04 | Phase 1 | Pending |
| CONV-05 | Phase 1 | Pending |
| CONV-06 | Phase 1 | Pending |
| CONV-07 | Phase 1 | Pending |
| DATA-01 | Phase 1 | Pending |
| DATA-02 | Phase 1 | Pending |
| DATA-03 | Phase 1 | Pending |
| DATA-04 | Phase 1 | Pending |
| DOC-01 | Phase 2 | Complete |
| DOC-02 | Phase 2 | Complete |
| DOC-03 | Phase 2 | Complete |
| DOC-04 | Phase 2 | Complete |
| DOC-05 | Phase 2 | Complete |
| DOC-06 | Phase 2 | Complete |
| DOC-07 | Phase 2 | Complete |
| RAG-01 | Phase 2 | Complete |
| RAG-02 | Phase 2 | Complete |
| RAG-03 | Phase 2 | Complete |
| RAG-04 | Phase 2 | Complete |
| RAG-05 | Phase 2 | Complete |
| LLM-01 | Phase 3 | Pending |
| LLM-02 | Phase 3 | Pending |
| LLM-03 | Phase 3 | Pending |
| LLM-04 | Phase 3 | Pending |
| LLM-05 | Phase 3 | Pending |
| LLM-06 | Phase 3 | Pending |
| HOOK-01 | Phase 3 | Pending |
| HOOK-02 | Phase 3 | Pending |
| HOOK-03 | Phase 3 | Pending |
| HOOK-04 | Phase 3 | Pending |
| ADM-01 | Phase 4 | Pending |
| ADM-02 | Phase 4 | Pending |
| ADM-03 | Phase 4 | Pending |
| ADM-04 | Phase 4 | Pending |
| ADM-05 | Phase 4 | Pending |
| DEP-01 | Phase 5 | Pending |
| DEP-02 | Phase 5 | Pending |
| DEP-03 | Phase 5 | Pending |
| DEP-04 | Phase 5 | Pending |
| DEP-05 | Phase 5 | Pending |
| DEP-06 | Phase 5 | Pending |
| DEP-07 | Phase 5 | Pending |
| DEP-08 | Phase 5 | Pending |
| DEP-09 | Phase 5 | Pending |
| DEP-10 | Phase 5 | Pending |
| SEC-01 | Phase 6 | Pending |
| SEC-02 | Phase 6 | Pending |
| SEC-03 | Phase 6 | Pending |
| SEC-04 | Phase 6 | Pending |
| SEC-05 | Phase 6 | Pending |
| SEC-06 | Phase 6 | Pending |
| SEC-07 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 57 total
- Mapped to phases: 57
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 after initial definition from research*
