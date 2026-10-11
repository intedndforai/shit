import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native modules must stay on the server runtime.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  // Produces .next/standalone for the Docker image.
  output: "standalone",
};

export default nextConfig;