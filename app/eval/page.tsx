import type { Metadata } from "next";
import { EvalView } from "@/components/Eval";

export const metadata: Metadata = { title: "How accurate is it?" };

export default function EvalPage() {
  return <EvalView />;
}
