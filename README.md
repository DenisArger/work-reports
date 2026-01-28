## Worker Reports Telegram Bot (Vercel)

### Переменные окружения

- **`BOT_TOKEN`**: токен Telegram бота
- **`ADMIN_IDS`**: Telegram ID админов через запятую (пример: `123,456`)
- **`FOLDER_ID`**: ID папки Google Drive с таблицами
- **`GOOGLE_SERVICE_ACCOUNT_JSON`**: JSON service account целиком (в одну строку)

Опционально (дедуп апдейтов):

- **`UPSTASH_REDIS_REST_URL`**
- **`UPSTASH_REDIS_REST_TOKEN`**

Для установки вебхука из локали:

- **`WEBHOOK_BASE_URL`**: base URL вашего деплоя (пример: `https://my-bot.vercel.app`)

### Google доступ

1) Создайте service account в Google Cloud.  
2) Включите **Google Drive API**.  
3) Скачайте ключ JSON и положите содержимое в `GOOGLE_SERVICE_ACCOUNT_JSON`.  
4) Дайте сервисному аккаунту доступ **к папке** `FOLDER_ID` (Share → email service account).

### Запуск локально

```bash
npm i
npm run dev
```

### Установка вебхука

```bash
BOT_TOKEN=... WEBHOOK_BASE_URL=https://... npm run set-webhook
```

