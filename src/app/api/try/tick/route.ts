// Judge mode safety net: the /try client calls this every second. Runs due bot actions + sweep for one sandbox
// drop (idempotent), marks the slot in use, and restarts the precise runner if none holds the lease.
import { after } from "next/server";
import { z } from "zod";
import { runLoop, settleBackground, tick } from "@/lib/server/bots";
import { body, json, notFound, route } from "@/lib/server/http";
import { touchSlot } from "@/lib/server/sandbox";

export const maxDuration = 300;

const Tick = z.object({ dropId: z.uuid() });

export const POST = route("POST /api/try/tick", async (req: Request) => {
  const { dropId } = await body(req, Tick);
  if (!(await touchSlot(dropId))) notFound();
  const r = await tick(dropId);
  after(async () => { await settleBackground(); await runLoop(dropId); });
  return json({ ok: true, status: r?.status ?? null });
});
