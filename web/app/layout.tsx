import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Firedrill results", description: "Run the drill before production does." };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
