import type { NextConfig } from "next";

const imageRuntime = ["src/lib/media/image-worker.cjs", "node_modules/sharp/**/*", "node_modules/@img/**/*", "node_modules/detect-libc/**/*", "node_modules/semver/**/*"];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/media/upload": imageRuntime,
    "/api/v1/admin/catalog/products/*/images": imageRuntime,
  },
};

export default nextConfig;
