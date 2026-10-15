// Right-click context menu on the graph.

import { isConfigured, PROVIDERS } from "../keys";
import { store } from "../store";
import { transformsFor } from "../transforms";
import { h } from "./dom";

export interface MenuActions {
  runTransform(transformId: string, entityIds: string[]): void;
  linkSelected(): void;
  deleteSelected(): void;
  selectNeighbours(id: string): void;
}

export class ContextMenu {
  private el = document.getElementById("menu")!;

  constructor(private actions: MenuActions) {
    document.addEventListener("click", () => this.hide());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.hide(); });
    window.addEventListener("resize", () => this.hide());
  }

  hide() { this.el.hidden = true; }

  async open(nodeId: string | null, selected: string[], x: number, y: number) {
    const ids = nodeId && !selected.includes(nodeId) ? [nodeId] : selected.length ? selected : nodeId ? [nodeId] : [];
    const items: HTMLElement[] = [];

    if (ids.length === 0) {
      this.hide();
      return;
    }

    if (ids.length === 1) {
      const e = store.entity(ids[0]);
      if (e) {
        const ts = transformsFor(e.type);
        items.push(h("div", { class: "menu-label" }, `Lookups — ${e.value}`));
        const configured = new Map<string, boolean>();
        for (const p of PROVIDERS) configured.set(p.id, await isConfigured(p.id));
        for (const t of ts) {
          const locked = t.provider !== "free" && !configured.get(t.provider);
          items.push(h("div", { class: `menu-item${locked ? " locked" : ""}`, title: locked ? `Needs ${t.provider} API key` : t.description, onclick: () => { this.hide(); this.actions.runTransform(t.id, ids); } }, t.name));
        }
        if (!ts.length) items.push(h("div", { class: "menu-item", style: "opacity:.6;cursor:default" }, "No lookups for this type"));
        items.push(h("div", { class: "menu-sep" }));
        items.push(h("div", { class: "menu-item", onclick: () => { this.hide(); this.actions.selectNeighbours(ids[0]); } }, "Select connected"));
      }
    } else {
      const types = new Set(ids.map((id) => store.entity(id)?.type));
      items.push(h("div", { class: "menu-label" }, `${ids.length} entities`));
      if (ids.length === 2) items.push(h("div", { class: "menu-item", onclick: () => { this.hide(); this.actions.linkSelected(); } }, "Link these two"));
      if (types.size === 1) {
        const ts = transformsFor([...types][0]!);
        const configured = new Map<string, boolean>();
        for (const p of PROVIDERS) configured.set(p.id, await isConfigured(p.id));
        if (ts.length) items.push(h("div", { class: "menu-sep" }), h("div", { class: "menu-label" }, "Run on all"));
        for (const t of ts) {
          const locked = t.provider !== "free" && !configured.get(t.provider);
          items.push(h("div", { class: `menu-item${locked ? " locked" : ""}`, onclick: () => { this.hide(); this.actions.runTransform(t.id, ids); } }, t.name));
        }
      }
    }

    items.push(h("div", { class: "menu-sep" }));
    items.push(h("div", { class: "menu-item", onclick: () => { this.hide(); this.actions.deleteSelected(); } }, `Delete ${ids.length > 1 ? ids.length : ""}`.trim()));

    this.el.replaceChildren(...items);
    this.el.hidden = false;
    // Keep the menu on screen.
    const rect = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    this.el.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  }
}
