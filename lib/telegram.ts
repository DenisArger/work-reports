import { mustGetEnv } from "./env.js";

type SendMessagePayload = {
  chat_id: number | string;
  text: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  disable_web_page_preview?: boolean;
};

export async function tgSendMessage(chatId: number | string, text: string) {
  const token = mustGetEnv("BOT_TOKEN");
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const payload: SendMessagePayload = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  };

  // #region agent log
  console.log("[DEBUG] Sending to Telegram:", {
    chatId,
    textLen: text.length,
    textPreview: text.slice(0, 50),
  });
  // #endregion

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    // keep raw
  }

  // #region agent log
  console.log("[DEBUG] Telegram API response:", {
    status: res.status,
    ok: body?.ok,
    error: body?.description,
  });
  // #endregion

  if (!res.ok || body?.ok !== true) {
    throw new Error(
      `Telegram sendMessage failed: http=${res.status} body=${bodyText.slice(0, 500)}`,
    );
  }

  return body;
}

export async function tgSetWebhook(webhookUrl: string) {
  const token = mustGetEnv("BOT_TOKEN");
  const url = `https://api.telegram.org/bot${token}/setWebhook`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      max_connections: 20,
      allowed_updates: ["message"],
    }),
  });

  const txt = await res.text();
  if (!res.ok) throw new Error(`setWebhook http=${res.status} body=${txt}`);
  return txt;
}
