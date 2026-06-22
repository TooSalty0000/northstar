import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** What happens when the main window is closed (the [x] / Cmd-W). */
export type CloseAction = "ask" | "hide" | "quit";

interface Prefs {
  closeAction?: CloseAction;
}

const file = () => path.join(app.getPath("userData"), "prefs.json");

function read(): Prefs {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Prefs;
  } catch {
    return {};
  }
}

function write(next: Prefs): void {
  try {
    writeFileSync(file(), JSON.stringify(next, null, 2));
  } catch {
    /* best effort — a missing pref just falls back to "ask" */
  }
}

export function getCloseAction(): CloseAction {
  return read().closeAction ?? "ask";
}

export function setCloseAction(action: CloseAction): void {
  write({ ...read(), closeAction: action });
}
