// Everything here runs in the browser from labels and the patient's own typed fields. No text is generated
// by a server, so nothing the patient re-adds to a letter ever leaves the device.

import type { ChainResult } from "./chain";
import { REASON_INFO, STRENGTH_TEXT, addDays, type Deadline, type Doc, type Level, type Reason, type Strength } from "./rules";

export type Personal = { name: string; dob: string; memberId: string; claimNumber: string; address: string; doctor: string; appealAddress: string; why: string };
export const EMPTY_PERSONAL: Personal = { name: "", dob: "", memberId: "", claimNumber: "", address: "", doctor: "", appealAddress: "", why: "" };

export const reasonsOf = (chain: ChainResult) => chain.reasons.labels as Reason[];

const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Local-only: what was denied, read from the original letter for the patient's own documents. */
export function findEquipment(letter: string) {
  const name = letter.match(/\b(?:(?:group \d\s+)?power(?:ed)?\s+(?:wheel\s?chair|mobility device|scooter)|(?:ultra[- ]?light(?:weight)?\s+|light(?:weight)?\s+|manual\s+|tilt[- ]in[- ]space\s+)*(?:manual\s+)?wheel\s?chair|(?:mobility\s+|power[- ]operated\s+)?scooter|rollator|walker)\b/i)?.[0];
  const code = letter.match(/\b[EKL]\d{4}\b/)?.[0];
  return { name: name?.toLowerCase() ?? "mobility equipment", code: code ?? null };
}

export function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

export function summary(chain: ChainResult, deadline: Deadline | null) {
  const reasons = reasonsOf(chain).map((r) => REASON_INFO[r]);
  const byWho = new Map<string, string[]>();
  for (const r of reasons) byWho.set(r.askWho, [...(byWho.get(r.askWho) ?? []), r.askFor]);
  const asks = [...byWho].map(([who, what], i) => `${i ? "Then ask" : "To fix it, ask"} ${who} for ${join(what)}.`);
  const lines = [
    `You were denied because ${join(reasons.map((r) => r.because))}.`,
    ...asks,
    STRENGTH_TEXT[chain.strength.labels[0] as Strength],
  ];
  if (deadline) lines.push(deadline.daysLeft < 0 ? `Your date to appeal may have passed. Call a helper today.` : `Send your appeal by ${formatDate(deadline.due)}.`);
  return lines.join(" ");
}

export function checklist(chain: ChainResult): Doc[] {
  const seen = new Set<string>();
  return reasonsOf(chain).flatMap((r) => REASON_INFO[r].docs).filter((d) => !seen.has(d.item) && seen.add(d.item));
}

const ph = (value: string, placeholder: string) => value.trim() || `[${placeholder}]`;

const REQUEST: Record<Level, string> = {
  redetermination: "Request for Redetermination (first Medicare appeal)",
  reconsideration: "Request for Reconsideration (second Medicare appeal)",
  ALJ: "Request for a Hearing with an Administrative Law Judge",
  internal_appeal: "Request for Internal Appeal",
  external_review: "Request for External Review",
};

export function appealLetter(chain: ChainResult, p: Personal, equipment: { name: string; code: string | null }, denialDate: string | null, today: string) {
  const reasons = reasonsOf(chain);
  const item = equipment.code ? `${equipment.name} (${equipment.code})` : equipment.name;
  return [
    formatDate(today),
    "",
    ph(p.appealAddress, "ADDRESS FOR APPEALS, FROM YOUR DENIAL LETTER"),
    "",
    `RE: ${REQUEST[chain.level.labels[0] as Level]}`,
    `Name: ${ph(p.name, "YOUR FULL NAME")}`,
    `Date of birth: ${ph(p.dob, "YOUR DATE OF BIRTH")}`,
    `Member or Medicare number: ${ph(p.memberId, "YOUR MEMBER NUMBER")}`,
    `Claim or reference number: ${ph(p.claimNumber, "CLAIM NUMBER FROM YOUR LETTER")}`,
    `Date of denial notice: ${denialDate ? formatDate(denialDate) : "[DATE ON YOUR LETTER]"}`,
    `Equipment: ${item}`,
    "",
    "To whom it may concern:",
    "",
    `I am appealing your decision to deny my ${item}. Please reverse this denial.`,
    "",
    ...reasons.map((r) => REASON_INFO[r].letterLine),
    "",
    `I need this equipment to move safely and do daily tasks. ${ph(p.why, "IN YOUR OWN WORDS, SAY WHAT YOU CAN'T DO WITHOUT IT.")}`,
    "",
    "I am sending these documents with this letter:",
    ...checklist(chain).map((d) => `- ${d.item}`),
    "",
    "Please send me your decision in writing. If you need anything else, contact me at the address below.",
    "",
    "Sincerely,",
    ph(p.name, "YOUR FULL NAME"),
    ph(p.address, "YOUR ADDRESS AND PHONE"),
  ].join("\n");
}

export function doctorNote(chain: ChainResult, p: Personal, equipment: string, deadline: Deadline | null) {
  const docs = checklist(chain).filter((d) => d.from === "Doctor" || d.from === "PT/OT");
  // Ask two weeks early, so a slow office doesn't cost the patient the deadline.
  const need = deadline && deadline.daysLeft > 14 ? `Could you send these by ${formatDate(addDays(deadline.due, -14))}? ` : "";
  return [
    `Hello ${ph(p.doctor, "DOCTOR'S NAME")},`,
    "",
    `My insurance denied my ${equipment}. To appeal, I need these from your office:`,
    ...(docs.length ? docs : checklist(chain)).map((d) => `- ${d.item}`),
    "",
    `${need}${deadline ? `My appeal is due ${formatDate(deadline.due)}.` : "My appeal has a short deadline."}`,
    "",
    "Thank you,",
    ph(p.name, "YOUR FULL NAME"),
  ].join("\n");
}

const icsDate = (iso: string) => iso.replaceAll("-", "");

/** All-day event with reminders 14 and 3 days out. No names or numbers go in it. */
export function ics(deadline: Deadline, stamp = new Date()) {
  const when = icsDate(deadline.due);
  const dtstamp = `${stamp.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const alarm = (days: number) => ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Equipment appeal due soon", `TRIGGER:-P${days}D`, "END:VALARM"];
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CareRoute Appeal//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@careroute-appeal`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${when}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(deadline.due, 1))}`,
    "SUMMARY:Equipment appeal due today",
    "DESCRIPTION:Send your appeal by today and keep a copy.",
    ...alarm(14),
    ...alarm(3),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

const syllables = (word: string) => {
  const w = word.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "");
  return Math.max(1, w.match(/[aeiouy]+/g)?.length ?? 1);
};

/** Flesch-Kincaid grade level, shown on screen and enforced by a test. */
export function readingGrade(text: string) {
  const words = text.match(/[A-Za-z'’-]+/g) ?? [];
  const sentences = Math.max(1, text.match(/[.!?]+/g)?.length ?? 1);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / Math.max(1, words.length)) - 15.59;
}
