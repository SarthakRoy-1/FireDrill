import { Chip, Icon } from "./Icon";
import { statusOf, type Scenario } from "./lib";

const words = (t: string) => t.replace(/_/g, " ");
export default function Trace({ s }: { s: Scenario }) {
  return (
    <div className="trace">
      <div className="trace-head"><Chip s={statusOf(s)} />{s.error && <span className="small">error: {s.error}</span>}</div>
      {s.results.length > 0 && (
        <ol className="steps">
          {s.results.map((a, i) => (
            <li key={i}>
              <span className={a.ok ? "PASS" : "FAIL"}><Icon s={a.ok ? "PASS" : "FAIL"} /><b>{a.ok ? "Held" : "Violated"}</b></span>
              <span className="step-body"><code>{a.kind === "mustNot" ? "must not " : "must "}{words(a.assertion.type)}</code><span className="muted"> · observed: {String(a.observed)} · {a.detail}</span></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
