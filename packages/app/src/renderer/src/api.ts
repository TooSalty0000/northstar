import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DailyReport,
  JiraBoard,
  JiraLink,
  JiraProject,
  JiraStatusOption,
  Repo,
  Space,
  StatsResponse,
  Task,
  TaskStatus,
  TodayResponse,
} from "@northstar/shared";
import { POLL_INTERVAL_MS } from "@northstar/shared";
import { useUI } from "./store";

const BASE = (window.northstar?.apiBase ?? "http://127.0.0.1:7777") + "/api";

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
const get = <T>(p: string) => req<T>(p);
const post = <T>(p: string, body?: unknown) =>
  req<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const patch = <T>(p: string, body?: unknown) =>
  req<T>(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });
const del = <T>(p: string) => req<T>(p, { method: "DELETE" });

const spaceParam = (space: string | null) => (space ? `space=${space}` : "");
const qs = (...parts: string[]) => {
  const p = parts.filter(Boolean);
  return p.length ? `?${p.join("&")}` : "";
};

/** Active space id, or null for "All Spaces". */
export const useSpaceId = () => useUI((s) => s.activeSpaceId);

// ---- queries ----
export const useSpaces = () =>
  useQuery({ queryKey: ["spaces"], queryFn: () => get<Space[]>("/spaces"), refetchInterval: POLL_INTERVAL_MS });

export function useToday() {
  const space = useSpaceId();
  return useQuery({
    queryKey: ["today", space],
    queryFn: () => get<TodayResponse>(`/today${qs(spaceParam(space))}`),
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export function useTasks(status?: TaskStatus) {
  const space = useSpaceId();
  return useQuery({
    queryKey: ["tasks", status ?? "all", space],
    queryFn: () => get<Task[]>(`/tasks${qs(status ? `status=${status}` : "", spaceParam(space))}`),
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export const useTask = (id: string | null) =>
  useQuery({ enabled: !!id, queryKey: ["task", id], queryFn: () => get<Task>(`/tasks/${id}`), refetchInterval: POLL_INTERVAL_MS });

export function useReport(date?: string) {
  const space = useSpaceId();
  return useQuery({
    queryKey: ["report", date ?? "today", space],
    queryFn: () => get<DailyReport>(`/report${qs(date ? `date=${date}` : "", spaceParam(space))}`),
  });
}

export function useStats() {
  const space = useSpaceId();
  return useQuery({
    queryKey: ["stats", space],
    queryFn: () => get<StatsResponse>(`/stats${qs(spaceParam(space))}`),
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export function useRepos() {
  const space = useSpaceId();
  return useQuery({
    queryKey: ["repos", space],
    queryFn: () => get<Repo[]>(`/repos${qs(spaceParam(space))}`),
    refetchInterval: POLL_INTERVAL_MS,
  });
}

// ---- mutations ----
export const api = {
  createTask: (b: {
    title: string;
    description?: string;
    repo?: string;
    spaceId?: string;
    subtasks?: string[];
    focusToday?: boolean;
  }) => post<Task>("/tasks", b),
  patchTask: ({ id, ...b }: { id: string; title?: string; description?: string | null; deadline?: string | null }) =>
    patch<Task>(`/tasks/${id}`, b),
  archiveTask: ({ id }: { id: string }) => del<{ ok: true }>(`/tasks/${id}`),
  setStatus: ({ id, status }: { id: string; status: TaskStatus }) => post<Task>(`/tasks/${id}/status`, { status }),
  focus: ({ id, on }: { id: string; on: boolean }) =>
    on ? post<Task>(`/tasks/${id}/focus`) : del<Task>(`/tasks/${id}/focus`),
  addSubtask: ({ id, title }: { id: string; title: string }) => post<Task>(`/tasks/${id}/subtasks`, { title }),
  checkSubtask: ({ id, sid, done }: { id: string; sid: string; done: boolean }) =>
    patch<Task>(`/tasks/${id}/subtasks/${sid}`, { done }),
  deleteSubtask: ({ id, sid }: { id: string; sid: string }) => del<Task>(`/tasks/${id}/subtasks/${sid}`),
  hotfix: (b: { title: string; description?: string; repo?: string; spaceId?: string }) => post<Task>("/hotfix", b),
  endDay: (date?: string) => post<{ ended: boolean; endedAt: string }>("/day/end", { date }),
  cancelDay: (date?: string) => post<{ ended: boolean }>("/day/cancel", { date }),
  createSpace: (b: { name: string; emoji?: string; color?: string }) => post<Space>("/spaces", b),
  updateSpace: ({ id, ...b }: { id: string; name?: string; emoji?: string | null; color?: string | null }) =>
    patch<Space>(`/spaces/${id}`, b),
  deleteSpace: ({ id }: { id: string }) => del<{ ok: boolean; error?: string }>(`/spaces/${id}`),
};

// ---- Jira ----
export function useJiraLink() {
  const space = useSpaceId();
  return useQuery({
    enabled: !!space && space !== "all",
    queryKey: ["jira-link", space],
    queryFn: async () => {
      const r = await get<JiraLink | { error: string }>(`/jira/link?space=${space}`);
      return "spaceId" in r ? (r as JiraLink) : null;
    },
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export const jiraApi = {
  projects: (space: string) => get<JiraProject[]>(`/jira/projects?space=${space}`),
  statuses: (space: string, projectKey: string) =>
    get<JiraStatusOption[]>(`/jira/statuses?space=${space}&projectKey=${encodeURIComponent(projectKey)}`),
  boards: (space: string, projectKeyOrId: string) =>
    get<JiraBoard[]>(`/jira/boards?space=${space}&projectKeyOrId=${encodeURIComponent(projectKeyOrId)}`),
  saveLink: (body: Record<string, unknown>) => post<JiraLink>("/jira/links", body),
  pull: (spaceId: string, sprintOnly?: boolean) =>
    post<{ imported: number; updated: number; archived: number }>("/jira/pull", { spaceId, sprintOnly }),
  pushLocal: (spaceId: string) => post<{ pushed: number }>("/jira/push-local", { spaceId }),
};

export function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
