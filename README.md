# CareRoute Appeal

A calibrated denial-appeal navigator for disabled patients. Built for HackGwinnett 6.0 (AI division).

**Live:** https://careroute-appeal.pages.dev · **Accuracy page:** https://careroute-appeal.pages.dev/eval

## The problem

A patient gets a denial letter for a wheelchair, scooter, or other mobility equipment (DME). The letter is dense, the reasons are coded, the deadline is short, and the fix is usually one specific missing document. People who need a power wheelchair are the people least able to spend weeks on hold, and many of them never appeal.

CareRoute Appeal reads the letter, works out why it was denied, says in plain language what is missing and who to get it from, tracks the deadline, and drafts the appeal. When it isn't sure, it says so.

## How it works

1. **Add the letter.** Paste it, photograph it, upload a PDF, or speak it. Photos and PDFs are read in the browser.
2. **Redact on the device.** `lib/redaction.ts` removes identifiers before anything is sent. The patient sees a side-by-side "What leaves your device" panel, can hide anything we missed, and presses send.
3. **Classify in four steps** (`lib/chain.ts`), each with a label and a confidence:
   - Payer: medicare, medicaid, medicare_advantage, commercial, unknown
   - Denial reasons (multi-label, 11 labels)
   - Appeal level, limited to the levels that payer actually has
   - Appeal strength: strong, needs_docs, weak
4. **Abstain when unsure.** If any step falls below the threshold (75% by default, adjustable), the app asks one targeted yes/no/not sure question and re-runs (`lib/clarify.ts`). If it is still unsure, it says so and sends the patient to a specific person: SHIP, Protection & Advocacy, or the supplier.
5. **Build the plan on the device.** A plain-language summary (6th-grade level or lower, enforced by a test), a document checklist saying who to ask, a deadline with an `.ics` calendar file, an appeal letter, and a message for the doctor. Jev returns typed answers, not text, so all wording comes from templates in `lib/letter.ts`. Names the patient adds to a letter are never sent anywhere.

## Why confidence matters here

A wrong answer can cost someone their appeal, so "I don't know, call this person" is a correct result. `/eval` runs 42 synthetic letters through the real pipeline and shows accuracy, accuracy when confident against abstain rate, and a reliability diagram, with a slider for the tradeoff. `npm run eval` regenerates it.

Results with the keyword fallback at the default 75%: it answers 17 of 42 letters and gets all 17 right. Without the abstain rule it gets 26 of 42 right. These are synthetic letters written by one team, so read them as a rough check, not a clinical claim. The page labels which classifier produced its numbers.

## HIPAA approach

This is a tool a patient runs for themselves. It is not a covered entity, and nothing here is a claim of HIPAA compliance. We use the Safe Harbor list as the design standard for what may leave the device.

- **18 identifiers:** the table at the top of `lib/redaction.ts` maps each one to the rule that handles it.
- **The denial date stays on the device.** Safe Harbor covers all date elements except the year, so a full denial date can't leave the device and still count as de-identified. The classifier doesn't need it. The date is read locally, used locally for the deadline, and sent only as the token `[DENIAL_DATE]`.
- **No server storage.** The API stores and logs nothing. `localStorage` keeps labels and the date only, never the letter, and **Delete my data** clears it.
- **Second lock.** `lib/handler.ts` runs the same redaction again on the server side.
- **Enforced by the browser.** `public/_headers` sets `connect-src 'self'`, so page code can't send data to any other site. OCR, PDF, and fonts are self-hosted.

### Verification

Driven in real Chrome against the Cloudflare Pages runtime:

| Check | Result |
| --- | --- |
| Every request across all 3 demo flows, searched for 22 planted identifiers | 0 matches |
| Requests to any other origin | 0 |
| Letter text in `localStorage` | None |
| Planted identifiers across all 42 synthetic letters (unit test) | 0 survive |
| Lighthouse accessibility, `/` and `/eval` | 100, 100 |
| axe WCAG 2.2 AA, every screen, default and high contrast + large text | 0 violations |
| Keyboard-only run through a full case | Passes, focus follows each step |

## Accessibility

Built to WCAG 2.2 AA: semantic HTML, a skip link, full keyboard use, visible focus, focus moved to each new step, live regions for status, 4.5:1 contrast, 48px targets, chart data tables, voice in, read-aloud, and large-text, high-contrast, and reduced-motion switches. Body text is Atkinson Hyperlegible, designed for low-vision readers.

## Limitations

- **Voice can leave the device.** By default the Web Speech API sends audio to the browser vendor, which no CSP or network log of ours can see. The app asks for on-device recognition first. If that isn't available, it warns the patient before opening the mic. Tested against a scripted recognizer, not a live microphone.
- **Redaction rules are not perfect.** A name with no label, no title, and only one unknown word can get through. That is why the patient reviews the output before sending.
- **Deadlines are conservative, not legal advice.** We count from the letter date, which can only be early. If the letter states a shorter time, we use that. State Medicaid windows vary. Georgia contacts are built in; other states use the national directories.
- **OCR misreads happen.** `K0823` can come back as `KO823`, so the patient should check the text.
- **Demo flows can differ under Jev.** The keyword fallback is deterministic; a live model may ask a different question.
- **Mock accuracy is a baseline.** Its keyword rules are hand-written and miss wording they have not seen.
- **`/api/classify` has no rate limit.** Steps and labels are allow-listed, so it can't be used as an open proxy for arbitrary questions, but production use would need one.

## Theme fit

The medical system assumes you can read dense paperwork, sit on hold, and keep track of dates. This tool does that work for people whose disability makes it hardest, and it hands them to a person when software shouldn't decide.

## Run it

```bash
npm install
npm run dev        # no env vars needed: uses the keyword fallback
npm test           # unit tests
npm run eval       # regenerates data/eval-results.json
npm run deploy     # builds and deploys to Cloudflare Pages
```

To use Jev, copy `.env.example` to `.env.local`. In production:

```bash
npx wrangler pages secret put JEV_API_URL --project-name careroute-appeal
npx wrangler pages secret put JEV_API_KEY --project-name careroute-appeal
```

Production is a static export on Cloudflare Pages. The API is `functions/api/classify.ts`. Static export rejects POST routes, so `app/api/classify/route.dev.ts` serves the same handler under `next dev` only.

Rule sources live beside each number in `lib/rules.ts`.

**Not legal or medical advice.**
