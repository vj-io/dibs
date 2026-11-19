import { DropCard, OG_SIZE, SiteCard, ogImage, rasterDataUri } from "@/lib/server/og";
import { dropByCode } from "@/lib/server/share";
import { appUrl } from "@/lib/server/queries";

export const alt = "Dibs sale room: first tap wins";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function dropImage({ params }: { params: Promise<{ shop: string; drop: string }> }) {
  const { shop, drop } = await params;
  const d = await dropByCode(shop, drop).catch(() => null);
  if (!d) return ogImage(<SiteCard />, 60);
  const photo = await rasterDataUri(d.items[0]?.photo, appUrl());
  return ogImage(<DropCard d={d} photo={photo} now={Date.now()} />, 60);
}
