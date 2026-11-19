// Validation for POST /api/metrics/tap, kept apart from the route so it can be unit-tested without a server.
import { z } from "zod";

export const TapMetric = z.object({
  dropId: z.uuid(),
  result: z.string().regex(/^[a-z_]{1,24}$/),
  clientMs: z.number().int().min(0).max(60000),
  serverMs: z.number().int().min(0).max(600000).optional(),
  conn: z.enum(["slow-2g", "2g", "3g", "4g"]).optional(),
}).strict();
export type TapMetric = z.infer<typeof TapMetric>;
