import { defineConfig } from "tsup";

// Bundle the server to a single ESM file. better-sqlite3 is a native module and
// must stay external (loaded from node_modules at runtime). Everything else —
// including the ESM-only MCP SDK — is bundled so the output is self-contained.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outExtension: () => ({ js: ".mjs" }),
  // Externalize all real npm deps (express, zod, MCP SDK, better-sqlite3) — they ship as a
  // real node_modules alongside the entry (staged by prepare-runtime). Only the TS workspace
  // package is bundled in. This runs the sidecar as an ordinary Node app (no esbuild
  // dynamic-require / native-loader surprises).
  external: ["better-sqlite3"],
  noExternal: ["@northstar/shared"],
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: true,
});
