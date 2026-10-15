// Entry point: build the panels, wire interactions, run transforms, autosave.

import "./styles.css";
import { emptyProject } from "./model";
import { store } from "./store";
import { runTransform } from "./runner";
import { transformById } from "./transforms";
import { GraphView } from "./ui/graph";
import { Palette } from "./ui/palette";
import { Inspector } from "./ui/inspector";
import { ContextMenu } from "./ui/menu";
import { Toolbar } from "./ui/toolbar";
import { confirmDialog } from "./ui/dialogs";
import { saveCase } from "./ui/files";
import { $, h, toast } from "./ui/dom";

store.load(emptyProject(), null);

const graph = new GraphView($("#graph"));
const palette = new Palette($("#palette"));
const inspector = new Inspector($("#inspector"));
const statusEl = $("#status");

// ---- status bar ----
function renderStatus(progress?: { done: number; total: number; label: string }) {
  const p = store.project;
  statusEl.replaceChildren(
    h("span", {}, `${p.entities.length} entities`),
    h("span", {}, `${p.links.length} links`),
    h("span", { class: "spacer" }),
    progress
      ? h("span", { class: "progress" },
          h("span", {}, progress.label),
          h("span", { class: "bar" }, h("div", { style: `width:${Math.round((progress.done / progress.total) * 100)}%` })),
          h("span", {}, `${progress.done}/${progress.total}`))
      : h("span", {}, store.path ? store.path.split("/").pop()! : "unsaved"),
  );
}
store.on(() => renderStatus());
renderStatus();

// ---- running transforms ----
let running = false;
async function run(transformId: string, entityIds: string[]) {
  if (running) { toast("A lookup is already running", "error"); return; }
  const t = transformById(transformId);
  if (!t) return;
  running = true;
  const entities = entityIds.map((id) => store.entity(id)!).filter(Boolean);
  try {
    const outcomes = await runTransform(t, entities, (done, total) => renderStatus({ done, total, label: t.name }));
    const added = outcomes.reduce((s, o) => s + o.added, 0);
    const errs = outcomes.filter((o) => o.error);
    if (errs.length) toast(errs[0].error!, "error");
    else toast(`${t.name}: ${added} new ${added === 1 ? "entity" : "entities"}`);
  } catch (e) {
    toast(`Lookup failed: ${e instanceof Error ? e.message : e}`, "error");
  } finally {
    running = false;
    renderStatus();
  }
}

// ---- selection plumbing ----
graph.onSelect = (ids) => { inspector.show(ids); graph.highlightNeighbourhood(ids.length === 1 ? ids[0] : null); };
graph.onBackground = () => { inspector.show([]); graph.highlightNeighbourhood(null); };
graph.onContext = (id, x, y) => menu.open(id, graph.selectedIds(), x, y);
palette.onAdd = (id) => graph.focus(id);
inspector.onRunTransform = (tid, ids) => run(tid, ids);
inspector.onFocus = (id) => graph.focus(id);

async function deleteSelected() {
  const ids = graph.selectedIds();
  if (!ids.length) return;
  if (ids.length > 3 && !(await confirmDialog(`Delete ${ids.length} entities and their links?`, "Delete"))) return;
  store.checkpoint();
  store.removeEntities(ids);
  inspector.show([]);
}

const menu = new ContextMenu({
  runTransform: run,
  linkSelected: () => {
    const ids = graph.selectedIds();
    if (ids.length === 2) { store.checkpoint(); store.addLink(ids[0], ids[1], ""); toast("Linked"); }
  },
  deleteSelected,
  selectNeighbours: (id) => {
    const hood = graph.cy.getElementById(id).closedNeighborhood().nodes();
    graph.cy.nodes().unselect();
    hood.select();
  },
});

new Toolbar($("#toolbar"), {
  onLayout: () => graph.layout(),
  onFit: () => graph.fit(),
  onSettingsChanged: () => inspector.refreshLocks(),
  onUndo: () => { if (!store.undo()) toast("Nothing to undo"); },
  onRedo: () => { if (!store.redo()) toast("Nothing to redo"); },
});

// ---- keyboard shortcuts ----
document.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName);
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveCase(); return; }
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
  if (mod && e.key.toLowerCase() === "l") { e.preventDefault(); graph.layout(); return; }
  if (typing) return;
  if ((e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); deleteSelected(); }
  if (e.key.toLowerCase() === "l") {
    const ids = graph.selectedIds();
    if (ids.length === 2) { store.checkpoint(); store.addLink(ids[0], ids[1], ""); toast("Linked"); }
  }
});

// ---- autosave (every 30s once a file path exists) + warn on close ----
setInterval(() => { if (store.dirty && store.path) saveCase(); }, 30_000);
window.addEventListener("beforeunload", (e) => {
  if (store.dirty) { e.preventDefault(); e.returnValue = ""; }
});

renderStatus();
