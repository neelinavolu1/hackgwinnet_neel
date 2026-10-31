import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";

const config: NextConfig = {
  // Production is a static site on Cloudflare Pages. The one server endpoint is functions/api/classify.ts.
  output: dev ? undefined : "export",
  // Static export rejects POST routes, so app/api/classify/route.dev.ts is a route only under `next dev`.
  pageExtensions: dev ? ["tsx", "ts", "dev.ts"] : ["tsx", "ts"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default config;
