## Worker Reports Telegram Bot (Vercel)

Telegram бот для сбора отчетов из Google Таблиц. Деплоится на Vercel как serverless функция.

### Быстрый старт

```bash
# Установка зависимостей
yarn

# Скопируйте .env.example в .env и заполните переменные
cp .env.example .env

# Локальная разработка (см. раздел ниже)
yarn dev
```

### Переменные окружения

**Обязательные:**

- `BOT_TOKEN` — токен Telegram бота (получить у @BotFather)
- `ADMIN_IDS` — Telegram ID админов через запятую (пример: `123,456`)
- `FOLDER_ID` — ID папки Google Drive с таблицами
- `GOOGLE_SERVICE_ACCOUNT_JSON` — JSON service account целиком (в одну строку)

**Для локальной отладки:**

- `WEBHOOK_BASE_URL` — URL от ngrok (пример: `https://xxxx.ngrok-free.app`)

**Для продакшена (скрипт webhook:prod):**

- `VERCEL_URL` — полный URL вашего Vercel деплоя (пример: `https://worker-reports.vercel.app`). Нужен только при запуске `yarn webhook:prod` локально; на самом Vercel эта переменная задаётся автоматически.

**Опционально (дедуп апдейтов):**

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### Локальная отладка (через ngrok)

1. **Установите ngrok** (если еще не установлен):

   ```bash
   # macOS
   brew install ngrok

   # Windows (через chocolatey)
   choco install ngrok

   # Или скачайте с https://ngrok.com/download
   ```

2. **Запустите ngrok туннель:**

   ```bash
   ngrok http 3000
   ```

   Скопируйте URL вида `https://xxxx.ngrok-free.app`

3. **Укажите URL в `.env`:**

   ```
   WEBHOOK_BASE_URL=https://xxxx.ngrok-free.app
   ```

4. **Установите webhook на локальный сервер:**

   ```bash
   yarn webhook:local
   ```

5. **Запустите dev сервер:**
   ```bash
   yarn dev
   ```

Теперь бот будет обрабатывать сообщения локально через ngrok туннель.

### Переключение на продакшен

После каждого деплоя (или смены домена) нужно заново выставить webhook на Vercel. В `.env` должен быть указан `VERCEL_URL` (полный URL деплоя), так как скрипт выполняется локально:

```bash
# Установить webhook на Vercel (в .env задайте VERCEL_URL)
yarn webhook:prod

# Проверить текущий webhook
yarn webhook:info

# Удалить webhook (при необходимости)
yarn webhook:delete
```

### Скрипты

| Команда               | Описание                               |
| --------------------- | -------------------------------------- |
| `yarn dev`            | Сборка и запуск локального dev сервера |
| `yarn build`          | Сборка TypeScript (в dist/)            |
| `yarn webhook:local`  | Установить webhook на ngrok URL        |
| `yarn webhook:prod`   | Установить webhook на Vercel URL       |
| `yarn webhook:delete` | Удалить webhook                        |
| `yarn webhook:info`   | Показать информацию о текущем webhook  |

### Google Drive доступ

1. Создайте service account в [Google Cloud Console](https://console.cloud.google.com/)
2. Включите **Google Drive API**
3. Скачайте ключ JSON и положите содержимое в `GOOGLE_SERVICE_ACCOUNT_JSON`
4. Дайте сервисному аккаунту доступ **к папке** `FOLDER_ID` (Share → email service account)

### Деплой на Vercel

1. Подключите репозиторий к Vercel.
2. В настройках проекта (Settings → Environment Variables) добавьте переменные окружения:
   - `BOT_TOKEN` — токен бота
   - `ADMIN_IDS` — ID админов через запятую
   - `FOLDER_ID` — ID папки Google Drive
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — JSON сервисного аккаунта (в одну строку)
   - при необходимости: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
3. В настройках проекта на Vercel: **Root Directory** оставьте пустым; выберите Node.js 18 или 20. Сборка задаётся в `vercel.json` (`yarn build:vercel` — Build Output API); не переопределяйте Build Command в Dashboard, иначе маршруты `/api/*` могут не появиться.
4. Деплой произойдёт автоматически при пуше.
5. После деплоя установите webhook: в `.env` укажите `VERCEL_URL=https://<ваш-проект>.vercel.app` и выполните `yarn webhook:prod`. URL webhook для Telegram: `https://<ваш-vercel-домен>/api/telegram`.

### Структура проекта

```
├── api/
│   └── telegram.ts      # Vercel serverless handler
├── lib/
│   ├── dedup.ts         # Дедупликация через Upstash Redis
│   ├── env.ts           # Работа с env переменными
│   ├── googleDrive.ts   # Google Drive API
│   └── telegram.ts      # Telegram API helpers
├── scripts/
│   ├── devServer.mjs    # Локальный dev сервер
│   ├── setWebhook.mjs   # Установка webhook
│   ├── deleteWebhook.mjs# Удаление webhook
│   └── webhookInfo.mjs  # Информация о webhook
└── vercel.json          # Конфигурация Vercel
```
