"use client";

import { useState } from "react";
import { firstUnsure, STEP_ORDER, type ChainResult, type StepName } from "@/lib/chain";
import { appealLetter, checklist, doctorNote, EMPTY_PERSONAL, formatDate, ics, readingGrade, summary, type Personal } from "@/lib/letter";
import { speak, stopSpeaking } from "@/lib/speech";
import { computeDeadline, HELPERS, LEVEL_NAME, PAYER_NAME, STRENGTH_NAME, todayIso, type Deadline, type Helper, type Level, type Payer, type Strength } from "@/lib/rules";

export type Case = {
  chain: ChainResult;
  escalated: boolean;
  denialDate: string | null;
  letterDays: number | null;
  equipment: { name: string; code: string | null };
  threshold: number;
  client: string;
};

const STEP_NAME: Record<StepName, string> = { payer: "Insurance type", reasons: "Why it was denied", level: "Your next step", strength: "Your appeal" };

function valueOf(step: StepName, chain: ChainResult) {
  const labels = chain[step].labels;
  if (step === "payer") return PAYER_NAME[labels[0] as Payer];
  if (step === "level") return LEVEL_NAME[labels[0] as Level];
  if (step === "strength") return STRENGTH_NAME[labels[0] as Strength];
  return labels.map((l) => l.replaceAll("_", " ")).join(", ");
}

function Confidence({ chain, threshold }: { chain: ChainResult; threshold: number }) {
  return (
    <section aria-labelledby="sure" className="card">
      <h2 id="sure" className="mb-1 text-2xl">How sure we are</h2>
      <p className="mb-4 text-base text-muted">You asked us to be {Math.round(threshold * 100)}% sure.</p>
      <dl className="grid gap-4">
        {STEP_ORDER.map((s) => {
          const pct = Math.round(chain[s].confidence * 100);
          const low = chain[s].confidence < threshold;
          return (
            <div key={s}>
              <dt className="text-base text-muted">{STEP_NAME[s]}</dt>
              <dd>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-bold first-letter:uppercase">{valueOf(s, chain)}</span>
                  <span className={low ? "font-bold text-warn" : "text-muted"}>{low ? `Not sure, ${pct}%` : `${pct}% sure`}</span>
                </div>
                <div aria-hidden className="mt-1 h-2 overflow-hidden rounded-full bg-chip">
                  <div className={`h-full rounded-full ${low ? "bg-warn" : "bg-ink"}`} style={{ width: `${pct}%` }} />
                </div>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function MonthGrid({ due, today }: { due: string; today: string }) {
  const [y, m, d] = due.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (day: number) => `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const month = first.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
  return (
    <div role="img" aria-label={`Calendar for ${month} ${y}, with ${formatDate(due)} marked as your last day.`}>
      <p className="mb-3 font-bold">{month} <span className="font-normal text-muted">{y}</span></p>
      <div aria-hidden className="grid grid-cols-7 gap-1 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => <span key={i} className="pb-1 text-sm font-bold text-muted">{w}</span>)}
        {Array.from({ length: first.getUTCDay() }, (_, i) => <span key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => i + 1).map((day) => (
          <span key={day} className={`grid aspect-square place-items-center rounded-lg text-base ${day === d ? "bg-ink font-bold text-white" : iso(day) === today ? "border border-control font-bold" : iso(day) > today && iso(day) < due ? "bg-chip" : "text-muted"}`}>
            {day}
          </span>
        ))}
      </div>
    </div>
  );
}

function save(name: string, type: string, data: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function DeadlineCard({ deadline, today }: { deadline: Deadline | null; today: string }) {
  if (!deadline) {
    return (
      <section aria-labelledby="due" className="card">
        <h2 id="due" className="mb-2 text-2xl">Your deadline</h2>
        <p>We can't give you a safe date for this letter. Look for a date in your letter, or call a helper soon. Appeal windows can be short.</p>
      </section>
    );
  }
  const late = deadline.daysLeft < 0;
  return (
    <section aria-labelledby="due" className="panel grid overflow-hidden sm:grid-cols-[1fr_1.1fr]">
      <div className="border-b border-line p-6 sm:border-b-0 sm:border-r">
        <h2 id="due" className="mb-1 text-2xl">Your deadline</h2>
        <p className="text-muted">{deadline.rule.name}</p>
        <p className="font-display mt-4 text-3xl">{formatDate(deadline.due)}</p>
        <p className={`tag mt-2 ${late ? "bg-bad-bg text-bad" : deadline.daysLeft <= 14 ? "bg-warn-bg text-warn" : "bg-good-bg text-good"}`}>
          {late ? `${Math.abs(deadline.daysLeft)} days ago` : `${deadline.daysLeft} days left`}
        </p>
        <p className="mt-4 text-base text-muted">
          {late ? "Some plans take late appeals for a good reason. Call a helper today. " : ""}
          {deadline.usedLetter ? "Your letter gives a shorter time, so we used it. " : ""}
          We count from the date on your letter, so this date is on the safe side. {deadline.rule.note ?? ""}
        </p>
        <p className="mt-1 text-sm text-muted">Rule: {deadline.rule.source}</p>
        <button type="button" className="btn btn-dark mt-4 w-full" onClick={() => save("appeal-deadline.ics", "text/calendar", ics(deadline))}>
          Add to my calendar
        </button>
      </div>
      <div className="p-6"><MonthGrid due={deadline.due} today={today} /></div>
    </section>
  );
}

function Checklist({ chain }: { chain: ChainResult }) {
  return (
    <section aria-labelledby="docs" className="card">
      <h2 id="docs" className="mb-1 text-2xl">What to get</h2>
      <p className="mb-3 text-base text-muted">Check things off as you get them.</p>
      <ul className="grid gap-1">
        {checklist(chain).map((d) => (
          <li key={d.item} className="border-b border-line last:border-0">
            <label className="flex min-h-12 cursor-pointer items-start gap-3 py-3">
              <input type="checkbox" className="tick mt-0.5" />
              <span className="flex-1">{d.item}</span>
              <span className="chip font-sans">{d.from}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CopyBox({ id, title, text, file, note }: { id: string; title: string; text: string; file: string; note: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <section aria-labelledby={id} className="card">
      <h2 id={id} className="mb-1 text-2xl">{title}</h2>
      <p className="mb-3 text-base text-muted">{note}</p>
      <textarea aria-labelledby={id} readOnly value={text} rows={Math.min(22, text.split("\n").length + 2)} className="field font-sans" />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-dark" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <button type="button" className="btn btn-light" onClick={() => save(file, "text/plain", text)}>Download</button>
      </div>
      <span role="status" className="sr-only">{copied ? `${title} copied.` : ""}</span>
    </section>
  );
}

function Details({ p, set }: { p: Personal; set: (p: Personal) => void }) {
  const f = (key: keyof Personal, label: string, autoComplete: string) => (
    <div>
      <label htmlFor={key} className="mb-1 block text-base font-bold">{label}</label>
      <input id={key} className="field" value={p[key]} onChange={(e) => set({ ...p, [key]: e.target.value })} autoComplete={autoComplete} />
    </div>
  );
  return (
    <section aria-labelledby="details" className="card">
      <h2 id="details" className="mb-1 text-2xl">Add your details</h2>
      <p className="mb-4 text-base text-muted">These fill in your letters below. They stay on this device and are never saved or sent.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {f("name", "Your full name", "name")}
        {f("dob", "Your date of birth", "off")}
        {f("memberId", "Member or Medicare number", "off")}
        {f("claimNumber", "Claim number", "off")}
        {f("address", "Your address and phone", "street-address")}
        {f("doctor", "Your doctor's name", "off")}
        {f("appealAddress", "Where to send your appeal", "off")}
        {f("why", "What can't you do without it?", "off")}
      </div>
    </section>
  );
}

function ReadAloud({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-light"
      aria-pressed={on}
      onClick={() => {
        if (on) {
          stopSpeaking();
          setOn(false);
        } else {
          setOn(true);
          speak(text, () => setOn(false));
        }
      }}
    >
      {on ? "Stop reading" : "Read this aloud"}
    </button>
  );
}

function HelperRow({ h }: { h: Helper }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-0">
      <div className="min-w-0 flex-1 basis-64">
        <a href={h.href} target="_blank" rel="noreferrer" className="font-bold text-ink underline">{h.name}</a>
        <p className="text-base text-muted">{h.for}</p>
      </div>
      {h.tel && <a className="btn btn-light" href={`tel:${h.tel}`}>Call {h.phone}</a>}
    </li>
  );
}

function helpersFor(payer: string): Helper[] {
  if (payer === "medicare" || payer === "medicare_advantage") return [HELPERS.ship, HELPERS.gaShip, HELPERS.pa];
  if (payer === "medicaid") return [HELPERS.pa, HELPERS.gaPa, HELPERS.ship];
  return [HELPERS.ship, HELPERS.pa, HELPERS.gaPa];
}

const SOURCE: Record<string, string> = {
  jev: "Scored by Jev.",
  mock: "Demo mode: this used keyword scoring because no Jev key is set.",
  "mock-fallback": "Jev could not be reached, so this used keyword scoring. Results are rougher.",
};

function Escalate({ c, deadline, today }: { c: Case; deadline: Deadline | null; today: string }) {
  const stuck = firstUnsure(c.chain, c.threshold);
  const script = `I got a denial for my ${c.equipment.name}. I can't tell why it was denied. Can you help me find out what to send, and by when?`;
  return (
    <div className="grid gap-4">
      <div className="panel rise p-6 sm:p-10">
        <p className="tag mb-4 bg-warn-bg text-warn">A person can help more here</p>
        <h1 tabIndex={-1} id="result-heading" className="mb-3 text-4xl sm:text-5xl">We are not sure, so we won't guess.</h1>
        <p className="max-w-3xl">
          {stuck
            ? `We could not get sure enough about: ${STEP_NAME[stuck].toLowerCase()}. `
            : "Your letter does not give a clear reason, so there is no specific problem to fix yet. "}
          A wrong answer could cost you your appeal, so please talk to one of these free helpers.
        </p>
        <h2 className="mb-1 mt-6 text-2xl">Who to call</h2>
        <ul>
          {helpersFor(c.chain.payer.labels[0]).map((h) => <HelperRow key={h.name} h={h} />)}
          <li className="py-3">
            <p className="font-bold">Your equipment supplier</p>
            <p className="text-base text-muted">They sent the claim and have the papers. Their number is on your order.</p>
          </li>
        </ul>
        <h2 className="mb-1 mt-6 text-2xl">What to say</h2>
        <p className="max-w-3xl">“{script}”</p>
        <div className="mt-4"><ReadAloud text={`We are not sure, so we won't guess. Please call a free helper. You can say: ${script}`} /></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Confidence chain={c.chain} threshold={c.threshold} />
        <DeadlineCard deadline={deadline} today={today} />
      </div>
    </div>
  );
}

export function Results({ c, onRestart }: { c: Case; onRestart: () => void }) {
  const [personal, setPersonal] = useState<Personal>(EMPTY_PERSONAL);
  const today = todayIso();
  const payer = c.chain.payer.labels[0] as Payer;
  const level = c.chain.level.labels[0] as Level;
  const deadlineSure = c.chain.payer.confidence >= c.threshold && c.chain.level.confidence >= c.threshold;
  const deadline = deadlineSure ? computeDeadline(payer, level, c.denialDate, c.letterDays, today) : null;

  const footer = (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-base text-muted">{SOURCE[c.client] ?? ""}</p>
      <button type="button" className="btn btn-light" onClick={onRestart}>Start over</button>
    </div>
  );

  if (c.escalated) {
    return (
      <>
        <Escalate c={c} deadline={deadline} today={today} />
        {footer}
      </>
    );
  }

  const text = summary(c.chain, deadline);
  return (
    <div className="grid gap-4">
      <div className="panel rise p-6 sm:p-10">
        <p className="mb-2 text-muted">Here is what we found</p>
        <h1 tabIndex={-1} id="result-heading" className="max-w-4xl text-3xl leading-tight sm:text-4xl">{text}</h1>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <ReadAloud text={text} />
          <span className="text-base text-muted">Reading level: grade {Math.max(1, readingGrade(text)).toFixed(1)}</span>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <DeadlineCard deadline={deadline} today={today} />
        <Confidence chain={c.chain} threshold={c.threshold} />
      </div>
      <Checklist chain={c.chain} />
      <Details p={personal} set={setPersonal} />
      <CopyBox id="letter" title="Your appeal letter" note="Fill in anything still in [BRACKETS], then sign it and keep a copy." file="appeal-letter.txt" text={appealLetter(c.chain, personal, c.equipment, c.denialDate, today)} />
      <CopyBox id="note" title="Message your doctor" note="Send this through your patient portal, or read it to the office." file="message-to-doctor.txt" text={doctorNote(c.chain, personal, c.equipment.name, deadline)} />
      {footer}
    </div>
  );
}
