// The staff member's own club: members, recent chat, reviews (hidden ones too), announcements.
import { manage } from "@/lib/server/club";
import { json, route } from "@/lib/server/http";
import { activeStaff } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export const GET = route("GET /api/club/manage", async () => json(await manage((await activeStaff()).shopId)));
