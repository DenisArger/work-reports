import { mustGetEnv } from './env.js';
export async function tgSendMessage(chatId, text) {
    const token = mustGetEnv('BOT_TOKEN');
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const bodyText = await res.text();
    let body = null;
    try {
        body = JSON.parse(bodyText);
    }
    catch {
        // keep raw
    }
    if (!res.ok || body?.ok !== true) {
        throw new Error(`Telegram sendMessage failed: http=${res.status} body=${bodyText.slice(0, 500)}`);
    }
    return body;
}
export async function tgSetWebhook(webhookUrl) {
    const token = mustGetEnv('BOT_TOKEN');
    const url = `https://api.telegram.org/bot${token}/setWebhook`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            url: webhookUrl,
            max_connections: 20,
            allowed_updates: ['message']
        })
    });
    const txt = await res.text();
    if (!res.ok)
        throw new Error(`setWebhook http=${res.status} body=${txt}`);
    return txt;
}
