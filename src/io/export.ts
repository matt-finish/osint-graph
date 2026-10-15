// Flat exports for reporting: CSV tables and a Markdown case report.

import { typeDef } from "../entities";
import type { Project } from "../model";
import { transformById } from "../transforms";

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const csvRow = (cells: string[]) => cells.map(csvCell).join(",");

export function entitiesCsv(p: Project): string {
  const propKeys = [...new Set(p.entities.flatMap((e) => Object.keys(e.props)))].sort();
  const rows = [csvRow(["id", "type", "value", "source", "created", "tags", "notes", ...propKeys])];
  for (const e of p.entities) {
    rows.push(csvRow([e.id, e.type, e.value, e.source, e.created, e.tags.join("; "), e.notes, ...propKeys.map((k) => e.props[k] ?? "")]));
  }
  return rows.join("\n");
}

export function linksCsv(p: Project): string {
  const byId = new Map(p.entities.map((e) => [e.id, e]));
  const rows = [csvRow(["source_type", "source", "label", "target_type", "target", "kind", "transform", "created"])];
  for (const l of p.links) {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (!s || !t) continue;
    rows.push(csvRow([s.type, s.value, l.label, t.type, t.value, l.kind, l.transform ?? "", l.created]));
  }
  return rows.join("\n");
}

const mdEsc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function markdownReport(p: Project): string {
  const c = p.case;
  const out: string[] = [
    `# ${p.name}`,
    "",
    `| | |`,
    `|---|---|`,
    `| Client | ${mdEsc(c.client)} |`,
    `| Reference | ${mdEsc(c.reference)} |`,
    `| Analyst | ${mdEsc(c.analyst)} |`,
    `| Authorization | ${mdEsc(c.authorization)} |`,
    `| Scope | ${mdEsc(c.scope)} |`,
    `| Created | ${p.created.slice(0, 10)} |`,
    `| Last modified | ${p.modified.slice(0, 16).replace("T", " ")} |`,
    `| Entities / links | ${p.entities.length} / ${p.links.length} |`,
    "",
  ];
  if (c.notes) out.push("## Case notes", "", c.notes, "");
  out.push("## Findings by type", "");
  const byType = new Map<string, typeof p.entities>();
  for (const e of p.entities) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  const linksFrom = (id: string) =>
    p.links
      .filter((l) => l.source === id || l.target === id)
      .map((l) => {
        const other = p.entities.find((x) => x.id === (l.source === id ? l.target : l.source));
        return other ? `${l.source === id ? "→" : "←"} ${l.label ? `${l.label} ` : ""}${other.value}` : "";
      })
      .filter(Boolean);
  for (const [type, ents] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`### ${typeDef(type as never).label} (${ents.length})`, "");
    for (const e of ents.sort((a, b) => a.value.localeCompare(b.value))) {
      out.push(`- **${mdEsc(e.value)}**${e.tags.length ? ` _[${e.tags.join(", ")}]_` : ""}`);
      for (const [k, v] of Object.entries(e.props)) if (v && k !== "banner") out.push(`  - ${k}: ${mdEsc(v).slice(0, 300)}`);
      if (e.notes) out.push(`  - notes: ${mdEsc(e.notes)}`);
      const rel = linksFrom(e.id);
      if (rel.length) out.push(`  - links: ${rel.slice(0, 15).map(mdEsc).join("; ")}${rel.length > 15 ? ` (+${rel.length - 15} more)` : ""}`);
    }
    out.push("");
  }
  if (p.log.length) {
    out.push("## Transform log", "", "| Time (UTC) | Transform | Input | Added | Error |", "|---|---|---|---|---|");
    for (const l of [...p.log].reverse()) {
      out.push(`| ${l.ts.slice(0, 19).replace("T", " ")} | ${mdEsc(transformById(l.transform)?.name ?? l.transform)} | ${mdEsc(l.entity)} | ${l.added} | ${mdEsc(l.error ?? "")} |`);
    }
  }
  return out.join("\n") + "\n";
}
