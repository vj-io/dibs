// Stages a migration in a scratch schema so it can be tested against the shared database without replacing the live
// functions: tables stay in public, the staged functions shadow public's for any session whose search_path is
// "perf8,public" (append ?search_path=perf8,public to the connection URL; both Supavisor modes apply it per client and
// it did not leak to other clients in a check). Indexes would land in public: keep them out.
// Test run: DATABASE_URL=<pooler>?search_path=perf8,public DATABASE_URL_SESSION=<session>?search_path=perf8,public npm run test:db
// Usage: node --env-file=.env.local scripts/perf-stage.ts up [supabase/migrations/0008_perf.sql] | down
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const [cmd, file = "supabase/migrations/0008_perf.sql"] = process.argv.slice(2);
const db = postgres(process.env.DATABASE_URL_SESSION!, { ssl: "require", max: 1, onnotice: () => {} });
try {
  if (cmd === "up") {
    const text = await readFile(file, "utf8");
    if (/create\s+(unique\s+)?index/i.test(text)) throw new Error("the staged file creates an index (it would land in public)");
    await db.begin(async (tx) => {
      await tx`drop schema if exists perf8 cascade`;
      await tx`create schema perf8`;
      await tx`set local search_path = perf8, public`;
      await tx.unsafe(text);
      // public's default privileges (0002) do not reach a new schema: mirror them so the staged copy is as locked down
      await tx.unsafe("revoke execute on all functions in schema perf8 from public");
      await tx.unsafe("do $$ begin if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke execute on all functions in schema perf8 from anon, authenticated'; end if; end $$");
    });
    const fns = await db`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'perf8' order by 1`;
    console.log(`staged ${file} in perf8: ${fns.map((f) => f.proname).join(", ")}`);
  } else if (cmd === "down") {
    await db`drop schema if exists perf8 cascade`;
    console.log("perf8 dropped");
  } else throw new Error("usage: perf-stage.ts up [file] | down");
} finally {
  await db.end();
}
