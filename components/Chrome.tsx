"use client";

import { useEffect, useState } from "react";

const PREFS = "careroute-prefs";
export const CASE = "careroute-case";
export const DELETED_EVENT = "careroute:deleted";

type PrefState = { text: boolean; contrast: boolean; motion: boolean };

const apply = (p: PrefState) => {
  const r = document.documentElement;
  if (p.text) r.dataset.text = "large";
  else delete r.dataset.text;
  if (p.contrast) r.dataset.contrast = "high";
  else delete r.dataset.contrast;
  if (p.motion) r.dataset.motion = "reduced";
  else delete r.dataset.motion;
};

export function Prefs() {
  const [p, setP] = useState<PrefState>({ text: false, contrast: false, motion: false });

  useEffect(() => {
    try {
      setP((old) => ({ ...old, ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") }));
    } catch {}
  }, []);

  const flip = (key: keyof PrefState) => {
    const next = { ...p, [key]: !p[key] };
    setP(next);
    apply(next);
    try {
      localStorage.setItem(PREFS, JSON.stringify(next));
    } catch {}
  };

  const row = (key: keyof PrefState, label: string) => (
    <label className="flex min-h-12 cursor-pointer items-center gap-2 text-base">
      <input type="checkbox" role="switch" className="switch" checked={p[key]} onChange={() => flip(key)} />
      {label}
    </label>
  );

  return (
    <section aria-label="Display settings" className="flex flex-wrap items-center gap-x-6 px-4 pb-3 sm:px-8">
      {row("text", "Large text")}
      {row("contrast", "High contrast")}
      {row("motion", "Reduced motion")}
    </section>
  );
}

export function DeleteData() {
  const [done, setDone] = useState(false);
  const wipe = () => {
    try {
      localStorage.removeItem(CASE);
    } catch {}
    window.dispatchEvent(new Event(DELETED_EVENT));
    setDone(true);
    setTimeout(() => setDone(false), 4000);
  };
  return (
    <>
      <button type="button" className="btn btn-light" onClick={wipe}>
        {done ? "Deleted" : "Delete my data"}
      </button>
      <span role="status" className="sr-only">
        {done ? "Your letter and results were deleted from this device." : ""}
      </span>
    </>
  );
}
