import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep prompts/*.md in the serverless bundle (agent + /api/prompts).
  outputFileTracingIncludes: {
    "/api/copilotkit/**/*": ["./prompts/**/*"],
    "/api/prompts/**/*": ["./prompts/**/*"],
  },
};

export default nextConfig;
