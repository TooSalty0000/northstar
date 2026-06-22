// Stages the production sidecar runtime for packaging:
//   (1) an official Node 22 (ABI 127) darwin-arm64 binary, and
//   (2) a COMPLETE production node_modules for the server (express, zod, MCP SDK,
//       better-sqlite3 + all transitive deps) via a clean install, so the sidecar runs
//       as an ordinary Node app — no bundling of express/native loaders.
// Output: packages/app/build/runtime/{node-darwin-arm64, server-node_modules}
// The shipped better-sqlite3 is the Node-22/ABI-127 prebuild and is run by the shipped
// Node 22 binary — same ABI, zero rebuild. NEVER run @electron/rebuild here.
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const NODE_VER = "v22.17.0"; // Node 22 -> ABI 127 (matches the better-sqlite3 prebuild)
const ABI = "127";
const ARCH = "darwin-arm64";

const here = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, ".."); // packages/app
const repoRoot = path.resolve(appRoot, "..", "..");
const runtime = path.join(appRoot, "build", "runtime");
mkdirSync(runtime, { recursive: true });

// ---- 1) Download + verify the official Node binary (cached after first run) ----
const nodeDir = path.join(runtime, `node-${ARCH}`);
if (!existsSync(path.join(nodeDir, "bin", "node"))) {
  const tarball = `node-${NODE_VER}-${ARCH}.tar.gz`;
  execSync(`curl -fsSLO https://nodejs.org/dist/${NODE_VER}/${tarball}`, { cwd: runtime, stdio: "inherit" });
  execSync(`curl -fsSLO https://nodejs.org/dist/${NODE_VER}/SHASUMS256.txt`, { cwd: runtime, stdio: "inherit" });
  execSync(`grep " ${tarball}$" SHASUMS256.txt | shasum -a 256 -c -`, { cwd: runtime, stdio: "inherit" });
  execSync(`tar -xzf ${tarball}`, { cwd: runtime, stdio: "inherit" });
  rmSync(nodeDir, { recursive: true, force: true });
  cpSync(path.join(runtime, `node-${NODE_VER}-${ARCH}`), nodeDir, { recursive: true });
}
const nodeBin = path.join(nodeDir, "bin", "node");
execSync(`codesign --force -s - "${nodeBin}"`, { stdio: "inherit" });

// ---- 2) Clean production install of the sidecar's runtime deps ----
// @northstar/shared is bundled into index.mjs, so it's excluded here.
const serverPkg = JSON.parse(readFileSync(path.join(repoRoot, "packages", "server", "package.json"), "utf8"));
const deps = { ...(serverPkg.dependencies ?? {}) };
delete deps["@northstar/shared"];

// Install OUTSIDE the workspace (tmp) so npm doesn't treat it as a workspace member.
const installDir = path.join(os.tmpdir(), "northstar-sidecar-install");
rmSync(installDir, { recursive: true, force: true });
mkdirSync(installDir, { recursive: true });
writeFileSync(
  path.join(installDir, "package.json"),
  JSON.stringify({ name: "northstar-sidecar", private: true, dependencies: deps }, null, 2),
);
console.log("installing sidecar deps:", Object.keys(deps).join(", "));
execSync("npm install --omit=dev --no-audit --no-fund", { cwd: installDir, stdio: "inherit" });

const stage = path.join(runtime, "server-node_modules");
rmSync(stage, { recursive: true, force: true });
cpSync(path.join(installDir, "node_modules"), stage, { recursive: true, dereference: true });

const addon = path.join(stage, "better-sqlite3", "build", "Release", "better_sqlite3.node");
if (!existsSync(addon)) throw new Error("better_sqlite3.node missing: " + addon);
execSync(`codesign --force -s - "${addon}"`, { stdio: "inherit" });

// BUILD-TIME ABI ASSERTION: load better-sqlite3 from the staged tree with the SHIPPED node.
execSync(
  `"${nodeBin}" -e ` +
    `"require('${path.join(stage, "better-sqlite3")}');` +
    `if(process.versions.modules!=='${ABI}'){console.error('ABI MISMATCH',process.versions.modules);process.exit(1)}` +
    `console.log('staged better-sqlite3 loads OK, ABI',process.versions.modules)"`,
  { stdio: "inherit" },
);

console.log("runtime staged OK ->", runtime);
