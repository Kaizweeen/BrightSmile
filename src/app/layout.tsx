import type { Metadata } from "next";
import { Figtree, Geist_Mono, Noto_Sans } from "next/font/google";
import { connection } from "next/server";
import { Providers } from "@/components/providers";
import "./globals.css";

// Figtree for headings, Noto Sans for text: clear at small sizes, which a front desk reads all day.
const display = Figtree({ variable: "--font-display", subsets: ["latin"] });
const sans = Noto_Sans({ variable: "--font-body", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "DentaSync", template: "%s | DentaSync" },
  description: "Appointments, chairs, and dental charts for a practice with several branches.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
