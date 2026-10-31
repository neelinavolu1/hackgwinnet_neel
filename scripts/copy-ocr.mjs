// Self-hosts the OCR and PDF engines, so reading a letter makes no request to any other site.
import { cpSync, mkdirSync, readdirSync } from "node:fs";

const out = "public/ocr";
mkdirSync(`${out}/wasm`, { recursive: true });
cpSync("node_modules/tesseract.js/dist/worker.min.js", `${out}/worker.min.js`);
cpSync("node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", `${out}/eng.traineddata.gz`);
for (const f of readdirSync("node_modules/tesseract.js-core"))
  if (/lstm\.wasm\.js$/.test(f)) cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/${f}`);
cpSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", `${out}/pdf.worker.min.mjs`);
cpSync("node_modules/pdfjs-dist/wasm", `${out}/wasm`, { recursive: true });
