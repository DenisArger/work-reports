import "dotenv/config";

const mode = process.argv[2]; // 'local' или 'prod'

if (!mode || !["local", "prod"].includes(mode)) {
  console.error("Usage: yarn webhook:local  or  yarn webhook:prod");
  console.error("");
  console.error("  local - использует WEBHOOK_BASE_URL из .env (ngrok URL)");
  console.error("  prod  - использует VERCEL_URL из .env");
  process.exit(1);
}

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error("Error: BOT_TOKEN не установлен в .env");
  process.exit(1);
}

let baseUrl;
if (mode === "local") {
  baseUrl = process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    console.error("Error: WEBHOOK_BASE_URL не установлен в .env");
    console.error(
      "Укажите URL от ngrok, например: https://xxxx.ngrok-free.app",
    );
    process.exit(1);
  }
} else {
  baseUrl = process.env.VERCEL_URL;
  if (!baseUrl) {
    console.error("Error: VERCEL_URL не установлен в .env");
    console.error(
      "Укажите URL вашего Vercel деплоя, например: https://my-bot.vercel.app",
    );
    process.exit(1);
  }
}

const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram`;
const apiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;

console.log(`Setting webhook (${mode} mode)...`);
console.log(`URL: ${webhookUrl}`);
console.log("");

const res = await fetch(apiUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    max_connections: 20,
    allowed_updates: ["message"],
  }),
});

const data = await res.json();

if (data.ok) {
  console.log("✓ Webhook установлен успешно");

  // Получаем информацию о webhook
  const infoRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getWebhookInfo`,
  );
  const info = await infoRes.json();

  if (info.ok) {
    console.log("");
    console.log("Webhook info:");
    console.log(`  URL: ${info.result.url}`);
    console.log(`  Pending updates: ${info.result.pending_update_count}`);
    if (info.result.last_error_message) {
      console.log(`  Last error: ${info.result.last_error_message}`);
    }
  }
} else {
  console.error("✗ Ошибка установки webhook:", data.description);
  process.exit(1);
}
