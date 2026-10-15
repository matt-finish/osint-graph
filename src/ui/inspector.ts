// Right sidebar: details for the selected entity — editable value/notes/tags,
// collected properties, available transforms and manual search pivots.

import { openExternal } from "../backend";
import { typeDef } from "../entities";
import { isConfigured, PROVIDERS } from "../keys";
import type { Entity } from "../model";
import { pivotsFor } from "../pivots";
import { store } from "../store";
import { transformsFor } from "../transforms";
import { h, toast } from "./dom";

export class Inspector {
  onRunTransform: (transformId: string, entityIds: string[]) => void = () => {};
  onFocus: (id: string) => void = () => {};
  private current: string[] = [];

  constructor(private root: HTMLElement) {
    this.showEmpty();
    store.on((e) => {
      if (this.current.length === 1 && (e.kind === "entity-updated" || e.kind === "reset")) {
        if (store.entity(this.current[0])) this.show(this.current);
        else this.showEmpty();
      }
    });
  }

  private showEmpty() {
    this.root.replaceChildren(h("div", { class: "insp-section" }, h("p", { class: "empty" }, "Select an entity to see its details, run lookups and open search pivots.")));
  }

  show(ids: string[]) {
    this.current = ids;
    if (ids.length === 0) return this.showEmpty();
    if (ids.length > 1) return this.showMulti(ids);
    const e = store.entity(ids[0]);
    if (!e) return this.showEmpty();
    const def = typeDef(e.type);

    const valueInput = h("input", { value: e.value, spellcheck: false });
    valueInput.addEventListener("change", () => { store.checkpoint(); store.updateEntity(e.id, { value: valueInput.value }); });

    const notes = h("textarea", { class: "notes", placeholder: "Notes…" }) as HTMLTextAreaElement;
    notes.value = e.notes;
    notes.addEventListener("change", () => store.updateEntity(e.id, { notes: notes.value }));

    const tagInput = h("input", { placeholder: "Add tag + Enter", spellcheck: false });
    tagInput.addEventListener("keydown", (ev) => {
      if ((ev as KeyboardEvent).key !== "Enter" || !tagInput.value.trim()) return;
      store.updateEntity(e.id, { tags: [...new Set([...e.tags, tagInput.value.trim()])] });
      tagInput.value = "";
    });

    this.root.replaceChildren(
      h("div", { class: "insp-section" },
        h("div", { class: "insp-head" },
          h("span", { class: "badge", style: `background:${def.color}` }, def.label),
          h("span", { class: "spacer", style: "flex:1" }),
          h("button", { class: "danger", title: "Delete entity (Del)", onclick: () => { store.checkpoint(); store.removeEntities([e.id]); } }, "Delete"),
        ),
        h("label", { style: "margin-top:10px" }, "Value"),
        valueInput,
        h("label", { style: "margin-top:10px" }, "Tags"),
        h("div", {}, ...e.tags.map((t) => h("span", { class: "chip" }, t, " ", h("a", { href: "#", onclick: (ev: Event) => { ev.preventDefault(); store.updateEntity(e.id, { tags: e.tags.filter((x) => x !== t) }); } }, "×")))),
        tagInput,
        h("label", { style: "margin-top:10px" }, "Notes"),
        notes,
      ),
      this.propsSection(e),
      this.transformsSection(e),
      this.pivotsSection(e),
    );
    this.refreshLocks();
  }

  private showMulti(ids: string[]) {
    this.current = ids;
    const common = ids.map((id) => store.entity(id)!).filter(Boolean);
    const sharedTypes = [...new Set(common.map((e) => e.type))];
    const shared = sharedTypes.length === 1 ? transformsFor(sharedTypes[0]) : [];
    this.root.replaceChildren(
      h("div", { class: "insp-section" },
        h("div", { class: "insp-head" }, h("strong", {}, `${ids.length} entities selected`)),
        h("button", { class: "danger", style: "margin-top:10px", onclick: () => { store.checkpoint(); store.removeEntities(ids); } }, `Delete ${ids.length}`),
        ids.length === 2 ? h("button", { style: "margin-top:10px;margin-left:8px", onclick: () => { store.checkpoint(); store.addLink(ids[0], ids[1], ""); toast("Linked"); } }, "Link these two") : null,
      ),
      shared.length
        ? h("div", { class: "insp-section" },
            h("h3", {}, `Run on all ${ids.length}`),
            ...shared.map((t) => this.transformRow(t, ids)))
        : h("div", { class: "insp-section" }, h("p", { class: "empty" }, "Select entities of the same type to run a lookup on all of them.")),
    );
    this.refreshLocks();
  }

  private propsSection(e: Entity) {
    const rows = Object.entries(e.props).filter(([, v]) => v);
    return h("div", { class: "insp-section" },
      h("h3", {}, "Properties"),
      rows.length
        ? h("div", {}, ...rows.map(([k, v]) =>
            h("div", { class: "prop-row" },
              h("span", { class: "k" }, k),
              /^https?:\/\//.test(v)
                ? h("a", { class: "v", href: "#", onclick: (ev: Event) => { ev.preventDefault(); openExternal(v); } }, v)
                : h("span", { class: "v" }, v))))
        : h("p", { class: "empty" }, "No properties yet. Run a lookup to populate."),
    );
  }

  private transformRow(t: ReturnType<typeof transformsFor>[number], ids: string[]) {
    const provider = t.provider === "free" ? "" : PROVIDERS.find((p) => p.id === t.provider)?.name ?? t.provider;
    const row = h("div", { class: "transform-row", "data-provider": t.provider, onclick: () => this.onRunTransform(t.id, ids) },
      h("div", { style: "flex:1" },
        h("div", {}, t.name),
        h("div", { class: "desc" }, t.description),
      ),
      provider ? h("span", { class: "lock", title: `Needs ${provider} API key` }, provider) : null,
    );
    return row;
  }

  private transformsSection(e: Entity) {
    const ts = transformsFor(e.type);
    return h("div", { class: "insp-section" },
      h("h3", {}, `Lookups (${ts.length})`),
      ts.length ? h("div", {}, ...ts.map((t) => this.transformRow(t, [e.id]))) : h("p", { class: "empty" }, "No automated lookups for this type."),
    );
  }

  private pivotsSection(e: Entity) {
    const pivots = pivotsFor(e);
    const groups = new Map<string, typeof pivots>();
    for (const p of pivots) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
    return h("div", { class: "insp-section" },
      h("h3", {}, "Search pivots (open in browser)"),
      ...[...groups.entries()].flatMap(([g, ps]) => [
        h("div", { class: "pivot-group-label" }, g),
        ...ps.map((p) => h("div", { class: "pivot-row", onclick: () => openExternal(p.url) }, h("span", { style: "color:var(--muted)" }, "↗"), p.name)),
      ]),
    );
  }

  /** Grey out keyed transforms whose provider isn't configured. */
  async refreshLocks() {
    for (const row of this.root.querySelectorAll<HTMLElement>(".transform-row[data-provider]")) {
      const provider = row.dataset.provider!;
      if (provider === "free") continue;
      const ok = await isConfigured(provider);
      row.classList.toggle("locked", !ok);
    }
  }
}
