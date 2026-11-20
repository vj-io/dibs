import { notFound } from "next/navigation";
import { find } from "./find";

// The unknown-link check sits above loading.tsx: once its skeleton streams, the status is fixed at 200 (Next's
// streaming docs), so a page-level notFound() could only send a 200 with noindex. Covers the record page too.
export default async function DropLayout({ children, params }: { children: React.ReactNode; params: Promise<{ shop: string; drop: string }> }) {
  const { shop, drop } = await params;
  if ((await find(shop, drop)) === null) notFound();
  return children;
}
