import { httpFetch, type HttpRequest, type HttpResponse } from "../backend";
import { loadSettings, type Settings } from "../keys";
import type { Entity, EntityTypeId } from "../model";

/** One discovered entity. `parent` refers to another result's `key`; omitted means the input entity. */
export interface ResultEntity {
  type: EntityTypeId;
  value: string;
  props?: Record<string, string>;
  notes?: string;
  label?: string;
  key?: string;
  parent?: string;
}

export interface TransformResult {
  entities: ResultEntity[];
  /** Properties merged into the input entity. */
  props?: Record<string, string>;
  /** Text appended to the input entity's notes. */
  notes?: string;
}

export interface TransformContext {
  settings: Settings;
  http(req: HttpRequest): Promise<HttpResponse>;
  json<T = any>(url: string, init?: Omit<HttpRequest, "url">): Promise<T>;
  text(url: string, init?: Omit<HttpRequest, "url">): Promise<string>;
}

export interface Transform {
  id: string;
  name: string;
  description: string;
  /** "free" or a provider id from keys.ts. */
  provider: string;
  inputs: EntityTypeId[];
  run(input: Entity, ctx: TransformContext): Promise<TransformResult>;
}

export class HttpError extends Error {
  constructor(public status: number, public body: string, url: string) {
    super(`HTTP ${status} from ${new URL(url).host}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
}

export function makeContext(): TransformContext {
  const http = (req: HttpRequest) => httpFetch(req);
  const text = async (url: string, init: Omit<HttpRequest, "url"> = {}) => {
    const r = await http({ ...init, url });
    if (r.status >= 400) throw new HttpError(r.status, r.body, url);
    return r.body;
  };
  return {
    settings: loadSettings(),
    http,
    text,
    json: async (url, init = {}) => {
      const body = await text(url, { ...init, headers: { accept: "application/json", ...(init.headers ?? {}) } });
      return body ? JSON.parse(body) : null;
    },
  };
}

/** Run async work over items with a concurrency cap. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const asArray = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export const uniq = <T>(xs: T[]) => [...new Set(xs)];
