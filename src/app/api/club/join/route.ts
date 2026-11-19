// Buyer joins a shop's club (the Server API adds or removes the Nexconn community member through the outbox).
import { z } from "zod";
import { join } from "@/lib/server/club";
import { body, json, route } from "@/lib/server/http";
import { requireBuyer } from "@/lib/server/session";

export const dynamic = "force-dynamic";
const Body = z.object({ shopSlug: z.string().min(1).max(64) });

export const POST = route("POST /api/club/join", async (req: Request) => {
  const b = await requireBuyer();
  const { shopSlug } = await body(req, Body);
  return json(await join(shopSlug, b.buyerId));
});
