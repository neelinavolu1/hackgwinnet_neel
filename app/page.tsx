"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CASE, DELETED_EVENT } from "@/components/Chrome";
import { Results, type Case } from "@/components/Results";
import { Review } from "@/components/Review";
import { needsHuman, runChain, type Caller, type ChainResult } from "@/lib/chain";
import { answerLine, parseAnswer, pickQuestion, type Answer, type Question } from "@/lib/clarify";
import { DEMOS } from "@/lib/demos";
import { findEquipment } from "@/lib/letter";
import { readFile } from "@/lib/ocr";
import { redact } from "@/lib/redaction";
import { statedDays } from "@/lib/rules";
import { listen, voiceMode, type VoiceMode } from "@/lib/speech";

type Stage = "input" | "review" | "working" | "clarify" | "result";

const STEPS = ["Your letter", "Check what leaves", "Your plan"];
const stepIndex: Record<Stage, number> = { input: 0, review: 1, working: 1, clarify: 2, result: 2 };

function Stepper({ stage }: { stage: Stage }) {
  return (
    <ol className="mb-4 flex flex-wrap gap-x-5 gap-y-1 px-1">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={stepIndex[stage] === i ? "step" : undefined} className={`flex items-center gap-2 text-base ${stepIndex[stage] === i ? "font-bold text-ink" : "text-muted"}`}>
          <span className={stepIndex[stage] === i ? "chip bg-ink text-white" : "chip"}>{String(i + 1).padStart(2, "0")}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

const Chevron = () => (
  <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3l5 5-5 5" />
  </svg>
);

export default function Home() {
  const [stage, setStage] = useState<Stage>("input");
  const [raw, setRaw] = useState("");
  const [hide, setHide] = useState<string[]>([]);
  const [dateEdit, setDateEdit] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.75);
  const [question, setQuestion] = useState<Question | null>(null);
  const [firstRun, setFirstRun] = useState<ChainResult | null>(null);
  const [saved, setSaved] = useState<Case | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [ocr, setOcr] = useState<number | null>(null);
  const [voiceWarn, setVoiceWarn] = useState<null | "letter">(null);
  const [listening, setListening] = useState<null | "letter" | "answer">(null);
  const stopVoice = useRef<() => void>(() => {});
  const client = useRef("mock");
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const redaction = useMemo(() => redact(raw, hide), [raw, hide]);
  const denialDate = dateEdit ?? redaction.denialDate ?? "";

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CASE);
      if (stored) {
        setSaved(JSON.parse(stored));
        setStage("result");
      }
    } catch {}
    const onDelete = () => reset("Your letter and results were deleted from this device.");
    window.addEventListener(DELETED_EVENT, onDelete);
    return () => window.removeEventListener(DELETED_EVENT, onDelete);
  }, []);

  // Moves keyboard and screen reader users to the new step instead of leaving them on a removed button.
  useEffect(() => {
    if (!moved.current) return;
    (stage === "result" ? document.getElementById("result-heading") : heading.current)?.focus();
    window.scrollTo({ top: 0 });
  }, [stage]);

  function go(next: Stage) {
    moved.current = true;
    setStage(next);
  }

  function reset(message = "") {
    stopVoice.current();
    setRaw("");
    setHide([]);
    setDateEdit(null);
    setQuestion(null);
    setFirstRun(null);
    setSaved(null);
    setError("");
    setStatus(message);
    go("input");
  }

  const call: Caller = async (step, text, labels) => {
    const r = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, text, labels }),
    });
    if (!r.ok) throw new Error(`classify ${r.status}`);
    const body = await r.json();
    client.current = body.client;
    return body.results;
  };

  function finish(chain: ChainResult, escalated: boolean) {
    const c: Case = {
      chain,
      escalated,
      denialDate: denialDate || null,
      letterDays: statedDays(raw),
      equipment: findEquipment(raw),
      threshold,
      client: client.current,
    };
    setSaved(c);
    try {
      // Labels and the date only. The letter itself, even redacted, is not kept.
      localStorage.setItem(CASE, JSON.stringify(c));
    } catch {}
    setStatus(escalated ? "We are not sure. Here is who can help." : "Your results are ready.");
    go("result");
  }

  async function analyze() {
    setError("");
    setStatus("Checking your letter. This takes a few seconds.");
    go("working");
    try {
      const chain = await runChain(redaction.redacted, call);
      if (!needsHuman(chain, threshold)) return finish(chain, false);
      setFirstRun(chain);
      setQuestion(pickQuestion(chain, threshold));
      setStatus("We have one question for you.");
      go("clarify");
    } catch {
      setError("We could not reach the checker. Your letter was not saved. Please try again.");
      go("review");
    }
  }

  async function answer(a: Answer) {
    stopVoice.current();
    if (!question || !firstRun) return;
    // "Not sure" adds no new fact, so a re-run could not change the outcome.
    if (a === "not_sure") return finish(firstRun, true);
    setStatus("Thanks. Checking again.");
    go("working");
    try {
      const chain = await runChain(redaction.redacted + answerLine(question, a), call);
      finish(chain, needsHuman(chain, threshold));
    } catch {
      setError("We could not reach the checker. Please try again.");
      go("clarify");
    }
  }

  async function upload(file: File) {
    setError("");
    setOcr(0);
    setStatus("Reading your letter on this device.");
    try {
      setRaw(await readFile(file, setOcr));
      setStatus("Your letter is ready. Check the text, then continue.");
    } catch {
      setError("We could not read that file. Try a clearer photo, or paste the text.");
    }
    setOcr(null);
  }

  async function startDictation(mode?: VoiceMode) {
    if (listening) return stopVoice.current();
    const m = mode ?? (await voiceMode());
    if (m === "none") return setError("Your browser does not support voice input. Try Chrome or Edge, or paste the text.");
    if (m === "cloud" && !mode) return setVoiceWarn("letter");
    setVoiceWarn(null);
    setError("");
    setListening("letter");
    setStatus("Listening. Press stop when you are done.");
    stopVoice.current = listen(m, (t) => setRaw((old) => `${old}${old ? " " : ""}${t}`), () => {
      setListening(null);
      setStatus("Stopped listening.");
    });
  }

  async function answerByVoice() {
    if (listening) return stopVoice.current();
    const m = await voiceMode();
    if (m === "none") return setError("Your browser does not support voice input. Please use the buttons.");
    setListening("answer");
    setStatus("Listening for yes, no, or not sure.");
    stopVoice.current = listen(m, (t) => {
      const a = parseAnswer(t);
      if (a) answer(a);
      else setStatus("Sorry, we did not catch that. Say yes, no, or not sure.");
    }, () => setListening(null));
  }

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">{status}</div>

      {stage === "input" && (
        <>
          <div className="panel grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_1.1fr] lg:gap-12 lg:p-14">
            <div>
              <p className="tag mb-5 border-line text-ink">No account. Nothing stored on a server.</p>
              <h1 tabIndex={-1} ref={heading} className="mb-4 text-5xl sm:text-6xl">Your equipment was denied. Let's find out why.</h1>
              <p className="mb-6 text-muted">Add your denial letter. We show you what is missing, who to ask, and when your appeal is due. Then we help you write it.</p>
              <h2 className="mb-2 font-sans text-base font-bold">Try a sample letter</h2>
              <div className="grid gap-2">
                {DEMOS.map((d) => (
                  <button key={d.id} type="button" className="btn btn-light w-full justify-between text-left" onClick={() => { setRaw(d.text); setHide([]); setDateEdit(null); go("review"); }}>
                    <span>
                      {d.title}
                      <span className="block text-base font-normal text-muted">{d.hint}</span>
                    </span>
                    <Chevron />
                  </button>
                ))}
              </div>
            </div>

            <section aria-labelledby="yours" className="rounded-xl border border-line p-5 sm:p-6">
              <h2 id="yours" className="mb-1 text-2xl">Your denial letter</h2>
              <p className="mb-3 text-base text-muted">Photos and PDFs are read here, on your device.</p>
              <label htmlFor="letter-text" className="mb-1 block font-bold">Paste the text</label>
              <textarea id="letter-text" className="field" rows={9} value={raw} onChange={(e) => setRaw(e.target.value)} />

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="btn btn-light cursor-pointer focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--focus)]">
                  <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
                  Upload a photo or PDF
                </label>
                <button type="button" className="btn btn-light" aria-pressed={listening === "letter"} onClick={() => startDictation()}>
                  {listening === "letter" ? "Stop listening" : "Speak your letter"}
                </button>
              </div>

              {ocr !== null && (
                <div className="mt-3">
                  <label htmlFor="ocr" className="text-base text-muted">Reading your letter on this device</label>
                  <progress id="ocr" className="block w-full accent-ink" max={100} value={Math.round(ocr * 100)} />
                </div>
              )}

              {voiceWarn && (
                <div className="mt-3 rounded-xl border border-warn bg-warn-bg p-4 text-base text-warn">
                  <p className="mb-2 font-bold">Voice may leave your device.</p>
                  <p className="mb-3">This browser may send your voice to its speech service. Please don't say your name, birthday, or ID numbers out loud.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-dark" onClick={() => startDictation("cloud")}>Use voice anyway</button>
                    <button type="button" className="btn btn-light" onClick={() => setVoiceWarn(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {error && <p role="alert" className="mt-3 rounded-xl bg-bad-bg p-3 text-base text-bad">{error}</p>}

              <button type="button" className="btn btn-dark mt-3 w-full" disabled={!raw.trim()} onClick={() => go("review")}>
                Continue <Chevron />
              </button>
            </section>
          </div>

          <ul className="mt-4 grid gap-4 md:grid-cols-3">
            {[
              ["01", "We read it here", "Your letter is read on your device. We take out your name, numbers, and dates."],
              ["02", "You check it", "You see what leaves your device, side by side, and you press send."],
              ["03", "You get a plan", "What's missing, who to ask, your due date, and a letter ready to sign."],
            ].map(([n, title, text]) => (
              <li key={n} className="card">
                <span aria-hidden className="chip mb-3">{n}</span>
                <h2 className="mb-1 text-xl">{title}</h2>
                <p className="text-muted">{text}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {stage === "review" && (
        <>
          <Stepper stage={stage} />
          <div className="panel rise p-6 sm:p-10">
            <h1 tabIndex={-1} ref={heading} className="mb-2 text-4xl sm:text-5xl">What leaves your device</h1>
            <Review raw={raw} r={redaction} onHide={(w) => w.trim() && setHide((h) => [...h, w])} denialDate={denialDate} onDenialDate={setDateEdit} threshold={threshold} onThreshold={setThreshold} />
            {error && <p role="alert" className="mt-4 rounded-xl bg-bad-bg p-3 text-base text-bad">{error}</p>}
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" className="btn btn-dark flex-1 sm:flex-none" onClick={analyze}>Send the right side only <Chevron /></button>
              <button type="button" className="btn btn-light" onClick={() => go("input")}>Go back</button>
            </div>
          </div>
        </>
      )}

      {stage === "working" && (
        <>
          <Stepper stage={stage} />
          <div className="panel flex items-center gap-4 p-6 sm:p-10">
            <div className="spinner" aria-hidden />
            <h1 tabIndex={-1} ref={heading} className="text-3xl">Checking your letter</h1>
          </div>
        </>
      )}

      {stage === "clarify" && question && (
        <>
          <Stepper stage={stage} />
          <div className="panel rise p-6 sm:p-10">
            <p className="tag mb-4 bg-warn-bg text-warn">One question</p>
            <h1 tabIndex={-1} ref={heading} className="mb-3 max-w-3xl text-4xl sm:text-5xl">{question.text}</h1>
            <p className="mb-6 text-muted">We were not sure enough to answer yet. Your answer helps us get it right. Look at your letter if you need to.</p>
            <div className="grid max-w-2xl gap-2 sm:grid-cols-3">
              <button type="button" className="btn btn-dark" onClick={() => answer("yes")}>Yes</button>
              <button type="button" className="btn btn-dark" onClick={() => answer("no")}>No</button>
              <button type="button" className="btn btn-light" onClick={() => answer("not_sure")}>Not sure</button>
            </div>
            <button type="button" className="btn btn-light mt-2" aria-pressed={listening === "answer"} onClick={answerByVoice}>
              {listening === "answer" ? "Stop listening" : "Answer out loud"}
            </button>
            {error && <p role="alert" className="mt-4 rounded-xl bg-bad-bg p-3 text-base text-bad">{error}</p>}
          </div>
        </>
      )}

      {stage === "result" && saved && <Results c={saved} onRestart={() => { try { localStorage.removeItem(CASE); } catch {} reset(); }} />}
    </>
  );
}
