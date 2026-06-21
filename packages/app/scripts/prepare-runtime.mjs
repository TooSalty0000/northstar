// Stages the production sidecar runtime for packaging:
//   (1) an official Node 22 (ABI 127) darwin-arm64 binary, and
//   (2) a server-scoped node_modules containing better-sqlite3 (ABI-127 prebuild)
//       + its 2 runtime deps, copied from the HOISTED root node_modules.
// Output: packages/app/build/runtime/{node-darwin-arm64, server-node_modules}
// The shipped better-sqlite3 is the Node-22/ABI-127 prebuild and is run by the
// shipped Node 22 binary — same ABI, zero rebuild. NEVER run @electron/rebuild here.
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const NODE_VER = "v22.17.0"; // Node 22 -> ABI 127 (matches the better-sqlite3 prebuild)
const ABI = "127"; // Node 22 NODE_MODULE_VERSION
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
// Already Apple-signed; ad-hoc re-sign defensively for arm64 Gatekeeper.
execSync(`codesign --force -s - "${nodeBin}"`, { stdio: "inherit" });

// ---- 2) Stage server-scoped node_modules from the HOISTED root deps ----
const stage = path.join(runtime, "server-node_modules");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const m of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
  const from = path.join(repoRoot, "node_modules", m);
  if (!existsSync(from)) throw new Error(`Expected hoisted dep missing: ${from}`);
  cpSync(from, path.join(stage, m), { recursive: true, dereference: true });
}

const addon = path.join(stage, "better-sqlite3", "build", "Release", "better_sqlite3.node");
if (!existsSync(addon)) throw new Error("better_sqlite3.node missing: " + addon);
execSync(`codesign --force -s - "${addon}"`, { stdio: "inherit" });

// BUILD-TIME ABI ASSERTION: load the staged addon with the SHIPPED node binary.
execSync(
  `"${nodeBin}" -e ` +
    `"require('${path.join(stage, "better-sqlite3")}');` +
    `if(process.versions.modules!=='${ABI}'){console.error('ABI MISMATCH',process.versions.modules);process.exit(1)}` +
    `console.log('staged better-sqlite3 loads OK, ABI',process.versions.modules)"`,
  { stdio: "inherit" },
);

console.log("runtime staged OK ->", runtime);
