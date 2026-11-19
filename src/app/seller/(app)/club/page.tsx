import type { Metadata } from "next";
import { ClubManage } from "@/components/club/ClubManage";

export const metadata: Metadata = { title: "Club" };

export default function Page() {
  return <ClubManage />;
}
