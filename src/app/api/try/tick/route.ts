// Judge mode safety net: the /try client calls this every second. Runs due bot actions + sweep for one sandbox
// drop (idempotent), marks the slot in use, and restarts the precise runner if none holds the lease.
import { after } from "next/server";
import { z } from "zod";
import { roomTick, runLoop, settleBackground, tick } from "@/lib/server/bots";
import { sql } from "@/lib/server/db";
import { body, forbidden, json, notFound, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { getBuyer, getStaff } from "@/lib/server/session";
import { touchSlot } from "@/lib/server/sandbox";

export const maxDuration = 300;

const Tick = z.object({ dropId: z.uuid(), where: z.enum(["room", "order"]).optional() });

export const POST = route("POST /api/try/tick", async (req: Request) => {
  const { dropId, where } = await body(req, Tick);
  // only this slot's visitor: the judge's buyer cookie, or the slot shop's demo staff (seller judge)
  const [b, st] = await Promise.all([getBuyer(), getStaff()]);
  const [slot] = await sql<{ judge_id: string | null; shop_id: string }[]>`select judge_id, shop_id from try_slots where drop_id = ${dropId}`;
  if (!slot) notFound();
  const mine = (b && b.buyerId === slot.judge_id) || (st && st.shopId === slot.shop_id
    && (await sql`select 1 from staff where id = ${st.staffId} and shop_id = ${slot.shop_id} and active`).length > 0);
  if (!mine) forbidden();
  await rateLimit(`tick:${b?.buyerId ?? st!.staffId}`, 2, 1, "Too many ticks.");
  if (!(await touchSlot(dropId))) notFound();
  if (where === "room") await roomTick(dropId); // buyer script: piece 2 waits for the judge to be back in the room
  const r = await tick(dropId);
  after(async () => { await settleBackground(); await runLoop(dropId).catch((e) => console.error("[try/tick] runner", e instanceof Error ? e.message : e)); });
  return json({ ok: true, status: r?.status ?? null });
});
