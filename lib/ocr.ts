// Runs entirely in the browser. Every asset is served from /ocr on this site (scripts/copy-ocr.mjs),
// so reading a letter makes no third-party request and the file itself goes nowhere.

type Progress = (fraction: number) => void;

const ocrWorker = async (onProgress: Progress) => {
  const { createWorker } = await import("tesseract.js");
  return createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress(m.progress);
    },
  });
};

async function readPdf(file: File, onProgress: Progress) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/ocr/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), wasmUrl: "/ocr/wasm/" }).promise;
  const pages: string[] = [];
  let worker: Awaited<ReturnType<typeof ocrWorker>> | null = null;

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : "")).join("");
    if (text.trim().length > 40) {
      pages.push(text);
    } else {
      // A scan has no text layer, so draw the page and read the picture.
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
      worker ??= await ocrWorker(() => {});
      pages.push((await worker.recognize(canvas)).data.text);
    }
    onProgress(n / pdf.numPages);
  }
  await worker?.terminate();
  return pages.join("\n\n");
}

export async function readFile(file: File, onProgress: Progress) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return readPdf(file, onProgress);
  const worker = await ocrWorker(onProgress);
  const { data } = await worker.recognize(file);
  await worker.terminate();
  return data.text;
}
