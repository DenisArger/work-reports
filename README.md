## Worker Reports Telegram Bot (Vercel)

[![CI](https://github.com/DenisArger/work-reports/actions/workflows/ci.yml/badge.svg)](https://github.com/DenisArger/work-reports/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

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
- `FOLDER_ID` — ID папки Google Drive с таблицами «(Ответы)» из форм (поиск по папке и подпапкам; в отчёт попадают все листы с «(Ответы)» в названии; фильтр по дате не используется, т.к. новые ответы в колонке «Отметка времени» не всегда обновляют дату файла в Drive)
- `GOOGLE_SERVICE_ACCOUNT_JSON` — JSON service account целиком (в одну строку)

**Опционально:**

- `REPORT_NAME_SUBSTRING` — подстрока в названии файла для отбора отчётов (по умолчанию `(Ответы)`). Если ваши таблицы называются иначе, задайте эту переменную.
- `REPORTS_DAYS` — число дней для команды `/reports` (по умолчанию `7`). По команде `/reports` бот создаёт сводный Google Doc с таблицей отчётов за указанный период, сохраняет его в подпапку «Отчеты» на Drive и отправляет в чат ссылку на файл.

**Вариант A — /reports через Google Apps Script (документ создаётся в вашем Диске, без квоты сервисного аккаунта):**

- `GOOGLE_APPS_SCRIPT_WEB_APP_URL` — URL развёрнутого Web App (см. раздел ниже). Если задан, бот вызывает скрипт вместо создания файла через API.
- `GOOGLE_APPS_SCRIPT_SECRET` — секретный токен для доступа к Web App (тот же, что в Script Properties скрипта `APPS_SCRIPT_SECRET`).

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

### Google Drive и Sheets доступ

1. Создайте service account в [Google Cloud Console](https://console.cloud.google.com/)
2. Включите в этом же проекте:
   - **Google Drive API**: [включить](https://console.developers.google.com/apis/api/drive.googleapis.com/overview) — список таблиц «(Ответы)» в папке и создание сводного документа для `/reports`
   - **Google Sheets API**: [включить](https://console.developers.google.com/apis/api/sheets.googleapis.com/overview) — чтение содержимого листов
   - **Google Docs API**: [включить](https://console.developers.google.com/apis/api/docs.googleapis.com/overview) — создание сводного отчёта (Google Doc) по команде `/reports`
     (выберите нужный проект, нажмите «Включить»; после включения подождите 1–2 минуты)
3. Скачайте ключ JSON и положите содержимое в `GOOGLE_SERVICE_ACCOUNT_JSON`
4. Дайте сервисному аккаунту доступ **к папке** `FOLDER_ID`: Share → пригласить по email сервисного аккаунта с правом **Редактор** (нужно для создания подпапки «Отчеты» и файла сводного отчёта по `/reports`). Email сервисного аккаунта — поле `client_email` в JSON ключа.

   **Ошибка «Insufficient permissions for the specified parent»** при `/reports`: папка открыта только на чтение. Откройте папку в Drive → «Настройки доступа» → найдите email сервисного аккаунта → смените право на **Редактор**.

   **Ошибка «Drive storage quota has been exceeded»**: при создании файла через API сервисный аккаунт становится владельцем файла, и квота списывается с него (у него почти нет места). **Решение:** используйте вариант A — вызовите бота через Google Apps Script. Разверните `code.js` как Web App (см. ниже), укажите `GOOGLE_APPS_SCRIPT_WEB_APP_URL` и `GOOGLE_APPS_SCRIPT_SECRET` в `.env`. Тогда документ будет создаваться в вашем Диске.

### Команда /reports через Google Apps Script (вариант A)

Чтобы документ создавался в вашем Google Диске (без ошибки квоты сервисного аккаунта):

1. Откройте [Google Apps Script](https://script.google.com/), создайте проект и вставьте код из `code.js`.
2. В проекте: **Проект** → **Настройки проекта** → **Свойства скрипта** добавьте:
   - `FOLDER_ID` — ID папки с отчётами (тот же, что в `.env`)
   - `APPS_SCRIPT_SECRET` — любой длинный секретный токен (тот же укажите в `.env` как `GOOGLE_APPS_SCRIPT_SECRET`)
3. **Развернуть** → **Новая развёртывание** → тип **Веб-приложение**. Укажите: «У кого есть доступ» — **Только я**, «Выполнять от имени» — **Я**. Нажмите **Развернуть**, скопируйте **URL веб-приложения**.
4. В `.env` добавьте:
   - `GOOGLE_APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/.../exec`
   - `GOOGLE_APPS_SCRIPT_SECRET=ваш_секрет`
5. При команде `/reports` бот вызовет этот URL (POST с токеном), скрипт создаст документ в вашем Диске и вернёт ссылку.

### Деплой на Vercel

1. Подключите репозиторий к Vercel.
2. В настройках проекта (Settings → Environment Variables) добавьте переменные окружения:
   - `BOT_TOKEN` — токен бота
   - `ADMIN_IDS` — ID админов через запятую
   - `FOLDER_ID` — ID папки Google Drive
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — JSON сервисного аккаунта (в одну строку)
   - при необходимости: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
3. В настройках проекта на Vercel: **Root Directory** оставьте пустым; выберите Node.js 20. **Build Command** в Dashboard оставьте пустым (сборка задаётся в `vercel.json`; если там указан `yarn build:vercel` — удалите, иначе возможна ошибка `EEXIST: file already exists, mkdir ... .func`). При повторяющихся ошибках деплоя: **Settings → General → Build Cache → Clear**.
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
