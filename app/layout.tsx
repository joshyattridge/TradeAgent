import type { Metadata } from "next";
import { Instrument_Serif, Syne, IBM_Plex_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { ChatWidget } from "@/components/ChatWidget";
import { ProposalReview } from "@/components/ProposalReview";
import { Providers } from "@/components/Providers";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400"],
});

const ibm = IBM_Plex_Mono({
  variable: "--font-ibm",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "TradeAgent",
  description: "Minimalist AI dashboard for day trading — plan, logs, and chat.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${syne.variable} ${instrument.variable} ${ibm.variable}`}>
        <Providers>
          <div className="app-shell">
            <Nav />
            <main>{children}</main>
            <ChatWidget />
            <ProposalReview />
          </div>
        </Providers>
      </body>
    </html>
  );
}
