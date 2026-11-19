// Judge mode heartbeat: the /try client calls this every second. It only marks the slot in use, records where the
// judge's screen is (room / order), and makes sure a runner is going (after the response). It never runs the bot
// script, a sweep or an outbox drain itself: those are the runner's job, and here they once made a tick take 80 s
// (engine calls are HTTP RPC with 20 s timeouts, and a global drain waits on every channel).
import { after } from "next/server";
import { z } from "zod";
import { roomTick, runLoop, settleBackground } from "@/lib/server/bots";
import { sql } from "@/lib/server/db";
import { body, fail, forbidden, json, notFound, route } from "@/lib/server/http";
import { getBuyer, getStaff } from "@/lib/server/session";

export const maxDuration = 300;

const Tick = z.object({ dropId: z.uuid(), where: z.enum(["room", "order"]).optional() });
const BUDGET_MS = 1500;

export const POST = route("POST /api/try/tick", async (req: Request) => {
  const t0 = Date.now();
  const { dropId, where } = await body(req, Tick);
  // only this slot's visitor: the judge's buyer cookie, or the slot shop's demo staff (seller judge)
  const [b, st] = await Promise.all([getBuyer(), getStaff()]);
  const [slot] = await sql<{ judge_id: string | null; shop_id: string; status: string | null }[]>`
    select t.judge_id, t.shop_id, (select status from drops where id = t.drop_id) as status from try_slots t where t.drop_id = ${dropId}`;
  if (!slot) notFound();
  const mine = (b && b.buyerId === slot.judge_id) || (st && st.shopId === slot.shop_id
    && (await sql`select 1 from staff where id = ${st.staffId} and shop_id = ${slot.shop_id} and active`).length > 0);
  if (!mine) forbidden();
  // rate limit over the Postgres pool, not HTTP RPC: a queued RPC (20 s timeout, retried) must not hold the heartbeat
  const [{ n }] = await sql<{ n: number }[]>`select rate_add(${`tick:${b?.buyerId ?? st!.staffId}`}, 1) as n`;
  if (n > 2) fail(429, "rate_limited", "Too many ticks.");

  // the rest is bounded: whatever is not done within the budget finishes after the response
  const work = (async () => {
    await sql`update try_slots set last_active_at = now() where drop_id = ${dropId}`;
    if (where === "room") await roomTick(dropId); // buyer script: piece 1 / piece 2 wait for the judge to be in the room
  })();
  const inTime = await Promise.race([work.then(() => true, () => true), new Promise<boolean>((r) => setTimeout(() => r(false), Math.max(0, BUDGET_MS - (Date.now() - t0))))]);
  after(async () => {
    await work.catch((e) => console.error("[try/tick] work", e instanceof Error ? e.message : e));
    await settleBackground();
    await runLoop(dropId).catch((e) => console.error("[try/tick] runner", e instanceof Error ? e.message : e)); // returns at once if one runs
  });
  const ms = Date.now() - t0;
  if (!inTime || ms > BUDGET_MS) console.warn(JSON.stringify({ route: "POST /api/try/tick", overBudgetMs: ms, dropId }));
  return json({ ok: true, status: (slot.status ?? null) as "scheduled" | "live" | "ended" | null });
});
