import type { Result } from "./jev";
import { LEVELS, LEVELS_BY_PAYER, PAYERS, REASONS, STRENGTHS, type Payer } from "./rules";

export type StepName = "payer" | "reasons" | "level" | "strength";
export const STEP_ORDER: StepName[] = ["payer", "reasons", "level", "strength"];

export const STEPS: Record<StepName, { labels: readonly string[]; multiLabel?: boolean; question: string; criteria: Record<string, string> }> = {
  payer: {
    labels: PAYERS,
    question: "Which kind of insurer sent this DME denial letter? Identifiers are redacted; read the wording and form names.",
    criteria: {
      medicare: "Original Medicare fee-for-service: a Medicare contractor, Medicare Summary Notice, or Medicare Part B",
      medicaid: "State Medicaid or a Medicaid managed care plan: notice of adverse benefit determination, state fair hearing",
      medicare_advantage: "A private Medicare Advantage (Part C) plan: organization determination, integrated denial notice",
      commercial: "Employer, marketplace, or other private insurance that is not Medicare or Medicaid",
      unknown: "The letter does not show which kind of insurer sent it",
    },
  },
  reasons: {
    labels: REASONS,
    multiLabel: true,
    question: "Is this a stated reason the mobility equipment was denied? Answer about reasons the letter gives, not items it says were received.",
    criteria: {
      missing_face_to_face_note: "A required face-to-face visit or its note was missing or not documented",
      missing_written_order: "A written order or prescription was missing, unsigned, or invalid",
      not_medically_necessary: "The item was found not medically necessary or not to meet coverage criteria",
      mobility_exam_insufficient: "An exam or PT/OT evaluation was received but lacked enough detail on mobility or function",
      home_assessment_missing: "A home assessment or on-site evaluation was missing",
      wrong_supplier_or_not_enrolled: "The supplier is not enrolled, accredited, or allowed to bill this payer",
      prior_auth_not_obtained: "Prior authorization was required and not obtained",
      same_or_similar_equipment: "The patient already has the same or similar equipment, or replacement came too soon",
      coding_error: "A billing code, modifier, or claim coding error",
      out_of_network: "The supplier or provider is outside the plan network",
      other: "A reason not covered by the other labels, or no specific reason is given",
    },
  },
  level: {
    labels: LEVELS,
    question: "Which appeal should this patient file next, based on what this letter is and what it offers?",
    criteria: {
      redetermination: "First Medicare appeal, to the Medicare contractor, after an initial denial",
      reconsideration: "Second Medicare appeal, to a Qualified Independent Contractor, after a redetermination was denied",
      ALJ: "Third Medicare appeal, a hearing with an Administrative Law Judge, after a reconsideration was denied",
      internal_appeal: "First appeal with the plan itself, after an initial denial",
      external_review: "Independent or state review, after the plan already denied an internal appeal",
    },
  },
  strength: {
    labels: STRENGTHS,
    question: "How strong is this patient's appeal?",
    criteria: {
      strong: "One or two specific documents would fix it and nothing suggests the patient does not qualify",
      needs_docs: "It can succeed but needs new exams, evaluations, or substantial clinical records",
      weak: "A rule-based bar applies that new records are unlikely to change",
    },
  },
};

export type StepOutcome = {
  labels: string[];
  confidence: number;
  scores: Record<string, number>;
  /** The label the classifier was least sure about: what a clarifying question should target. */
  unsure: string;
};

export type ChainResult = Record<StepName, StepOutcome>;

export type Caller = (step: StepName, text: string, labels: readonly string[]) => Promise<Result[]>;

function outcome(step: StepName, results: Result[]): StepOutcome {
  const scores = results[0].scores;
  if (STEPS[step].multiLabel) {
    // A label at 0.5 is uncertain whether it was picked or not, so unchosen labels count as well.
    const sureness = (l: string) => Math.max(scores[l], 1 - scores[l]);
    const unsure = Object.keys(scores).sort((a, b) => sureness(a) - sureness(b))[0];
    return { labels: results.map((r) => r.label), confidence: sureness(unsure), scores, unsure };
  }
  // "unknown" can't be confirmed by asking, so the question targets the best real label.
  const unsure = Object.entries(scores).filter(([l]) => l !== "unknown").sort((a, b) => b[1] - a[1])[0][0];
  return { labels: [results[0].label], confidence: results[0].confidence, scores, unsure };
}

/** Runs the four steps in order. Later steps see earlier answers, and the payer limits the appeal levels. */
export async function runChain(text: string, call: Caller): Promise<ChainResult> {
  const payer = outcome("payer", await call("payer", text, STEPS.payer.labels));
  const reasons = outcome("reasons", await call("reasons", text, STEPS.reasons.labels));
  const known = `${text}\n\nClassified insurance type: ${payer.labels[0]}`;
  const level = outcome("level", await call("level", known, LEVELS_BY_PAYER[payer.labels[0] as Payer]));
  const strength = outcome("strength", await call("strength", `${known}\nClassified reasons: ${reasons.labels.join(", ")}`, STEPS.strength.labels));
  return { payer, reasons, level, strength };
}

/** The first step under threshold. Earliest wins, because later steps were built on its answer. */
export function firstUnsure(chain: ChainResult, threshold: number) {
  return STEP_ORDER.find((s) => chain[s].confidence < threshold) ?? null;
}

/** A confident "no clear reason" is still no reason: there is nothing specific to appeal. */
export function needsHuman(chain: ChainResult, threshold: number) {
  return firstUnsure(chain, threshold) !== null || chain.reasons.labels.join() === "other";
}

export function chainConfidence(chain: ChainResult) {
  return Math.min(...STEP_ORDER.map((s) => chain[s].confidence));
}
