import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono, Patrick_Hand } from "next/font/google";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], weight: ["400", "600", "800"], variable: "--font-archivo", display: "swap" });
const patrick = Patrick_Hand({ subsets: ["latin"], weight: "400", variable: "--font-patrick", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-jetbrains", display: "swap" });

const pitch = "First tap wins. Everyone sees it. Nobody gets lost in the DMs.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "Dibs — First tap wins", template: "%s · Dibs" },
  description: `${pitch} A live sale room for sellers who drop jewellery and fashion on WhatsApp and Instagram.`,
  applicationName: "Dibs",
  openGraph: { title: "Dibs — First tap wins", description: pitch, type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#f0ede8",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={`${archivo.variable} ${patrick.variable} ${jetbrains.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <a href="#main" className="sr-only-focusable fixed left-3 top-3 z-50 rounded-md border-2 border-ink bg-lime px-3 py-2 font-semibold">Skip to content</a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
