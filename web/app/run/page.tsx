import type { Metadata } from "next";
import RunForm from "./RunForm";

export const metadata: Metadata = { title: "Run it yourself" };

export default function RunIt() {
  return (
    <>
      <section className="hero compact">
        <h1>Run it yourself</h1>
        <p className="lede">Enter your sandbox repo and copy the exact commands to test your own Alan workflow with FireDrill.</p>
      </section>

      <section aria-labelledby="safe">
        <div className="card note" id="safe-box">
          <h2 id="safe" className="box-h">Before you start</h2>
          <ul>
            <li>This page runs nothing and sends nothing. It only builds text for you to copy.</li>
            <li>Everything happens in your terminal, against a repo you own.</li>
            <li>Only test repos and workflows you own. Never point FireDrill at anyone else&apos;s.</li>
            <li>There is no token field here on purpose. A token never belongs in a browser: set <code>GITHUB_TOKEN</code> in your terminal (step below).</li>
          </ul>
        </div>
      </section>

      <RunForm />
    </>
  );
}
