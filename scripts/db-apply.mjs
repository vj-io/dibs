// Applies every supabase/migrations/*.sql in name order. The migrations are written to be re-runnable,
// so this can run any number of times. Usage: npm run db:apply  (reads DATABASE_URL_SESSION from .env.local)
import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL_SESSION;
if (!url) throw new Error("DATABASE_URL_SESSION is not set (run with --env-file=.env.local)");

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const sql = postgres(url, { ssl: "require", max: 1, onnotice: () => {} });
try {
  for (const f of files) {
    const t0 = Date.now();
    const text = await readFile(join(dir, f), "utf8");
    await sql.begin((tx) => tx.unsafe(text));
    console.log(`applied ${f} (${Date.now() - t0} ms)`);
  }
} finally {
  await sql.end();
}
