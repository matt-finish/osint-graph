// Open / save / import / export wiring. Uses native dialogs + file I/O inside
// Tauri, and download/upload fallbacks in browser dev mode.

import {
  downloadBlob, isTauri, pickBrowserFile, pickOpenPath, pickSavePath,
  readBinary, readText, writeBinary, writeText,
} from "../backend";
import { emptyProject, parseProject, type Project } from "../model";
import { store } from "../store";
import { entitiesCsv, linksCsv, markdownReport } from "../io/export";
import { exportMtgx, mergeImported, readMtgx } from "../io/mtgx";
import { toast } from "./dom";
import { confirmDialog } from "./dialogs";

const OSINT_FILTER = [{ name: "OSINT Graph", extensions: ["osint"] }];
const MTGX_FILTER = [{ name: "Maltego graph", extensions: ["mtgx"] }];

function safeName(ext: string) {
  const base = store.project.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "case";
  return `${base}.${ext}`;
}

export async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!store.dirty) return true;
  return confirmDialog("The current case has unsaved changes. Discard them?", "Discard");
}

export async function newCase() {
  if (!(await confirmDiscardIfDirty())) return;
  store.load(emptyProject(), null);
  toast("New case");
}

export async function openCase() {
  if (!(await confirmDiscardIfDirty())) return;
  try {
    let text: string;
    let path: string | null = null;
    if (isTauri) {
      path = await pickOpenPath(OSINT_FILTER);
      if (!path) return;
      text = await readText(path);
    } else {
      const f = await pickBrowserFile(".osint,application/json");
      if (!f) return;
      text = await f.text();
    }
    store.load(parseProject(text), path);
    toast(`Opened ${store.project.name}`);
  } catch (e) {
    toast(`Open failed: ${e instanceof Error ? e.message : e}`, "error");
  }
}

export async function saveCase(forceDialog = false): Promise<boolean> {
  try {
    const json = JSON.stringify(store.project, null, 2);
    if (!isTauri) {
      downloadBlob(safeName("osint"), new Blob([json], { type: "application/json" }));
      store.dirty = false;
      toast("Downloaded .osint file");
      return true;
    }
    let path = store.path;
    if (!path || forceDialog) path = await pickSavePath(safeName("osint"), OSINT_FILTER);
    if (!path) return false;
    await writeText(path, json);
    store.markSaved(path);
    toast(`Saved ${store.project.name}`);
    return true;
  } catch (e) {
    toast(`Save failed: ${e instanceof Error ? e.message : e}`, "error");
    return false;
  }
}

export async function importMtgx() {
  try {
    let bytes: Uint8Array;
    if (isTauri) {
      const path = await pickOpenPath(MTGX_FILTER);
      if (!path) return;
      bytes = await readBinary(path);
    } else {
      const f = await pickBrowserFile(".mtgx");
      if (!f) return;
      bytes = new Uint8Array(await f.arrayBuffer());
    }
    const graph = await readMtgx(bytes);
    const res = mergeImported(graph);
    toast(`Imported ${res.entities} entities, ${res.links} links${res.unknownTypes.length ? ` (${res.unknownTypes.length} unmapped Maltego types kept as notes)` : ""}`);
  } catch (e) {
    toast(`Import failed: ${e instanceof Error ? e.message : e}`, "error");
  }
}

async function writeOut(ext: string, mime: string, data: Uint8Array | string) {
  if (!isTauri) {
    downloadBlob(safeName(ext), new Blob([data as BlobPart], { type: mime }));
    return;
  }
  const path = await pickSavePath(safeName(ext), [{ name: ext.toUpperCase(), extensions: [ext] }]);
  if (!path) return;
  if (typeof data === "string") await writeText(path, data);
  else await writeBinary(path, data);
  toast(`Exported ${path.split("/").pop()}`);
}

export const exports = {
  async mtgx() {
    try { await writeOut("mtgx", "application/zip", await exportMtgx(store.project)); }
    catch (e) { toast(`Export failed: ${e instanceof Error ? e.message : e}`, "error"); }
  },
  async entitiesCsv() { await writeOut("csv", "text/csv", entitiesCsv(store.project)); },
  async linksCsv() { await writeOut("links.csv", "text/csv", linksCsv(store.project)); },
  async report() { await writeOut("md", "text/markdown", markdownReport(store.project)); },
};

export type { Project };
