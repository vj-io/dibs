// Nexconn message:send webhook: signature + 5-minute window checked here, the sale-room pipeline (scam shield,
// typed-claim helper, answer bot) runs after the 200 so Nexconn's 5 s timeout is never at risk.
import { after } from "next/server";
import { route } from "@/lib/server/http";
import { handleWebhook } from "@/lib/server/webhook";

export const maxDuration = 60;

export const POST = route("POST /api/nexconn/webhook", (req: Request) => handleWebhook(req, { defer: (job) => after(job) }));
