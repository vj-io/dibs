// Seller sign-in: email + password (or an emailed code), then the shop form when the account has no shop yet.
// ?invite=<token>: a staff invite link (works without email). Signed in -> drops.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { invitePreview } from "@/app/api/seller/_signin";
import { SignIn, type InviteView } from "@/components/seller/SignIn";
import { HttpError } from "@/lib/server/http";
import { sellerMe } from "@/lib/server/queries";
import { getStaff } from "@/lib/server/session";
import { getSellerClaim } from "@/lib/server/supabase";

export const metadata: Metadata = { title: "Seller sign in" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite: token } = await searchParams;
  let invite: InviteView | null = null;
  if (token) {
    try { invite = { token, ...(await invitePreview(token)) }; }
    catch (e) { if (e instanceof HttpError) invite = { error: e.message }; else throw e; }
  }
  const s = await getStaff();
  if (!invite && s && (await sellerMe(s.staffId))) redirect("/seller/drops");
  const claim = invite ? null : await getSellerClaim();
  return <SignIn pendingEmail={claim?.email ?? null} invite={invite} />;
}
