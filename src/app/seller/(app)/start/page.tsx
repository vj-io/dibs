// First run after creating a shop (owners of a real shop; anyone else goes to the drops list).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StartWizard } from "@/components/seller/StartWizard";
import { sellerMe } from "@/lib/server/queries";
import { getStaff } from "@/lib/server/session";

export const metadata: Metadata = { title: "Get your first drop ready" };

export default async function Page() {
  const s = await getStaff();
  const me = s ? await sellerMe(s.staffId) : null;
  if (!me || me.role !== "owner" || me.shop.isSandbox) redirect("/seller/drops");
  return <StartWizard />;
}
