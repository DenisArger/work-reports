import "dotenv/config";

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error("Error: BOT_TOKEN не установлен в .env");
  process.exit(1);
}

const dropPending = process.argv.includes("--drop");

console.log("Удаление webhook...");
if (dropPending) {
  console.log("(с очисткой ожидающих обновлений)");
}
console.log("");

const apiUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`;

const res = await fetch(apiUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    drop_pending_updates: dropPending,
  }),
});

const data = await res.json();

if (data.ok) {
  console.log("✓ Webhook удален");

  if (dropPending) {
    console.log("✓ Ожидающие обновления очищены");
  }

  console.log("");
  console.log("Теперь бот не будет получать обновления через webhook.");
  console.log(
    "Для восстановления используйте: yarn webhook:local или yarn webhook:prod",
  );
} else {
  console.error("✗ Ошибка удаления webhook:", data.description);
  process.exit(1);
}
