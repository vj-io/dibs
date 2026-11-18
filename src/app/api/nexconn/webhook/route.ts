// Nexconn webhook. The Console takes ONE URL for every subscribed event, so this route dispatches on the event type:
//  - `*:pre_messaging` (synchronous): scam-shield rules only, answered within ~300 ms with { pass }. Any doubt passes.
//  - `message:send`: signature + 5-minute window checked, then the sale-room pipeline (scam shield, typed-claim
//    helper, answer bot) runs after the 200 so Nexconn's 5 s timeout is never at risk.
import { after } from "next/server";
import { flags } from "@/lib/server/flags";
import { json, route } from "@/lib/server/http";
import { handlePreMessage, handleWebhook } from "@/lib/server/webhook";

export const maxDuration = 60;

export const POST = route("POST /api/nexconn/webhook", async (req: Request) => {
  let type = "";
  try { type = String((JSON.parse(await req.clone().text()) as { type?: unknown }).type ?? ""); } catch { /* handled below */ }
  if (type.endsWith(":pre_messaging")) {
    // Only sale rooms (open channels) are screened; every other channel type passes untouched.
    if (!flags.features.premessage || type !== "open_channel:pre_messaging") return json({ pass: 1 });
    return json(await handlePreMessage(req, { defer: (job) => after(job) }));
  }
  return handleWebhook(req, { defer: (job) => after(job) });
});
