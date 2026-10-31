"use client";

import { useState } from "react";
import type { Redaction } from "@/lib/redaction";

const NAMES: Record<string, string> = {
  NAME: "name", DATE: "date", DENIAL_DATE: "denial date", ID: "ID number", PHONE: "phone number", EMAIL: "email",
  ADDRESS: "address", CITY: "city or county", ZIP: "ZIP code", SSN: "Social Security number", URL: "web link",
  IP: "IP address", AGE_90_PLUS: "age", HIDDEN: "hidden word",
};

function Original({ text, r }: { text: string; r: Redaction }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  r.spans.forEach((s, i) => {
    parts.push(text.slice(at, s.start), <mark className="removed" key={i}>{s.original}</mark>);
    at = s.end;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function Outbound({ text }: { text: string }) {
  return <>{text.split(/(\[[A-Z0-9_]+\])/).map((part, i) => (i % 2 ? <mark className="token" key={i}>{part}</mark> : part))}</>;
}

type Props = {
  raw: string;
  r: Redaction;
  onHide: (word: string) => void;
  denialDate: string;
  onDenialDate: (iso: string) => void;
  threshold: number;
  onThreshold: (t: number) => void;
};

export function Review({ raw, r, onHide, denialDate, onDenialDate, threshold, onThreshold }: Props) {
  const [word, setWord] = useState("");
  const counts = Object.entries(r.counts).map(([k, n]) => `${n} ${NAMES[k] ?? "item"}${n > 1 && !NAMES[k]?.endsWith("s") ? "s" : ""}`);

  return (
    <>
      <p className="mb-5 text-muted">
        {counts.length ? `We removed ${counts.join(", ")}. ` : "We found nothing to remove. Check it closely. "}
        Only the right side is sent. Look it over first.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-line">
          <h2 id="stays" className="border-b border-line bg-bg px-4 py-3 font-sans text-base font-bold">Stays on your device</h2>
          <div className="sheet" tabIndex={0} role="region" aria-labelledby="stays"><Original text={raw} r={r} /></div>
        </div>
        <div className="overflow-hidden rounded-xl border border-control">
          <h2 id="leaves" className="border-b border-line bg-bg px-4 py-3 font-sans text-base font-bold">What leaves your device</h2>
          <div className="sheet" tabIndex={0} role="region" aria-labelledby="leaves"><Outbound text={r.redacted} /></div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onHide(word);
            setWord("");
          }}
        >
          <label htmlFor="hide" className="mb-1 block font-bold">See something we missed?</label>
          <div className="flex gap-2">
            <input id="hide" className="field" value={word} onChange={(e) => setWord(e.target.value)} placeholder="Type it here" autoComplete="off" />
            <button type="submit" className="btn btn-light" disabled={!word.trim()}>Hide</button>
          </div>
        </form>

        <div>
          <label htmlFor="denial" className="mb-1 block font-bold">Date on your letter</label>
          <input id="denial" type="date" className="field" value={denialDate} onChange={(e) => onDenialDate(e.target.value)} aria-describedby="denial-help" />
          <p id="denial-help" className="mt-1 text-base text-muted">This stays here. We use it to count your deadline.</p>
        </div>

        <div>
          <label htmlFor="threshold" className="mb-1 block font-bold">How sure must we be? <output htmlFor="threshold">{Math.round(threshold * 100)}%</output></label>
          <input id="threshold" type="range" min={0.5} max={0.95} step={0.05} value={threshold} onChange={(e) => onThreshold(Number(e.target.value))} className="h-12 w-full accent-ink" aria-describedby="threshold-help" />
          <p id="threshold-help" className="text-base text-muted">Below this, we ask you a question or send you to a person.</p>
        </div>
      </div>
    </>
  );
}
