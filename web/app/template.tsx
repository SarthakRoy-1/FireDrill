import type { ReactNode } from "react";

// A template (unlike a layout) remounts on every navigation, so this wrapper replays its CSS enter
// animation per route. Pure CSS, no JS, no experimental flags; nav and footer live in layout and never remount.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page">{children}</div>;
}
