// Core data model. A project (".osint" file) is plain JSON so it can be read,
// diffed and archived without this app.

export type EntityTypeId =
  | "person"
  | "username"
  | "email"
  | "phone"
  | "domain"
  | "hostname"
  | "ip"
  | "netblock"
  | "asn"
  | "url"
  | "organization"
  | "location"
  | "social"
  | "image"
  | "document"
  | "service"
  | "vuln"
  | "breach"
  | "vehicle"
  | "phrase";

export interface Entity {
  id: string;
  type: EntityTypeId;
  value: string;
  props: Record<string, string>;
  notes: string;
  tags: string[];
  /** "manual", "import", or the id of the transform that produced it. */
  source: string;
  created: string;
  x?: number;
  y?: number;
}

export interface Link {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: "manual" | "transform";
  transform?: string;
  created: string;
}

export interface CaseInfo {
  client: string;
  reference: string;
  analyst: string;
  scope: string;
  authorization: string;
  notes: string;
}

export interface LogEntry {
  ts: string;
  transform: string;
  entity: string;
  added: number;
  error?: string;
}

export interface Project {
  format: "osint-graph";
  version: 1;
  name: string;
  created: string;
  modified: string;
  case: CaseInfo;
  entities: Entity[];
  links: Link[];
  log: LogEntry[];
}

export const now = () => new Date().toISOString();

export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function emptyProject(name = "Untitled case"): Project {
  const ts = now();
  return {
    format: "osint-graph",
    version: 1,
    name,
    created: ts,
    modified: ts,
    case: { client: "", reference: "", analyst: "", scope: "", authorization: "", notes: "" },
    entities: [],
    links: [],
    log: [],
  };
}

/** Normalised key used to merge duplicate entities (same type + same value). */
export function entityKey(type: EntityTypeId, value: string): string {
  let v = value.trim();
  if (["email", "domain", "hostname", "username", "social", "url"].includes(type)) v = v.toLowerCase();
  if (type === "domain" || type === "hostname") v = v.replace(/\.$/, "");
  if (type === "phone") v = v.replace(/[^\d+]/g, "");
  if (type === "url") v = v.replace(/\/$/, "");
  return `${type}:${v}`;
}

export function parseProject(text: string): Project {
  const data = JSON.parse(text);
  if (data?.format !== "osint-graph") throw new Error("Not an OSINT Graph project file");
  const p = { ...emptyProject(), ...data } as Project;
  p.case = { ...emptyProject().case, ...data.case };
  return p;
}
