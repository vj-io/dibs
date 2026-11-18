import type { Metadata } from "next";
import { MyStuff } from "@/components/order/MyStuff";

export const metadata: Metadata = { title: "My stuff" };

export default function Page() {
  return <MyStuff />;
}
