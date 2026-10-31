import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Cal_Sans } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { DeleteData, Prefs } from "@/components/Chrome";
import "./globals.css";

// next/font copies both faces into the build, so the page makes no third-party font request.
const body = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-body" });
const heading = Cal_Sans({ weight: "400", subsets: ["latin"], variable: "--font-heading" });

export const metadata: Metadata = {
  title: { default: "CareRoute Appeal", template: "%s | CareRoute Appeal" },
  description: "Find out why your wheelchair or mobility equipment was denied, what to get, and when your appeal is due.",
};

// Applies saved display settings before first paint, so a low-vision user never sees a flash of small text.
const PREFS_BOOT = `try{var p=JSON.parse(localStorage.getItem("careroute-prefs")||"{}"),r=document.documentElement;if(p.text)r.dataset.text="large";if(p.contrast)r.dataset.contrast="high";if(p.motion)r.dataset.motion="reduced"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT }} />
      </head>
      <body>
        <a href="#main" className="btn btn-dark sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10">
          Skip to main content
        </a>
        <div className="frame">
          <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 sm:px-8">
            <Link href="/" className="font-display rounded-md text-2xl text-ink no-underline">
              CareRoute Appeal
            </Link>
            <nav aria-label="Main" className="flex flex-wrap items-center gap-2">
              <Link href="/eval" className="btn text-ink underline-offset-4 hover:underline">
                How accurate is it?
              </Link>
              <DeleteData />
            </nav>
          </header>
          <Prefs />
          <main id="main" className="flex-1 px-3 pb-10 sm:px-3">
            {children}
          </main>
          <footer className="px-4 pb-8 pt-6 text-base text-muted sm:px-8">
            <div className="rule -mx-4 mb-6 sm:-mx-8" />
            <p>
              <strong className="text-ink">Not legal or medical advice.</strong> CareRoute Appeal helps you read a letter and get ready. A doctor, a SHIP counselor, or a lawyer can tell you what is right for you.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
