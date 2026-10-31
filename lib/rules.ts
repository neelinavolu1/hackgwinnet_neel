// Every number in this file carries the regulation it came from. Change a rule here, nowhere else.

export const PAYERS = ["medicare", "medicaid", "medicare_advantage", "commercial", "unknown"] as const;
export const REASONS = [
  "missing_face_to_face_note",
  "missing_written_order",
  "not_medically_necessary",
  "mobility_exam_insufficient",
  "home_assessment_missing",
  "wrong_supplier_or_not_enrolled",
  "prior_auth_not_obtained",
  "same_or_similar_equipment",
  "coding_error",
  "out_of_network",
  "other",
] as const;
export const LEVELS = ["redetermination", "reconsideration", "ALJ", "internal_appeal", "external_review"] as const;
export const STRENGTHS = ["strong", "needs_docs", "weak"] as const;

export type Payer = (typeof PAYERS)[number];
export type Reason = (typeof REASONS)[number];
export type Level = (typeof LEVELS)[number];
export type Strength = (typeof STRENGTHS)[number];

/** Which appeal levels can exist for each payer. Step 3 of the chain only chooses among these. */
export const LEVELS_BY_PAYER: Record<Payer, readonly Level[]> = {
  medicare: ["redetermination", "reconsideration", "ALJ"],
  medicaid: ["internal_appeal", "external_review"],
  medicare_advantage: ["internal_appeal", "external_review"],
  commercial: ["internal_appeal", "external_review"],
  unknown: LEVELS,
};

export type DeadlineRule = {
  /** Name a patient would see. */
  name: string;
  /** Exactly one of days or months. Neither means the plan forwards the case with no patient deadline. */
  days?: number;
  months?: number;
  source: string;
  note?: string;
};

// We always count from the date on the letter. Several of these rules run from the day the patient
// receives the letter, which is presumed to be 5 days later. Counting from the letter date is the
// safe choice: it can only be early, never late.
export const DEADLINES: Partial<Record<Payer, Partial<Record<Level, DeadlineRule>>>> = {
  medicare: {
    // 42 CFR 405.942(a): 120 calendar days from receipt; receipt presumed 5 days after the notice.
    redetermination: { name: "Medicare redetermination (first appeal)", days: 120, source: "42 CFR 405.942(a)" },
    // 42 CFR 405.962(a): 180 calendar days from receipt of the redetermination.
    reconsideration: { name: "Medicare reconsideration (second appeal)", days: 180, source: "42 CFR 405.962(a)" },
    // 42 CFR 405.1014(c)(1): 60 calendar days from receipt of the reconsideration.
    // Amount in controversy for ALJ requests filed in 2026 is $200 (CMS-4209-N, 90 FR, Dec 4 2025).
    ALJ: {
      name: "Hearing with a judge (third appeal)",
      days: 60,
      source: "42 CFR 405.1014(c)(1)",
      note: "In 2026 the amount in dispute must be at least $200.",
    },
  },
  medicare_advantage: {
    // 42 CFR 422.582(b): 60 calendar days after receipt; receipt presumed 5 days after the notice,
    // which CMS states as 65 days from the notice date. We use the safe 60 from the letter date.
    internal_appeal: { name: "Plan reconsideration (first appeal)", days: 60, source: "42 CFR 422.582(b)" },
    // 42 CFR 422.590: when the plan upholds a denial it must forward the case to the independent
    // review entity itself, so there is no patient filing deadline.
    external_review: { name: "Independent review", source: "42 CFR 422.590", note: "Your plan must send your case to independent review for you." },
  },
  medicaid: {
    // 42 CFR 438.402(c)(2)(ii): 60 calendar days from the date on the adverse benefit determination.
    internal_appeal: { name: "Medicaid plan appeal", days: 60, source: "42 CFR 438.402(c)(2)(ii)" },
    // 42 CFR 438.408(f)(2): managed care states set 90 to 120 days. 42 CFR 431.221(d): fee-for-service
    // ceiling is 90 days and a state may set less. We use 90; a shorter number on the letter wins.
    external_review: {
      name: "State fair hearing",
      days: 90,
      source: "42 CFR 438.408(f)(2), 42 CFR 431.221(d)",
      note: "States can set a shorter time. Check your letter.",
    },
  },
  commercial: {
    // 29 CFR 2560.503-1(h)(3)(i), applied to ACA plans by 45 CFR 147.136(b): at least 180 days from receipt.
    internal_appeal: { name: "Internal appeal with your plan", days: 180, source: "45 CFR 147.136(b), 29 CFR 2560.503-1(h)(3)(i)" },
    // 45 CFR 147.136(d)(2)(i): four months after receipt of the final internal denial.
    external_review: { name: "External review", months: 4, source: "45 CFR 147.136(d)(2)(i)" },
  },
};

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function todayIso(now = new Date()) {
  // Local calendar day, not UTC: at 9 PM in Georgia the UTC date is already tomorrow.
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** The patient's own letter is the most specific source there is: "within 60 days of this notice". */
export function statedDays(letter: string) {
  const m = letter.match(/\b(?:within|have|has|up to)\s+(\d{1,3})\s+(?:calendar\s+|business\s+)?days\b/i);
  return m ? Number(m[1]) : null;
}

export type Deadline = { due: string; daysLeft: number; rule: DeadlineRule; usedLetter: boolean };

/** Null means we can't state a date and the UI must say so. A wrong date is worse than none. */
export function computeDeadline(payer: Payer, level: Level, denialDate: string | null, letterDays: number | null, today = todayIso()): Deadline | null {
  const rule = DEADLINES[payer]?.[level];
  if (!rule || !denialDate || (rule.days === undefined && rule.months === undefined)) return null;
  const fromRule = rule.days !== undefined ? addDays(denialDate, rule.days) : addMonths(denialDate, rule.months!);
  const fromLetter = letterDays ? addDays(denialDate, letterDays) : null;
  const usedLetter = !!fromLetter && fromLetter < fromRule;
  const due = usedLetter ? fromLetter : fromRule;
  return { due, daysLeft: daysBetween(today, due), rule, usedLetter };
}

export type Doc = { item: string; from: "Doctor" | "PT/OT" | "Supplier" | "Plan" };

export type ReasonInfo = {
  /** Finishes "You were denied because ___". Must stay near a 6th-grade reading level. */
  because: string;
  /** Finishes "ask ___ for ___". */
  askWho: string;
  askFor: string;
  /** The single clarifying question for this label. */
  question: string;
  docs: Doc[];
  /** Line for the appeal letter, Medicare-specific cites only where they apply. */
  letterLine: string;
  source?: string;
};

export const REASON_INFO: Record<Reason, ReasonInfo> = {
  missing_face_to_face_note: {
    because: "your doctor's visit note was missing",
    askWho: "your doctor",
    askFor: "the note from your visit about how you move",
    question: "Does the letter mention a “face-to-face” visit or exam?",
    docs: [
      { item: "Visit note from your face-to-face exam about how you move. It must be dated in the 6 months before your order.", from: "Doctor" },
      { item: "A signed order written after that visit", from: "Doctor" },
    ],
    letterLine: "The denial says a face-to-face visit note was missing. I am sending the note from my visit with my treating doctor.",
    source: "42 CFR 410.38(d)(2)",
  },
  missing_written_order: {
    because: "a signed order from your doctor was missing",
    askWho: "your doctor",
    askFor: "a signed order",
    question: "Does the letter say a written order or prescription was missing?",
    docs: [{ item: "Written order with your name, the equipment, the date, and your doctor's signature", from: "Doctor" }],
    letterLine: "The denial says a written order was missing. I am sending the signed order from my treating doctor.",
    source: "42 CFR 410.38(d)(1)",
  },
  not_medically_necessary: {
    because: "the plan says your records do not show you need this equipment",
    askWho: "your doctor",
    askFor: "a letter that says why you need it",
    question: "Does the letter say the equipment is not “medically necessary”?",
    docs: [
      { item: "Letter from your doctor saying why you need this equipment and why a cane, walker, or simpler chair will not work", from: "Doctor" },
      { item: "Notes that show the daily tasks you can't do without it", from: "PT/OT" },
    ],
    letterLine: "The denial says this equipment is not medically necessary. My doctor's letter explains why I need it and why simpler equipment will not work.",
    source: "NCD 280.3, LCD L33789",
  },
  mobility_exam_insufficient: {
    because: "your exam notes did not say enough about how you move",
    askWho: "your doctor or therapist",
    askFor: "a full mobility exam",
    question: "Does the letter say your exam or evaluation did not have enough detail?",
    docs: [
      { item: "Full mobility exam: strength, balance, how far you can go, and how you get around at home", from: "Doctor" },
      { item: "Evaluation from a physical or occupational therapist", from: "PT/OT" },
    ],
    letterLine: "The denial says my exam did not have enough detail. I am sending a full mobility exam that shows how I move and what I can't do.",
    source: "LCD L33789",
  },
  home_assessment_missing: {
    because: "no one checked if the equipment fits in your home",
    askWho: "your supplier",
    askFor: "a home check",
    question: "Does the letter talk about a home visit or home assessment?",
    docs: [{ item: "Home check that shows the equipment fits through your doors and rooms", from: "Supplier" }],
    letterLine: "The denial says a home assessment was missing. I am sending the home assessment that shows this equipment works in my home.",
    source: "LCD L33789",
  },
  wrong_supplier_or_not_enrolled: {
    because: "your plan does not accept this supplier",
    askWho: "your supplier",
    askFor: "proof that they can bill your plan",
    question: "Does the letter say the supplier is not enrolled or not approved?",
    docs: [{ item: "Proof the supplier is enrolled, or the name of a new supplier who is", from: "Supplier" }],
    letterLine: "The denial says my supplier was not enrolled. I am sending proof of the supplier's status.",
    source: "42 CFR 424.57",
  },
  prior_auth_not_obtained: {
    because: "no one got approval before you got the equipment",
    askWho: "your supplier",
    askFor: "a prior approval request",
    question: "Does the letter say prior approval or “prior authorization” was missing?",
    docs: [{ item: "Prior approval request, sent with your doctor's notes", from: "Supplier" }],
    letterLine: "The denial says prior authorization was not obtained. I am sending the request and the records that support it.",
  },
  same_or_similar_equipment: {
    because: "your records show you already have similar equipment",
    askWho: "your doctor",
    askFor: "a note on why your old one no longer works",
    question: "Does the letter say you already have the same or similar equipment?",
    docs: [
      { item: "Note on how your needs changed or why your old equipment can't meet them", from: "Doctor" },
      { item: "Repair estimate, or proof it was lost, stolen, or damaged", from: "Supplier" },
    ],
    letterLine: "The denial says I already have similar equipment. My records show my old equipment no longer meets my needs.",
    source: "42 CFR 414.210(f)",
  },
  coding_error: {
    because: "there is a billing code mistake on the claim",
    askWho: "your supplier",
    askFor: "a fixed claim",
    question: "Does the letter talk about a billing code or claim error?",
    docs: [{ item: "Fixed claim with the right billing code", from: "Supplier" }],
    letterLine: "The denial points to a coding error. My supplier is sending a corrected claim.",
  },
  out_of_network: {
    because: "the supplier is not in your plan's network",
    askWho: "your plan",
    askFor: "a list of suppliers in your network",
    question: "Does the letter say the supplier is “out of network”?",
    docs: [
      { item: "List of suppliers in your network", from: "Plan" },
      { item: "Request for an exception if no one in your network can give you this equipment", from: "Supplier" },
    ],
    letterLine: "The denial says the supplier is out of network. I am asking for an exception or a supplier in the network.",
  },
  other: {
    because: "the letter does not give a clear reason",
    askWho: "your plan",
    askFor: "the exact reason in writing",
    question: "Is the reason in your letter hard to pin down, even when you read it slowly?",
    docs: [{ item: "The exact reason for the denial and the rule they used, in writing", from: "Plan" }],
    letterLine: "The denial does not state a clear reason. Please send me the specific reason and the rule you relied on.",
  },
};

export const PAYER_NAME: Record<Payer, string> = {
  medicare: "Original Medicare",
  medicaid: "Medicaid",
  medicare_advantage: "Medicare Advantage",
  commercial: "Job or marketplace insurance",
  unknown: "Not known",
};

export const LEVEL_NAME: Record<Level, string> = {
  redetermination: "Redetermination (first appeal)",
  reconsideration: "Reconsideration (second appeal)",
  ALJ: "Hearing with a judge (third appeal)",
  internal_appeal: "Appeal with your plan",
  external_review: "Outside review",
};

export const STRENGTH_NAME: Record<Strength, string> = { strong: "Strong", needs_docs: "Needs more records", weak: "Hard appeal" };

export const PAYER_QUESTION: Record<Payer, string> = {
  medicare: "Does your card say Original Medicare (red, white, and blue)?",
  medicaid: "Is this insurance from Medicaid?",
  medicare_advantage: "Is this a private Medicare Advantage plan?",
  commercial: "Is this insurance from a job or the marketplace?",
  unknown: "Do you know who your insurance is from?",
};

export const LEVEL_QUESTION: Record<Level, string> = {
  redetermination: "Is this the first denial you got for this equipment?",
  reconsideration: "Is this letter the answer to an appeal you already sent?",
  ALJ: "Have you already lost two appeals for this equipment?",
  internal_appeal: "Is this the first denial you got for this equipment?",
  external_review: "Did your plan already say no to an appeal from you?",
};

export const STRENGTH_QUESTION: Record<Strength, string> = {
  strong: "Do you think your doctor can send the missing paper soon?",
  needs_docs: "Will you need a new exam or new records to fix this?",
  weak: "Did you get the same kind of equipment in the last 5 years?",
};

export const STRENGTH_TEXT: Record<Strength, string> = {
  strong: "Your appeal looks strong. One clear paper could fix this.",
  needs_docs: "Your appeal can work, but you need more records first.",
  weak: "This will be a hard appeal. Talk to a helper before you send it.",
};

export type Helper = { name: string; for: string; phone: string; tel: string; href: string };

/** Numbers checked against shiphelp.org, ndrn.org, and thegao.org on 2026-10-31. */
export const HELPERS: Record<"ship" | "pa" | "gaShip" | "gaPa", Helper> = {
  ship: { name: "SHIP (State Health Insurance Assistance Program)", for: "Free one-on-one Medicare help in every state", phone: "877-839-2675", tel: "+18778392675", href: "https://www.shiphelp.org/" },
  gaShip: { name: "GeorgiaCares (Georgia's SHIP)", for: "If you live in Georgia. Press 4 for Medicare help.", phone: "866-552-4464", tel: "+18665524464", href: "https://www.shiphelp.org/about-medicare/regional-ship-location/georgia" },
  pa: { name: "Protection & Advocacy", for: "Free legal help for people with disabilities. Find your state here.", phone: "State list online", tel: "", href: "https://www.ndrn.org/about/ndrn-member-agencies/" },
  gaPa: { name: "Georgia Advocacy Office (Georgia's P&A)", for: "If you live in Georgia", phone: "800-537-2329", tel: "+18005372329", href: "https://thegao.org/" },
};
