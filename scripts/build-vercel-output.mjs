/**
 * Build Output API v3: creates .vercel/output for serverless-only deploy.
 * Each api/*.ts is bundled into .vercel/output/functions/api/<name>.func/
 * so Vercel reliably routes /api/telegram and /api/health.
 */
import { build } from "esbuild";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const out = join(root, ".vercel", "output");

async function run() {
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "functions", "api"), { recursive: true });
  await mkdir(join(out, "static"), { recursive: true });

  const nodeVersion = "nodejs20.x";
  const funcConfig = {
    runtime: nodeVersion,
    launcherType: "Nodejs",
    shouldAddHelpers: true,
  };

  for (const name of ["telegram", "health"]) {
    const funcDir = join(out, "functions", "api", `${name}.func`);
    await mkdir(funcDir, { recursive: true });

    await build({
      entryPoints: [join(root, "api", `${name}.ts`)],
      bundle: true,
      platform: "node",
      target: "node20",
      outfile: join(funcDir, "index.js"),
      format: "cjs",
      external: ["@vercel/node"],
      sourcemap: false,
    });

    await writeFile(
      join(funcDir, ".vc-config.json"),
      JSON.stringify({
        ...funcConfig,
        handler: "index.js",
      }),
    );
  }

  await writeFile(
    join(out, "config.json"),
    JSON.stringify({
      version: 3,
    }),
  );

  await writeFile(
    join(out, "static", "index.html"),
    '<!DOCTYPE html><html><body><p>Worker Reports Bot API</p><a href="/api/health">/api/health</a></body></html>',
  );

  console.log("Created .vercel/output (Build Output API v3)");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
