import Link from "next/link";

const REPO = "https://github.com/SarthakRoy-1/FireDrill";

function Cmd({ children }: { children: string }) {
  return <pre tabIndex={0}><code>{children}</code></pre>;
}

export default function Welcome() {
  return (
    <>
      <section className="hero">
        <h1>Run the drill before production does.</h1>
        <p className="lede">FireDrill is an open-source test runner. It opens prompt-injection pull requests against a <strong>sandbox repo you own</strong>, lets your <a href="https://tryalan.ai">Alan</a> workflow react, then grades what it actually did (comments, branches, merges, leaked secrets, trap-URL hits) with deterministic checks. No model grades the result.</p>
        <p className="lede" style={{ marginTop: 12 }}><strong>Privacy:</strong> everything runs on your machine, with your own GitHub token and your own tripwire. Nothing is sent to this site, and your results never appear here.</p>
        <div className="cta">
          <Link href="/demo/" className="btn primary">See the demo audit</Link>
          <Link href="/run/" className="btn">Run it yourself</Link>
          <a href={REPO} className="btn">GitHub source</a>
        </div>
      </section>

      <section aria-labelledby="start">
        <h2 id="start">Get started</h2>
        <p className="small muted">Needs Node.js, a throwaway private GitHub repo with at least one commit on <code>main</code>, and an Alan automation on that repo. The <Link href="/run/">Run it yourself</Link> page builds these commands for your repo.</p>
        <ol className="how">
          <li><strong>Clone the repo.</strong>
            <Cmd>{`git clone ${REPO}.git\ncd FireDrill`}</Cmd></li>
          <li><strong>Install and check the baseline.</strong>
            <Cmd>{"npm install\nnpm test\nnpm run selftest"}</Cmd></li>
          <li><strong>Generate your config and fake canary.</strong> Paste the canary into your Alan automation as an internal token; a leak of it counts as a failure.
            <Cmd>{"npx tsx src/cli.ts init"}</Cmd></li>
          <li><strong>Set a fine-grained GitHub token</strong> limited to your sandbox repo (Contents and Pull requests: read and write). Never commit it.
            <Cmd>{'export GITHUB_TOKEN=<token>          # bash / zsh\n$env:GITHUB_TOKEN = "<token>"        # PowerShell'}</Cmd></li>
          <li><strong>Optional: start the tripwire</strong> and expose it publicly (for example a Cloudflare quick tunnel), then set <code>tripwireBase</code> in <code>firedrill.config.json</code>. Without it, scenarios that use <code>tripwire_hit</code> refuse to run.
            <Cmd>{"npx tsx src/cli.ts tripwire --port 8787\ncloudflared tunnel --url http://localhost:8787"}</Cmd></li>
          <li><strong>Run the attacks.</strong> Check the setup first with <code>doctor</code>.
            <Cmd>{"npx tsx src/cli.ts doctor --repo you/your-sandbox\nnpx tsx src/cli.ts run scenarios/attacks --repo you/your-sandbox --out results.json"}</Cmd>
            <span className="small muted">Use a different <code>--out</code> file for each project so results do not overwrite each other.</span></li>
          <li><strong>View your results.</strong>
            <Cmd>{"npx tsx src/cli.ts report results.json\nnpx tsx src/cli.ts report results.json --html report.html"}</Cmd>
            <span className="small muted">Or open <code>results.json</code> on the <Link href="/view/">View your results</Link> page. It is read in your browser only and never uploaded.</span></li>
        </ol>
        <p className="small muted">The Alan automation itself is set up by hand in Alan&apos;s web app. The <a href={`${REPO}#setup-in-detail`}>full setup guide</a> covers token permissions, the tunnel and the automation steps.</p>
      </section>

      <section aria-labelledby="explore">
        <h2 id="explore">Explore</h2>
        <ul className="entries">
          <li><Link href="/demo/" className="entry"><span className="e-name">Demo audit</span><span className="e-meta">Recorded runs</span><span className="small muted">What one tested configuration did, by the FireDrill author.</span></Link></li>
          <li><Link href="/scenarios/" className="entry"><span className="e-name">Scenarios</span><span className="e-meta">The attacks</span><span className="small muted">Every scenario with its status per run and assertion trace.</span></Link></li>
          <li><Link href="/method/" className="entry"><span className="e-name">Method</span><span className="e-meta">How grading works</span><span className="small muted">Status definitions, the score formula, and the honest limits.</span></Link></li>
          <li><Link href="/view/" className="entry"><span className="e-name">View your results</span><span className="e-meta">Open your own results.json</span><span className="small muted">Read in your browser only. Nothing is uploaded or stored.</span></Link></li>
          <li><Link href="/run/" className="entry"><span className="e-name">Run it yourself</span><span className="e-meta">Generate the commands</span><span className="small muted">Enter your sandbox repo and copy the exact steps. Nothing is sent from this page.</span></Link></li>
        </ul>
        <p className="small links"><a href="/report.html">Standalone report</a><a href={`${REPO}/blob/main/docs/EVIDENCE.md`}>Evidence pack</a><a href={REPO}>Source on GitHub</a></p>
      </section>
    </>
  );
}
