"use client";
import { useRef, useState } from "react";
import { commandSteps, defaultSandboxName, nameError, parseRepoRef, repoError } from "../lib";

function Block({ text, label, title }: { text: string; label?: string; title: string }) {
  const [state, setState] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("Copied");
    } catch {
      if (pre.current) getSelection()?.selectAllChildren(pre.current);
      setState("Copy not available here. The command is selected, press Ctrl+C.");
    }
    setTimeout(() => setState(""), 2500);
  };
  return (
    <div className="cmd">
      <div className="cmd-bar">
        <span className="cap">{label ?? "Terminal"}</span>
        <button type="button" className="copy" onClick={copy} aria-label={`Copy ${title}${label ? `, ${label}` : ""}`}>Copy</button>
        <span className="small muted copied" role="status" aria-live="polite">{state}</span>
      </div>
      <pre ref={pre} tabIndex={0} aria-label={`${title}${label ? `, ${label}` : ""} command`}><code>{text}</code></pre>
    </div>
  );
}

function Field(p: { id: string; label: string; value: string; set: (v: string) => void; err: string | null; hint?: string; ph: string }) {
  return (
    <div className="field">
      <label htmlFor={p.id}>{p.label}</label>
      <input id={p.id} type="text" value={p.value} onChange={(e) => p.set(e.target.value)} placeholder={p.ph} autoComplete="off" autoCapitalize="off" spellCheck={false}
        aria-invalid={p.err ? true : undefined} aria-describedby={`${p.id}-msg`} />
      <p id={`${p.id}-msg`} className={"small " + (p.err ? "ferr" : "muted")}>{p.err ? `Error: ${p.err}` : p.hint}</p>
    </div>
  );
}

export default function RunForm() {
  const [repo, setRepo] = useState("");
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const srcOk = !!parseRepoRef(source);
  const steps = commandSteps(repo, source, name);
  const dflt = defaultSandboxName(source);
  return (
    <>
      <section aria-labelledby="inputs">
        <h2 id="inputs">Your repos</h2>
        <form className="card form" onSubmit={(e) => e.preventDefault()} noValidate>
          <Field id="repo" label="Sandbox repo (owner/name)" value={repo} set={setRepo} err={repoError(repo)} ph="my-org/alan-sandbox" hint="Required. A repo you own, used only for testing." />
          <Field id="source" label="Clone source (owner/repo), optional" value={source} set={setSource} err={repoError(source)} ph="my-org/my-app" hint="Optional. Fill this to make a code-only copy to attack instead of the original." />
          {srcOk && <Field id="newname" label="New sandbox name" value={name} set={setName} err={nameError(name)} ph={dflt} hint={`Defaults to ${dflt} if left empty.`} />}
        </form>
        {!parseRepoRef(repo) && <p className="small muted">Until you enter a valid sandbox repo, commands show placeholders like <code>&lt;owner&gt;/&lt;sandbox-repo&gt;</code>.</p>}
      </section>

      <section aria-labelledby="steps">
        <h2 id="steps">Commands, in order</h2>
        <ol className="rsteps">
          {steps.map((s) => (
            <li key={s.id} className="card rstep">
              <h3>{s.title}</h3>
              <p className="small muted">{s.why}</p>
              {s.blocks.map((b) => <Block key={b.label ?? "t"} text={b.text} label={b.label} title={s.title} />)}
              {s.notes && <ul className="small stepnotes">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
