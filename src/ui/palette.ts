// Left sidebar: quick-add box (auto-detects type from pasted text) and the
// entity-type palette.

import { detectType, ENTITY_TYPES, typeDef } from "../entities";
import type { EntityTypeId } from "../model";
import { store } from "../store";
import { h, icon } from "./dom";

export class Palette {
  private detectedEl: HTMLElement;
  private input: HTMLInputElement;
  onAdd: (id: string) => void = () => {};

  constructor(private root: HTMLElement) {
    this.input = h("input", { placeholder: "Paste domain, IP, URL…", spellcheck: false });
    this.detectedEl = h("div", { class: "detected" });
    this.input.addEventListener("input", () => this.updateDetected());
    this.input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.commitQuickAdd();
    });
    this.render();
  }

  private updateDetected() {
    const v = this.input.value.trim();
    this.detectedEl.textContent = v ? `→ ${typeDef(detectType(v)).label}` : "";
  }

  private commitQuickAdd() {
    const v = this.input.value.trim();
    if (!v) return;
    store.checkpoint();
    const { entity } = store.addEntity({ type: detectType(v), value: v });
    this.input.value = "";
    this.updateDetected();
    this.onAdd(entity.id);
  }

  private addType(type: EntityTypeId) {
    const v = this.input.value.trim();
    store.checkpoint();
    const { entity } = store.addEntity({ type, value: v || `New ${typeDef(type).label}` });
    this.input.value = "";
    this.updateDetected();
    this.onAdd(entity.id);
  }

  private render() {
    const groups = new Map<string, typeof ENTITY_TYPES>();
    for (const t of ENTITY_TYPES) groups.set(t.category, [...(groups.get(t.category) ?? []), t]);
    this.root.replaceChildren(
      h("div", { class: "quick-add" },
        h("label", {}, "Quick add"),
        this.input,
        this.detectedEl,
      ),
      ...[...groups.entries()].flatMap(([cat, types]) => [
        h("div", { class: "palette-group" }, cat),
        ...types.map((t) =>
          h("button", { class: "type-btn", title: `Add ${t.label}`, onclick: () => this.addType(t.id) },
            h("span", { class: "type-dot", style: `background:${t.color}` }),
            icon(t.icon),
            t.label,
          ),
        ),
      ]),
    );
  }
}
