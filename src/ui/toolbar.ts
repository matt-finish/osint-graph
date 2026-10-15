// Top toolbar. Buttons delegate to files.ts / dialogs.ts; the title reflects the
// open case and dirty state.

import { store } from "../store";
import { openApiKeys, openCaseInfo, openSettings } from "./dialogs";
import { h } from "./dom";
import { exports, importMtgx, newCase, openCase, saveCase } from "./files";

export interface ToolbarHandlers {
  onLayout(): void;
  onFit(): void;
  onSettingsChanged(): void;
  onUndo(): void;
  onRedo(): void;
}

export class Toolbar {
  private titleEl = h("span", { class: "title" });

  constructor(private root: HTMLElement, private handlers: ToolbarHandlers) {
    this.render();
    store.on(() => this.updateTitle());
  }

  private updateTitle() {
    this.titleEl.textContent = store.project.name + (store.dirty ? " •" : "");
    this.titleEl.classList.toggle("dirty", store.dirty);
  }

  private menuButton(label: string, items: [string, () => void][]) {
    const btn = h("button", { onclick: (e: Event) => { e.stopPropagation(); this.popup(btn, items); } }, label, h("span", { style: "font-size:9px" }, "▾"));
    return btn;
  }

  private popup(anchor: HTMLElement, items: [string, () => void][]) {
    const menu = document.getElementById("menu")!;
    menu.replaceChildren(...items.map(([label, fn]) => h("div", { class: "menu-item", onclick: () => { menu.hidden = true; fn(); } }, label)));
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 4}px`;
  }

  private render() {
    this.updateTitle();
    this.root.replaceChildren(
      this.titleEl,
      h("span", { class: "sep" }),
      this.menuButton("File", [
        ["New case", () => newCase()],
        ["Open…", () => openCase()],
        ["Save", () => saveCase()],
        ["Save as…", () => saveCase(true)],
      ]),
      this.menuButton("Import / Export", [
        ["Import Maltego .mtgx…", () => importMtgx()],
        ["Export Maltego .mtgx…", () => exports.mtgx()],
        ["Export entities CSV…", () => exports.entitiesCsv()],
        ["Export links CSV…", () => exports.linksCsv()],
        ["Export case report (Markdown)…", () => exports.report()],
      ]),
      h("button", { title: "Case details", onclick: () => openCaseInfo() }, "Case"),
      h("span", { class: "sep" }),
      h("button", { title: "Undo (⌘Z)", onclick: () => this.handlers.onUndo() }, "Undo"),
      h("button", { title: "Redo (⇧⌘Z)", onclick: () => this.handlers.onRedo() }, "Redo"),
      h("span", { class: "sep" }),
      h("button", { title: "Auto-layout (⌘L)", onclick: () => this.handlers.onLayout() }, "Layout"),
      h("button", { title: "Fit to screen", onclick: () => this.handlers.onFit() }, "Fit"),
      h("span", { class: "spacer" }),
      h("button", { onclick: () => openApiKeys() }, "API keys"),
      h("button", { onclick: () => openSettings(() => this.handlers.onSettingsChanged()) }, "Settings"),
    );
  }
}
