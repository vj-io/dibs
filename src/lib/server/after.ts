// What every mutating route does after its engine call: send the outbox now so the room hears at once,
// then give judge mode its hook. Neither step can fail the request. Server only.
import { drainOutbox } from "./outbox.ts";
import { onDropEvent, type DropEvent } from "./sandbox-hooks.ts";

export async function afterWrite(dropId: string | null, event?: DropEvent): Promise<void> {
  const r = await drainOutbox({ budgetMs: 1500 }); // never throws; the cron retries what is left
  if (r.failed) console.warn(JSON.stringify({ outbox: "failed_sends", dropId, failed: r.failed }));
  if (event) await onDropEvent(event).catch((e) => console.error("[afterWrite] onDropEvent", e));
}
