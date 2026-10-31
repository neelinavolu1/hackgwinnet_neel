import type { Result } from "./jev";
import { LEVELS, LEVELS_BY_PAYER, PAYERS, REASONS, STRENGTHS, type Payer } from "./rules";

export type StepName = "payer" | "reasons" | "level" | "strength";
export const STEP_ORDER: StepName[] = ["payer", "reasons", "level", "strength"];

// Jev reads questions literally and answers each noul alone, so boundaries live here in the criteria.
export const STEPS: Record<StepName, { labels: readonly string[]; multiLabel?: boolean; question: string; criteria: Record<string, string>; boundary?: { true: string; false: string } }> = {
  payer: {
    labels: PAYERS,
    question: "Which kind of insurer sent this denial letter for mobility equipment? Names and numbers are redacted, so judge from the wording, program names, and appeal terms.",
    criteria: {
      medicare: "Original Medicare fee-for-service. Signs: Medicare Summary Notice, Medicare contractor, Medicare Part B, or the appeal terms redetermination, Qualified Independent Contractor, or Administrative Law Judge, which only Original Medicare uses",
      medicaid: "State Medicaid or a Medicaid managed care plan. Signs: the word Medicaid, Notice of Adverse Benefit Determination, state fair hearing, Department of Community Health",
      medicare_advantage: "A private Medicare Advantage (Part C) plan. Signs: Medicare Advantage, organization determination, Integrated Denial Notice, Notice of Denial of Medical Coverage, plan reconsideration",
      commercial: "Employer, marketplace, or other private insurance with no mention of Medicare or Medicaid. Signs: group plan, employer plan, marketplace plan, certificate of coverage, pre-certification, explanation of benefits",
      unknown: "Only when no wording in the letter points to any insurer type above",
    },
  },
  reasons: {
    labels: REASONS.filter((r) => r !== "other"),
    multiLabel: true,
    question: "Does this letter give the following as a reason the equipment was denied:",
    boundary: {
      true: "The letter says this is why the equipment was denied, in any wording. A line starting PATIENT ANSWER is the patient's own answer and settles the question for that label.",
      false: "The letter does not say this, or says this item was received and is fine, or mentions it only as a general rule. A different reason in the letter is not this reason.",
    },
    criteria: {
      missing_face_to_face_note: "a required visit or exam with the treating doctor, or its visit note, is missing? A visit that happened but lacked detail does not count",
      missing_written_order: "a written order or prescription is missing, unsigned, or invalid?",
      not_medically_necessary: "a reviewer decided the item is not medically necessary or does not meet coverage criteria? A missing document on its own does not count",
      mobility_exam_insufficient: "an exam or therapist evaluation was received but lacked detail about mobility or function? A missing visit does not count",
      home_assessment_missing: "a home assessment, home visit, or on-site evaluation of the home is missing?",
      wrong_supplier_or_not_enrolled: "the supplier is not enrolled, not accredited, or not allowed to bill this payer? Being outside a plan network does not count",
      prior_auth_not_obtained: "prior authorization, prior approval, or pre-certification was required and not obtained?",
      same_or_similar_equipment: "the patient already has the same or similar equipment, or replacement came too soon?",
      coding_error: "a billing code, modifier, or claim coding error?",
      out_of_network: "the supplier is outside the plan network or not contracted with the plan? A Medicare enrollment or accreditation problem does not count",
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
    question: "How strong is this patient's appeal? Decide from the classified reasons listed at the end of the text.",
    criteria: {
      strong: "Only paperwork a doctor or supplier can quickly supply: a face-to-face note, a written order, or a billing code fix",
      needs_docs: "Needs new exams or clinical records: medical necessity, a thin mobility exam, a home assessment, or prior authorization. Also any mix where one reason needs new records",
      weak: "Only a rule-based bar that new records are unlikely to change: same or similar equipment, a supplier that is not enrolled, out of network, or a contract exclusion",
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
    // "other" means none of the named reasons applied. Asking it directly can't work: each question is
    // answered alone, so "not covered by the other labels" has nothing to compare against.
    const chosen = results.filter((r) => r.confidence >= 0.5).map((r) => r.label);
    return { labels: chosen.length ? chosen : ["other"], confidence: sureness(unsure), scores, unsure };
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
