// Single source of truth for the open project. The graph view and panels
// subscribe to change events; every mutation goes through here so undo,
// duplicate merging and autosave stay consistent.

import {
  emptyProject, entityKey, now, uid,
  type Entity, type EntityTypeId, type Link, type LogEntry, type Project,
} from "./model";
import { normaliseValue } from "./entities";

export type StoreEvent =
  | { kind: "reset" }
  | { kind: "entity-added"; entity: Entity }
  | { kind: "entity-updated"; entity: Entity }
  | { kind: "entity-removed"; id: string }
  | { kind: "link-added"; link: Link }
  | { kind: "link-removed"; id: string }
  | { kind: "meta" };

export interface NewEntity {
  type: EntityTypeId;
  value: string;
  props?: Record<string, string>;
  notes?: string;
  tags?: string[];
  source?: string;
  x?: number;
  y?: number;
}

const UNDO_LIMIT = 50;

export class Store {
  project: Project = emptyProject();
  path: string | null = null;
  dirty = false;

  private listeners = new Set<(e: StoreEvent) => void>();
  private index = new Map<string, string>(); // entityKey → id
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  on(fn: (e: StoreEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: StoreEvent) {
    if (e.kind !== "reset") {
      this.dirty = true;
      this.project.modified = now();
    }
    for (const fn of this.listeners) fn(e);
  }

  // ---- lifecycle ----

  load(project: Project, path: string | null) {
    this.project = project;
    this.path = path;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.reindex();
    this.emit({ kind: "reset" });
  }

  private reindex() {
    this.index.clear();
    for (const e of this.project.entities) this.index.set(entityKey(e.type, e.value), e.id);
  }

  markSaved(path: string) {
    this.path = path;
    this.dirty = false;
    this.emit({ kind: "meta" });
    this.dirty = false;
  }

  // ---- undo ----

  /** Snapshot the project before a user-visible change. */
  checkpoint() {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.redoStack.push(JSON.stringify(this.project));
    this.restore(snap);
    return true;
  }

  redo() {
    const snap = this.redoStack.pop();
    if (!snap) return false;
    this.undoStack.push(JSON.stringify(this.project));
    this.restore(snap);
    return true;
  }

  private restore(snap: string) {
    this.project = JSON.parse(snap);
    this.reindex();
    this.dirty = true;
    this.emit({ kind: "reset" });
  }

  // ---- queries ----

  entity(id: string) {
    return this.project.entities.find((e) => e.id === id);
  }

  findEntity(type: EntityTypeId, value: string) {
    const id = this.index.get(entityKey(type, normaliseValue(type, value)));
    return id ? this.entity(id) : undefined;
  }

  neighbours(id: string): { entity: Entity; link: Link; direction: "in" | "out" }[] {
    const out: { entity: Entity; link: Link; direction: "in" | "out" }[] = [];
    for (const l of this.project.links) {
      const other = l.source === id ? l.target : l.target === id ? l.source : null;
      const e = other && this.entity(other);
      if (e) out.push({ entity: e, link: l, direction: l.source === id ? "out" : "in" });
    }
    return out;
  }

  // ---- mutations (callers checkpoint() first when the change is user-initiated) ----

  /** Adds an entity, or returns the existing one with the same type+value (merging props). */
  addEntity(n: NewEntity): { entity: Entity; created: boolean } {
    const value = normaliseValue(n.type, n.value);
    const existing = this.findEntity(n.type, value);
    if (existing) {
      let changed = false;
      for (const [k, v] of Object.entries(n.props ?? {})) {
        if (v && existing.props[k] !== v) {
          existing.props[k] = v;
          changed = true;
        }
      }
      for (const t of n.tags ?? []) {
        if (!existing.tags.includes(t)) {
          existing.tags.push(t);
          changed = true;
        }
      }
      if (changed) this.emit({ kind: "entity-updated", entity: existing });
      return { entity: existing, created: false };
    }
    const entity: Entity = {
      id: uid("e"),
      type: n.type,
      value,
      props: { ...(n.props ?? {}) },
      notes: n.notes ?? "",
      tags: [...(n.tags ?? [])],
      source: n.source ?? "manual",
      created: now(),
      x: n.x,
      y: n.y,
    };
    this.project.entities.push(entity);
    this.index.set(entityKey(entity.type, entity.value), entity.id);
    this.emit({ kind: "entity-added", entity });
    return { entity, created: true };
  }

  updateEntity(id: string, patch: Partial<Omit<Entity, "id">>) {
    const e = this.entity(id);
    if (!e) return;
    const oldKey = entityKey(e.type, e.value);
    Object.assign(e, patch);
    if (patch.value !== undefined) e.value = normaliseValue(e.type, patch.value);
    const newKey = entityKey(e.type, e.value);
    if (oldKey !== newKey) {
      this.index.delete(oldKey);
      this.index.set(newKey, e.id);
    }
    this.emit({ kind: "entity-updated", entity: e });
  }

  /** Position updates are frequent and not undoable, so they skip the event bus. */
  setPosition(id: string, x: number, y: number) {
    const e = this.entity(id);
    if (e) {
      e.x = Math.round(x);
      e.y = Math.round(y);
      this.dirty = true;
    }
  }

  removeEntities(ids: string[]) {
    const drop = new Set(ids);
    for (const l of this.project.links.filter((l) => drop.has(l.source) || drop.has(l.target))) {
      this.removeLink(l.id);
    }
    for (const id of ids) {
      const e = this.entity(id);
      if (!e) continue;
      this.project.entities = this.project.entities.filter((x) => x.id !== id);
      this.index.delete(entityKey(e.type, e.value));
      this.emit({ kind: "entity-removed", id });
    }
  }

  addLink(source: string, target: string, label = "", kind: Link["kind"] = "manual", transform?: string): Link | null {
    if (source === target) return null;
    const dup = this.project.links.find((l) => l.source === source && l.target === target && l.label === label);
    if (dup) return dup;
    const link: Link = { id: uid("l"), source, target, label, kind, transform, created: now() };
    this.project.links.push(link);
    this.emit({ kind: "link-added", link });
    return link;
  }

  updateLink(id: string, label: string) {
    const l = this.project.links.find((x) => x.id === id);
    if (!l) return;
    l.label = label;
    this.emit({ kind: "link-removed", id });
    this.emit({ kind: "link-added", link: l });
  }

  removeLink(id: string) {
    this.project.links = this.project.links.filter((l) => l.id !== id);
    this.emit({ kind: "link-removed", id });
  }

  log(entry: Omit<LogEntry, "ts">) {
    this.project.log.unshift({ ts: now(), ...entry });
    if (this.project.log.length > 2000) this.project.log.length = 2000;
    this.emit({ kind: "meta" });
  }

  setMeta(patch: Partial<Pick<Project, "name" | "case">>) {
    Object.assign(this.project, patch);
    this.emit({ kind: "meta" });
  }
}

export const store = new Store();
