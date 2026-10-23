import type { NextConfig } from "next";

/**
 * Content-Security-Policy for the app shell.
 *
 * The core UI loads no third-party fonts, scripts, stylesheets, or images
 * (Section 3.2). The single explicit exception is cdn.jsdelivr.net, which the
 * opt-in browser Python runner fetches Pyodide from; that tool is classified as
 * third-party egress and is disabled in Strict Local mode.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data: https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    // Section 3.2: a restrictive policy. Microphone stays available for the
    // opt-in dictation feature planned in M10; everything else is off.
    value:
      "camera=(), geolocation=(), payment=(), usb=(), serial=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=()",
  },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow an isolated build directory (e.g. while a dev server owns .next).
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  // Native modules and heavy parsers must stay on the server runtime.
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist", "mammoth", "xlsx"],
  poweredByHeader: false,
  // Produces .next/standalone for the Docker image.
  output: "standalone",

  // Keep runtime data out of the deploy artifact. File tracing follows
  // path.resolve(process.cwd(), ...) in lib/db/index.ts and the upload
  // helpers, so on its own it copies the whole project, including ./data with
  // the SQLite database and every uploaded attachment, into .next/standalone.
  // (.env is copied by the Next build itself; the Dockerfile deletes it.)
  outputFileTracingExcludes: {
    "*": [
      "./data/**",
      "./.env*",
      "./.git/**",
      "./.tmp/**",
      "./docs/**",
      "./scripts/**",
      "./*.md",
      "./tsconfig*.json",
      "./eslint.config.mjs",
      "./drizzle.config.ts",
      // Build-time config only. Do not exclude a bare `./lib/**` or
      // `./app/**` here: the glob also matches every package's own `lib`
      // folder (better-sqlite3, mammoth, sharp) and guts the runtime.
      "./next.config.ts",
      "./postcss.config.mjs",
      "./package-lock.json",
      "./tsconfig.tsbuildinfo",
    ],
  },
  async headers() {
    return [
      // API routes opt out of this global CSP: Next applies config headers
      // after route handlers, so a blanket match would override the sandbox /
      // previewCsp() policies that /api/files/[id] and the preview routes set.
      { source: "/((?!api/).*)", headers: SECURITY_HEADERS },
      // Chat and API responses are never cached (Section 3.2).
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
