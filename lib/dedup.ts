import { getEnv } from './env.js';

// Дедуп по update_id.
// На Vercel in-memory не гарантирован (холодные старты), поэтому лучше Upstash Redis.
// Если UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN не заданы — дедуп отключен.

export async function isUpdateProcessed(updateId: number): Promise<boolean> {
  const url = getEnv('UPSTASH_REDIS_REST_URL');
  const token = getEnv('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) return false;

  const key = `upd:${updateId}`;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = (await res.json().catch(() => null)) as { result?: unknown } | null;
  return json?.result != null;
}

export async function markUpdateProcessed(updateId: number): Promise<void> {
  const url = getEnv('UPSTASH_REDIS_REST_URL');
  const token = getEnv('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) return;

  const key = `upd:${updateId}`;
  // TTL 6 часов
  const ttlSeconds = 60 * 60 * 6;
  await fetch(`${url}/set/${encodeURIComponent(key)}/1?ex=${ttlSeconds}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

