# CareRoute Appeal

Helps disabled patients understand a wheelchair or mobility equipment denial, and appeal it.

**[Try it](https://careroute-appeal.pages.dev)** · **[See the accuracy numbers](https://careroute-appeal.pages.dev/eval)** · Built for HackGwinnett 6.0

## The problem

Denial letters are dense and deadlines are short, yet the fix is often one missing document. The people who need a power wheelchair are the least able to spend weeks on hold.

## How it works

1. **Add your letter.** Paste it, upload a photo or PDF, or speak it.
2. **Check what leaves your device.** Names, numbers, and dates are removed in your browser. You see the result and press send.
3. **Jev classifies it in four steps:** insurance type, denial reasons, appeal level, and appeal strength. Each step has a confidence score.
4. **If it isn't sure, it asks one question.** If it is still unsure, it says so and sends you to a free helper.
5. **You get a plan:** what's missing, who to ask, your deadline, an appeal letter, and a note for your doctor.

## Accuracy

Scored with real Jev on synthetic letters. We tuned the prompts on 42, then wrote 14 more with the prompts locked.

| | Fully right | Answered at 75% sure | Right when answered |
| --- | --- | --- | --- |
| **Held-out (14)** | 11 | 10 | 9 |
| Tuned (42) | 38 | 30 | 29 |

The held-out row is the one to trust. It is a small set written by one team, so treat it as a rough check. Run `npm run eval` to regenerate.

## Privacy

This tool isn't a covered entity and makes no claim of HIPAA compliance. We use the 18 Safe Harbor identifiers as the standard for what may leave the device; `lib/redaction.ts` maps each one to a rule.

- Your letter is redacted in the browser, then again on the server.
- The denial date stays on your device, because Safe Harbor covers it.
- Nothing is stored on a server. The browser keeps only labels and the date, and **Delete my data** clears them.
- A strict CSP blocks the page from sending data to any other site.

Checked in Chrome on the live site: 0 of 22 planted identifiers appeared in any request, and no request went to another site. Lighthouse accessibility scored 100 on both pages.

## Accessibility

Built to WCAG 2.2 AA: full keyboard use, screen reader support, voice in, read-aloud, 48px targets, and large-text, high-contrast, and reduced-motion switches.

## Limitations

- **Voice can leave the device.** Browsers may send speech to their vendor. We try on-device first and warn you if we can't. Not yet tested with a live microphone.
- **Redaction can miss things,** so you review it before sending.
- **Deadlines are conservative.** State Medicaid rules vary, and a shorter date on your letter wins.
- **OCR can misread text,** so check it before continuing.
- **`/api/classify` has no rate limit,** and Jev runs on `jev-latest`, not a pinned version.

## Theme fit

The medical system assumes you can read dense paperwork, sit on hold, and track dates. This does that work for the people it's hardest for, and hands them to a person when software shouldn't decide.

## Run it

```bash
npm install
npm run dev      # works with no keys, using keyword scoring
npm test
npm run deploy   # Cloudflare Pages
```

For Jev, copy `.env.example` to `.env.local`. Deadline sources are next to each rule in `lib/rules.ts`.

**Not legal or medical advice.**
