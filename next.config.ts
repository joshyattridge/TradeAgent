import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Large chat history with images / CSV / PDF attachments
  experimental: {
    proxyClientMaxBodySize: "50mb",
  },
  transpilePackages: ["@jsr/neabyte__forex-calculator"],
};

export default nextConfig;
