// Public realtime config for the browser: transport, Nexconn App Key (public by design), area, flags.
import { publicConfig } from "@/lib/server/flags";
import { json, route } from "@/lib/server/http";

export const GET = route("GET /api/config", async () => json(publicConfig()));
