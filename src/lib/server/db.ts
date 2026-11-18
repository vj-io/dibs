// Postgres through the Supabase transaction pooler. Server only: never import from a client component.
// The database decides everything about stock, claims and orders; routes call the functions in supabase/migrations.
import postgres from "postgres";

const g = globalThis as unknown as { __dibsSql?: ReturnType<typeof postgres> };

/** One pool per server instance. `prepare: false` because the transaction pooler does not keep prepared statements. */
export const sql = (g.__dibsSql ??= postgres(process.env.DATABASE_URL!, {
  ssl: "require",
  prepare: false,
  max: Number(process.env.DB_POOL_MAX ?? 8),
  max_pipeline: 1, // the Supabase transaction pooler hangs on pipelined queries (seen in the 300-claim test)
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
}));

/** Calls a jsonb-returning engine function: `await fn<ClaimResult>("claim_dibs", item, variant, buyer, receivedAt)`. */
export async function fn<T>(name: string, ...args: (string | number | boolean | Date | null)[]): Promise<T> {
  if (!/^[a-z_]+$/.test(name)) throw new Error("bad function name");
  const rows = await sql.unsafe(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args as never[]);
  return rows[0].r as T;
}
