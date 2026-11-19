// What every mutating route does after its engine call: send the outbox now so the room hears at once,
// then give judge mode its hook. Neither step can fail the request. Server only.
import { drainOutbox } from "./outbox.ts";
import { onDropEvent, type DropEvent } from "./sandbox-hooks.ts";

/** Whatever the inline budget did not send goes out right after the response (same instance), never waiting for a cron. */
async function finishLater() {
  try {
    const { after } = await import("next/server");
    after(async () => { await drainOutbox({ budgetMs: 25_000 }); });
  } catch { // outside a request (tests, scripts): finish now
    await drainOutbox({ budgetMs: 25_000 });
  }
}

const BUDGET_MS = 1500;
let running: Promise<void> | null = null;
let again = false;

/**
 * One drain per instance at a time. A call that arrives while one runs does not start a second (in a 300-tap burst,
 * 298 of 300 concurrent drains found nothing to send: docs/perf.md); it asks the running one to go round once more,
 * so rows written after that drain's last lease still go out, and it waits for the same promise. Bounded by the budget.
 */
function drainShared(dropId: string | null): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    const t0 = Date.now();
    let more = false;
    try {
      do {
        again = false;
        const r = await drainOutbox({ budgetMs: Math.max(200, BUDGET_MS - (Date.now() - t0)) }); // never throws
        if (r.failed) console.warn(JSON.stringify({ outbox: "failed_sends", dropId, failed: r.failed }));
        more = r.more;
      } while (again && !more && Date.now() - t0 < BUDGET_MS);
      if (more || again) await finishLater();
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function afterWrite(dropId: string | null, event?: DropEvent): Promise<void> {
  await drainShared(dropId);
  if (event) await onDropEvent(event).catch((e) => console.error("[afterWrite] onDropEvent", e));
}
