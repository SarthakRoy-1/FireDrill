import type { Metadata } from "next";
import ViewResults from "./ViewResults";

export const metadata: Metadata = { title: "View your results" };

export default function View() {
  return (
    <>
      <section className="hero compact">
        <h1>View your results</h1>
        <p className="lede">Open the <code>results.json</code> that FireDrill wrote on your machine and see it laid out like the demo.</p>
        <p className="note demo-note" role="note"><strong>Private by design.</strong> The file is read inside your browser only. It is not uploaded, stored or sent anywhere, and it is gone when you close or reload this page.</p>
      </section>
      <ViewResults />
    </>
  );
}
