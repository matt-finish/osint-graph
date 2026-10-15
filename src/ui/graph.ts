// Cytoscape graph view. Mirrors the store: each store event patches the graph
// in place so large graphs don't re-render wholesale.

import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from "cytoscape";
import fcose from "cytoscape-fcose";
import { typeDef } from "../entities";
import type { Entity, Link } from "../model";
import { store } from "../store";

cytoscape.use(fcose);

function nodeDef(e: Entity): ElementDefinition {
  const def = typeDef(e.type);
  return {
    group: "nodes",
    data: { id: e.id, label: e.value, type: e.type, color: def.color, icon: def.label[0] },
    position: e.x != null && e.y != null ? { x: e.x, y: e.y } : undefined,
  };
}

function edgeDef(l: Link): ElementDefinition {
  return { group: "edges", data: { id: l.id, source: l.source, target: l.target, label: l.label, kind: l.kind } };
}

export class GraphView {
  cy: Core;
  onSelect: (ids: string[]) => void = () => {};
  onContext: (id: string | null, x: number, y: number) => void = () => {};
  onBackground: () => void = () => {};

  constructor(container: HTMLElement) {
    this.cy = cytoscape({
      container,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 3,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "data(label)",
            color: "#e5e7eb",
            "font-size": 11,
            "text-valign": "bottom",
            "text-margin-y": 4,
            "text-max-width": "140px",
            "text-wrap": "ellipsis",
            width: 30,
            height: 30,
            "border-width": 2,
            "border-color": "#0b1120",
            "text-outline-width": 2,
            "text-outline-color": "#0b1120",
          },
        },
        { selector: "node:selected", style: { "border-color": "#38bdf8", "border-width": 3 } },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#3b4759",
            "target-arrow-color": "#3b4759",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.8,
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": 9,
            color: "#94a3b8",
            "text-rotation": "autorotate",
            "text-background-color": "#0b1120",
            "text-background-opacity": 0.85,
            "text-background-padding": "2px",
          },
        },
        { selector: "edge[kind = 'transform']", style: { "line-style": "dashed" } },
        { selector: "edge:selected", style: { "line-color": "#38bdf8", "target-arrow-color": "#38bdf8", width: 2.5 } },
        { selector: ".faded", style: { opacity: 0.25 } },
      ],
    });

    this.cy.on("select unselect", "node", () => this.onSelect(this.cy.nodes(":selected").map((n) => n.id())));
    this.cy.on("dragfree", "node", (ev) => {
      const n = ev.target as NodeSingular;
      store.setPosition(n.id(), n.position("x"), n.position("y"));
    });
    this.cy.on("cxttap", (ev) => {
      const t = ev.target;
      const oe = ev.originalEvent as MouseEvent;
      this.onContext(t !== this.cy && t.isNode?.() ? t.id() : null, oe.clientX, oe.clientY);
    });
    this.cy.on("tap", (ev) => {
      if (ev.target === this.cy) this.onBackground();
    });

    store.on((e) => this.apply(e.kind === "reset" ? null : e));
  }

  private apply(e: Parameters<Parameters<typeof store.on>[0]>[0] | null) {
    if (!e) return this.reload();
    this.cy.batch(() => {
      switch (e.kind) {
        case "entity-added": this.cy.add(nodeDef(e.entity)); break;
        case "entity-updated": {
          const n = this.cy.getElementById(e.entity.id);
          if (n.nonempty()) { n.data("label", e.entity.value); n.data("type", e.entity.type); n.data("color", typeDef(e.entity.type).color); }
          break;
        }
        case "entity-removed": this.cy.getElementById(e.id).remove(); break;
        case "link-added": if (this.cy.getElementById(e.link.id).empty()) this.cy.add(edgeDef(e.link)); break;
        case "link-removed": this.cy.getElementById(e.id).remove(); break;
      }
    });
    this.updateHint();
  }

  reload() {
    this.cy.elements().remove();
    this.cy.add([...store.project.entities.map(nodeDef), ...store.project.links.map(edgeDef)]);
    const needLayout = store.project.entities.some((e) => e.x == null);
    if (needLayout && store.project.entities.length) this.layout();
    else this.cy.fit(undefined, 60);
    this.updateHint();
  }

  private updateHint() {
    document.getElementById("empty-hint")!.style.display = this.cy.nodes().length ? "none" : "flex";
  }

  layout() {
    this.cy.layout({ name: "fcose", animate: true, animationDuration: 500, nodeSeparation: 120, idealEdgeLength: 110, nodeRepulsion: 8000 } as never).run();
    this.cy.one("layoutstop", () => this.cy.nodes().forEach((n) => store.setPosition(n.id(), n.position("x"), n.position("y"))));
  }

  focus(id: string) {
    const n = this.cy.getElementById(id);
    if (n.empty()) return;
    this.cy.nodes().unselect();
    n.select();
    this.cy.animate({ center: { eles: n }, zoom: Math.max(this.cy.zoom(), 1) }, { duration: 300 });
  }

  highlightNeighbourhood(id: string | null) {
    this.cy.batch(() => {
      if (!id) { this.cy.elements().removeClass("faded"); return; }
      const hood = this.cy.getElementById(id).closedNeighborhood();
      this.cy.elements().addClass("faded");
      hood.removeClass("faded");
    });
  }

  selectedIds(): string[] {
    return this.cy.nodes(":selected").map((n) => n.id());
  }

  fit() { this.cy.fit(undefined, 60); }
}
