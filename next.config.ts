import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow base64 chart screenshots in chat requests
  experimental: {
    proxyClientMaxBodySize: "12mb",
  },
};

export default nextConfig;
