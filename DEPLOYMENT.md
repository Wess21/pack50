# Pack50 Deployment Guide

Полное руководство по развертыванию Pack50 бота на VDS сервере.

## Содержание

1. [Архитектура деплоя](#архитектура-деплоя)
2. [Требования к серверу](#требования-к-серверу)
3. [Подготовка к деплою](#подготовка-к-деплою)
4. [Развертывание на VDS](#развертывание-на-vds)
5. [Обновление бота](#обновление-бота)
6. [Локальное тестирование](#локальное-тестирование)
7. [Мониторинг и логи](#мониторинг-и-логи)
8. [Решение проблем](#решение-проблем)

---

## Архитектура деплоя

### Новая система деплоя (рекомендуется)

```
GitHub → GitHub Actions → GitHub Container Registry (GHCR) → VDS Server
```

**Преимущества:**
- ✅ Образ собирается на GitHub (нет проблем с Docker Hub rate limits)
- ✅ Быстрый деплой (не нужно собирать образ на сервере)
- ✅ Кеширование слоев Docker для быстрой пересборки
- ✅ Версионирование образов (latest, по тегам, по коммитам)
- ✅ Меньше нагрузки на VDS сервер

### Компоненты

1. **GitHub Actions** ([.github/workflows/docker-build.yml](.github/workflows/docker-build.yml))
   - Автоматически собирает Docker образ при push в main/master
   - Публикует образ в GitHub Container Registry (ghcr.io)
   - Кеширует слои для быстрой сборки

2. **Docker Compose файлы:**
   - `docker-compose.yml` - разработка (локальная сборка)
   - `docker-compose.prod.yml` - продакшн (использует GHCR образ)
   - `docker-compose.test.yml` - изолированное тестирование

3. **Deployment Scripts:**
   - `deploy-vds.sh` - автоматическое развертывание на VDS
   - `test-deployment.sh` - локальное тестирование перед деплоем

---

## Требования к серверу

### Минимальные характеристики

- **CPU:** 1 core (рекомендуется 2 cores)
- **RAM:** 1 GB (рекомендуется 2 GB)
- **Disk:** 10 GB свободного места
- **OS:** Ubuntu 20.04/22.04 или Debian 11/12
- **Network:** Статический IP или домен

### Необходимое ПО

- Docker 20.10+
- Docker Compose v2+
- Git
- curl
- openssl

---

## Подготовка к деплою

### 1. Настройка GitHub Container Registry

#### Шаг 1: Проверка видимости пакета

По умолчанию GitHub Container Registry создает **приватные** пакеты. Нужно сделать пакет публичным:

1. Перейдите на страницу пакета: `https://github.com/users/Wess21/packages/container/pack50`
2. Нажмите **"Package settings"**
3. Прокрутите вниз до секции **"Danger Zone"**
4. Найдите **"Change package visibility"**
5. Выберите **"Public"** и подтвердите

**Или** можно использовать приватный пакет с авторизацией (см. ниже).

#### Шаг 2: Создание Personal Access Token (для приватных пакетов)

Если пакет приватный, создайте токен с доступом на чтение:

1. Перейдите: https://github.com/settings/tokens/new
2. Укажите название: `pack50-deploy`
3. Выберите срок действия: `90 days` или `No expiration`
4. Отметьте разрешения:
   - ✅ `read:packages` - чтение пакетов
5. Нажмите **"Generate token"**
6. **Скопируйте токен** (он больше не отобразится!)

### 2. Подготовка Telegram бота

1. Создайте бота через [@BotFather](https://t.me/BotFather)
2. Получите Bot Token (формат: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
3. Сохраните токен в надежном месте

### 3. API ключи (опционально)

Получите API ключи для LLM провайдеров:

- **Anthropic Claude:** https://console.anthropic.com/settings/keys
- **OpenAI GPT:** https://platform.openai.com/api-keys

**Примечание:** API ключи можно настроить позже через админ-панель.

---

## Развертывание на VDS

### Вариант 1: Автоматический деплой (рекомендуется)

#### Шаг 1: Подключитесь к серверу

```bash
ssh root@your-server-ip
```

#### Шаг 2: Скачайте deployment script

```bash
curl -fsSL https://raw.githubusercontent.com/Wess21/pack50/main/deploy-vds.sh -o deploy-vds.sh
chmod +x deploy-vds.sh
```

#### Шаг 3: Запустите деплой

```bash
./deploy-vds.sh
```

Скрипт автоматически:
- ✅ Установит Docker и Docker Compose (если нужно)
- ✅ Клонирует репозиторий
- ✅ Создаст .env файл с безопасными паролями
- ✅ Авторизуется в GHCR
- ✅ Скачает latest образ
- ✅ Запустит все сервисы
- ✅ Проверит health endpoints

#### Шаг 4: Сохраните учетные данные

В конце деплоя скрипт покажет:
```
Admin Login: admin
Admin Password: <сгенерированный пароль>
```

**Обязательно сохраните эти данные!** Пароль также сохранен в файле `.admin_password`.

---

### Вариант 2: Ручной деплой

<details>
<summary>Развернуть инструкцию по ручному деплою</summary>

#### Шаг 1: Установка Docker

```bash
# Обновление системы
apt update && apt upgrade -y

# Установка Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
rm get-docker.sh

# Проверка
docker --version
docker compose version
```

#### Шаг 2: Клонирование репозитория

```bash
cd ~
git clone https://github.com/Wess21/pack50.git
cd pack50
```

#### Шаг 3: Создание .env файла

```bash
cp .env.example .env
nano .env
```

Заполните обязательные поля:
```env
BOT_TOKEN=your_bot_token_here
DB_PASSWORD=$(openssl rand -hex 16)
ENCRYPTION_KEY=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -base64 32)
DEFAULT_ADMIN_PASSWORD=$(openssl rand -base64 12)
```

Сохраните: `Ctrl+O`, `Enter`, `Ctrl+X`

#### Шаг 4: Авторизация в GHCR

**Для публичного пакета:**
```bash
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

**Для публичного пакета без токена:**
Пропустите этот шаг, Docker Pull будет работать без авторизации.

#### Шаг 5: Запуск сервисов

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

#### Шаг 6: Проверка статуса

```bash
# Просмотр статуса контейнеров
docker compose -f docker-compose.prod.yml ps

# Проверка логов
docker compose -f docker-compose.prod.yml logs -f bot

# Тест health endpoint
curl http://localhost:3000/health
```

</details>

---

## Обновление бота

### Способ 1: Через deploy-vds.sh (рекомендуется)

Просто запустите скрипт заново:

```bash
cd ~/pack50
./deploy-vds.sh
```

Скрипт:
1. Подтянет новый код из GitHub
2. Скачает новый образ из GHCR
3. Перезапустит контейнеры
4. Проверит работоспособность

### Способ 2: Ручное обновление

```bash
cd ~/pack50

# Подтянуть новый код
git pull origin main

# Скачать новый образ
docker compose -f docker-compose.prod.yml pull

# Перезапустить контейнеры
docker compose -f docker-compose.prod.yml up -d

# Проверить логи
docker compose -f docker-compose.prod.yml logs -f bot
```

### Способ 3: Zero-downtime обновление

```bash
cd ~/pack50

# Подтянуть новый код
git pull origin main

# Скачать новый образ (не останавливая старый)
docker compose -f docker-compose.prod.yml pull

# Пересоздать и перезапустить только измененные сервисы
docker compose -f docker-compose.prod.yml up -d --no-deps --build bot

# Проверить что всё работает
curl http://localhost:3000/health
```

---

## Локальное тестирование

**Критически важно:** Всегда тестируйте изменения локально перед деплоем на VDS!

### Шаг 1: Создайте тестовый .env

```bash
# В корне проекта
cp .env.example .env.test

# Отредактируйте .env.test (минимальная конфигурация)
BOT_TOKEN=test_token  # Можно использовать фейковый токен для тестирования
```

### Шаг 2: Запустите тестовый скрипт

```bash
./test-deployment.sh
```

Скрипт выполнит:
1. ✅ Сборку Docker образа
2. ✅ Запуск всех сервисов (изолированно на других портах)
3. ✅ Проверку healthcheck
4. ✅ Тест подключения к PostgreSQL
5. ✅ Тест подключения к Redis
6. ✅ Проверку pgvector extension
7. ✅ Проверку создания таблиц
8. ✅ Отображение использования ресурсов

### Шаг 3: Ручное тестирование

Если нужен ручной контроль:

```bash
# Запуск тестового окружения
docker compose -f docker-compose.test.yml up -d --build

# Просмотр логов
docker compose -f docker-compose.test.yml logs -f

# Тест health endpoint
curl http://localhost:23000/health

# Остановка и удаление
docker compose -f docker-compose.test.yml down -v
```

---

## Мониторинг и логи

### Просмотр статуса контейнеров

```bash
docker compose -f docker-compose.prod.yml ps
```

### Просмотр логов

```bash
# Все сервисы
docker compose -f docker-compose.prod.yml logs -f

# Только бот
docker compose -f docker-compose.prod.yml logs -f bot

# Только PostgreSQL
docker compose -f docker-compose.prod.yml logs -f postgres

# Последние 100 строк
docker compose -f docker-compose.prod.yml logs --tail=100 bot
```

### Использование ресурсов

```bash
# Real-time мониторинг
docker stats

# Разовый снимок
docker stats --no-stream
```

### Health check

```bash
# HTTP health endpoint
curl http://localhost:3000/health

# Docker healthcheck status
docker inspect pack50_bot | grep -A 10 Health
```

### Мониторинг базы данных

```bash
# Подключение к PostgreSQL
docker compose -f docker-compose.prod.yml exec postgres psql -U pack50 -d pack50

# Размер базы данных
docker compose -f docker-compose.prod.yml exec postgres psql -U pack50 -d pack50 -c "SELECT pg_size_pretty(pg_database_size('pack50'));"

# Список таблиц
docker compose -f docker-compose.prod.yml exec postgres psql -U pack50 -d pack50 -c "\dt"
```

---

## Решение проблем

### Проблема: Контейнер не запускается

**Диагностика:**
```bash
# Проверьте логи
docker compose -f docker-compose.prod.yml logs bot

# Проверьте статус
docker compose -f docker-compose.prod.yml ps
```

**Возможные причины:**

1. **Неправильный BOT_TOKEN**
   ```
   Error: 401 Unauthorized
   ```
   Решение: Проверьте токен в `.env` файле

2. **База данных не готова**
   ```
   Error: connect ECONNREFUSED postgres:5432
   ```
   Решение: Подождите, пока PostgreSQL запустится (30-60 секунд)

3. **Недостаточно памяти**
   ```
   Error: JavaScript heap out of memory
   ```
   Решение: Увеличьте лимиты памяти в docker-compose.prod.yml

### Проблема: Ошибка при pull образа из GHCR

**Ошибка:**
```
Error response from daemon: pull access denied
```

**Решение для публичного пакета:**
Убедитесь, что пакет публичный (см. раздел "Настройка GitHub Container Registry")

**Решение для приватного пакета:**
```bash
# Авторизуйтесь с Personal Access Token
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Попробуйте снова
docker compose -f docker-compose.prod.yml pull
```

### Проблема: Health check failed

**Диагностика:**
```bash
# Проверьте, отвечает ли приложение
curl -v http://localhost:3000/health

# Проверьте порты
netstat -tlnp | grep 3000

# Проверьте логи
docker compose -f docker-compose.prod.yml logs bot
```

**Возможные причины:**

1. **Приложение еще загружается**
   - Подождите 60-90 секунд после запуска
   - Модель embeddings загружается при старте (20-30 секунд)

2. **Порт занят**
   ```bash
   # Проверьте, что порт 3000 свободен
   lsof -i :3000
   ```

3. **Ошибка в приложении**
   - Проверьте логи на наличие stack traces

### Проблема: Docker Hub rate limit (старая система)

**Ошибка:**
```
toomanyrequests: You have reached your pull rate limit
```

**Решение:**
Используйте новую систему деплоя с GHCR! Она не имеет этой проблемы:
```bash
# Переключитесь на docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
```

### Проблема: Высокое использование памяти

**Диагностика:**
```bash
docker stats --no-stream
```

**Решение:**

1. **Уменьшите лимиты в docker-compose.prod.yml:**
   ```yaml
   deploy:
     resources:
       limits:
         memory: 384M  # было 512M
   ```

2. **Ограничьте размер контекста:**
   Отредактируйте `src/services/context-manager.ts` и уменьшите `SAFE_CONTEXT_WINDOW`

3. **Используйте swap:**
   ```bash
   # Создайте swap файл (2GB)
   fallocate -l 2G /swapfile
   chmod 600 /swapfile
   mkswap /swapfile
   swapon /swapfile

   # Добавьте в /etc/fstab для постоянного использования
   echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
   ```

### Проблема: Бот не отвечает на сообщения

**Диагностика:**
```bash
# Проверьте логи на наличие ошибок
docker compose -f docker-compose.prod.yml logs -f bot

# Проверьте webhook статус (если включен)
curl -X POST https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo
```

**Возможные причины:**

1. **Webhook конфликт:**
   - Если `WEBHOOK_URL` установлен, но не работает, удалите webhook:
   ```bash
   curl -X POST https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook
   ```
   - Перезапустите бота без `WEBHOOK_URL`

2. **API ключи не настроены:**
   - Зайдите в админ-панель: `http://your-server-ip:3000`
   - Добавьте API ключи для Anthropic или OpenAI

3. **База знаний пуста:**
   - Загрузите документы через админ-панель

---

## Резервное копирование

### Backup базы данных

```bash
# Создать backup
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U pack50 pack50 > backup_$(date +%Y%m%d_%H%M%S).sql

# Восстановить из backup
cat backup_20240101_120000.sql | docker compose -f docker-compose.prod.yml exec -T postgres psql -U pack50 pack50
```

### Backup Redis

```bash
# Создать snapshot
docker compose -f docker-compose.prod.yml exec redis redis-cli SAVE

# Скопировать dump.rdb
docker cp pack50_redis:/data/dump.rdb redis_backup_$(date +%Y%m%d_%H%M%S).rdb
```

### Backup .env и конфигурации

```bash
# Создать полный backup
tar -czf pack50_backup_$(date +%Y%m%d_%H%M%S).tar.gz \
    .env \
    .admin_password \
    docker-compose.prod.yml
```

---

## Безопасность

### Рекомендации

1. **Используйте firewall:**
   ```bash
   ufw allow 22/tcp    # SSH
   ufw allow 3000/tcp  # Bot API
   ufw enable
   ```

2. **Настройте автоматические обновления:**
   ```bash
   apt install unattended-upgrades
   dpkg-reconfigure -plow unattended-upgrades
   ```

3. **Используйте SSL/TLS:**
   - Настройте Nginx reverse proxy с Let's Encrypt
   - Пример конфигурации в [nginx.conf.example](nginx.conf.example) (создайте при необходимости)

4. **Регулярные backups:**
   - Настройте cron job для автоматических backups
   ```bash
   # Добавьте в crontab
   0 2 * * * cd ~/pack50 && ./backup.sh
   ```

5. **Ограничьте доступ к .env:**
   ```bash
   chmod 600 .env
   chmod 600 .admin_password
   ```

---

## Полезные команды

### Управление контейнерами

```bash
# Запуск
docker compose -f docker-compose.prod.yml up -d

# Остановка
docker compose -f docker-compose.prod.yml down

# Перезапуск
docker compose -f docker-compose.prod.yml restart

# Перезапуск только бота
docker compose -f docker-compose.prod.yml restart bot

# Пересоздание контейнеров
docker compose -f docker-compose.prod.yml up -d --force-recreate
```

### Очистка

```bash
# Удалить неиспользуемые образы
docker image prune -a

# Удалить неиспользуемые volumes
docker volume prune

# Полная очистка системы
docker system prune -a --volumes
```

### Доступ к контейнерам

```bash
# Shell доступ к боту
docker compose -f docker-compose.prod.yml exec bot sh

# PostgreSQL CLI
docker compose -f docker-compose.prod.yml exec postgres psql -U pack50 pack50

# Redis CLI
docker compose -f docker-compose.prod.yml exec redis redis-cli
```

---

## Контакты и поддержка

- **GitHub Issues:** https://github.com/Wess21/pack50/issues
- **Email:** your-email@example.com
- **Telegram:** @your_username

---

## Changelog

### 2024-03-03
- Добавлена интеграция с GitHub Container Registry
- Создан автоматический deployment скрипт
- Добавлено изолированное тестовое окружение
- Оптимизирован Dockerfile (multi-stage build с кешированием)
- Исправлена конфигурация Redis (убрана несуществующая аутентификация)
- Улучшен healthcheck с использованием curl

### 2024-02-27
- Initial release
