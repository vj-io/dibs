// Buyer leaves a shop's club (the Server API adds or removes the Nexconn community member through the outbox).
import { z } from "zod";
import { leave } from "@/lib/server/club";
import { body, json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireBuyer } from "@/lib/server/session";

export const dynamic = "force-dynamic";
const Body = z.object({ shopSlug: z.string().min(1).max(64) });

export const POST = route("POST /api/club/leave", async (req: Request) => {
  const b = await requireBuyer();
  await rateLimit(`clubleave:${b.buyerId}`, 6, 60);
  const { shopSlug } = await body(req, Body);
  return json(await leave(shopSlug, b.buyerId));
});
