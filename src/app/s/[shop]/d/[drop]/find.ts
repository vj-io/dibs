import { cache } from "react";
import { dropByCode } from "@/lib/server/share";

// One lookup per request for the layout's 404 check, the metadata and the page, bounded to 3 s so a slow database
// never holds the page: undefined = unknown (failed or slow), and the room resolves the link itself with its own retry screen.
export const find = cache((shop: string, code: string) => Promise.race([
  dropByCode(shop, code).catch(() => undefined),
  new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000)),
]));
