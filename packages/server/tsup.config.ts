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
  external: ["better-sqlite3"],
  // tsup externalizes deps by default; force the TS workspace pkg to be bundled.
  noExternal: ["@northstar/shared"],
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: true,
});
