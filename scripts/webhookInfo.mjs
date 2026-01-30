import "dotenv/config";

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error("Error: BOT_TOKEN не установлен в .env");
  process.exit(1);
}

console.log("Получение информации о webhook...");
console.log("в");

const res = await fetch(
  `https://api.telegram.org/bot${botToken}/getWebhookInfo`,
);
const data = await res.json();

if (data.ok) {
  const info = data.result;

  console.log("Webhook Info:");
  console.log("─".repeat(40));

  if (info.url) {
    console.log(`  URL:              ${info.url}`);
    console.log(`  Pending updates:  ${info.pending_update_count}`);
    console.log(`  Max connections:  ${info.max_connections || "default"}`);

    if (info.allowed_updates && info.allowed_updates.length > 0) {
      console.log(`  Allowed updates:  ${info.allowed_updates.join(", ")}`);
    }

    if (info.last_error_date) {
      const errorDate = new Date(info.last_error_date * 1000);
      console.log("");
      console.log("  Last error:");
      console.log(`    Date:    ${errorDate.toLocaleString("ru-RU")}`);
      console.log(`    Message: ${info.last_error_message}`);
    }
  } else {
    console.log("  Webhook не установлен");
    console.log("");
    console.log("  Используйте: yarn webhook:local или yarn webhook:prod");
  }

  console.log("─".repeat(40));
} else {
  console.error("✗ Ошибка:", data.description);
  process.exit(1);
}
