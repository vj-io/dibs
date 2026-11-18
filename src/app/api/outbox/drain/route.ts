// Drains the outbox. Called by Vercel Cron (GET) or by hand (POST), both with `Authorization: Bearer $CRON_SECRET`.
import { createHash, timingSafeEqual } from "node:crypto";
import { fail, json, route } from "@/lib/server/http";
import { drainOutbox } from "@/lib/server/outbox";

const digest = (s: string) => createHash("sha256").update(s).digest();

const handler = route("POST /api/outbox/drain", async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) fail(401, "unauthorized");
  return json(await drainOutbox({ max: 500, budgetMs: 25_000 }));
});

export const POST = handler;
export const GET = handler;
