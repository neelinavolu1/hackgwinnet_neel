// Runs every synthetic letter through the real pipeline (redact, then the chain) and writes
// data/eval-results.json for the /eval page. Uses Jev when JEV_API_URL and JEV_API_KEY are set,
// else the keyword fallback. `npm run eval` regenerates it.
import { readFileSync, writeFileSync } from "node:fs";
import { chainConfidence, needsHuman, runChain, STEP_ORDER, STEPS, type Caller, type ChainResult, type StepName } from "../lib/chain";
import { answerLine, pickQuestion } from "../lib/clarify";
import { getClient } from "../lib/jev";
import { redact } from "../lib/redaction";

try {
  process.loadEnvFile(".env.local");
} catch {}

type Gold = { id: string; text: string; payer: string; reasons: string[]; level: string; strength: string };

const THRESHOLD = 0.75;
const { classify, name } = getClient(process.env);
const call: Caller = (step, text, labels) => classify(text, labels, STEPS[step]);

const rows: Gold[] = readFileSync("data/denials.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));

const goldFor = (r: Gold, s: StepName) => (s === "reasons" ? r.reasons : [r[s]]);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const allRight = (chain: ChainResult, r: Gold) => STEP_ORDER.every((s) => same(chain[s].labels, goldFor(r, s)));

async function one(r: Gold) {
  const clean = redact(r.text).redacted;
  const chain = await runChain(clean, call);
  const steps = Object.fromEntries(
    STEP_ORDER.map((s) => [s, { pred: chain[s].labels, gold: goldFor(r, s), confidence: chain[s].confidence, correct: same(chain[s].labels, goldFor(r, s)) }]),
  );

  // Simulates the patient: answers the one question truthfully from the gold labels, then re-runs.
  let afterQuestion: { confident: boolean; correct: boolean } | null = null;
  if (needsHuman(chain, THRESHOLD)) {
    const q = pickQuestion(chain, THRESHOLD)!;
    const truth = goldFor(r, q.step).includes(q.label) ? "yes" : "no";
    const again = await runChain(clean + answerLine(q, truth), call);
    afterQuestion = { confident: !needsHuman(again, THRESHOLD), correct: allRight(again, r) };
  }
  return { id: r.id, confidence: chainConfidence(chain), correct: allRight(chain, r), steps, afterQuestion };
}

async function main() {
  const out: Awaited<ReturnType<typeof one>>[] = [];
  // ponytail: fixed batches of 5, a real queue only if Jev rate limits become a problem.
  for (let i = 0; i < rows.length; i += 5) {
    out.push(...(await Promise.all(rows.slice(i, i + 5).map(one))));
    process.stdout.write(`\r${out.length}/${rows.length}`);
  }
  const model = name === "jev" ? (process.env.JEV_MODEL ?? "jev-latest") : "keyword fallback";
  writeFileSync("data/eval-results.json", `${JSON.stringify({ client: name, model, generatedAt: new Date().toISOString().slice(0, 10), rows: out })}\n`);
  const right = out.filter((r) => r.correct).length;
  console.log(`\n${name}: ${right}/${out.length} all four steps right`);
  for (const s of STEP_ORDER) console.log(`  ${s}: ${out.filter((r) => r.steps[s].correct).length}/${out.length}`);
}

main();
