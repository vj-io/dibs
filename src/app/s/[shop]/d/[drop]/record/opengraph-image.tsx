import { buildRecord, recordHeadline } from "@/lib/record";
import { OG_SIZE, RecordCard, SiteCard, ogImage } from "@/lib/server/og";
import { dropByCode, dropRecord } from "@/lib/server/share";

export const alt = "Dibs fairness record: every tap in the order the server committed it";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function recordImage({ params }: { params: Promise<{ shop: string; drop: string }> }) {
  const { shop, drop } = await params;
  const d = await dropByCode(shop, drop).catch(() => null);
  const r = d && await dropRecord(d.dropId).catch(() => null);
  if (!d || !r) return ogImage(<SiteCard />, 60);
  return ogImage(<RecordCard d={d} headline={recordHeadline(buildRecord(r.pieces, r.taps).totals, d.status, d.isSandbox)} />, 60);
}
