// API providers and their credentials. Values live in the macOS Keychain
// (service "osint-graph", account "<provider>.<field>"), never in project files.

import { secretDelete, secretGet, secretSet } from "./backend";

export interface ProviderField {
  id: string;
  label: string;
  secret: boolean;
  default?: string;
  optional?: boolean;
}

export interface Provider {
  id: string;
  name: string;
  signup: string;
  fields: ProviderField[];
  notes: string;
}

export const PROVIDERS: Provider[] = [
  { id: "shodan", name: "Shodan", signup: "https://account.shodan.io/", notes: "Host services, banners, CVEs and DNS for domains.", fields: [{ id: "apiKey", label: "API key", secret: true }] },
  { id: "censys", name: "Censys Platform", signup: "https://platform.censys.io/account/api", notes: "Host services. Uses a Personal Access Token; organization ID is needed only on paid plans.", fields: [{ id: "pat", label: "Personal access token", secret: true }, { id: "orgId", label: "Organization ID", secret: false, optional: true }] },
  { id: "virustotal", name: "VirusTotal", signup: "https://www.virustotal.com/gui/my-apikey", notes: "Passive DNS, subdomains and reputation.", fields: [{ id: "apiKey", label: "API key", secret: true }] },
  { id: "securitytrails", name: "SecurityTrails", signup: "https://securitytrails.com/app/account/credentials", notes: "Subdomains and historical DNS.", fields: [{ id: "apiKey", label: "API key", secret: true }] },
];

const cache = new Map<string, string | null>();

export async function getField(provider: string, field: string): Promise<string | null> {
  const name = `${provider}.${field}`;
  if (!cache.has(name)) cache.set(name, await secretGet(name));
  const v = cache.get(name);
  if (v) return v;
  return PROVIDERS.find((p) => p.id === provider)?.fields.find((f) => f.id === field)?.default ?? null;
}

export async function setField(provider: string, field: string, value: string) {
  const name = `${provider}.${field}`;
  if (value) await secretSet(name, value);
  else await secretDelete(name);
  cache.set(name, value || null);
}

export async function isConfigured(provider: string): Promise<boolean> {
  const p = PROVIDERS.find((x) => x.id === provider);
  if (!p) return true;
  for (const f of p.fields) {
    if (!f.optional && !(await getField(provider, f.id))) return false;
  }
  return true;
}

export class MissingKeyError extends Error {
  constructor(public provider: string) {
    super(`No API key configured for ${PROVIDERS.find((p) => p.id === provider)?.name ?? provider}. Add one in Settings → API keys.`);
  }
}

export async function requireField(provider: string, field: string): Promise<string> {
  const v = await getField(provider, field);
  if (!v) throw new MissingKeyError(provider);
  return v;
}

// ---- non-secret app settings (localStorage) ----

export interface Settings {
  usernameConcurrency: number;
  maxResultsPerTransform: number;
}

const SETTINGS_KEY = "osint-graph.settings";
const DEFAULT_SETTINGS: Settings = { usernameConcurrency: 6, maxResultsPerTransform: 250 };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
