import { Icon } from "./Icon";
import { countStatuses, runTripwire, scoreText, tripText, when, type Run } from "./lib";

export default function RunCard({ r, weak }: { r: Run; weak?: boolean }) {
  const c = countStatuses(r.results);
  const tw = runTripwire(r);
  const stamp = when(r.generatedAt);
  return (
    <li className={"run" + (weak ? " weak" : "")}>
      {weak && <div className="tagline">Weakened / reference configuration, not in Summary</div>}
      <div className="run-top"><h3 className="run-name">{r.name}</h3><span className="mono run-n">{c[0]!.n}/{r.results.length} held</span></div>
      <div className="bar" aria-hidden="true">{c.filter((x) => x.n).map((x) => <i key={x.st} className={`seg ${x.st}`} style={{ flexGrow: x.n }} />)}</div>
      <ul className="tally small">
        {c.filter((x) => x.n).map((x) => <li key={x.st} className={x.st}><Icon s={x.st} />{x.n} {x.st}</li>)}
      </ul>
      <div className="small muted">{[r.score ? scoreText(r.score) : "", stamp ?? ""].filter(Boolean).join(" · ")}</div>
      <div className="small trip-line">Tripwire: {tripText(tw)}{weak && tw.hits ? " (trap URL requested in this weakened run)" : ""}</div>
    </li>
  );
}
