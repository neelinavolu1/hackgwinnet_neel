import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { firstUnsure, needsHuman, runChain, STEPS, type Caller } from "../lib/chain";
import { answerLine, parseAnswer, pickQuestion } from "../lib/clarify";
import { DEMOS } from "../lib/demos";
import { handleClassify } from "../lib/handler";
import { mockClient } from "../lib/jev";
import { checklist, doctorNote, ics, readingGrade, summary, appealLetter, EMPTY_PERSONAL } from "../lib/letter";
import { redact, toIso } from "../lib/redaction";
import { addMonths, computeDeadline, REASONS, REASON_INFO, statedDays, type Level, type Payer } from "../lib/rules";

const call: Caller = (step, text, labels) => mockClient(text, labels, STEPS[step]);
const demo = (id: string) => DEMOS.find((d) => d.id === id)!;
const THRESHOLD = 0.75;

const pipeline = async (raw: string, answer: "yes" | "no" | "not_sure") => {
  const clean = redact(raw).redacted;
  const first = await runChain(clean, call);
  if (!needsHuman(first, THRESHOLD)) return { first, final: first, asked: false };
  const q = pickQuestion(first, THRESHOLD)!;
  const final = await runChain(clean + answerLine(q, answer), call);
  return { first, final, asked: true };
};

describe("redaction", () => {
  test("removes every identifier from the demo letters", () => {
    const planted: Record<string, string[]> = {
      clear: ["Loretta", "Pruitt", "418 Sugarloaf", "Lawrenceville", "30043", "1EG4-TE5-MK73", "21626701455000", "03/22/1951", "555-0142", "Krishnan", "July 30", "September 14"],
      messy: ["Darnell", "Whitfield", "667123904512", "11/02/1988", "10/06/2026", "555-0177"],
      unclear: ["Priya", "Venkataraman", "LEH4471902", "88213", "08/29/2026"],
    };
    for (const d of DEMOS) {
      const out = redact(d.text).redacted;
      for (const p of planted[d.id]) assert.ok(!out.toLowerCase().includes(p.toLowerCase()), `${d.id} leaked ${p}\n${out}`);
    }
  });

  test("keeps what the classifier needs", () => {
    const out = redact(demo("clear").text).redacted;
    for (const k of ["K0823", "face-to-face", "power wheelchair", "redetermination", "120 days", "1-800-MEDICARE", "Medicare Number:", "6 months"])
      assert.ok(out.includes(k), `lost ${k}\n${out}`);
  });

  test("the denial date never goes out but stays on the device", () => {
    const r = redact(demo("clear").text);
    assert.equal(r.denialDate, "2026-09-14");
    assert.ok(r.redacted.includes("[DENIAL_DATE]"));
    assert.ok(!/2026/.test(r.redacted.replace("Date: [DENIAL_DATE]", "")) || !r.redacted.includes("September"));
  });

  test("a date of birth is not mistaken for the denial date", () => {
    assert.equal(redact("Date of Birth: 01/02/1950\nReviewed and denied.\nDate of Decision: 03/04/2026").denialDate, "2026-03-04");
    assert.equal(redact("DOB 01/02/1950. Your claim was denied on March 4, 2026.").denialDate, "2026-03-04");
  });

  test("a name found once is removed everywhere", () => {
    const out = redact("Patient: Harold McKinley\nMr. McKinley's chair was denied. McKinley may appeal.").redacted;
    assert.ok(!out.includes("McKinley") && !out.includes("Harold"), out);
  });

  test("a surname that is an ordinary word still goes when context proves it is a name", () => {
    const out = redact("Dear Mrs. Long:\nMs. Long's wheelchair needs a long review. Patient: Hope Long").redacted;
    assert.ok(!out.includes("Long") && !out.includes("Hope"), out);
    assert.ok(out.includes("a long review"), out);
  });

  test("a title or a following sentence is not swallowed into a name", () => {
    const out = redact("Sincerely,\nElena Morozova\nMedical Director\n\nNotice of Denial of Medical Coverage from your Medicare Advantage HMO.\nPatient: Rosa Delgado requested a wheelchair.").redacted;
    assert.ok(out.includes("Medical Director") && out.includes("Medical Coverage") && out.includes("Medicare Advantage HMO") && out.includes("requested a wheelchair"), out);
    assert.ok(!out.includes("Morozova") && !out.includes("Delgado"), out);
  });

  test("identifier shapes", () => {
    const cases = ["SSN 123-45-6789", "reach me at dana.fox@example.com", "fax 404.555.0199", "IP 10.2.3.4", "visit myportal.example.com/u/88", "MRN: A1234567", "Serial # SN88421Q", "she is 93 years old", "PO Box 7713", "Gwinnett County", "account 9988776655"];
    for (const c of cases) {
      const out = redact(c).redacted;
      assert.notEqual(out, c, `not redacted: ${c}`);
      assert.ok(out.includes("["), c);
    }
    assert.ok(!redact("He lives in Duluth, GA 30096").redacted.includes("Duluth"));
    assert.ok(!redact("MARIA T ALVAREZ\n100 Peachtree St NE\nATLANTA GA 30303").redacted.match(/ALVAREZ|Peachtree|ATLANTA/));
  });

  test("the patient can hide anything we missed", () => {
    assert.ok(!redact("Clinic at Oakmoor.", ["Oakmoor"]).redacted.includes("Oakmoor"));
  });

  test("running it twice changes nothing", () => {
    for (const d of DEMOS) {
      const once = redact(d.text).redacted;
      assert.equal(redact(once).redacted, once);
    }
  });

  test("calendar parsing rejects impossible dates", () => {
    assert.equal(toIso("13/45/2026"), null);
    assert.equal(toIso("2/30/2026"), null);
    assert.equal(toIso("Sept. 3, 2026"), "2026-09-03");
    assert.equal(toIso("3rd October 2026"), "2026-10-03");
  });
});

describe("demo cases", () => {
  test("1: Medicare is confident, strong, and asks nothing", async () => {
    const { first, asked } = await pipeline(demo("clear").text, "yes");
    assert.equal(asked, false, JSON.stringify(first, null, 1));
    assert.deepEqual(first.payer.labels, ["medicare"]);
    assert.deepEqual(first.reasons.labels, ["missing_face_to_face_note"]);
    assert.deepEqual(first.level.labels, ["redetermination"]);
    assert.deepEqual(first.strength.labels, ["strong"]);
  });

  test("2: Medicaid abstains, asks once, and resolves on yes or no", async () => {
    for (const answer of ["yes", "no"] as const) {
      const { first, final, asked } = await pipeline(demo("messy").text, answer);
      assert.equal(asked, true);
      assert.deepEqual(first.payer.labels, ["medicaid"]);
      assert.equal(firstUnsure(first, THRESHOLD), "reasons");
      assert.equal(needsHuman(final, THRESHOLD), false, `${answer}: ${JSON.stringify(final, null, 1)}`);
    }
  });

  test("3: commercial stays uncertain and escalates on any answer", async () => {
    for (const answer of ["yes", "no", "not_sure"] as const) {
      const { first, final, asked } = await pipeline(demo("unclear").text, answer);
      assert.equal(asked, true);
      assert.deepEqual(first.payer.labels, ["commercial"]);
      assert.equal(needsHuman(final, THRESHOLD), true, answer);
    }
  });

  test("a higher threshold makes the app abstain on the clear letter", async () => {
    const chain = await runChain(redact(demo("clear").text).redacted, call);
    assert.ok(needsHuman(chain, 0.999));
    assert.ok(pickQuestion(chain, 0.999));
  });
});

describe("deadlines", () => {
  test("Medicare redetermination is 120 days from the letter", () => {
    assert.equal(computeDeadline("medicare", "redetermination", "2026-09-14", 120, "2026-10-31")?.due, "2027-01-12");
  });

  test("every level a payer can reach has a sourced rule", () => {
    const pairs: [Payer, Level, number | string][] = [["medicare", "reconsideration", 180], ["medicare", "ALJ", 60], ["medicare_advantage", "internal_appeal", 60], ["medicaid", "internal_appeal", 60], ["medicaid", "external_review", 90], ["commercial", "internal_appeal", 180]];
    for (const [payer, level, days] of pairs) assert.equal(computeDeadline(payer, level, "2026-01-01", null, "2026-01-01")?.daysLeft, days);
  });

  test("a shorter number on the letter wins; a longer one does not", () => {
    const short = computeDeadline("medicaid", "external_review", "2026-01-01", 30, "2026-01-01");
    assert.equal(short?.daysLeft, 30);
    assert.equal(short?.usedLetter, true);
    assert.equal(computeDeadline("medicaid", "internal_appeal", "2026-01-01", 90, "2026-01-01")?.daysLeft, 60);
  });

  test("no rule or no date means no invented date", () => {
    assert.equal(computeDeadline("unknown", "internal_appeal", "2026-01-01", null), null);
    assert.equal(computeDeadline("medicare", "internal_appeal", "2026-01-01", null), null);
    assert.equal(computeDeadline("medicare", "redetermination", null, null), null);
    assert.equal(computeDeadline("medicare_advantage", "external_review", "2026-01-01", null), null);
  });

  test("month arithmetic stays inside short months and across leap day", () => {
    assert.equal(addMonths("2026-10-31", 4), "2027-02-28");
    assert.equal(addMonths("2027-10-31", 4), "2028-02-29");
    assert.equal(computeDeadline("commercial", "external_review", "2026-10-31", null, "2026-10-31")?.due, "2027-02-28");
  });

  test("reads the day count off the letter", () => {
    assert.equal(statedDays("You have 30 days to ask"), 30);
    assert.equal(statedDays("within 60 calendar days of the date"), 60);
    assert.equal(statedDays("no timeline here"), null);
  });

  test("calendar file is valid and carries no identifiers", () => {
    const d = computeDeadline("medicare", "redetermination", "2026-09-14", null, "2026-10-31")!;
    const out = ics(d, new Date("2026-10-31T12:00:00Z"));
    assert.ok(out.includes("DTSTART;VALUE=DATE:20270112\r\n"));
    assert.ok(out.includes("DTEND;VALUE=DATE:20270113\r\n"));
    assert.ok(out.includes("DTSTAMP:20261031T120000Z\r\n"));
    assert.equal((out.match(/BEGIN:VALARM/g) ?? []).length, 2);
    assert.ok(out.split("\r\n").every((l) => l.length <= 75));
  });
});

describe("outputs", () => {
  const fake = (labels: string[]) => ({
    payer: { labels: ["medicare"], confidence: 0.9, scores: {}, unsure: "medicare" },
    reasons: { labels, confidence: 0.9, scores: {}, unsure: labels[0] },
    level: { labels: ["redetermination"], confidence: 0.9, scores: {}, unsure: "redetermination" },
    strength: { labels: ["strong"], confidence: 0.9, scores: {}, unsure: "strong" },
  });

  test("every summary reads at or under 6th grade, alone or with a second reason", () => {
    for (const a of REASONS) for (const b of REASONS) {
      const s = summary(fake(a === b ? [a] : [a, b]), null);
      assert.ok(readingGrade(s) <= 6.5, `${readingGrade(s).toFixed(1)}: ${s}`);
    }
  });

  test("the summary follows the promised shape", () => {
    assert.match(summary(fake(["missing_face_to_face_note"]), null), /^You were denied because .*\. To fix it, ask your doctor for .*\./);
  });

  test("every reason says who to ask", () => {
    for (const r of REASONS) assert.ok(REASON_INFO[r].docs.length > 0, r);
  });

  test("two reasons sharing a document list it once", () => {
    const items = checklist(fake(["missing_face_to_face_note", "missing_face_to_face_note"])).map((d) => d.item);
    assert.equal(new Set(items).size, items.length);
  });

  test("letters keep placeholders until the patient fills them", () => {
    const letter = appealLetter(fake(["missing_written_order"]), EMPTY_PERSONAL, { name: "power wheelchair", code: "K0823" }, "2026-09-14", "2026-10-31");
    assert.ok(letter.includes("[YOUR FULL NAME]") && letter.includes("K0823"));
    const filled = appealLetter(fake(["missing_written_order"]), { ...EMPTY_PERSONAL, name: "Test Person" }, { name: "x", code: null }, null, "2026-10-31");
    assert.ok(filled.includes("Name: Test Person") && !filled.includes("[YOUR FULL NAME]"));
    assert.ok(doctorNote(fake(["missing_written_order"]), EMPTY_PERSONAL, "x", null).includes("[DOCTOR'S NAME]"));
  });
});

describe("clarifying answers and the API boundary", () => {
  test("spoken answers", () => {
    assert.equal(parseAnswer("yes it does"), "yes");
    assert.equal(parseAnswer("no"), "no");
    assert.equal(parseAnswer("I'm not sure"), "not_sure");
    assert.equal(parseAnswer("banana"), null);
  });

  test("the handler rejects anything but a known step with known labels", async () => {
    assert.equal((await handleClassify({ step: "nope", text: "x" }, {})).status, 400);
    assert.equal((await handleClassify({ step: "payer", text: "" }, {})).status, 400);
    assert.equal((await handleClassify({ step: "payer", text: "x", labels: ["evil"] }, {})).status, 400);
    assert.equal((await handleClassify({ step: "payer", text: "x".repeat(20_001) }, {})).status, 400);
    assert.equal((await handleClassify(null, {})).status, 400);
  });

  test("the handler uses mock with no env vars and re-redacts on the way through", async () => {
    const r = await handleClassify({ step: "payer", text: "Medicare letter for Patient: Rosa Delgado, SSN 123-45-6789" }, {});
    const body = await r.json();
    assert.equal(body.client, "mock");
    assert.equal(body.results[0].label, "medicare");
  });
});

// Skipped until data/denials.jsonl exists, then covers every synthetic letter.
describe("synthetic set", () => {
  test("no planted identifier survives redaction", (t) => {
    let raw = "";
    try { raw = readFileSync("data/denials.jsonl", "utf8"); } catch { return t.skip("no dataset yet"); }
    for (const line of raw.trim().split("\n")) {
      const row = JSON.parse(line);
      const out = redact(row.text).redacted.toLowerCase();
      for (const p of row.phi) assert.ok(!out.includes(p.toLowerCase()), `${row.id} leaked ${p}\n${out}`);
    }
  });

  test("the denial date is found in every letter", (t) => {
    let raw = "";
    try { raw = readFileSync("data/denials.jsonl", "utf8"); } catch { return t.skip("no dataset yet"); }
    for (const line of raw.trim().split("\n")) {
      const row = JSON.parse(line);
      assert.equal(redact(row.text).denialDate, row.denial_date, row.id);
    }
  });
});
