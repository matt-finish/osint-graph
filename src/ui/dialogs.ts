// Modal dialogs: API keys, case info, and settings. All built with the <dialog>
// element so Esc / backdrop click close them.

import { openExternal } from "../backend";
import { getField, loadSettings, PROVIDERS, saveSettings, setField, type Settings } from "../keys";
import { store } from "../store";
import { h, toast } from "./dom";

const dlg = () => document.getElementById("dialog") as HTMLDialogElement;

function frame(title: string, body: HTMLElement, footer: HTMLElement[]): void {
  const d = dlg();
  d.replaceChildren(
    h("form", { method: "dialog" },
      h("div", { class: "dlg-head" }, title, h("span", { class: "spacer" }), h("button", { value: "cancel", title: "Close" }, "✕")),
      h("div", { class: "dlg-body" }, body),
      h("div", { class: "dlg-foot" }, ...footer),
    ),
  );
  d.showModal();
}

export async function openApiKeys() {
  const body = h("div", {});
  const inputs = new Map<string, HTMLInputElement>();
  for (const p of PROVIDERS) {
    const configured = await (async () => { for (const f of p.fields) if (!f.optional && !(await getField(p.id, f.id))) return false; return true; })();
    const card = h("div", { class: "provider-card" },
      h("div", { class: "ph" },
        h("strong", {}, p.name),
        h("a", { href: "#", style: "font-size:12px", onclick: (e: Event) => { e.preventDefault(); openExternal(p.signup); } }, "Get key ↗"),
        h("span", { class: `status ${configured ? "on" : "off"}` }, configured ? "configured" : "not set"),
      ),
      h("div", { class: "notes" }, p.notes),
    );
    for (const f of p.fields) {
      const existing = await getField(p.id, f.id);
      const input = h("input", {
        type: f.secret ? "password" : "text",
        placeholder: f.secret && existing ? "•••••••• (saved — leave blank to keep)" : f.label + (f.optional ? " (optional)" : ""),
        value: f.secret ? "" : existing ?? "",
        autocomplete: "off",
        spellcheck: false,
      });
      inputs.set(`${p.id}.${f.id}`, input);
      card.append(h("label", { style: "margin-top:8px" }, f.label), input);
    }
    body.append(card);
  }

  const save = h("button", { class: "primary", type: "button" }, "Save keys");
  save.addEventListener("click", async () => {
    try {
      for (const [key, input] of inputs) {
        const [provider, field] = key.split(".");
        const fieldDef = PROVIDERS.find((p) => p.id === provider)!.fields.find((f) => f.id === field)!;
        const v = input.value.trim();
        // For secret fields, a blank box means "keep existing"; non-secret saves as typed.
        if (fieldDef.secret) { if (v) await setField(provider, field, v); }
        else await setField(provider, field, v);
      }
      toast("API keys saved to the system keychain");
      dlg().close();
    } catch (e) {
      toast(`Could not save keys: ${e instanceof Error ? e.message : e}`, "error");
    }
  });
  frame("API keys", body, [h("button", { value: "cancel", type: "submit" }, "Close"), save]);
}

export function openCaseInfo() {
  const c = store.project.case;
  const nameI = h("input", { value: store.project.name });
  const fields: [keyof typeof c, string, boolean][] = [
    ["client", "Client", false], ["reference", "Case reference", false], ["analyst", "Analyst", false],
    ["authorization", "Authorization (ticket / letter ref)", false], ["scope", "Scope", true], ["notes", "Case notes", true],
  ];
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  const body = h("div", {},
    h("div", { class: "field" }, h("label", {}, "Case name"), nameI),
    ...fields.map(([k, label, area]) => {
      const el = area ? (h("textarea", { class: "notes" }) as HTMLTextAreaElement) : h("input", {});
      el.value = c[k];
      inputs.set(k, el);
      return h("div", { class: "field" }, h("label", {}, label), el);
    }),
  );
  const save = h("button", { class: "primary", type: "button" }, "Save");
  save.addEventListener("click", () => {
    const next = { ...c };
    for (const [k, el] of inputs) (next as Record<string, string>)[k] = el.value;
    store.checkpoint();
    store.setMeta({ name: nameI.value || "Untitled case", case: next });
    toast("Case details saved");
    dlg().close();
  });
  frame("Case details", body, [h("button", { value: "cancel", type: "submit" }, "Cancel"), save]);
}

export function openSettings(onChange: () => void) {
  const s = loadSettings();
  const conc = h("input", { type: "number", min: 1, max: 20, value: s.usernameConcurrency });
  const max = h("input", { type: "number", min: 10, max: 2000, value: s.maxResultsPerTransform });
  const mask = h("input", { type: "checkbox" }) as HTMLInputElement;
  mask.checked = s.maskPasswords;
  const body = h("div", {},
    h("div", { class: "field" }, h("label", {}, "Max results added per lookup"), max),
    h("div", { class: "field" }, h("label", {}, "Username check concurrency"), conc),
    h("div", { class: "field" }, h("label", { style: "display:flex;gap:8px;align-items:center" }, mask, "Mask leaked passwords from breach lookups")),
    h("p", { class: "empty" }, "API keys are stored in the macOS Keychain, not in project files. Project files (.osint) contain only the graph. Breach lookups surface personal data — use them only within an authorized engagement."),
  );
  const save = h("button", { class: "primary", type: "button" }, "Save");
  save.addEventListener("click", () => {
    const next: Settings = { usernameConcurrency: Math.max(1, Math.min(20, +conc.value || 6)), maxResultsPerTransform: Math.max(10, Math.min(2000, +max.value || 250)), maskPasswords: mask.checked };
    saveSettings(next);
    onChange();
    toast("Settings saved");
    dlg().close();
  });
  frame("Settings", body, [h("button", { value: "cancel", type: "submit" }, "Cancel"), save]);
}

export function confirmDialog(message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const yes = h("button", { class: "danger", type: "button" }, confirmLabel);
    let decided = false;
    yes.addEventListener("click", () => { decided = true; resolve(true); dlg().close(); });
    dlg().addEventListener("close", () => { if (!decided) resolve(false); }, { once: true });
    frame("Please confirm", h("p", {}, message), [h("button", { value: "cancel", type: "submit" }, "Cancel"), yes]);
  });
}
