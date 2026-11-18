// Nexconn pre-message callback (flag FEATURE_PREMESSAGE): scam-shield rules only, answered within ~300 ms.
// Response { pass: 0 | 1, extra? }: 0 blocks (extra goes back to the sender), 1 delivers. Any doubt passes.
import { after } from "next/server";
import { flags } from "@/lib/server/flags";
import { json, route } from "@/lib/server/http";
import { handlePreMessage } from "@/lib/server/webhook";

export const POST = route("POST /api/nexconn/premessage", async (req: Request) => {
  if (!flags.features.premessage) return json({ pass: 1 });
  return json(await handlePreMessage(req, { defer: (job) => after(job) }));
});
