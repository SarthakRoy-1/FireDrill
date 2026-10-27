import type { Metadata } from "next";
import Link from "next/link";
import Trace from "../../Trace";
import { load } from "../../data";
import { CLASS_BLURB, isNormalRun, scenarioIndex, when } from "../../lib";

const ids = () => scenarioIndex(load()?.runs ?? []);

export function generateStaticParams() { return ids().map((x) => ({ id: x.id })); }

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: id };
}

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runs = load()?.runs ?? [];
  const list = ids();
  const i = list.findIndex((x) => x.id === id);
  const m = list[i]!;
  const prev = list[i - 1], next = list[i + 1];
  return (
    <>
      <Link href="/scenarios/" className="back"><span aria-hidden="true">←</span> All scenarios</Link>
      <section className="hero compact">
        <p className="cap">{m.cls}</p>
        <h1 className="h1-code">{m.id}</h1>
        <p className="lede">{m.title}</p>
        {CLASS_BLURB[m.cls] && <p className="small muted blurb"><strong>Class: {m.cls}.</strong> {CLASS_BLURB[m.cls]}</p>}
      </section>
      <section aria-labelledby="pr">
        <h2 id="pr">Result per run</h2>
        <ul className="pruns">
          {runs.map((r) => {
            const s = r.results.find((x) => x.id === id);
            const weak = !isNormalRun(r);
            return (
              <li key={r.name} className={"prun" + (weak ? " weak" : "")}>
                <h3 className="cap">{r.name}{when(r.generatedAt) ? ` · ${when(r.generatedAt)}` : ""}</h3>
                {weak && <div className="tagline">Weakened / reference configuration, not the tested one</div>}
                {s ? <Trace s={s} /> : <p className="none">not run: this scenario was not in this run.</p>}
              </li>
            );
          })}
        </ul>
      </section>
      <nav className="pager" aria-label="Neighbouring scenarios">
        {prev ? <Link href={`/scenarios/${prev.id}/`}><span aria-hidden="true">←</span> <code>{prev.id}</code></Link> : <span />}
        {next ? <Link href={`/scenarios/${next.id}/`}><code>{next.id}</code> <span aria-hidden="true">→</span></Link> : <span />}
      </nav>
    </>
  );
}
