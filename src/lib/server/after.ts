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

export async function afterWrite(dropId: string | null, event?: DropEvent): Promise<void> {
  const r = await drainOutbox({ budgetMs: 1500 }); // never throws
  if (r.failed) console.warn(JSON.stringify({ outbox: "failed_sends", dropId, failed: r.failed }));
  if (r.more) await finishLater();
  if (event) await onDropEvent(event).catch((e) => console.error("[afterWrite] onDropEvent", e));
}
