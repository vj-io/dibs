// Live console. Another shop's drop (or a bad id) is a plain not-found, not a 403 page.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Console } from "@/components/seller/Console";
import { sql } from "@/lib/server/db";
import { getStaff } from "@/lib/server/session";

export const metadata: Metadata = { title: "Live console" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getStaff();
  if (!s || !UUID.test(id)) notFound();
  const [d] = await sql<{ shop_id: string }[]>`select shop_id from drops where id = ${id}`;
  if (!d || d.shop_id !== s.shopId) notFound();
  return <Console dropId={id} />;
}
