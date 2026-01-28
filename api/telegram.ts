import { collectReports } from '../lib/googleDrive.js';
import { isUpdateProcessed, markUpdateProcessed } from '../lib/dedup.js';
import { tgSendMessage } from '../lib/telegram.js';
import { getEnv, mustGetEnv } from '../lib/env.js';

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
  const admins = (getEnv('ADMIN_IDS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return admins.includes(String(userId));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return new Response('OK', { status: 200 });
  }

  const updateId = update.update_id;
  if (typeof updateId === 'number' && (await isUpdateProcessed(updateId))) {
    return new Response('OK', { status: 200 });
  }

  // Отвечаем Telegram быстро, но работу всё равно делаем синхронно (для MVP).
  // Если команды станут тяжелыми — можно вынести в очередь.
  try {
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = (update.message.text || '').trim();
      const userId = update.message.from.id;
      const userName = update.message.from.first_name || 'Пользователь';

      let command = text.split(' ')[0].toLowerCase();
      if (command.includes('@')) command = command.split('@')[0];

      switch (command) {
        case '/start': {
          await tgSendMessage(
            chatId,
            `🎉 *Привет, ${userName}!*\\n\\n` +
              `Я бот для сбора отчетов из Google Таблиц.\\n\\n` +
              `*Доступные команды:*\\n` +
              `📊 /reports - Отчеты за неделю\\n` +
              `📅 /today - Отчеты за сегодня\\n` +
              `🆘 /help - Справка\\n` +
              `🏓 /ping - Проверка связи\\n\\n` +
              `Для работы с отчетами нужны права администратора.`
          );
          break;
        }
        case '/help': {
          await tgSendMessage(
            chatId,
            `📚 *Справка по командам*\\n\\n` +
              `/start - Начать работу\\n` +
              `/reports - Отчеты за неделю (админы)\\n` +
              `/today - Отчеты за сегодня (админы)\\n` +
              `/ping - Проверка\\n` +
              `/help - Справка`
          );
          break;
        }
        case '/ping': {
          await tgSendMessage(
            chatId,
            `🏓 *Pong!*\\n\\n✅ Бот работает исправно\\n🕐 Время сервера: ${new Date().toLocaleString(
              'ru-RU'
            )}\\n📡 Статус: Online`
          );
          break;
        }
        case '/reports': {
          if (!isAdmin(userId)) {
            await tgSendMessage(chatId, '❌ У вас нет прав для выполнения этой команды.');
            break;
          }

          await tgSendMessage(chatId, '⏳ Собираю отчеты за последние 7 дней...');
          const reports = await collectReports(7);
          if (reports.length === 0) {
            await tgSendMessage(chatId, '📭 Отчетов за последние 7 дней не найдено.');
            break;
          }

          const top = reports.slice(0, 5);
          const msg =
            `📊 *Найдено отчетов: ${reports.length}*\\n\\n` +
            top
              .map(
                (r, i) =>
                  `${i + 1}. ${r.name}\\n   📅 ${formatDate(r.lastUpdated)}\\n   👤 ${
                    r.author || 'Автор не указан'
                  }\\n   🔗 ${r.url}`
              )
              .join('\\n\\n') +
            (reports.length > 5 ? `\\n\\n...и еще ${reports.length - 5} отчетов` : '');

          await tgSendMessage(chatId, msg);
          break;
        }
        case '/today': {
          if (!isAdmin(userId)) {
            await tgSendMessage(chatId, '❌ У вас нет прав для выполнения этой команды.');
            break;
          }

          await tgSendMessage(chatId, '⏳ Собираю отчеты за сегодня...');
          const reports = await collectReports(1);
          if (reports.length === 0) {
            await tgSendMessage(chatId, '📭 Отчетов за сегодня не найдено.');
            break;
          }

          const msg =
            `📅 *Отчеты за сегодня*\\nНайдено: ${reports.length} отчетов\\n\\n` +
            reports
              .map(
                (r, i) =>
                  `${i + 1}. ${r.name}\\n   📅 ${formatDate(r.lastUpdated)}\\n   👤 ${
                    r.author || 'Неизвестно'
                  }\\n   🔗 ${r.url}`
              )
              .join('\\n\\n');

          await tgSendMessage(chatId, msg);
          break;
        }
        default: {
          if (text.startsWith('/')) {
            await tgSendMessage(chatId, '🤔 Неизвестная команда. Используйте /help');
          } else {
            await tgSendMessage(chatId, '🤖 Я понимаю только команды. Отправьте /start');
          }
        }
      }
    }

    if (typeof updateId === 'number') await markUpdateProcessed(updateId);
  } catch (err: any) {
    // Пытаемся пингануть админа, если настроен
    try {
      const adminChatId = (getEnv('ADMIN_IDS') || '').split(',')[0]?.trim();
      if (adminChatId) {
        await tgSendMessage(
          adminChatId,
          `❌ *Ошибка*\\n` +
            `Update: \`${String(updateId)}\`\\n` +
            `Msg: \`${String(err?.message || err).slice(0, 300)}\``
        );
      }
    } catch {
      // ignore
    }
  }

  return new Response('OK', { status: 200 });
}

