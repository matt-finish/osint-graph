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
  { id: "hunter", name: "Hunter.io", signup: "https://hunter.io/api-keys", notes: "Discover employee email addresses for a company domain, and the org's email-address pattern. Verify a single address.", fields: [{ id: "apiKey", label: "API key", secret: true }] },
  { id: "hibp", name: "Have I Been Pwned", signup: "https://haveibeenpwned.com/API/Key", notes: "Which known public breaches and pastes an email address appeared in. Awareness/exposure data — never returns passwords.", fields: [{ id: "apiKey", label: "API key", secret: true }] },
  { id: "dehashed", name: "DeHashed", signup: "https://dehashed.com/profile", notes: "Credential-exposure records from public breaches by email, username, domain, name, phone or IP (API v2). For authorized assessments only.", fields: [{ id: "apiKey", label: "API key", secret: true }] },
  { id: "intelx", name: "Intelligence X", signup: "https://intelx.io/account?tab=developer", notes: "Phonebook search: emails, subdomains and URLs tied to a selector. Free keys use https://free.intelx.io.", fields: [{ id: "apiKey", label: "API key", secret: true }, { id: "baseUrl", label: "API base URL", secret: false, default: "https://free.intelx.io" }] },
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
  /** Mask leaked passwords from breach lookups when storing them on the graph. */
  maskPasswords: boolean;
}

const SETTINGS_KEY = "osint-graph.settings";
const DEFAULT_SETTINGS: Settings = { usernameConcurrency: 6, maxResultsPerTransform: 250, maskPasswords: true };

/** Reversibly-informative mask: keeps length and first/last char so analysts can
 * spot password reuse without the raw value sitting in the project file. */
export function maskSecret(value: string): string {
  if (!value) return value;
  if (value.length <= 2) return "•".repeat(value.length);
  if (value.length <= 5) return value[0] + "•".repeat(value.length - 1);
  return `${value[0]}${"•".repeat(value.length - 2)}${value[value.length - 1]} (${value.length})`;
}

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
