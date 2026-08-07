import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` otherwise appends a "nextjs-agent-rules" block to CLAUDE.md on
  // every run. CLAUDE.md is this project's constitution and §17 forbids it being
  // rewritten, so the generator is turned off rather than fought with.
  // Next's own guidance for this version lives in node_modules/next/dist/docs/.
  agentRules: false,

  experimental: {
    // `forbidden()` is what makes /print/report/[id] answer 403 rather than
    // hand out a redacted document (P20). Next refuses to run it unless this is
    // on — without the flag the call throws an internal error, which would turn
    // a deliberate refusal into a crash. Not a dependency, so §2 is untouched.
    authInterrupts: true,
  },
};

export default nextConfig;
