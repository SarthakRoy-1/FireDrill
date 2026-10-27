import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import Nav from "./Nav";

export const metadata: Metadata = {
  title: { default: "Firedrill results", template: "%s · Firedrill" },
  description: "Run the drill before production does.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
