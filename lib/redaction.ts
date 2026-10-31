// Local redaction. Runs in the browser before anything leaves the device, and again on the server as
// a second check. It fails closed: when unsure, it removes the text. Over-redaction costs a little
// accuracy; under-redaction leaks a patient's identity. The patient also reviews the result and can
// hide more words before pressing send, because no rule set catches every name.
//
// HIPAA Safe Harbor, 45 CFR 164.514(b)(2)(i): the 18 identifiers and how each is handled here.
//
//  #  Identifier                                Rule below, or how it is handled
//  1  Names                                     labeled fields, salutations, honorifics, credentials,
//                                               Title Case and ALL CAPS name shapes, then every part of
//                                               a found name is removed wherever else it appears
//  2  Geography smaller than a state            street addresses, PO boxes, units, City ST, counties, ZIP
//  3  Date elements except year; ages over 89   every date form, including the denial date (kept on the
//                                               device only, see below); ages 90 and up
//  4  Telephone numbers                         phone rule
//  5  Fax numbers                               phone rule
//  6  Email addresses                           email rule
//  7  Social Security numbers                   SSN rule
//  8  Medical record numbers                    labeled ID rule (MRN, medical record)
//  9  Health plan beneficiary numbers           MBI shape, labeled ID rule (member, Medicare, Medicaid)
// 10  Account numbers                           labeled ID rule, long-number rule
// 11  Certificate or license numbers            labeled ID rule, mixed-ID rule
// 12  Vehicle identifiers and plates            labeled ID rule (VIN, plate), mixed-ID rule
// 13  Device identifiers and serial numbers     labeled ID rule (serial, device), mixed-ID rule
// 14  Web URLs                                  URL rule (.gov pages are kept: they name no one)
// 15  IP addresses                              IP rule
// 16  Biometric identifiers                     not in letter text; voice is covered in lib/speech.ts
// 17  Full-face photographs                     uploaded images are read on the device and never sent
// 18  Any other unique identifying number       long-number rule, mixed-ID rule, patient's "hide this" box
//
// The denial date: Safe Harbor #3 covers it, so a full date can't leave the device and still count as
// de-identified. The classifier doesn't need it. It is read here, kept in the browser, used for the
// deadline there, and sent only as the token [DENIAL_DATE].

export type Span = { start: number; end: number; kind: string; original: string };
export type Redaction = { redacted: string; spans: Span[]; denialDate: string | null; counts: Record<string, number> };

const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const DATE = String.raw`(?:\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b|\b${MONTH}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}\.?(?:,?\s+\d{4})?\b|\b${MONTH}\.?,?\s+(?:19|20)\d{2}\b)`;
const STREET = String.raw`(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way|Circle|Cir|Place|Pl|Highway|Hwy|Parkway|Pkwy|Terrace|Ter|Trail|Trl|Loop|Pike)`;
const STATE = String.raw`(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)`;
const ANY_STATE = `(?:${STATE}|${STATE.toUpperCase().replaceAll("(?:", "(?:")})`;
// One name word: "Alvarez", "O'Neil", "McKinley", "Okafor-Reyes", "ALVAREZ".
const NW = String.raw`[A-Z][A-Za-z'’]*(?:-[A-Z][A-Za-z'’]+)?`;
// Words of a name sit one space apart. A wider gap is a column break in a form, not more name.
const NAME = String.raw`${NW}(?: [A-Z]\.?(?=\s))?(?: ${NW}){0,3}(?:,? (?:Jr|Sr|II|III|IV)\b\.?)?`;
const ID_LABEL = String.raw`(?:member|subscriber|policy|group|claim|reference|ref|case|account|acct|medical record|record|chart|mrn|health plan|plan|hicn|mbi|medicare|medicaid|beneficiary|enrollee|recipient|authorization|auth|certificate|license|licence|npi|ptan|serial|device|vehicle|vin|plate|control|icn|tracking|confirmation|appeal|prior auth|document|id|identification)`;
const PERSON_LABEL = String.raw`(?:patient|member|beneficiary|enrollee|insured|subscriber|policyholder|applicant|recipient|guardian|parent|spouse|caregiver|representative|employer|name|patient name|member name|beneficiary name|enrollee name|subscriber name|insured name|to|attn|attention|prepared for|c\/o|care of|cc|from|ordering (?:provider|physician|practitioner)|prescriber|physician|provider|treating (?:provider|physician|practitioner)|therapist|signed by)`;

// `sure` marks a rule whose context proves a person follows: "Mrs. Long" is a name even though "long"
// is an ordinary word. Softer rules skip values made only of ordinary words.
type Rule = { kind: string; re: RegExp; sure?: boolean };

// Earlier rules win where matches overlap. A named group `v` limits the match to the value, so the
// label ("Member ID:") survives for the classifier and for the reader of the side-by-side panel.
const RULES: Rule[] = [
  { kind: "EMAIL", re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  { kind: "URL", re: /\b(?:https?:\/\/|www\.)(?![\w.-]*\.gov\b)[^\s)>\]]+|\b(?![\w.-]*\.gov\b)[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|info|health)\b(?:\/[^\s)>\]]*)?/gi },
  { kind: "IP", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { kind: "SSN", re: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g },
  { kind: "SSN", re: new RegExp(String.raw`\b(?:ssn|social security(?: number| no\.?)?)\b[\s:#]*(?<v>[\dXx*-]{4,11})`, "gid") },
  // Medicare Beneficiary Identifier, 11 characters with fixed letter and digit positions.
  { kind: "ID", re: /\b[1-9][A-Z][A-Z0-9]\d[- ]?[A-Z][A-Z0-9]\d[- ]?[A-Z]{2}\d{2}\b/gi },
  { kind: "DATE", re: new RegExp(DATE, "gi") },
  { kind: "PHONE", re: /(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b(?:\s*(?:x|ext\.?)\s*\d+)?/gi },
  { kind: "ID", re: new RegExp(String.raw`\b${ID_LABEL}\b(?:\s+(?:id|identification|no\.?|number|num|nbr|#))*\s*[:#]?\s*#?\s*(?<v>(?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{3,})`, "gid") },
  { kind: "ADDRESS", re: new RegExp(String.raw`\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9.'’-]+\s+){0,4}?${STREET}\b\.?(?:\s+(?:NE|NW|SE|SW|N|S|E|W)\b)?(?:,?\s*(?:Apt|Apartment|Unit|Suite|Ste|Bldg|Building|Floor|Fl|#)\.?\s*#?[\w-]+)?`, "gi") },
  { kind: "ADDRESS", re: /\b(?:P\.?\s?O\.?\s?Box|Post Office Box)\s+\d+\b/gi },
  { kind: "ADDRESS", re: /\b(?:Apt|Apartment|Unit|Suite|Ste)\.?\s*#?\s*\d[\w-]*\b/gi },
  // Needs a comma or a ZIP, because "Member ID" otherwise reads as a town in Idaho.
  { kind: "CITY", re: new RegExp(String.raw`\b[A-Z][A-Za-z.'’-]+(?:[ \t]+[A-Z][A-Za-z.'’-]+){0,2}(?:,[ \t]*${ANY_STATE}\b(?:[ \t]+\d{5}(?:-\d{4})?)?|[ \t]+${ANY_STATE}[ \t]+\d{5}(?:-\d{4})?)`, "g") },
  { kind: "CITY", re: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:County|Parish)\b/g },
  { kind: "ZIP", re: /\b\d{5}(?:-\d{4})?\b/g },
  { kind: "AGE_90_PLUS", re: /\b(?:9\d|1[01]\d)[- ]?(?:years?|yrs?|y\/?o)\b(?:[- ]old)?/gi },
  { kind: "NAME", re: new RegExp(String.raw`\b(?:Mr|Mrs|Ms|Mx|Miss|Dr|Doctor|Prof)\.?\s+(?<v>${NAME})`, "gd"), sure: true },
  { kind: "NAME", re: new RegExp(String.raw`\b(?:Dear|Hello|Hi)\s+(?:(?:Mr|Mrs|Ms|Mx|Miss|Dr)\.?\s+)?(?!(?:Mr|Mrs|Ms|Mx|Miss|Dr)\b)(?<v>${NAME})`, "gd"), sure: true },
  { kind: "NAME", re: new RegExp(String.raw`\b(?:${PERSON_LABEL})\b(?:\s+name)?\s*[:#-]\s*(?<v>${NAME})`, "gid") },
  { kind: "NAME", re: new RegExp(String.raw`(?<v>${NW}(?:\s+[A-Z]\.?)?\s+${NW}(?:\s+${NW})?),\s*(?:MD|DO|NP|PA-?C?|DPT|PT|OT|OTR(?:\/L)?|RN|ATP|PhD|ARNP|APRN|CRNP)\b`, "gd") },
  { kind: "NAME", re: new RegExp(String.raw`(?:Sincerely|Regards|Respectfully|Thank you)[,.]?\s*\n+\s*(?<v>${NAME})`, "gid") },
  { kind: "ID", re: /(?<![\w-])\d{6,}(?![\w-])/g },
  { kind: "ID", re: /(?<![\w-])(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9-]{6,}(?![\w-])/g },
];

// Words that look like names by shape but carry the meaning of the letter. Lowercase; Title Case or
// ALL CAPS runs are checked against this. A miss here over-redacts, which is the safe direction.
const SAFE = new Set(
  `a about above across action additional address adverse after again against agency all allowed also an and any appeal appeals applicable application approval approve approved are as assessment assistance at attached authorization authorized available
  bcbs be because been before below benefit benefits bill billed billing blue board box business but by
  call can cannot care case center centers certificate chair change changes chief circle claim claims clinical code codes community company complete compliance consumer contact contractor contractors copy copies county court coverage covered criteria cross customer
  date dates day days dear decision decisions denial denials denied department description determination details device devices did disability disabled division dme dmepos do doctor document documentation documents does done durable
  each effective electric eligibility emergency employee employer employers enclosed encounter encounters end enrolled enrollee enrollment entity equipment evaluation evidence exam examination exception exceptions expedited explanation external
  face face-to-face fact facts failed fair family fast federal fee fee-for-service file filed filing final find first follow for form forms found from full functional
  general georgia get give go government group groups guide
  had has have health healthcare hearing hearings help here home hospital how
  i if ii iii important in independent individual information initial insurance insured insurer integrated internal is issue issued it item items its iv
  judge just
  last law legal letter level levels life lightweight limitation limited line lines local location long
  mail mailing mailed make management managed manual many may mac medicaid medical medicare member members mental method mobility more most motorized must my
  name national necessary necessity need needed needs network new next no non-covered not note notes notice notices now number
  occupational of off office officer official on one only open operated operations or order orders organization other our out out-of-network over own
  page paid part partners patient patients pay payer payment payments pending person personal phone physical physician physicians place plan plans please policy power practitioner practitioners pre-service prescription prior privacy private procedure process program programs protection provider providers public purchase
  qualified quality questions quick
  read reason reasons receive received recent reconsideration record records redetermination reference regarding regional related relations rental repair replacement report representative request requested requests required requirement requirements resolution resource resources response result results review reviewed reviewer reviews right rights rule rules
  safety same scooter second section see seating send sent service services shall should sign signature signed similar social solutions special specialist specialty standard state states statement status submit submitted subscriber summary supplier suppliers supplies supply support supporting system systems
  table take team telephone terms than thank that the their them then there these they third this those three through time times title to today total treating treatment two type types
  under unit united university until up urgent us use used user utilization
  value very visit
  walker walkers wants was we well were what wheelchair wheelchairs when where which while who why will with within without work works would write written
  year years yes you your
  january february march april june july august september october november december monday tuesday wednesday thursday friday saturday sunday
  advantage beneficiary beneficiaries director security act hmo ppo epo pos snp rollator tilt tilt-in-space ultra
  aetna anthem cigna humana kaiser unitedhealthcare wellcare amerigroup caresource centene molina oscar
  dme hcpcs icd npi cms hhs ship qic alj omha mbi msn eob noabd idn lcd ncd swo f2f pt ot ptp atp ms als cva copd sci cp`
    .split(/\s+/),
);

const isSafe = (w: string) => SAFE.has(w.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""));

// HCPCS, LCD, and form numbers look like IDs, but they name a rule or a product, not a person.
const KEEP_ID = /^(?:[A-Z]\d{4}(?:-[A-Z0-9]{2})?|L\d{5}|A\d{5}|CMS-\d+[A-Z]?|ICN\d+-?[A-Z]*|\d+(?:-\d+)*-(?:month|day|year|point|page|week|hour)s?)$/i;
const FORM = /^(?:face-to-face|out-of-network|in-network|fee-for-service|non-covered|1-800-MEDICARE)$/i;

const ORG = /\b(?:member|beneficiary|subscriber|patient|enrollee|id|health|plan|medical|medicare|medicaid|insurance|care|group|supply|services?|inc|llc|company|center|hospital|clinic|contractor|department|office|notice|director|determination|benefits?|coverage|appeals?)\b/i;

function findNameShapes(text: string): Span[] {
  const spans: Span[] = [];
  const add = (start: number, end: number) => spans.push({ start, end, kind: "NAME", original: text.slice(start, end) });

  // Runs of capitalized words where two neighbors are both unknown: "Harold McKinley", "MARIA ALVAREZ".
  const words = [...text.matchAll(/[A-Z][A-Za-z'’]*(?:-[A-Za-z'’]+)*\.?/g)];
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i];
    const b = words[i + 1];
    const between = text.slice(a.index + a[0].length, b.index);
    if (!/^[ \t]+$/.test(between)) continue;
    if (isSafe(a[0]) || isSafe(b[0]) || a[0].length < 2) continue;
    add(a.index, b.index + b[0].length);
  }

  // A line that is nothing but a name, from an address block. "HOPE LONG" has only one unknown word,
  // so one is enough unless the line reads like an organization.
  for (const m of text.matchAll(/^[ \t]*([A-Z][A-Za-z'’-]+(?:[ \t]+[A-Z]\.?)?(?:[ \t]+[A-Z][A-Za-z'’-]+){1,3})[ \t]*$/gm)) {
    const unknown = m[1].split(/\s+/).filter((w) => w.length > 1 && !isSafe(w)).length;
    const start = m.index + m[0].indexOf(m[1]);
    if (unknown >= 2 || (unknown === 1 && !ORG.test(m[1]))) add(start, start + m[1].length);
  }
  return spans;
}

/** Overlapping matches become one span. Keeping only the first would let the rest of the second leak. */
function mergeSpans(spans: Span[], text: string) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Span[] = [];
  for (const s of sorted) {
    const last = kept[kept.length - 1];
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      last.original = text.slice(last.start, last.end);
    } else {
      kept.push({ ...s });
    }
  }
  return kept;
}

const NOT_DENIAL = /(?:birth|dob|born|service|delivered|delivery|ordered|order date|visit|seen|received on|encounter|exam|admi|discharge|signed|effective)[^\n]{0,30}$/i;
const IS_DENIAL = /(?:notice date|date of (?:this )?(?:notice|letter|decision|determination|denial)|decision date|denial date|determination date|date (?:issued|mailed|sent)|mailed on|issued on|denied on|dated|^\s*date)\s*:?\s*$/im;

/** The date that starts the appeal clock. Labeled date first, else the first date not tied to something else. */
function findDenialSpan(text: string) {
  const dates = [...text.matchAll(new RegExp(DATE, "gi"))];
  const lead = (i: number) => text.slice(Math.max(0, i - 45), i);
  return dates.find((d) => IS_DENIAL.test(lead(d.index))) ?? dates.find((d) => !NOT_DENIAL.test(lead(d.index)) && /\d{4}|\/\d{2}$/.test(d[0]));
}

export function toIso(raw: string): string | null {
  const s = raw.replace(/(\d)(st|nd|rd|th)/i, "$1");
  const num = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  const pad = (n: string | number) => String(n).padStart(2, "0");
  let iso: string | null = null;
  if (num) iso = `${num[3].length === 2 ? `20${num[3]}` : num[3]}-${pad(num[1])}-${pad(num[2])}`;
  const isoish = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoish) iso = `${isoish[1]}-${pad(isoish[2])}-${pad(isoish[3])}`;
  if (!iso) {
    const t = Date.parse(`${s.replace(/\.(?=\s)/, "")} UTC`);
    if (!Number.isNaN(t)) iso = new Date(t).toISOString().slice(0, 10);
  }
  // Rejects impossible dates such as 13/45/2026, which Date would quietly roll forward.
  const d = new Date(`${iso}T00:00:00Z`);
  return iso && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param hide words the patient asked to remove on the review screen */
export function redact(text: string, hide: string[] = []): Redaction {
  let spans: Span[] = [];
  const add = (start: number, end: number, kind: string) => spans.push({ start, end, kind, original: text.slice(start, end) });

  for (const word of hide.map((h) => h.trim()).filter(Boolean))
    for (const m of text.matchAll(new RegExp(escapeRe(word), "gi"))) add(m.index, m.index + m[0].length, "HIDDEN");

  const denial = findDenialSpan(text);
  if (denial) add(denial.index, denial.index + denial[0].length, "DENIAL_DATE");

  for (const { kind, re, sure } of RULES) {
    for (const m of text.matchAll(re)) {
      const [start, matchEnd] = m.indices?.groups?.v ?? [m.index, m.index + m[0].length];
      // Case-insensitive labels let NAME run into lowercase words: "Patient: Rosa Delgado requested a chair".
      // A value in all lowercase stays whole, since that may be an OCR'd name with no capitals to go on.
      const caps = kind === "NAME" ? text.slice(start, matchEnd).match(/^[A-Z][^\s,]*(?:[ \t]+[A-Z][^\s,]*)*/)?.[0] : null;
      const end = caps ? start + caps.length : matchEnd;
      const value = text.slice(start, end);
      if ((kind === "ID" && (KEEP_ID.test(value) || FORM.test(value))) || (kind === "NAME" && !sure && value.split(/\s+/).every(isSafe))) continue;
      add(start, end, kind);
    }
  }
  spans.push(...findNameShapes(text));

  // A name found once is removed everywhere: "Alvarez's chair" has no label next to it. A surname that is
  // also an ordinary word matches only with its capital, so "Ms. Long" doesn't erase every "long".
  const parts = new Set(spans.filter((s) => s.kind === "NAME").flatMap((s) => s.original.match(/[A-Za-z'’-]{3,}/g) ?? []));
  for (const w of parts) {
    const flags = isSafe(w) ? "g" : "gi";
    for (const m of text.matchAll(new RegExp(String.raw`\b${escapeRe(w)}\b`, flags))) add(m.index, m.index + m[0].length, "NAME");
  }

  // The word beside a known name is part of it: "Dear Hope" also takes the "Long" in "Hope Long".
  for (const w of parts) {
    const beside = new RegExp(String.raw`\b${escapeRe(w)}[ \t]+(?:[A-Z]\.?[ \t]+)?([A-Z][A-Za-z'’-]+)`, "g");
    for (const m of text.matchAll(beside)) if (!ORG.test(m[1])) add(m.index, m.index + m[0].length, "NAME");
  }

  spans = mergeSpans(spans, text);
  let redacted = "";
  let at = 0;
  const counts: Record<string, number> = {};
  for (const s of spans) {
    redacted += `${text.slice(at, s.start)}[${s.kind}]`;
    at = s.end;
    counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  }
  return { redacted: redacted + text.slice(at), spans, denialDate: denial ? toIso(denial[0]) : null, counts };
}
