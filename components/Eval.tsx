"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import results from "@/data/eval-results.json";

type StepRow = { pred: string[]; gold: string[]; confidence: number; correct: boolean };
type Row = {
  id: string;
  split: string;
  confidence: number;
  correct: boolean;
  steps: Record<string, StepRow>;
  afterQuestion: { confident: boolean; correct: boolean } | null;
};

const rows = results.rows as Row[];
const STEP_LABEL: Record<string, string> = { payer: "Insurance type", reasons: "Denial reasons (all must match)", level: "Appeal level", strength: "Appeal strength" };
const pct = (x: number | null, digits = 0) => (x === null ? "None" : `${(x * 100).toFixed(digits)}%`);

function at(threshold: number) {
  const answered = rows.filter((r) => r.confidence >= threshold);
  const right = answered.filter((r) => r.correct).length;
  return { answered: answered.length, right, coverage: answered.length / rows.length, accuracy: answered.length ? right / answered.length : null };
}

const preds = rows.flatMap((r) => Object.values(r.steps));
const BINS = Array.from({ length: 10 }, (_, i) => {
  const lo = i / 10;
  const inside = preds.filter((p) => p.confidence >= lo && (i === 9 ? p.confidence <= 1 : p.confidence < lo + 0.1));
  return {
    bin: `${i * 10}–${(i + 1) * 10}`,
    n: inside.length,
    actual: inside.length ? (inside.filter((p) => p.correct).length / inside.length) * 100 : null,
    meanConf: inside.length ? inside.reduce((s, p) => s + p.confidence, 0) / inside.length : null,
    perfect: i * 10 + 5,
  };
});
const ECE = BINS.reduce((s, b) => s + (b.n / preds.length) * Math.abs((b.actual ?? 0) / 100 - (b.meanConf ?? 0)), 0);

const CURVE = Array.from({ length: 46 }, (_, i) => {
  const t = 0.5 + i / 100;
  const m = at(t);
  return { t: Math.round(t * 100) / 100, coverage: m.coverage * 100, accuracy: m.accuracy === null ? null : m.accuracy * 100 };
});

// The 14 letters written after the prompts were frozen. This is the number to trust.
const heldOut = rows.filter((r) => r.split === "holdout");
const heldAnswered = heldOut.filter((r) => r.confidence >= 0.75);
const heldRight = heldAnswered.filter((r) => r.correct).length;
const heldFull = heldOut.filter((r) => r.correct).length;
const tuned = rows.length - heldOut.length;

const stuck = rows.filter((r) => r.afterQuestion);
const resolved = stuck.filter((r) => r.afterQuestion?.confident);
const resolvedRight = resolved.filter((r) => r.afterQuestion?.correct);

const legendText = (value: string) => <span style={{ color: "var(--ink)" }}>{value}</span>;
const AXIS = { tick: { fill: "var(--muted)", fontSize: 14 }, stroke: "var(--line)", tickLine: false };

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="card">
      <p className="font-display text-4xl">{value}</p>
      <p className="mt-1 text-base text-muted">{label}</p>
    </div>
  );
}

export function EvalView() {
  const [threshold, setThreshold] = useState(0.75);
  const m = useMemo(() => at(threshold), [threshold]);
  const overall = at(0);
  const isMock = results.client !== "jev";

  return (
    <div className="grid gap-4">
      <div className="panel p-6 sm:p-10">
        <h1 tabIndex={-1} className="mb-3 text-4xl sm:text-5xl">How accurate is it?</h1>
        <p className="max-w-3xl text-muted">
          A confidence number only helps if it is honest. So we ran {rows.length} made-up denial letters through the same steps the app uses, and checked each answer against the right one. No real patient data was used. The charts below use all {rows.length}.
        </p>
        <p className={`mt-4 max-w-3xl rounded-xl p-4 text-base ${isMock ? "bg-warn-bg text-warn" : "bg-good-bg text-good"}`}>
          {isMock
            ? <><strong>Source: {results.model}.</strong> These numbers are from the simple keyword scorer the app uses when no Jev key is set, not from Jev.</>
            : <><strong>Source: {results.model}.</strong> Scored on {results.generatedAt}.</>}{" "}
          This is a small set written by one team, so treat these numbers as rough.
        </p>
        {heldOut.length > 0 && (
          <div className="mt-4 max-w-3xl rounded-xl border border-control p-4">
            <h2 className="mb-1 font-sans text-base font-bold">The honest test</h2>
            <p className="text-base">
              We tuned our questions on {tuned} letters, so scores on those run high. Then we locked the questions and wrote {heldOut.length} new letters. On those new letters, it got {heldFull} of {heldOut.length} fully right. At 75% sure, it answered {heldAnswered.length} and got {heldRight} right. That is {pct(heldRight / heldAnswered.length)}, and the rest stopped to ask.
            </p>
          </div>
        )}

        <div className="mt-6 max-w-xl">
          <label htmlFor="eval-threshold" className="block font-bold">How sure must we be? <output htmlFor="eval-threshold">{pct(threshold)}</output></label>
          <input id="eval-threshold" type="range" min={0.5} max={0.95} step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="h-12 w-full accent-ink" />
        </div>
      </div>

      <section aria-label={`Results when we must be ${pct(threshold)} sure`} aria-live="polite" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={pct(m.accuracy)} label={`Right when it answers (${m.right} of ${m.answered})`} />
        <Stat value={pct(m.coverage)} label={`Letters it answers (${m.answered} of ${rows.length})`} />
        <Stat value={pct(1 - m.coverage)} label="Letters where it stops and asks" />
        <Stat value={pct(overall.accuracy)} label="Right if it never stopped to ask" />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <figure className="card">
          <h2 className="mb-1 text-2xl">Does “80% sure” mean 80% right?</h2>
          <figcaption className="mb-3 text-base text-muted">
            Each bar is a group of {preds.length} answers, grouped by how sure the app was. On the line means the confidence is honest. Below the line means it was too sure. Average gap: {pct(ECE, 1)}.
          </figcaption>
          <div role="img" aria-label={`Reliability chart. Average gap between confidence and accuracy is ${pct(ECE, 1)}. The table below has every value.`}>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart accessibilityLayer={false} data={BINS} margin={{ top: 8, right: 8, bottom: 20, left: 0 }} barCategoryGap="20%">
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="bin" {...AXIS} interval="preserveStartEnd" minTickGap={6} fontSize={12} label={{ value: "How sure the app was (%)", position: "bottom", offset: 2, fill: "var(--muted)", fontSize: 14 }} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...AXIS} width={44} unit="%" />
                <Tooltip formatter={(v, name) => [v === null ? "None" : `${Math.round(Number(v))}%`, name]} labelFormatter={(l) => `Sure: ${l}%`} />
                <Legend verticalAlign="top" align="left" height={32} formatter={legendText} />
                <Bar dataKey="actual" name="Actually right" fill="var(--series-1)" maxBarSize={24} radius={[4, 4, 0, 0]} />
                <Line dataKey="perfect" name="Perfectly honest" stroke="var(--series-2)" strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-3">
            <summary className="btn btn-light w-full">See this as a table</summary>
            <table className="mt-3 w-full text-left text-base">
              <caption className="sr-only">Accuracy by confidence group</caption>
              <thead><tr className="border-b border-line"><th scope="col" className="py-2">Sure</th><th scope="col">Answers</th><th scope="col">Actually right</th></tr></thead>
              <tbody>
                {BINS.filter((b) => b.n).map((b) => (
                  <tr key={b.bin} className="border-b border-line"><th scope="row" className="py-2 font-normal">{b.bin}%</th><td>{b.n}</td><td>{Math.round(b.actual ?? 0)}%</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </figure>

        <figure className="card">
          <h2 className="mb-1 text-2xl">Ask more, get more right</h2>
          <figcaption className="mb-3 text-base text-muted">
            Raise the bar and the app answers fewer letters on its own, but gets more of those right. Move the slider above to see it.
          </figcaption>
          <div role="img" aria-label={`Line chart of the tradeoff. At ${pct(threshold)}, the app answers ${pct(m.coverage)} of letters and is right on ${pct(m.accuracy)} of those. The table below has more values.`}>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart accessibilityLayer={false} data={CURVE} margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="t" type="number" domain={[0.5, 0.95]} ticks={[0.5, 0.6, 0.7, 0.8, 0.9]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...AXIS} label={{ value: "How sure it must be", position: "bottom", offset: 2, fill: "var(--muted)", fontSize: 14 }} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...AXIS} width={44} unit="%" />
                <Tooltip formatter={(v, name) => [v === null ? "None" : `${Math.round(Number(v))}%`, name]} labelFormatter={(l) => `Must be ${Math.round(Number(l) * 100)}% sure`} />
                <Legend verticalAlign="top" align="left" height={32} formatter={legendText} />
                <ReferenceLine x={threshold} stroke="var(--ink)" strokeWidth={1} />
                <Line type="stepAfter" dataKey="accuracy" name="Right when it answers" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="stepAfter" dataKey="coverage" name="Letters it answers" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-3">
            <summary className="btn btn-light w-full">See this as a table</summary>
            <table className="mt-3 w-full text-left text-base">
              <caption className="sr-only">Tradeoff by required confidence</caption>
              <thead><tr className="border-b border-line"><th scope="col" className="py-2">Must be</th><th scope="col">Letters it answers</th><th scope="col">Right when it answers</th></tr></thead>
              <tbody>
                {CURVE.filter((c) => Math.round(c.t * 100) % 5 === 0).map((c) => (
                  <tr key={c.t} className="border-b border-line"><th scope="row" className="py-2 font-normal">{Math.round(c.t * 100)}%</th><td>{Math.round(c.coverage)}%</td><td>{c.accuracy === null ? "None" : `${Math.round(c.accuracy)}%`}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </figure>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="by-step" className="card">
          <h2 id="by-step" className="mb-3 text-2xl">Each step on its own</h2>
          <table className="w-full text-left">
            <caption className="sr-only">Accuracy for each step of the chain with no threshold</caption>
            <thead><tr className="border-b border-line text-base text-muted"><th scope="col" className="py-2 font-normal">Step</th><th scope="col" className="font-normal">Right</th></tr></thead>
            <tbody>
              {Object.keys(STEP_LABEL).map((s) => {
                const right = rows.filter((r) => r.steps[s].correct).length;
                return <tr key={s} className="border-b border-line last:border-0"><th scope="row" className="py-2 font-normal">{STEP_LABEL[s]}</th><td>{right} of {rows.length}</td></tr>;
              })}
            </tbody>
          </table>
        </section>
        <section aria-labelledby="one-q" className="card">
          <h2 id="one-q" className="mb-3 text-2xl">What one question does</h2>
          <p>
            At 75%, the app stopped on {stuck.length} letters. With one true answer, {resolved.length} of those became clear, and {resolvedRight.length} of those {resolved.length} were right.
            The other {stuck.length - resolved.length} went to a person.
          </p>
          <p className="mt-2 text-base text-muted">The answers here were simulated from the correct labels, so this is the best case.</p>
        </section>
      </div>
    </div>
  );
}
