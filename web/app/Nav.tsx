"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [["/", "Overview"], ["/scenarios/", "Scenarios"], ["/runs/", "Runs"], ["/method/", "Method"], ["/run/", "Run it yourself"]] as const;

export function Mark() {
  return <svg className="mark" width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)" /><path fill="#fff" d="M16.6 4.5c.5 3-1.1 4.6-2.7 6.4-1.7 1.9-3.4 3.8-3.4 7a5.5 5.5 0 0 0 11 0c0-2-.9-3.5-1.9-4.7-.2 1.1-.8 1.9-1.6 2.3.5-3.6-.3-8.1-1.4-11Z" /></svg>;
}

export default function Nav() {
  const path = (usePathname() || "/").replace(/\/?$/, "/");
  const on = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <header className="site">
      <div className="site-in">
        <Link href="/" className="logo" aria-label="Firedrill home"><Mark />Firedrill</Link>
        <nav aria-label="Main">
          <ul>
            {items.map(([h, l]) => <li key={h}><Link href={h} aria-current={on(h) ? "page" : undefined}>{h === "/run/" ? <>Run it<span className="nav-more"> yourself</span></> : l}</Link></li>)}
          </ul>
        </nav>
      </div>
    </header>
  );
}
