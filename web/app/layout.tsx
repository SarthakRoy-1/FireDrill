import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import Nav from "./Nav";
import { Geist, Geist_Mono } from "next/font/google";

// Self-hosted at build time by next/font: the deployed site makes no request to Google.
const sans = Geist({ subsets: ["latin"], display: "swap", variable: "--font-sans", weight: ["400", "500", "600"] });
const mono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: "Firedrill results", template: "%s · Firedrill" },
  description: "Run the drill before production does.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <Nav />
        <main id="main">{children}</main>
        <footer className="foot">
          <div className="foot-in">
            <span>Firedrill. Run the drill before production does.</span>
            <span className="foot-links">
              <a href="/report.html">Standalone report</a>
              <a href="https://github.com/SarthakRoy-1/FireDrill/blob/main/docs/EVIDENCE.md">Evidence pack</a>
              <a href="https://github.com/SarthakRoy-1/FireDrill">Source</a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
