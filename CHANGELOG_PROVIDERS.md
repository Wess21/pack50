# Changelog: Multi-Provider Management System

**Дата:** 2026-03-01
**Версия:** 1.1.0

## 🎯 Основные изменения

Реализована система управления множественными LLM провайдерами с удобным веб-интерфейсом.

## ✨ Новые возможности

### 1. Множественные провайдеры
- Добавление неограниченного количества LLM провайдеров
- Быстрое переключение между провайдерами
- Один активный провайдер в любой момент времени

### 2. Новый веб-интерфейс
- **URL:** http://localhost:3000/admin.html
- Модальное окно для управления провайдерами
- Визуальные карточки провайдеров
- Кнопки: Активировать, Тест, Изменить, Удалить
- Индикация активного провайдера

### 3. Тестирование подключений
- Проверка API ключа перед активацией
- Кнопка "Тест" на каждом провайдере
- Детальное сообщение об ошибках

### 4. Кастомные API endpoints
- Поддержка vsellm.ru и других OpenAI-совместимых API
- Настройка custom base_url
- Настройка custom model_name

## 📁 Новые файлы

### Backend
- `src/db/migrations/001_llm_providers.sql` - Миграция базы данных
- `src/api/routes/providers.ts` - REST API для управления провайдерами

### Frontend
- `public/admin.html` - Новый улучшенный интерфейс

### Документация
- `PROVIDERS.md` - Полное руководство по системе провайдеров
- `MIGRATION_GUIDE.md` - Инструкция по миграции со старой системы
- `CHANGELOG_PROVIDERS.md` - Этот файл

### Утилиты
- `test-providers-api.sh` - Скрипт для тестирования API

## 🔄 Измененные файлы

### Backend
- `src/index.ts` - Добавлен роут `/api/providers`
- `src/services/llm/provider-factory.ts` - Поддержка новой таблицы с fallback
- `src/services/llm/openai-provider.ts` - Поддержка custom baseURL и model

### Документация
- `QUICKSTART.md` - Обновлены инструкции для нового интерфейса

## 🗄️ Структура базы данных

### Новая таблица: `llm_providers`

```sql
CREATE TABLE llm_providers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  provider_type VARCHAR(20) NOT NULL CHECK (provider_type IN ('anthropic', 'openai')),
  api_key_encrypted TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  api_base_url TEXT,
  model_name TEXT,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Обновлена таблица: `bot_config`

```sql
ALTER TABLE bot_config ADD COLUMN api_base_url TEXT;
ALTER TABLE bot_config ADD COLUMN llm_model_name TEXT DEFAULT 'gpt-4o';
```

## 🔌 API Endpoints

### Управление провайдерами

| Method | Endpoint | Описание |
|--------|----------|----------|
| GET | `/api/providers` | Список всех провайдеров |
| GET | `/api/providers/:id` | Детали провайдера |
| POST | `/api/providers` | Создать провайдер |
| PUT | `/api/providers/:id` | Обновить провайдер |
| DELETE | `/api/providers/:id` | Удалить провайдер |
| POST | `/api/providers/:id/test` | Тест подключения |
| POST | `/api/providers/:id/activate` | Активировать провайдер |

## 🔐 Безопасность

- ✅ API ключи шифруются AES-256-CBC
- ✅ Уникальный IV для каждого ключа
- ✅ JWT аутентификация для всех endpoints
- ✅ API ключи не возвращаются в GET запросах

## 🔄 Обратная совместимость

### Миграция данных
Существующие провайдеры из `bot_config` автоматически мигрированы в `llm_providers`.

### Fallback логика
Provider Factory ищет провайдеров в следующем порядке:
1. `llm_providers` таблица (активный провайдер)
2. `bot_config` таблица (старая система)
3. `.env` файл (переменные окружения)

### Старый интерфейс
- `index.html` продолжает работать (legacy)
- Рекомендуется использовать `admin.html`

## 📝 Примеры использования

### Добавление vsellm.ru провайдера

```bash
curl -X POST http://localhost:3000/api/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "VSE LLM - Claude Haiku",
    "provider_type": "openai",
    "api_key": "your-key",
    "api_base_url": "https://api.vsellm.ru/v1",
    "model_name": "anthropic/claude-haiku-4.5",
    "is_active": true
  }'
```

### Переключение провайдера

```bash
curl -X POST http://localhost:3000/api/providers/1/activate \
  -H "Authorization: Bearer $TOKEN"
```

## 🧪 Тестирование

Запустите тестовый скрипт:

```bash
./test-providers-api.sh
```

Или вручную через веб-интерфейс:
1. Откройте http://localhost:3000/admin.html
2. Добавьте провайдер
3. Нажмите кнопку "Тест"

## 📊 Статистика изменений

- **Новых файлов:** 6
- **Измененных файлов:** 4
- **Новых API endpoints:** 7
- **Новых таблиц в БД:** 1
- **Строк кода добавлено:** ~1500

## 🚀 Как использовать

### Быстрый старт

1. Пересобрать проект:
```bash
npm run build
```

2. Миграция уже применена автоматически

3. Запустить бот:
```bash
npm run dev
```

4. Открыть веб-интерфейс:
```
http://localhost:3000/admin.html
```

5. Добавить провайдер через UI

### Конфигурация для vsellm.ru

1. Откройте http://localhost:3000/admin.html
2. Войдите (admin / changeme)
3. Нажмите "+ Добавить провайдер"
4. Заполните:
   - Название: VSE LLM - Claude
   - Тип: OpenAI Compatible
   - API Key: ваш ключ от vsellm.ru
   - API Base URL: https://api.vsellm.ru/v1
   - Модель: anthropic/claude-haiku-4.5
   - ✅ Сделать активным
5. Сохранить → Тест

## 🐛 Known Issues

Нет известных проблем.

## 📚 Дополнительная документация

- [PROVIDERS.md](PROVIDERS.md) - Полное руководство
- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Инструкция по миграции
- [QUICKSTART.md](QUICKSTART.md) - Быстрый старт

## 🎉 Что дальше?

Теперь вы можете:
- ✅ Добавлять неограниченное количество провайдеров
- ✅ Быстро переключаться между ними
- ✅ Использовать vsellm.ru без ручного редактирования
- ✅ Тестировать каждого провайдера перед использованием
- ✅ Управлять всем через удобный веб-интерфейс

---

**Автор:** Claude Sonnet 4.5
**Дата выпуска:** 2026-03-01
