import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SaleRoomByCode } from "@/components/sale/SaleRoomByCode";
import { appUrl } from "@/lib/server/queries";
import { dropByCode, shareUrl } from "@/lib/server/share";
import { istWhen } from "@/lib/when";

// One lookup per request for the metadata and the 404 check, bounded to 3 s so a slow database never holds the
// page: undefined = unknown (failed or slow), and the room resolves the link itself with its own retry screen.
const find = cache((shop: string, code: string) => Promise.race([
  dropByCode(shop, code).catch(() => undefined),
  new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000)),
]));

export async function generateMetadata({ params }: { params: Promise<{ shop: string; drop: string }> }): Promise<Metadata> {
  const { shop, drop } = await params;
  const d = await find(shop, drop);
  if (!d) return { title: "Sale room", robots: { index: false } };
  const n = d.items.length, pieces = `${n} ${n === 1 ? "piece" : "pieces"}`;
  const when = d.status === "ended" ? "This drop has ended" : d.status === "live" ? "Live now" : istWhen(d.startsAt);
  const title = `${d.title} · ${d.shop.name} on Dibs`;
  const description = d.status === "ended" ? `${when}. ${pieces}.` : `${when} · ${pieces}. First tap wins.`;
  const url = shareUrl(d, appUrl());
  return {
    metadataBase: new URL(appUrl()),
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: d.isSandbox ? { index: false, follow: false } : undefined,
    openGraph: { title, description, url, type: "website", siteName: "Dibs" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ shop: string; drop: string }> }) {
  const { shop, drop } = await params;
  if ((await find(shop, drop)) === null) notFound(); // a real 404 status and the site's not-found page
  return <SaleRoomByCode shop={shop} code={drop} />;
}
