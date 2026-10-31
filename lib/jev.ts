// Adapter between the chain and a classifier. Jev returns typed answers, never text, so it only ever
// labels; the letters in lib/letter.ts are templates filled on the patient's device.
//
// Request and response shapes match the working Jev clients in ~/kalshi/bot.py, ~/speedai/Launcher.swift,
// and ~/jev-gmail/jev.js: POST { state, model, questions } with a Bearer key returns
// answers[q].choice + answers[q].probabilities for "choice", and answers[q].noul (a probability) for "noul".

export type Result = { label: string; confidence: number; scores: Record<string, number> };
export type ClassifyOptions = { multiLabel?: boolean; question?: string; criteria?: Record<string, string>; boundary?: { true: string; false: string } };
export type Classify = (text: string, labels: readonly string[], opts?: ClassifyOptions) => Promise<Result[]>;

/** Multi-label: every label at or above 0.5, or the best label when none is. */
function toMulti(scores: Record<string, number>): Result[] {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const chosen = sorted.filter(([, p]) => p >= 0.5);
  return (chosen.length ? chosen : sorted.slice(0, 1)).map(([label, confidence]) => ({ label, confidence, scores }));
}

function toSingle(scores: Record<string, number>): Result[] {
  const [label, confidence] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return [{ label, confidence, scores }];
}

export function jevClient(url: string, key: string, model = "jev-latest"): Classify {
  return async (text, labels, opts = {}) => {
    const describe = (l: string) => opts.criteria?.[l] ?? l;
    const questions = opts.multiLabel
      ? Object.fromEntries(labels.map((l) => [l, { type: "noul", instructions: `${opts.question ?? ""} ${describe(l)}`.trim(), criteria: opts.boundary }]))
      : { pick: { type: "choice", instructions: opts.question ?? "Choose the best label.", criteria: Object.fromEntries(labels.map((l) => [l, describe(l)])) } };

    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: text, model, questions }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`Jev ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const { answers } = await r.json();

    if (!opts.multiLabel) return toSingle(Object.fromEntries(labels.map((l) => [l, Number(answers.pick.probabilities[l] ?? 0)])));
    return toMulti(Object.fromEntries(labels.map((l) => [l, Number(answers[l].noul)])));
  };
}

// ponytail: hand-written keyword weights, not a model. It keeps the demo alive with no key and gives
// the eval a baseline; regex phrases miss wording they have not seen and the /eval page says so.
const NEG = String.raw`(?:no|not|missing|without|lack\w*|absent|never|did not (?:receive|include|contain|show|have)|does not (?:include|contain|show|have)|was not (?:received|provided|included|submitted|on file)|were not (?:received|provided|included|submitted)|could not (?:find|locate|confirm)|unable to (?:find|locate)|fail\w*)`;
const near = (noun: string, gap = 70) => new RegExp(String.raw`${NEG}\b[^.\n]{0,${gap}}(?:${noun})|(?:${noun})[^.\n]{0,${gap}}\b${NEG}`, "i");

const KEYWORDS: Record<string, [RegExp, number][]> = {
  // Payer
  medicare: [[/medicare summary notice|\bMSN\b/i, 3], [/durable medical equipment (?:medicare administrative )?contractor|\bDME MAC\b|medicare administrative contractor/i, 3], [/medicare part b|part b\b/i, 2], [/\bmedicare\b/i, 1.5], [/1-800-MEDICARE/i, 0.5], [/redetermination/i, 1.5]],
  medicare_advantage: [[/medicare advantage|part c\b|\bMA[- ]?(?:PD|plan)\b/i, 4], [/organization determination|integrated denial notice|notice of denial of medical coverage|\bIDN\b/i, 4], [/independent review (?:entity|organization)\b.*medicare|medicare.*\bHMO\b|\bHMO\b.*medicare|\bdual\b/i, 1]],
  medicaid: [[/medicaid/i, 3], [/notice of adverse benefit determination|\bNOABD\b/i, 2], [/fair hearing/i, 2], [/care management organization|managed care organization|\bCMO\b|\bMCO\b|peachcare/i, 2]],
  commercial: [[/employer|group (?:health )?plan|subscriber|policyholder|marketplace|\bERISA\b|summary plan description|certificate of coverage|plan document/i, 3], [/explanation of benefits|\bEOB\b/i, 1.5], [/external review|independent medical review|department of insurance/i, 1.5]],
  unknown: [[/./, 1]],

  // Reasons
  missing_face_to_face_note: [[near("face[- ]to[- ]face|f2f"), 4], [/face[- ]to[- ]face|\bF2F\b/i, 1.5]],
  missing_written_order: [[near("written order|standard written order|\\bSWO\\b|prescription|signed order|physician order|doctor'?s order|order on file"), 4], [/order[^.\n]{0,40}(?:unsigned|incomplete|not signed|invalid|expired)|(?:unsigned|incomplete|invalid)[^.\n]{0,20}order/i, 3.5]],
  not_medically_necessary: [[/not (?:considered )?(?:reasonable and )?(?:medically )?necessary|medical necessity|does not meet[^.\n]{0,30}necess/i, 4], [/medical need/i, 2.5], [/does not (?:fully )?(?:support|meet)|not supported|\bcriteria\b|guideline/i, 1]],
  mobility_exam_insufficient: [[/(?:exam|evaluation|assessment|note)[^.\n]{0,60}(?:insufficient|not sufficient|inadequate|incomplete|too brief|lack\w*|not (?:enough|detailed)|did not (?:show|describe|document|explain|address))/i, 2], [/(?:mobility|functional|physical therap\w*|occupational therap\w*|PT\/OT|specialty)[^.\n]{0,40}(?:evaluation|exam)[^.\n]{0,60}(?:insufficient|inadequate|incomplete|missing|not)/i, 2]],
  home_assessment_missing: [[near("home (?:assessment|evaluation|visit)|on-?site (?:evaluation|assessment|visit)|in-?home"), 4], [/home (?:assessment|evaluation)|on-?site evaluation/i, 1.5]],
  wrong_supplier_or_not_enrolled: [[/(?:supplier|vendor|provider|DMEPOS)[^.\n]{0,60}(?:not enrolled|not (?:approved|accredited|contracted|eligible|authorized|a (?:medicare|medicaid)[- ]?(?:enrolled)?)|revoked|inactive|no longer enrolled|suspended|lapsed)/i, 4], [/(?:enrollment|billing privileges|accreditation)[^.\n]{0,60}(?:revoked|lapsed|expired|inactive|not active)/i, 4]],
  prior_auth_not_obtained: [[near("prior (?:authorization|approval)|pre-?(?:authorization|approval|cert\\w*)|authorization"), 4], [/prior (?:authorization|approval)|pre-?authorization/i, 1], [/authorization[^.\n]{0,50}(?:could not be matched|not matched|expired)/i, 2]],
  same_or_similar_equipment: [[/same or similar|similar equipment|already (?:has|have|received|own|got)|duplicate|reasonable useful lifetime|\bRUL\b|replacement[^.\n]{0,50}(?:not|too soon|before)/i, 4]],
  coding_error: [[/(?:cod(?:e|ing)|HCPCS|modifier|billing)[^.\n]{0,50}(?:error|mistake|incorrect|invalid|wrong|mismatch|does not match|not match|missing)|(?:invalid|incorrect|wrong)[^.\n]{0,30}(?:code|HCPCS|modifier)|billed under[^.\n]{0,40}(?:wrong|incorrect)|unbundl/i, 4]],
  out_of_network: [[/out[- ]of[- ]network|non[- ]?participating|not (?:in|part of)[^.\n]{0,20}network|non-?contracted/i, 4], [/participating[^.\n]{0,40}(?:could not be confirmed|unclear|status)|network status/i, 2]],

  // Appeal level: the level the patient should file next. A word alone is a weak hint; "request X" is strong.
  redetermination: [[/(?:request|ask for|file|asking for)[^.\n]{0,20}redetermination/i, 4], [/redetermination/i, 1], [/\bfirst level\b|level 1\b/i, 1]],
  reconsideration: [[/(?:request|ask for|file|asking for)[^.\n]{0,30}reconsideration/i, 4], [/qualified independent contractor|\bQIC\b/i, 3], [/redetermination (?:decision|was|upheld|result)|decision on your redetermination|unfavorable/i, 2]],
  ALJ: [[/administrative law judge|\bALJ\b|\bOMHA\b|office of medicare hearings/i, 5]],
  internal_appeal: [[/(?:right to|may|can|file an?|request an?|ask for an?)[^.\n]{0,30}(?:internal )?appeal/i, 2], [/internal appeal|plan appeal|plan reconsideration|appeal with (?:the|your) plan/i, 2], [/request a[^.\n]{0,20}reconsideration/i, 2]],
  external_review: [[/external review|independent (?:medical )?review/i, 1.5], [/(?:after|upheld|final)[^.\n]{0,60}(?:internal|plan|your) appeal[^.\n]{0,60}(?:upheld|denied|final|decision)|appeal (?:was|has been) (?:denied|upheld)|final (?:internal )?(?:adverse )?(?:determination|decision)|plan upheld|upheld (?:the|our)/i, 3.5], [/fair hearing/i, 0.5]],

  // Appeal strength keys off the reasons step, which the chain writes into the text.
  strong: [[/Classified reasons:[^\n]*(?:missing_face_to_face_note|missing_written_order|coding_error)/, 3]],
  needs_docs: [[/Classified reasons:[^\n]*(?:not_medically_necessary|mobility_exam_insufficient|home_assessment_missing|prior_auth_not_obtained)/, 3]],
  weak: [[/Classified reasons:[^\n]*(?:same_or_similar_equipment|wrong_supplier_or_not_enrolled|out_of_network)/, 4], [/late|untimely|past the (?:deadline|filing)/i, 2]],
};

const FACT = /PATIENT ANSWER \[(\w+)=(yes|no)\]/g;
const FACT_WEIGHT = 8;

function keywordScore(text: string, label: string) {
  const body = text.replace(/PATIENT ANSWER[^\n]*/g, "");
  let score = (KEYWORDS[label] ?? []).reduce((sum, [re, w]) => sum + (re.test(body) ? w : 0), 0);
  for (const [, l, a] of text.matchAll(FACT)) if (l === label) score += a === "yes" ? FACT_WEIGHT : -FACT_WEIGHT;
  return score;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** No network, no key: the same interface as Jev, scored from phrases in the text. */
export const mockClient: Classify = async (text, labels, opts = {}) => {
  if (opts.multiLabel) {
    return toMulti(Object.fromEntries(labels.map((l) => [l, sigmoid(1.6 * keywordScore(text, l) - 2.4)])));
  }
  const raw = labels.map((l) => keywordScore(text, l));
  const total = raw.reduce((s, x) => s + Math.exp(x), 0);
  return toSingle(Object.fromEntries(labels.map((l, i) => [l, Math.exp(raw[i]) / total])));
};

export type ClientEnv = Record<string, string | undefined>;

export function getClient(env: ClientEnv): { classify: Classify; name: "jev" | "mock" } {
  if (env.JEV_API_URL && env.JEV_API_KEY) return { classify: jevClient(env.JEV_API_URL, env.JEV_API_KEY, env.JEV_MODEL), name: "jev" };
  return { classify: mockClient, name: "mock" };
}
