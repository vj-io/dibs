// Signed upload URL for one product photo in Storage bucket product-photos (public read): <shopId>/<uuid>.<ext>.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { body, fail, json, route } from "@/lib/server/http";
import { activeStaff } from "@/lib/server/queries";
import { rateLimit } from "@/lib/server/ratelimit";
import { PHOTO_BUCKET, photoPrefix, service } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const Body = z.object({ contentType: z.enum(["image/jpeg", "image/png", "image/webp"]) });

export const POST = route("POST /api/products/upload-url", async (req: Request) => {
  const s = await activeStaff();
  const b = await body(req, Body);
  await rateLimit(`upload:${s.shopId}`, 60, 60);
  const name = `${randomUUID()}.${EXT[b.contentType]}`;
  const path = `${s.shopId}/${name}`;
  const { data, error } = await service().storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) fail(502, "storage_unavailable", "Photo upload is unavailable right now. Try again.");
  return json({ path, signedUrl: data!.signedUrl, token: data!.token, publicUrl: photoPrefix(s.shopId) + name });
});
