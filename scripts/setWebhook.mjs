import { tgSetWebhook } from '../lib/telegram.js';
import { mustGetEnv } from '../lib/env.js';

const baseUrl = mustGetEnv('WEBHOOK_BASE_URL'); // например: https://your-project.vercel.app
const webhook = `${baseUrl.replace(/\/$/, '')}/api/telegram`;

tgSetWebhook(webhook)
  .then((txt) => {
    console.log('Webhook set:', webhook);
    console.log(txt);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

