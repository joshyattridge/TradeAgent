import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow base64 chart screenshots / PDF attachments in chat requests
  experimental: {
    proxyClientMaxBodySize: "20mb",
  },
};

export default nextConfig;
