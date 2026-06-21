import { dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { MCP_URL, resolveApiBase } from "@northstar/shared";

// .mcp.json written into work repos always targets the PRODUCTION endpoint (MCP_URL,
// :7777) — that's the daily-driver app. The registry fetch talks to THIS running app.
const API_BASE = resolveApiBase();
import { SKILL_MD } from "./repoTemplates";

const NORTHSTAR_ENTRY = { type: "http", url: MCP_URL };

/**
 * Add the northstar server to a repo's .mcp.json WITHOUT clobbering existing servers.
 * Reads + parses the file, merges, writes back. Never overwrites blindly.
 */
function upsertMcpJson(dir: string): { ok: boolean; error?: string } {
  const file = path.join(dir, ".mcp.json");
  let data: any = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (raw.length) {
      try {
        data = JSON.parse(raw);
      } catch {
        // Do NOT destroy a malformed config — back it up and abort.
        const bak = `${file}.bak-${Date.now()}`;
        fs.copyFileSync(file, bak);
        return {
          ok: false,
          error: `Existing .mcp.json isn't valid JSON. Left it untouched and saved a copy to ${path.basename(bak)}. Fix it, then add the repo again.`,
        };
      }
    }
    if (typeof data !== "object" || data === null) data = {};
  }
  if (!data.mcpServers || typeof data.mcpServers !== "object") data.mcpServers = {};
  data.mcpServers.northstar = NORTHSTAR_ENTRY;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return { ok: true };
}

/**
 * Remove ONLY the northstar server from .mcp.json, preserving every other server.
 * Deletes the file only if northstar was the sole content.
 */
function removeNorthstarFromMcpJson(dir: string) {
  const file = path.join(dir, ".mcp.json");
  if (!fs.existsSync(file)) return;
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return; // leave malformed files alone
  }
  if (data?.mcpServers && typeof data.mcpServers === "object") delete data.mcpServers.northstar;
  const hasOtherServers = data?.mcpServers && Object.keys(data.mcpServers).length > 0;
  const hasOtherTopKeys = Object.keys(data ?? {}).some((k) => k !== "mcpServers");
  if (!hasOtherServers && !hasOtherTopKeys) {
    fs.rmSync(file, { force: true }); // only northstar was here → safe to remove
  } else {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  }
}

/**
 * "Add repo to Northstar": pick a repo, MERGE the northstar MCP server into its
 * .mcp.json, write the logging skill, and register it under a Space.
 */
export async function addRepo(spaceId?: string): Promise<{ ok: boolean; dir?: string; error?: string }> {
  const result = await dialog.showOpenDialog({
    title: "Choose a work repo to connect to Northstar",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Connect repo",
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false };
  const dir = result.filePaths[0];
  try {
    const merged = upsertMcpJson(dir);
    if (!merged.ok) {
      await dialog.showMessageBox({ type: "error", title: "Couldn't update .mcp.json", message: merged.error! });
      return { ok: false, error: merged.error };
    }
    const skillDir = path.join(dir, ".claude", "skills", "northstar-logging");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), SKILL_MD);
    await fetch(`${API_BASE}/api/repos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dir, name: path.basename(dir), spaceId }),
    }).catch(() => {});
    await dialog.showMessageBox({
      type: "info",
      title: "Repo connected",
      message: "Northstar was merged into this repo's .mcp.json (existing servers untouched).",
      detail:
        `Updated .mcp.json and wrote .claude/skills/northstar-logging/SKILL.md in:\n${dir}\n\n` +
        "Open Claude Code there and approve the 'northstar' MCP server. Its work files into the chosen Space automatically.",
    });
    return { ok: true, dir };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "write failed" };
  }
}

/**
 * Remove a repo: confirm, optionally strip ONLY northstar from .mcp.json + delete the
 * skill (never touches other servers), then unregister it from the server.
 */
export async function removeRepo(repo: {
  id: string;
  path: string;
  name: string;
}): Promise<{ ok: boolean; deletedFiles?: boolean }> {
  const choice = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Remove northstar config", "Just unregister", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "Remove repo",
    message: `Remove “${repo.name}” from Northstar?`,
    detail:
      "“Remove northstar config” strips only the northstar entry from .mcp.json (your other MCP " +
      "servers are kept) and deletes the northstar-logging skill in:\n" +
      `${repo.path}\n\n` +
      "“Just unregister” forgets it in Northstar but leaves all files in place.",
  });
  if (choice.response === 2) return { ok: false };

  let deletedFiles = false;
  if (choice.response === 0) {
    try {
      removeNorthstarFromMcpJson(repo.path);
      fs.rmSync(path.join(repo.path, ".claude", "skills", "northstar-logging"), { recursive: true, force: true });
      deletedFiles = true;
    } catch {
      /* best effort */
    }
  }
  await fetch(`${API_BASE}/api/repos/${repo.id}`, { method: "DELETE" }).catch(() => {});
  return { ok: true, deletedFiles };
}
