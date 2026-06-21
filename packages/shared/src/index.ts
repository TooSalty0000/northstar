// ============================================================================
// Northstar shared contract — types + constants used across server / app.
// Keep this dependency-free (no zod, no runtime libs) so every layer can import it.
// ============================================================================

// ---- network / server ----
export const NORTHSTAR_HOST = "127.0.0.1";
export const NORTHSTAR_PORT = 7777;
export const MCP_PATH = "/mcp";
/** Fixed production endpoint — used in the .mcp.json written into work repos (always prod). */
export const API_BASE = `http://${NORTHSTAR_HOST}:${NORTHSTAR_PORT}`;
export const MCP_URL = `${API_BASE}${MCP_PATH}`;

/**
 * Runtime-resolved port. A dev profile sets NORTHSTAR_PORT (e.g. 7788) so the dev
 * app never collides with the installed production app on 7777. Safe in browser
 * (no process) — falls back to the default there.
 */
export function resolvePort(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NORTHSTAR_PORT;
  const p = Number(env);
  return Number.isFinite(p) && p > 0 ? p : NORTHSTAR_PORT;
}
export function resolveApiBase(): string {
  return `http://${NORTHSTAR_HOST}:${resolvePort()}`;
}
export function resolveMcpUrl(): string {
  return `${resolveApiBase()}${MCP_PATH}`;
}

// ---- product tuning (locked in spec §4.2 / §9) ----
/** Day boundary offset: a "day" runs 04:00 → next 04:00 local (late-night work counts to the day it started). */
export const DEFAULT_DAY_START_HOUR = 4;
/** Accomplishment-unit weights for the Today bar. */
export const WEIGHTS = {
  subtask_done: 1,
  task_completed: 3,
  hotfix: 2,
} as const;
/** In-progress task untouched ≥ this many days gets the neutral "last touched N days ago" aid. */
export const STALE_DAYS_DEFAULT = 3;
/** UI poll cadence (ms) for near-real-time updates without WebSockets. */
export const POLL_INTERVAL_MS = 20_000;

// ---- domain enums ----
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review", "done"];
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

export type Actor = "user" | "claude";

export type ActivityType =
  | "task_created"
  | "subtask_added"
  | "subtask_done"
  | "status_changed"
  | "task_completed"
  | "task_focused"
  | "task_unfocused"
  | "hotfix"
  | "task_archived"
  | "day_ended";

// ---- entities ----
export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  doneAt: string | null;
  position: number;
}

export interface Space {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
  position: number;
  isDefault: boolean;
  createdAt: string;
}

export interface Repo {
  id: string;
  path: string;
  name: string;
  spaceId: string | null;
  addedAt: string;
  lastSeen?: string | null; // derived from activity_log
  eventCount?: number; // derived
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  repo: string | null;
  spaceId: string | null;
  deadline: string | null;
  focusDate: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastTouchedAt: string;
  completedAt: string | null;
  // ---- Jira link (null unless this task came from / is linked to Jira) ----
  externalProvider: string | null; // 'jira'
  externalId: string | null; // issue key, e.g. PROJ-123
  externalUrl: string | null;
  syncState: string | null; // synced | pending | error | conflict | unassigned
  sprintName: string | null; // neutral tag, never a deadline
  assigneeName: string | null; // Jira assignee display name (shared-board mirror)
  // ---- derived (populated by queries) ----
  subtasks?: Subtask[];
  total?: number;
  doneCount?: number;
  pct?: number; // 0..1
}

export type JiraAuthState = "ok" | "revoked" | "error";

export interface JiraLink {
  spaceId: string;
  siteUrl: string;
  email: string;
  accountId: string | null;
  projectKey: string;
  projectId: string | null;
  boardId: number | null;
  reviewStatusId: string | null;
  issueTypeId: string | null;
  authState: JiraAuthState;
  lastPullAt: string | null;
  connected: boolean; // is there a live in-memory session?
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}
export interface JiraBoard {
  id: number;
  name: string;
  type: string; // "scrum" | "kanban"
}
export interface JiraStatusOption {
  id: string;
  name: string;
  category: string; // "new" | "indeterminate" | "done"
}

export interface ActivityEvent {
  id: number;
  ts: string;
  type: ActivityType;
  taskId: string | null;
  subtaskId: string | null;
  actor: Actor;
  repo: string | null;
  payload: Record<string, unknown> | null;
  taskTitle?: string | null; // joined for display
}

// ---- API response shapes ----
export interface HealthResponse {
  status: "ok";
  version: string;
  uptimeMs: number;
  nonce: string;
}

export interface TodayBar {
  completedUnits: number;
  plannedRemainingUnits: number;
  denominator: number;
  fillPct: number; // 0..1, capped at 1 (overflow indicated separately)
  overflow: boolean; // true when you've done more than the morning's plan
  breakdown: { subtasks: number; tasks: number; hotfixes: number };
}

export interface TodayResponse {
  localDate: string;
  bar: TodayBar;
  focusTasks: Task[];
  staleTasks: Task[]; // in-progress, untouched ≥ STALE_DAYS, not already focused
  completedEvents: ActivityEvent[];
}

export interface DailyReport {
  localDate: string;
  tasksCompleted: Task[];
  subtasksChecked: number;
  hotfixes: ActivityEvent[];
  statusChanges: ActivityEvent[];
  units: number;
  byActor: Record<Actor, number>;
  byRepo: Record<string, number>;
  events: ActivityEvent[];
  ended: boolean; // has this day been "ended" (the End Day ritual)?
  endedAt: string | null;
}

export interface StatsDay {
  localDate: string;
  units: number;
  subtasks: number;
  tasks: number;
  hotfixes: number;
}

export interface StatsResponse {
  days: StatsDay[];
  streak: number;
  totals: { subtasks: number; tasks: number; hotfixes: number; units: number };
  byActor: Record<Actor, number>;
}

export interface ConnectionInfo {
  repo: string;
  lastSeen: string;
  eventCount: number;
}

// ---- server lifecycle status surfaced to the tray/renderer ----
export type ServerStatus = "starting" | "running" | "paused" | "crashed";
