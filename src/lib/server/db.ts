// Postgres through the Supabase transaction pooler. Server only: never import from a client component.
// The database decides everything about stock, claims and orders; routes call the functions in supabase/migrations.
import postgres from "postgres";

const g = globalThis as unknown as { __dibsSql?: ReturnType<typeof postgres> };

/** One pool per server instance. `prepare: false` because the transaction pooler does not keep prepared statements. */
export const sql = (g.__dibsSql ??= postgres(process.env.DATABASE_URL!, {
  ssl: "require",
  prepare: false,
  max: Number(process.env.DB_POOL_MAX ?? 3), // small on purpose: many function instances share the pooler's 200 client connections
  max_pipeline: 1, // the Supabase transaction pooler hangs on pipelined queries (seen in the 300-claim test)
  idle_timeout: 5,
  connect_timeout: 10,
  onnotice: () => {},
}));

const CONNECT_ERRORS = /EMAXCONN|max client connections|CONNECT_TIMEOUT|CONNECTION_ENDED|CONNECTION_CLOSED|ECONNRESET|ECONNREFUSED/i;

/**
 * Runs a query and retries only when the connection could not be opened (the pooler was full in a tap burst:
 * seen as EMAXCONN in the 300-tap production test). The statement never reached Postgres in that case, so a
 * retry cannot run it twice. Backoff with jitter, about 3 s in total.
 */
export async function withConn<T>(run: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await run(); } catch (e) {
      const msg = e instanceof Error ? `${(e as { code?: string }).code ?? ""} ${e.message}` : String(e);
      if (i >= 6 || !CONNECT_ERRORS.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 80 * 2 ** Math.min(i, 3) + Math.random() * 150));
    }
  }
}

/** Calls a jsonb-returning engine function: `await fn<ClaimResult>("claim_dibs", item, variant, buyer, receivedAt)`. */
export async function fn<T>(name: string, ...args: (string | number | boolean | Date | null)[]): Promise<T> {
  if (!/^[a-z_]+$/.test(name)) throw new Error("bad function name");
  const rows = await withConn(() => sql.unsafe(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args as never[]));
  return rows[0].r as T;
}
