// Maltego .mtgx interchange. An .mtgx is a zip holding Graphs/Graph1.graphml:
// GraphML whose node/edge <data> carry mtg:MaltegoEntity / mtg:MaltegoLink
// elements (namespace http://maltego.paterva.com/xml/mtgx) with typed
// <mtg:Property name=…><mtg:Value>…</mtg:Value></mtg:Property> children and an
// mtg:EntityRenderer/mtg:Position for layout.

import JSZip from "jszip";
import { MALTEGO_TO_TYPE, typeDef } from "../entities";
import type { EntityTypeId, Project } from "../model";
import { store } from "../store";

const NS_GRAPHML = "http://graphml.graphdrawing.org/xmlns";
const NS_MTG = "http://maltego.paterva.com/xml/mtgx";
/** Hidden property that preserves our own type when Maltego has no exact equivalent. */
const TYPE_PROP = "osintgraph.type";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function property(name: string, value: string, displayName = name, hidden = false) {
  return `<mtg:Property displayName="${esc(displayName)}" hidden="${hidden}" name="${esc(name)}" nullable="true" readonly="false" type="string"><mtg:Value>${esc(value)}</mtg:Value></mtg:Property>`;
}

export function toGraphML(p: Project): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<graphml xmlns="${NS_GRAPHML}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:mtg="${NS_MTG}">`,
    `<key attr.name="MaltegoEntity" for="node" id="d0"/>`,
    `<key attr.name="EntityRenderer" for="node" id="d1"/>`,
    `<key attr.name="MaltegoLink" for="edge" id="d2"/>`,
    `<key attr.name="LinkRenderer" for="edge" id="d3"/>`,
    `<graph edgedefault="directed" id="G">`,
  ];
  for (const e of p.entities) {
    const def = typeDef(e.type);
    const props = [property(def.maltegoProp, e.value, def.label), property(TYPE_PROP, e.type, TYPE_PROP, true)];
    if (e.type === "social") props.push(property("person.name", e.value, "Name"));
    for (const [k, v] of Object.entries(e.props)) if (k !== def.maltegoProp) props.push(property(k, v));
    if (e.tags.length) props.push(property("osintgraph.tags", e.tags.join(", "), "Tags"));
    const notes = e.notes ? `<mtg:Notes show="false">${esc(e.notes)}</mtg:Notes>` : "";
    lines.push(
      `<node id="${esc(e.id)}">`,
      `<data key="d0"><mtg:MaltegoEntity type="${def.maltego}"><mtg:Properties>${props.join("")}</mtg:Properties>${notes}<mtg:Weight>0</mtg:Weight></mtg:MaltegoEntity></data>`,
      `<data key="d1"><mtg:EntityRenderer><mtg:Position x="${e.x ?? 0}" y="${e.y ?? 0}"/></mtg:EntityRenderer></data>`,
      `</node>`,
    );
  }
  for (const l of p.links) {
    const type = l.kind === "transform" ? "maltego.link.transform-link" : "maltego.link.manual-link";
    const props = [property("maltego.link.label", l.label, "Label")];
    if (l.transform) props.push(property("maltego.link.transform.name", l.transform, "Transform"));
    lines.push(
      `<edge id="${esc(l.id)}" source="${esc(l.source)}" target="${esc(l.target)}">`,
      `<data key="d2"><mtg:MaltegoLink type="${type}"><mtg:Properties>${props.join("")}</mtg:Properties></mtg:MaltegoLink></data>`,
      `</edge>`,
    );
  }
  lines.push(`</graph>`, `</graphml>`);
  return lines.join("\n");
}

export async function exportMtgx(p: Project): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("Graphs/Graph1.graphml", toGraphML(p));
  zip.file("version.properties", `#Created by OSINT Graph\nmaltego.client.version=4\nmaltego.graph.version=1.2\n`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export interface ImportedGraph {
  entities: { srcId: string; type: EntityTypeId; value: string; props: Record<string, string>; notes: string; x?: number; y?: number; unknownType?: string }[];
  links: { source: string; target: string; label: string; kind: "manual" | "transform" }[];
}

const local = (el: Element, name: string) => [...el.getElementsByTagNameNS(NS_MTG, name)];

export function parseGraphML(xml: string): ImportedGraph {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid GraphML");
  const out: ImportedGraph = { entities: [], links: [] };
  for (const node of [...doc.getElementsByTagNameNS(NS_GRAPHML, "node")]) {
    const me = local(node, "MaltegoEntity")[0];
    if (!me) continue;
    const mType = me.getAttribute("type") ?? "maltego.Phrase";
    const props: Record<string, string> = {};
    for (const prop of local(me, "Property")) {
      const name = prop.getAttribute("name") ?? "";
      const value = local(prop, "Value")[0]?.textContent ?? "";
      if (name && value) props[name] = value;
    }
    const known = Boolean(props[TYPE_PROP] || MALTEGO_TO_TYPE[mType]);
    const ourType = (props[TYPE_PROP] as EntityTypeId) || MALTEGO_TO_TYPE[mType] || "phrase";
    delete props[TYPE_PROP];
    const def = typeDef(ourType);
    // Main value: our mapped property, else the first property Maltego listed.
    const mainKey = props[def.maltegoProp] !== undefined ? def.maltegoProp : Object.keys(props)[0];
    const value = mainKey ? props[mainKey] : "";
    if (!value) continue;
    if (mainKey) delete props[mainKey];
    if (ourType === "social") delete props["person.name"];
    const tags = props["osintgraph.tags"];
    delete props["osintgraph.tags"];
    if (tags) props["tags"] = tags;
    const pos = local(node, "Position")[0];
    out.entities.push({
      srcId: node.getAttribute("id") ?? "",
      type: ourType,
      value,
      props,
      notes: local(me, "Notes")[0]?.textContent ?? "",
      x: pos ? Number(pos.getAttribute("x")) : undefined,
      y: pos ? Number(pos.getAttribute("y")) : undefined,
      unknownType: known ? undefined : mType,
    });
  }
  for (const edge of [...doc.getElementsByTagNameNS(NS_GRAPHML, "edge")]) {
    const ml = local(edge, "MaltegoLink")[0];
    let label = "";
    for (const prop of ml ? local(ml, "Property") : []) {
      if (prop.getAttribute("name") === "maltego.link.label") label = local(prop, "Value")[0]?.textContent ?? "";
    }
    out.links.push({
      source: edge.getAttribute("source") ?? "",
      target: edge.getAttribute("target") ?? "",
      label,
      kind: (ml?.getAttribute("type") ?? "").includes("transform") ? "transform" : "manual",
    });
  }
  return out;
}

export async function readMtgx(bytes: Uint8Array): Promise<ImportedGraph> {
  const zip = await JSZip.loadAsync(bytes);
  const graphs = Object.keys(zip.files).filter((n) => /^Graphs\/.*\.graphml$/i.test(n));
  if (!graphs.length) throw new Error("No Graphs/*.graphml inside this .mtgx");
  const merged: ImportedGraph = { entities: [], links: [] };
  for (const name of graphs) {
    const g = parseGraphML(await zip.file(name)!.async("string"));
    merged.entities.push(...g.entities);
    merged.links.push(...g.links);
  }
  return merged;
}

/** Merge an imported graph into the open project. Returns counts for the status bar. */
export function mergeImported(g: ImportedGraph): { entities: number; links: number; unknownTypes: string[] } {
  store.checkpoint();
  const idMap = new Map<string, string>();
  let added = 0;
  const unknown = new Set<string>();
  for (const e of g.entities) {
    const props = { ...e.props };
    if (e.unknownType) {
      props["maltego.type"] = e.unknownType;
      unknown.add(e.unknownType);
    }
    const tags = props["tags"]?.split(/,\s*/).filter(Boolean) ?? [];
    delete props["tags"];
    const r = store.addEntity({ type: e.type, value: e.value, props, notes: e.notes, tags, source: "import", x: e.x, y: e.y });
    if (r.created) added++;
    idMap.set(e.srcId, r.entity.id);
  }
  let links = 0;
  for (const l of g.links) {
    const s = idMap.get(l.source);
    const t = idMap.get(l.target);
    if (s && t && store.addLink(s, t, l.label, l.kind)) links++;
  }
  return { entities: added, links, unknownTypes: [...unknown] };
}
