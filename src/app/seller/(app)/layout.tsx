// Every signed-in seller page: no active staff session -> /seller (sign in).
import { redirect } from "next/navigation";
import { SellerShell } from "@/components/seller/Shell";
import { sellerMe } from "@/lib/server/queries";
import { getStaff } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function SellerAppLayout({ children }: { children: React.ReactNode }) {
  const s = await getStaff();
  const me = s ? await sellerMe(s.staffId, s.iat) : null;
  if (!me) redirect("/seller");
  return <SellerShell me={me}>{children}</SellerShell>;
}
