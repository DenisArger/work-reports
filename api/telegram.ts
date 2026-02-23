import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { VercelRequest, VercelResponse } from "@vercel/node";
import { callAppsScriptForReport } from "../lib/appsScript";
import { collectReports } from "../lib/googleDrive";
import { isUpdateProcessed, markUpdateProcessed } from "../lib/dedup";
import { tgSendMessage } from "../lib/telegram";
import { getEnv, mustGetEnv } from "../lib/env";

const DEBUG_LOG_PATH = path.join(process.cwd(), ".cursor", "debug.log");
function appendLog(obj: Record<string, unknown>) {
  try {
    fs.appendFileSync(
      DEBUG_LOG_PATH,
      JSON.stringify({
        ...obj,
        timestamp: Date.now(),
        sessionId: "debug-session",
      }) + "\n",
    );
  } catch {
    // ignore
  }
}

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number };
    from: { id: number; first_name?: string };
  };
};

function isAdmin(userId: number): boolean {
  const admins = (getEnv("ADMIN_IDS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return admins.includes(String(userId));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Экранирует символы Markdown в тексте для Telegram (parse_mode: Markdown). */
function escapeMarkdown(text: string): string {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`");
}

/** Экранирует содержимое ячейки для Markdown-таблицы (|, \, *, _, `). */
function escapeTableCell(text: string): string {
  return String(text)
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`");
}

function formatReportsAsMarkdownTable(
  reports: {
    name: string;
    lastUpdated: string;
    author?: string;
    url: string;
  }[],
  maxRows: number,
): string {
  const header = "| *Имя* | *Дата* | *Автор* | *Ссылка* |";
  const separator = "|------|--------|--------|----------|";
  const rows = reports
    .slice(0, maxRows)
    .map(
      (r) =>
        `| ${escapeTableCell(r.name)} | ${escapeTableCell(formatDate(r.lastUpdated))} | ${escapeTableCell(r.author || "—")} | ${escapeTableCell(r.url)} |`,
    );
  const table = [header, separator, ...rows].join("\n");
  const tail =
    reports.length > maxRows
      ? `\n\n_...и еще ${reports.length - maxRows} отчетов_`
      : "";
  return table + tail;
}

const DEBUG_INGEST =
  "http://127.0.0.1:7243/ingest/9acac06f-fa87-45a6-af60-73458650b939";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let requesterChatId: number | null = null;
  // #region agent log
  fetch(DEBUG_INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "api/telegram.ts:handler",
      message: "telegram handler invoked",
      data: { method: req.method, url: req.url, hasBody: !!req.body },
      timestamp: Date.now(),
      sessionId: "debug-session",
      hypothesisId: "H4",
    }),
  }).catch(() => {});
  console.log("[DEBUG] Handler entry, method:", req.method);
  // #endregion

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  let update: TgUpdate | null = null;
  try {
    const body = req.body as unknown;
    if (body && typeof body === "object") {
      update = body as TgUpdate;
    } else if (typeof body === "string") {
      update = JSON.parse(body) as TgUpdate;
    } else if (Buffer.isBuffer(body)) {
      update = JSON.parse(body.toString("utf-8")) as TgUpdate;
    }
  } catch (e: any) {
    console.log("[DEBUG] Body parse failed:", e?.message);
  }

  if (!update || typeof update !== "object") {
    console.log("[DEBUG] Empty or unsupported request body type");
    return res.status(200).send("OK");
  }

  // #region agent log
  console.log("[DEBUG] Update parsed:", {
    update_id: update.update_id,
    hasMessage: !!update.message,
    text: update.message?.text,
  });
  // #endregion

  const updateId = update.update_id;
  if (typeof updateId === "number" && (await isUpdateProcessed(updateId))) {
    return res.status(200).send("OK");
  }

  // Отвечаем Telegram быстро, но работу всё равно делаем синхронно (для MVP).
  // Если команды станут тяжелыми — можно вынести в очередь.
  try {
    if (update.message) {
      const chatId = update.message.chat.id;
      requesterChatId = chatId;
      const text = (update.message.text || "").trim();
      const userId = update.message.from.id;
      const userName = update.message.from.first_name || "Пользователь";

      let command = text.split(" ")[0].toLowerCase();
      if (command.includes("@")) command = command.split("@")[0];
      // #region agent log
      console.log("[DEBUG] Command parsed:", {
        command,
        chatId,
        userId,
        userName,
      });
      // #endregion

      switch (command) {
        case "/start": {
          await tgSendMessage(
            chatId,
            `🎉 *Привет, ${escapeMarkdown(userName)}!*\n\n` +
              `Я бот для сбора отчетов из Google Таблиц.\n\n` +
              `*Доступные команды:*\n` +
              `📊 /reports - Отчеты за неделю\n` +
              `📅 /today - Отчеты за сегодня\n` +
              `🆘 /help - Справка\n` +
              `🏓 /ping - Проверка связи\n\n` +
              `Для работы с отчетами нужны права администратора.`,
          );
          break;
        }
        case "/help": {
          await tgSendMessage(
            chatId,
            `📚 *Справка по командам*\n\n` +
              `/start - Начать работу\n` +
              `/reports - Отчеты за неделю (админы)\n` +
              `/today - Отчеты за сегодня (админы)\n` +
              `/ping - Проверка\n` +
              `/help - Справка`,
          );
          break;
        }
        case "/ping": {
          await tgSendMessage(
            chatId,
            `🏓 *Pong!*\n\n✅ Бот работает исправно\n🕐 Время сервера: ${new Date().toLocaleString(
              "ru-RU",
            )}\n📡 Статус: Online`,
          );
          break;
        }
        case "/reports": {
          // #region agent log
          fetch(DEBUG_INGEST, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              location: "api/telegram.ts:case:/reports",
              message: "entered /reports branch",
              data: { userId, isAdmin: isAdmin(userId), command },
              timestamp: Date.now(),
              sessionId: "debug-session",
              hypothesisId: "H-branch",
            }),
          }).catch(() => {});
          // #endregion
          appendLog({
            location: "api/telegram.ts:reportsFlowStart",
            message: "reports flow started (sync before any await)",
            data: { isAdmin: isAdmin(userId) },
            hypothesisId: "sync",
          });
          if (!isAdmin(userId)) {
            await tgSendMessage(
              chatId,
              "❌ У вас нет прав для выполнения этой команды.",
            );
            break;
          }

          const appsScriptUrl = getEnv("GOOGLE_APPS_SCRIPT_WEB_APP_URL")?.trim();
          if (!appsScriptUrl) {
            await tgSendMessage(
              chatId,
              "❌ Не настроен Apps Script для /reports. Добавьте `GOOGLE_APPS_SCRIPT_WEB_APP_URL` в переменные окружения.",
            );
            break;
          }
          await tgSendMessage(
            chatId,
            "⏳ Формирую сводный отчет и создаю файл…",
          );
          const result = await callAppsScriptForReport();
          if (!result) {
            await tgSendMessage(
              chatId,
              "📭 Нет данных для формирования отчета.",
            );
            break;
          }
          await tgSendMessage(
            chatId,
            `📊 Сводный отчёт создан.\n\nСсылка на файл на Google Диске:\n${result.url}`,
            { parseMode: false },
          );
          break;
        }
        case "/today": {
          if (!isAdmin(userId)) {
            await tgSendMessage(
              chatId,
              "❌ У вас нет прав для выполнения этой команды.",
            );
            break;
          }

          await tgSendMessage(chatId, "⏳ Собираю отчеты за сегодня...");
          const reports = await collectReports(1);
          if (reports.length === 0) {
            await tgSendMessage(chatId, "📭 Отчетов за сегодня не найдено.");
            break;
          }

          const msg =
            `📅 *Отчеты за сегодня*\nНайдено: ${reports.length} отчетов\n\n` +
            formatReportsAsMarkdownTable(reports, 50);

          await tgSendMessage(chatId, msg);
          break;
        }
        default: {
          if (text.startsWith("/")) {
            await tgSendMessage(
              chatId,
              "🤔 Неизвестная команда. Используйте /help",
            );
          } else {
            await tgSendMessage(
              chatId,
              "🤖 Я понимаю только команды. Отправьте /start",
            );
          }
        }
      }
    }

    if (typeof updateId === "number") await markUpdateProcessed(updateId);
  } catch (err: any) {
    // #region agent log
    console.log(
      "[DEBUG] Handler exception:",
      err?.message,
      err?.stack?.slice(0, 300),
    );
    // #endregion
    const errMsg = String(err?.message || err);
    const isDriveApiDisabled =
      /Google Drive API.*(has not been used|disabled)/i.test(errMsg);
    const isInsufficientPermissions =
      /Insufficient permissions for the specified parent/i.test(errMsg);
    const isDriveQuotaExceeded =
      /Drive storage quota|storage quota.*exceeded|quota has been exceeded/i.test(
        errMsg,
      );
    const projectMatch = errMsg.match(/project[=\s](\d+)/i);
    const driveApiUrl = projectMatch
      ? `https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${projectMatch[1]}`
      : "https://console.developers.google.com/apis/api/drive.googleapis.com/overview";

    try {
      if (requesterChatId) {
        await tgSendMessage(
          requesterChatId,
          "❌ Не удалось выполнить команду. Проверьте настройки и повторите попытку.",
          { parseMode: false },
        );
      }
    } catch {
      // ignore
    }

    try {
      const adminChatId = (getEnv("ADMIN_IDS") || "").split(",")[0]?.trim();
      if (adminChatId) {
        let friendlyMsg: string;
        if (isDriveApiDisabled) {
          friendlyMsg =
            `❌ *Google Drive API отключен*\n\n` +
            `Включите API в проекте и подождите 1–2 минуты:\n${escapeMarkdown(driveApiUrl)}`;
        } else if (isInsufficientPermissions) {
          friendlyMsg =
            `❌ *Недостаточно прав к папке на Drive*\n\n` +
            `Для команды /reports бот создаёт файл в папке \`FOLDER_ID\`. Откройте эту папку в Google Drive → «Настройки доступа» → пригласите по email ваш *сервисный аккаунт* (из JSON ключа, поле \`client_email\`) с правом *Редактор* (не «Читатель»).`;
        } else if (isDriveQuotaExceeded) {
          friendlyMsg =
            `❌ *На Google Диске закончилось место*\n\n` +
            `Папка \`FOLDER_ID\` привязана к аккаунту, у которого исчерпана квота. Освободите место: удалите ненужные файлы, очистите корзину на [drive.google.com](https://drive.google.com) или смените папку на аккаунт с доступным местом.`;
        } else {
          friendlyMsg =
            `❌ *Ошибка*\n` +
            `Update: \`${String(updateId)}\`\n` +
            `Msg: \`${escapeMarkdown(errMsg.slice(0, 300))}\``;
        }
        await tgSendMessage(adminChatId, friendlyMsg);
      }
    } catch {
      // ignore
    }
  }

  return res.status(200).send("OK");
}
