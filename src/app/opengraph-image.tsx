import { OG_SIZE, PITCH, SiteCard, ogImage } from "@/lib/server/og";

export const alt = `Dibs: ${PITCH}`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return ogImage(<SiteCard />);
}
