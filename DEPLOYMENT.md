# Pack50 — Деплой и Обновление

Быстрое руководство по развертыванию Pack50 бота на новом VDS сервере и его обновлению без даунтайма.

---

## 1. Первый деплой на новом VDS

### Требования к серверу
- **OS:** Ubuntu 20.04/22.04 или Debian 11/12
- Чистый сервер с доступом по SSH (желательно root)

### Инструкция по установке

```bash
# 1. Скачайте скрипт развертывания
curl -fsSL https://raw.githubusercontent.com/Wess21/pack50/main/deploy-vds.sh -o deploy-vds.sh
chmod +x deploy-vds.sh

# 2. Запустите автоматический деплой
./deploy-vds.sh
```

**Что делает скрипт:**
- Устанавливает Docker и Docker Compose (если не установлены)
- Создаёт `.env` с автоматически сгенерированными безопасными паролями для БД
- Скачивает свежий образ бота из GitHub Container Registry (`ghcr.io`)
- Запускает все контейнеры (bot, postgres, redis)
- Ожидает до 60 секунд старт бота (embedding model грузится ~15 сек)

> **⚠️ BOT_TOKEN не требуется при деплое!**
> Токен Telegram бота устанавливается через **Admin Panel** после первого входа, а не через скрипт.

### После первого запуска

1. Откройте Admin Panel: `http://<ip-сервера>:3000`
2. Войдите с учётными данными, которые скрипт вывел на экран (также сохранены в `.admin_password`)
3. В настройках установите **Telegram Bot Token** (получить у [@BotFather](https://t.me/BotFather))
4. Бот начнёт отвечать в Telegram автоматически

---

## 2. Важно — Docker Volumes

> **⚠️ КРИТИЧНО: `DB_PASSWORD` нельзя менять после первого запуска!**

PostgreSQL инициализирует базу данных с паролем **один раз** при первом старте. Если после этого `DB_PASSWORD` в `.env` изменится — бот будет падать с ошибкой `password authentication failed`.

**Безопасные способы очистить сервер:**

```bash
# Остановить и удалить контейнеры + volumes (полный сброс)
docker compose -f docker-compose.prod.yml down -v

# Только после этого можно удалять .env и запускать скрипт заново
rm .env
./deploy-vds.sh
```

> Удаление папки проекта (`rm -rf /pack50-bot`) **НЕ удаляет** Docker volumes!
> Volumes хранятся в `/var/lib/docker/volumes/` и переживают удаление директории.

---

## 3. Обновление бота (Zero-Downtime)

При пуше в `main` GitHub Actions автоматически собирает новый Docker образ. Чтобы применить обновление:

```bash
cd ~/pack50-bot   # или папка где лежит .env и docker-compose.prod.yml
./deploy-vds.sh
```

**Что происходит при обновлении:**
- Скрипт **не изменяет** существующий `.env` и `DB_PASSWORD`
- Скачивает обновлённый образ из GHCR
- Пересоздаёт только контейнер бота (база данных и Redis не затрагиваются)
- Все миграции применяются автоматически при старте

---

## 4. Полезные команды

```bash
# Посмотреть логи
docker compose -f docker-compose.prod.yml logs -f bot

# Статус контейнеров
docker compose -f docker-compose.prod.yml ps

# Перезапустить бот
docker compose -f docker-compose.prod.yml restart bot

# Health check
curl http://localhost:3000/health
```