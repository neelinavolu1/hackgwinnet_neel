// Voice out uses an on-device voice when one exists. Voice in is the one place the browser itself can
// send data somewhere: by default the Web Speech API streams audio to the browser vendor's servers,
// which no CSP or network tab of ours can see. So dictation tries on-device recognition first, and if
// that isn't possible the UI warns the patient before the mic opens.

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionClass = {
  new (): Recognition;
  available?(o: { langs: string[]; processLocally: boolean }): Promise<string>;
  install?(o: { langs: string[]; processLocally: boolean }): Promise<boolean>;
};

const recognizer = () => {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export type VoiceMode = "local" | "cloud" | "none";

const within = <T,>(p: Promise<T> | undefined, ms: number) =>
  Promise.race([p, new Promise<undefined>((done) => setTimeout(() => done(undefined), ms))]);

export async function voiceMode(): Promise<VoiceMode> {
  const SR = recognizer();
  if (!SR) return "none";
  const want = { langs: ["en-US"], processLocally: true };
  try {
    const state = await within(SR.available?.(want), 2_000);
    if (state === "available") return "local";
    if ((state === "downloadable" || state === "downloading") && (await within(SR.install?.(want), 30_000))) return "local";
  } catch {}
  return "cloud";
}

/** Plain words for a recognition failure, or null when the patient simply pressed stop. */
export function voiceError(code?: string) {
  if (!code || code === "aborted") return null;
  if (code === "no-speech") return "We did not hear anything. Please try again.";
  return "We could not use your microphone. Check your browser's microphone setting, or use the text box.";
}

export function listen(mode: VoiceMode, onText: (t: string) => void, onDone: (error?: string) => void) {
  const SR = recognizer();
  if (!SR) {
    onDone("not-supported");
    return () => {};
  }
  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = false;
  if (mode === "local") rec.processLocally = true;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript);
  };
  rec.onerror = (e) => onDone(e.error);
  rec.onend = () => onDone();
  rec.start();
  return () => rec.stop();
}

export function speak(text: string, onEnd: () => void) {
  const s = window.speechSynthesis;
  if (!s) return onEnd();
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = s.getVoices().find((v) => v.localService && v.lang.startsWith("en"));
  if (voice) u.voice = voice;
  u.rate = 0.95;
  u.onend = onEnd;
  u.onerror = onEnd;
  s.speak(u);
}

export const stopSpeaking = () => window.speechSynthesis?.cancel();
