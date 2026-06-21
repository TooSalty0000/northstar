import { create } from "zustand";

export type View = "today" | "board" | "report" | "productivity" | "connections";

interface UIState {
  view: View;
  selectedTaskId: string | null;
  /** Active Space id, or null = "All Spaces". */
  activeSpaceId: string | null;
  setView: (v: View) => void;
  selectTask: (id: string | null) => void;
  setSpace: (id: string | null) => void;
}

export const useUI = create<UIState>((set) => ({
  view: "today",
  selectedTaskId: null,
  activeSpaceId: null,
  setView: (view) => set({ view }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  setSpace: (activeSpaceId) => set({ activeSpaceId }),
}));
