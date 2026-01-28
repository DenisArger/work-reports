export function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

