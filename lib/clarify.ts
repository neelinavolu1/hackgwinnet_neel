import { firstUnsure, needsHuman, type ChainResult, type StepName } from "./chain";
import { LEVEL_QUESTION, PAYER_QUESTION, REASON_INFO, STRENGTH_QUESTION, type Level, type Payer, type Reason, type Strength } from "./rules";

export type Question = { step: StepName; label: string; text: string };
export type Answer = "yes" | "no" | "not_sure";

const askFor = (step: StepName, label: string) =>
  step === "payer" ? PAYER_QUESTION[label as Payer]
  : step === "reasons" ? REASON_INFO[label as Reason].question
  : step === "level" ? LEVEL_QUESTION[label as Level]
  : STRENGTH_QUESTION[label as Strength];

/** The one question worth asking: the least certain label in the earliest unsure step. */
export function pickQuestion(chain: ChainResult, threshold: number): Question | null {
  const step = firstUnsure(chain, threshold) ?? (needsHuman(chain, threshold) ? "reasons" : null);
  if (!step) return null;
  const label = chain[step].unsure;
  return { step, label, text: askFor(step, label) };
}

/** Appended to the redacted text so the re-run sees it. "Not sure" adds nothing, so it adds no line. */
export function answerLine(q: Question, answer: Answer) {
  return answer === "not_sure" ? "" : `\n\nPATIENT ANSWER [${q.label}=${answer}]: ${q.text} ${answer}`;
}

/** Yes/no/not sure from a spoken phrase. Null when we couldn't hear a clear answer. */
export function parseAnswer(spoken: string): Answer | null {
  const s = spoken.toLowerCase();
  if (/not sure|don'?t know|unsure|maybe/.test(s)) return "not_sure";
  if (/\b(yes|yeah|yep|correct|right)\b/.test(s)) return "yes";
  if (/\b(no|nope)\b/.test(s)) return "no";
  return null;
}
