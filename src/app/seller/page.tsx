// Seller sign-in: email one-time code, then the shop form when this email has no shop yet. Signed in -> drops.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignIn } from "@/components/seller/SignIn";
import { sellerMe } from "@/lib/server/queries";
import { getStaff } from "@/lib/server/session";
import { getSellerClaim } from "@/lib/server/supabase";

export const metadata: Metadata = { title: "Seller sign in" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const s = await getStaff();
  if (s && (await sellerMe(s.staffId))) redirect("/seller/drops");
  const claim = await getSellerClaim();
  return <SignIn pendingEmail={claim?.email ?? null} />;
}
