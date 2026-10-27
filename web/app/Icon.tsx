import type { Status } from "./lib";
// Inline 16px icons, 1.5px stroke, currentColor. Always paired with a text label, never the only signal.
const paths: Record<Status, string> = {
  PASS: "M3.5 8.5l3 3 6-7",
  FAIL: "M4 4l8 8M12 4l-8 8",
  ERROR: "M8 2.5l6 10.5H2L8 2.5zM8 7v3M8 11.6v.4",
  TIMEOUT: "M8 4.5V8l2.5 1.5M8 14a6 6 0 100-12 6 6 0 000 12z",
};
export function Icon({ s }: { s: Status }) {
  return (
    <svg className="ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[s]} />
    </svg>
  );
}
export const Chip = ({ s }: { s: Status }) => <span className={`chip ${s}`}><Icon s={s} />{s}</span>;
