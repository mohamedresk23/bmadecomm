import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/media/upload": ["src/lib/media/image-worker.cjs", "node_modules/sharp/**/*", "node_modules/@img/**/*", "node_modules/detect-libc/**/*", "node_modules/semver/**/*"],
  },
};

export default nextConfig;
