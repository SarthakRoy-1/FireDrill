import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Firedrill results", description: "Run the drill before production does.", icons: { icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%23d9480f'/%3E%3C/svg%3E" } };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
