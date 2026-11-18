// Postgres through the Supabase transaction pooler. Server only: never import from a client component.
// The database decides everything about stock, claims and orders; routes call the functions in supabase/migrations.
import { attachDatabasePool } from "@vercel/functions";
import postgres from "postgres";

const g = globalThis as unknown as { __dibsSql?: ReturnType<typeof postgres> };

const IDLE_SECONDS = 5;
// A suspended function instance cannot run the timer that closes its idle connections, so after a tap burst the
// frozen instances kept the pooler's 200 client slots and every request failed (seen in the 300-tap production test).
// Vercel's attachDatabasePool keeps the instance awake until the idle timeout has passed. It knows pg/mysql pools,
// not postgres.js, so this shim presents the mysql2 shape (config.idleTimeout + a "release" event) and fires the
// event for every query.
const released: (() => void)[] = [];
const touch = () => { for (const f of released) { try { f(); } catch { /* outside a request: nothing to keep alive */ } } };

/** One pool per server instance. `prepare: false` because the transaction pooler does not keep prepared statements. */
export const sql = (g.__dibsSql ??= (() => {
  const pool = postgres(process.env.DATABASE_URL!, {
    ssl: "require",
    prepare: false,
    max: Number(process.env.DB_POOL_MAX ?? 3), // small on purpose: many function instances share the pooler's 200 client connections
    max_pipeline: 1, // the Supabase transaction pooler hangs on pipelined queries (seen in the 300-claim test)
    idle_timeout: IDLE_SECONDS,
    connect_timeout: 10,
    onnotice: () => {},
    debug: touch, // called once per query
  });
  try {
    attachDatabasePool({ config: { idleTimeout: IDLE_SECONDS * 1000 }, on: (_event: string, listener: () => void) => { released.push(listener); } } as never);
  } catch (e) { console.warn("[db] attachDatabasePool", e instanceof Error ? e.message : e); }
  return pool;
})());

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
  if (rpcReady()) return rpc<T>("api_call", { p_fn: name, p_args: args.map((a) => (a instanceof Date ? a.toISOString() : a)) });
  const rows = await withConn(() => sql.unsafe(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args as never[]));
  return rows[0].r as T;
}

const rpcReady = () => process.env.DB_RPC !== "0" && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Calls a Postgres function over HTTP (Supabase PostgREST) with the service role. No Postgres connection is held by
 * this instance, so a tap burst across hundreds of instances queues at PostgREST instead of failing at the pooler
 * (migration 0007). Retries only when the request did not get an answer from the database (network, 502/503/504):
 * the engine functions are safe to repeat (a repeated claim returns `already` with the same claim).
 */
export async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  if (!/^[a-z_]+$/.test(name)) throw new Error("bad function name");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 120 * i + Math.random() * 120));
    let res: Response;
    try {
      res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
    } catch (e) { last = e; continue; }
    if (res.status === 502 || res.status === 503 || res.status === 504) { last = new Error(`rpc ${name}: HTTP ${res.status}`); continue; }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      throw Object.assign(new Error(`rpc ${name}: ${err.message ?? `HTTP ${res.status}`}`), { code: err.code });
    }
    return (await res.json()) as T;
  }
  throw last instanceof Error ? last : new Error(`rpc ${name} failed`);
}
