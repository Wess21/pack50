# Pack50 Deployment Checklist

Быстрый чеклист для деплоя на VDS сервер.

## Перед деплоем

### 1. Подготовка GitHub Container Registry

**Вариант A: Публичный пакет (проще)**
- [ ] Перейти: `https://github.com/users/Wess21/packages/container/pack50/settings`
- [ ] Нажать "Change visibility" → "Public"
- [ ] Подтвердить

**Вариант B: Приватный пакет (безопаснее)**
- [ ] Перейти: `https://github.com/settings/tokens/new`
- [ ] Название: `pack50-deploy`
- [ ] Права: `read:packages`
- [ ] Сгенерировать и скопировать токен

### 2. Подготовка данных

- [ ] Telegram Bot Token готов (от @BotFather)
- [ ] Anthropic API Key (опционально)
- [ ] OpenAI API Key (опционально)
- [ ] Webhook URL (опционально)

### 3. Локальное тестирование

```bash
# ОБЯЗАТЕЛЬНО протестировать перед production!
./test-deployment.sh
```

- [ ] Все тесты прошли успешно
- [ ] Health check OK
- [ ] PostgreSQL и Redis работают

---

## Деплой на VDS

### Шаг 1: Подключение к серверу

```bash
ssh root@YOUR_SERVER_IP
```

- [ ] Подключился к серверу

### Шаг 2: Скачивание deployment script

```bash
curl -fsSL https://raw.githubusercontent.com/Wess21/pack50/main/deploy-vds.sh -o deploy-vds.sh
chmod +x deploy-vds.sh
```

- [ ] Скрипт скачан

### Шаг 3: Запуск деплоя

```bash
./deploy-vds.sh
```

Скрипт спросит:
1. **Telegram Bot Token** - введите ваш токен
2. **Anthropic API Key** - введите или нажмите Enter (пропустить)
3. **OpenAI API Key** - введите или нажмите Enter (пропустить)
4. **Webhook URL** - введите или нажмите Enter (пропустить)
5. **GitHub username** - ваш username
6. **GitHub token** - токен или пропустите если пакет публичный

- [ ] Все данные введены
- [ ] Скрипт завершился успешно

### Шаг 4: Сохранение credentials

В конце деплоя скрипт покажет:
```
Admin Login: admin
Admin Password: <сгенерированный_пароль>
```

- [ ] Admin credentials сохранены в безопасном месте
- [ ] Пароль также в файле `.admin_password` на сервере

---

## Проверка деплоя

### 1. Проверка контейнеров

```bash
cd ~/pack50
docker compose -f docker-compose.prod.yml ps
```

Ожидается:
```
pack50_postgres   running (healthy)
pack50_redis      running (healthy)
pack50_bot        running
```

- [ ] Все контейнеры запущены
- [ ] PostgreSQL healthy
- [ ] Redis healthy

### 2. Проверка health endpoint

```bash
curl http://localhost:3000/health
```

Ожидается:
```json
{"status":"ok","timestamp":"2024-03-03T..."}
```

- [ ] Health endpoint отвечает

### 3. Проверка логов

```bash
docker compose -f docker-compose.prod.yml logs --tail=50 bot
```

Ожидается:
```
Pack50 Bot Starting
Database initialized
Embedding model preloaded
Pack50 Bot Ready
```

- [ ] Нет критических ошибок в логах
- [ ] Бот запустился успешно

### 4. Доступ к админ-панели

Откройте в браузере: `http://YOUR_SERVER_IP:3000`

- [ ] Админ-панель открывается
- [ ] Можно залогиниться (admin / <ваш_пароль>)

---

## Настройка бота (через админ-панель)

1. **Login в админ-панель**
   - URL: `http://YOUR_SERVER_IP:3000`
   - Login: `admin`
   - Password: из `.admin_password`

2. **Настройка LLM провайдера** (если не задали при деплое)
   - [ ] Добавить Anthropic API Key или
   - [ ] Добавить OpenAI API Key

3. **Загрузка базы знаний**
   - [ ] Загрузить документы (PDF/DOCX/URL)
   - [ ] Проверить что векторы созданы

4. **Тестирование бота в Telegram**
   - [ ] Найти бота в Telegram
   - [ ] Отправить `/start`
   - [ ] Задать тестовый вопрос
   - [ ] Бот отвечает корректно

---

## Post-deployment (опционально)

### Безопасность

```bash
# Настройка firewall
ufw allow 22/tcp    # SSH
ufw allow 3000/tcp  # Bot API
ufw enable
```

- [ ] Firewall настроен

### SSL сертификат

Для production рекомендуется:
- [ ] Настроить Nginx reverse proxy
- [ ] Установить Let's Encrypt сертификат
- [ ] Перенаправить HTTP → HTTPS

### Мониторинг

- [ ] Настроить UptimeRobot или аналог
- [ ] Настроить alerting (опционально)

### Backups

```bash
# Создать backup скрипт
cat > ~/backup.sh << 'EOF'
#!/bin/bash
cd ~/pack50
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U pack50 pack50 > backup_$(date +%Y%m%d_%H%M%S).sql
EOF

chmod +x ~/backup.sh

# Добавить в crontab (каждый день в 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * ~/backup.sh") | crontab -
```

- [ ] Backup скрипт создан
- [ ] Cron job настроен

---

## Обновление бота

### Когда нужно обновить код

1. **Локально:**
   ```bash
   git add .
   git commit -m "Your changes"
   ./test-deployment.sh  # ОБЯЗАТЕЛЬНО!
   git push origin main
   ```

2. **Подождать GitHub Actions** (2-3 минуты)
   - Проверить: `https://github.com/Wess21/pack50/actions`

3. **На VDS:**
   ```bash
   cd ~/pack50
   ./deploy-vds.sh
   ```

- [ ] Изменения протестированы локально
- [ ] GitHub Actions успешно завершился
- [ ] Деплой на VDS выполнен
- [ ] Бот работает после обновления

---

## Troubleshooting

### Контейнер не запускается

```bash
# Проверка логов
docker compose -f docker-compose.prod.yml logs bot

# Проверка .env
cat ~/pack50/.env

# Перезапуск
docker compose -f docker-compose.prod.yml restart bot
```

- [ ] Проверил логи
- [ ] Проблема решена

### Health check failed

```bash
# Подождать 60 секунд
sleep 60
curl http://localhost:3000/health

# Проверить порт
lsof -i :3000
```

- [ ] Health check работает

### Ошибка pull из GHCR

```bash
# Для публичного пакета: сделать пакет публичным в GitHub
# Для приватного: авторизоваться
echo "YOUR_TOKEN" | docker login ghcr.io -u YOUR_USERNAME --password-stdin
docker compose -f docker-compose.prod.yml pull
```

- [ ] Образ скачивается успешно

---

## Итоговый чеклист

### Перед production launch

- [ ] Локальное тестирование пройдено
- [ ] Деплой на VDS успешен
- [ ] Все контейнеры healthy
- [ ] Health endpoint отвечает
- [ ] Админ-панель доступна
- [ ] API ключи настроены
- [ ] База знаний загружена
- [ ] Бот отвечает в Telegram
- [ ] Firewall настроен
- [ ] SSL сертификат установлен (для production)
- [ ] Backups настроены
- [ ] Мониторинг работает
- [ ] Документация обновлена

### Готово! 🚀

**Полезные ссылки:**
- [DEPLOYMENT.md](DEPLOYMENT.md) - Подробная документация
- [DEPLOYMENT_SUMMARY.md](DEPLOYMENT_SUMMARY.md) - Итоги оптимизации
- GitHub Actions: https://github.com/Wess21/pack50/actions
- GHCR Package: https://github.com/Wess21/packages/container/pack50

**Важные файлы на сервере:**
- `~/pack50/.env` - переменные окружения
- `~/pack50/.admin_password` - admin пароль
- `~/pack50/deploy-vds.sh` - deployment скрипт

**Команды для управления:**
```bash
cd ~/pack50

# Логи
docker compose -f docker-compose.prod.yml logs -f bot

# Статус
docker compose -f docker-compose.prod.yml ps

# Перезапуск
docker compose -f docker-compose.prod.yml restart bot

# Обновление
./deploy-vds.sh
```
