# Запуск BTC Market Console на своём сервере

Этот набор запускает приложение вне Replit:

- `postgres` — постоянная база данных с volume;
- `api` — API, Telegram polling и paper trading monitor;
- `web` — production-сборка React-приложения;
- `caddy` — HTTPS и reverse proxy.

## Требования

- Ubuntu VPS с 2 GB RAM или больше;
- установленный Docker Engine и Docker Compose Plugin;
- домен, направленный A-записью на IP сервера.

## Первый запуск

```bash
git clone <URL_репозитория> /opt/btc-market-console
cd /opt/btc-market-console

cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
nano deploy/.env
```

В `deploy/.env` задайте:

- `POSTGRES_PASSWORD`;
- `SESSION_SECRET`;
- `TELEGRAM_BOT_TOKEN` — если нужен Telegram-бот.

Затем замените `app.example.com` в `deploy/Caddyfile` на свой домен и выполните:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
```

Caddy сам запросит TLS-сертификат, если DNS уже направлен на сервер и порты `80`/`443` открыты в firewall.

## Проверка

```bash
curl https://your-domain.example/api/healthz
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f api
```

Ожидаемый ответ healthcheck:

```json
{"status":"ok"}
```

## Обновление

```bash
cd /opt/btc-market-console
git pull
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

PostgreSQL хранится в named volume и не удаляется обычным `up` или `down`.

## Backup базы

Создайте backup-файл на сервере:

```bash
mkdir -p backups
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
  pg_dump -U btc_console -d btc_console | gzip > "backups/btc_console-$(date +%F).sql.gz"
```

Храните копии backup отдельно от VPS. Команду можно добавить в cron после проверки ручного backup.

## Остановка

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
```

Не используйте `down -v`, если нужно сохранить базу данных.