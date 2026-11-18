// Public real totals; sandbox shops, sandbox drops and bot buyers never count.
import { fn } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import type { ImpactTotals } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route("GET /api/impact", async () => json(await fn<ImpactTotals>("impact_totals")));
