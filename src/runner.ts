// Executes transforms against entities and merges their results into the store.

import { isConfigured } from "./keys";
import type { Entity } from "./model";
import { store } from "./store";
import { makeContext, type Transform, type TransformResult } from "./transforms/types";

export interface RunOutcome {
  transform: Transform;
  entity: Entity;
  added: number;
  error?: string;
}

/** Place new children on a ring around their parent so they don't stack. */
function ringPosition(parent: Entity, i: number, n: number) {
  const radius = 140 + Math.min(n, 60) * 4;
  const angle = (2 * Math.PI * i) / Math.max(n, 1) - Math.PI / 2;
  return { x: (parent.x ?? 0) + radius * Math.cos(angle), y: (parent.y ?? 0) + radius * Math.sin(angle) };
}

export function applyResult(input: Entity, t: Transform, result: TransformResult): number {
  if (result.props) {
    const props = { ...input.props };
    for (const [k, v] of Object.entries(result.props)) if (v) props[k] = v;
    store.updateEntity(input.id, { props });
  }
  if (result.notes) {
    store.updateEntity(input.id, { notes: [input.notes, `[${t.name}] ${result.notes}`].filter(Boolean).join("\n") });
  }
  const byKey = new Map<string, Entity>();
  let added = 0;
  const n = result.entities.length;
  result.entities.forEach((r, i) => {
    if (!r.value) return;
    const parent = (r.parent && byKey.get(r.parent)) || input;
    const pos = ringPosition(parent, i, n);
    const { entity, created } = store.addEntity({ type: r.type, value: r.value, props: r.props, notes: r.notes, source: t.id, ...pos });
    if (created) added++;
    if (r.key) byKey.set(r.key, entity);
    store.addLink(parent.id, entity.id, r.label ?? "", "transform", t.id);
  });
  return added;
}

export async function runTransform(t: Transform, entities: Entity[], onProgress?: (done: number, total: number) => void): Promise<RunOutcome[]> {
  const targets = entities.filter((e) => t.inputs.includes(e.type));
  if (!targets.length) return [];
  if (t.provider !== "free" && !(await isConfigured(t.provider))) {
    const error = `No API key for ${t.provider}. Add one in Settings → API keys.`;
    return targets.map((entity) => ({ transform: t, entity, added: 0, error }));
  }
  store.checkpoint();
  const ctx = makeContext();
  const outcomes: RunOutcome[] = [];
  let done = 0;
  for (const entity of targets) {
    try {
      const result = await t.run(entity, ctx);
      const added = applyResult(store.entity(entity.id) ?? entity, t, result);
      outcomes.push({ transform: t, entity, added });
      store.log({ transform: t.id, entity: `${entity.type}:${entity.value}`, added });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      outcomes.push({ transform: t, entity, added: 0, error });
      store.log({ transform: t.id, entity: `${entity.type}:${entity.value}`, added: 0, error });
    }
    onProgress?.(++done, targets.length);
  }
  return outcomes;
}
