import { getEnv } from "./env";

/**
 * Вызывает Google Apps Script Web App (doPost), который создаёт сводный отчёт
 * в вашем Диске и возвращает URL. Документ создаётся от имени владельца скрипта —
 * квота списывается с вашего аккаунта, а не с сервисного.
 * Требует GOOGLE_APPS_SCRIPT_WEB_APP_URL и GOOGLE_APPS_SCRIPT_SECRET в .env.
 */
export async function callAppsScriptForReport(): Promise<{
  url: string;
} | null> {
  const webAppUrl = getEnv("GOOGLE_APPS_SCRIPT_WEB_APP_URL");
  const secret = getEnv("GOOGLE_APPS_SCRIPT_SECRET");
  if (!webAppUrl?.trim()) {
    return null;
  }
  const res = await fetch(webAppUrl.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: secret || "" }),
  });
  if (!res.ok) {
    throw new Error(`Apps Script: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { url?: string; error?: string };
  if (data.error) {
    if (data.error === "no_data") return null;
    throw new Error(data.error);
  }
  if (data.url && typeof data.url === "string") {
    return { url: data.url };
  }
  return null;
}
