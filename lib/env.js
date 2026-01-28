export function mustGetEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env var: ${name}`);
    return v;
}
export function getEnv(name) {
    return process.env[name] || undefined;
}
