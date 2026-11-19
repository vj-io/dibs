// Judge mode (/try): hands a visitor a private sandbox drop from the pool of 8 slots and starts the script. Server only.
import { randomInt } from "node:crypto";
import { displayName } from "../codec.ts";
import { scheduleStart, slotOf } from "./bots.ts";
import { sql } from "./db.ts";

export type TryRole = "buyer" | "seller";
/** What the /try screen shows as "what happens next". atMs = ms after start, null = when you act. */
export type ScriptStep = { atMs: number | null; text: string };

export const SCRIPTS: Record<TryRole, ScriptStep[]> = {
  buyer: [
    { atMs: 0, text: "You're in a demo room with 40 🤖 demo buyers. Nothing here is real money." },
    { atMs: null, text: "Piece 1 goes live 5 s after you are in the room. Ten demo bots tap 0.08–0.4 s after it does." },
    { atMs: 18_000, text: "Bots never pay: each bot hold runs out after 12 s and the next in line is promoted." },
    { atMs: null, text: "Demo: you get 90 seconds to pay; bots get 12" },
    { atMs: null, text: "When it's yours, tap I've paid. Asha (demo staff) confirms 3 s later." },
    { atMs: null, text: "Back in the sale room, piece 2 drops 3 s later. Every size keeps one piece for 10 s, so a quick tap wins it outright." },
    { atMs: null, text: "Piece 2 is the last: the demo ends 4 s after you win it, or 16 s after it drops, and shows your own times. Paying for piece 2 is optional." },
    { atMs: 180_000, text: "The demo room closes after 3 minutes at the latest." },
  ],
  seller: [
    { atMs: 0, text: "40 🤖 demo buyers are in your room. Nothing drops until you press Drop next." },
    { atMs: null, text: "Each piece: bots tap within 0.08–0.4 s, and more over the next 6 s." },
    { atMs: null, text: "Bot holds run out after 12 s (bots never pay): watch the ledger promote the next buyer." },
    { atMs: null, text: "Demo: you get 90 seconds to pay; bots get 12" },
    { atMs: null, text: "Two bots tap I've paid: mark them paid, then shipped." },
    { atMs: null, text: "One bot posts a UPI ID: the scam shield hides it and logs it. Mute that bot." },
  ],
};

export type TryStart = {
  dropId: string; code: string; shopSlug: string; role: TryRole; script: ScriptStep[];
  buyerId: string; ownerId: string; shopId: string; channelId: string; slot: number;
};

/** Every demo slot is in use right now. */
export class DemoBusy extends Error {
  retryInSeconds: number;
  constructor(retryInSeconds: number) { super("demo_busy"); this.retryInSeconds = retryInSeconds; }
}

/** Resets the slot idle longest that nobody is using and schedules the script. Throws DemoBusy when all are in use. */
export async function startTry(role: TryRole, name?: string): Promise<TryStart> {
  const given = name?.trim().slice(0, 40) || "";
  const display = given ? displayName(given) : `Guest ${randomInt(100, 1000)}`;
  const [{ r }] = await sql`select try_start(${role}, ${given || "You"}, ${display}) as r`;
  if (r.busy) throw new DemoBusy(Number(r.retryInSeconds));
  const slot = await slotOf(r.dropId);
  if (!slot) throw new Error("try_start: slot not recorded");
  await scheduleStart(slot); // the runner (or the first tick) sends the room setup
  return {
    dropId: r.dropId, code: r.code, shopSlug: r.shopSlug, role, script: SCRIPTS[role],
    buyerId: r.buyerId, ownerId: r.ownerId, shopId: r.shopId, channelId: r.channelId, slot: r.slot,
  };
}

/** The client's 1 s heartbeat marks the slot as in use, so /try/start picks other slots first. */
export async function touchSlot(dropId: string): Promise<boolean> {
  return (await sql`update try_slots set last_active_at = now() where drop_id = ${dropId} returning 1`).length > 0;
}
