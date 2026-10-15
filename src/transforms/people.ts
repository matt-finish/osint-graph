// People / enterprise transforms backed by keyed APIs: Hunter.io (employee
// emails), Have I Been Pwned (breach exposure), DeHashed (credential records),
// Intelligence X (phonebook). These surface personal data, so use them only
// within an authorized engagement, and keep the maskPasswords setting on unless
// you have a specific reason to store raw leaked credentials.

import { maskSecret, requireField } from "../keys";
import { asArray, uniq, type ResultEntity, type Transform } from "./types";

// ---------- Hunter.io ----------

const hunterDomain: Transform = {
  id: "hunter.domain",
  name: "Hunter: emails at this organization",
  description: "Employee email addresses for the domain, their names/roles where known, plus the org's email-address pattern.",
  provider: "hunter",
  inputs: ["domain"],
  async run(e, ctx) {
    const key = await requireField("hunter", "apiKey");
    const r = await ctx.json(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(e.value)}&limit=100&api_key=${encodeURIComponent(key)}`);
    const d = r?.data ?? {};
    const out: ResultEntity[] = [];
    if (d.organization) out.push({ type: "organization", value: d.organization, label: "organization" });
    for (const m of asArray<any>(d.emails)) {
      if (!m.value) continue;
      const name = [m.first_name, m.last_name].filter(Boolean).join(" ");
      out.push({
        type: "email",
        value: m.value,
        label: "employee email",
        key: `em:${m.value}`,
        props: { "hunter.confidence": m.confidence != null ? `${m.confidence}%` : "", "hunter.type": m.type ?? "", position: m.position ?? "", department: m.department ?? "" },
      });
      if (name && /\s/.test(name)) out.push({ type: "person", value: name, label: "mailbox owner", parent: `em:${m.value}`, props: { position: m.position ?? "" } });
    }
    return { props: { "hunter.pattern": d.pattern ?? "", "hunter.emails-found": String(asArray(d.emails).length) }, entities: out };
  },
};

const hunterVerify: Transform = {
  id: "hunter.verify",
  name: "Hunter: verify this email",
  description: "Deliverability check: whether the mailbox exists, is disposable, catch-all or risky.",
  provider: "hunter",
  inputs: ["email"],
  async run(e, ctx) {
    const key = await requireField("hunter", "apiKey");
    const r = await ctx.json(`https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(e.value)}&api_key=${encodeURIComponent(key)}`);
    const d = r?.data ?? {};
    return {
      props: {
        "verify.status": d.status ?? "",
        "verify.result": d.result ?? "",
        "verify.score": d.score != null ? String(d.score) : "",
        "verify.disposable": String(!!d.disposable),
        "verify.webmail": String(!!d.webmail),
        "verify.mx": String(!!d.mx_records),
      },
      entities: [],
    };
  },
};

// ---------- Have I Been Pwned ----------

async function hibp(ctx: Parameters<Transform["run"]>[1], path: string) {
  const key = await requireField("hibp", "apiKey");
  const r = await ctx.http({ url: `https://haveibeenpwned.com/api/v3/${path}`, headers: { "hibp-api-key": key, "user-agent": "OSINT-Graph" }, timeoutMs: 20_000 });
  if (r.status === 404) return null; // nothing found for this account
  if (r.status === 401) throw new Error("HIBP rejected the API key");
  if (r.status === 429) throw new Error("HIBP rate limit — wait a moment and retry");
  if (r.status >= 400) throw new Error(`HIBP HTTP ${r.status}`);
  return r.body ? JSON.parse(r.body) : null;
}

const hibpBreaches: Transform = {
  id: "hibp.breaches",
  name: "HIBP: breaches for this email",
  description: "Public breaches this address appeared in, with dates and what data classes were exposed. No passwords are returned.",
  provider: "hibp",
  inputs: ["email"],
  async run(e, ctx) {
    const breaches = await hibp(ctx, `breachedaccount/${encodeURIComponent(e.value)}?truncateResponse=false`);
    if (!breaches) return { notes: "No HIBP breaches for this address.", props: { "hibp.breaches": "0" }, entities: [] };
    const out: ResultEntity[] = asArray<any>(breaches).map((b) => ({
      type: "breach",
      value: `${b.Title} ${b.BreachDate ?? ""}`.trim(),
      label: "exposed in",
      props: { "breach.domain": b.Domain ?? "", "breach.date": b.BreachDate ?? "", "breach.pwn-count": b.PwnCount != null ? String(b.PwnCount) : "", "breach.data": asArray(b.DataClasses).join(", "), source: "HIBP" },
    }));
    return { props: { "hibp.breaches": String(out.length) }, entities: out };
  },
};

const hibpPastes: Transform = {
  id: "hibp.pastes",
  name: "HIBP: pastes for this email",
  description: "Paste-site dumps (Pastebin and similar) HIBP has seen this address in.",
  provider: "hibp",
  inputs: ["email"],
  async run(e, ctx) {
    const pastes = await hibp(ctx, `pasteaccount/${encodeURIComponent(e.value)}`);
    if (!pastes) return { notes: "No HIBP pastes for this address.", entities: [] };
    return {
      entities: asArray<any>(pastes).map((p) => ({
        type: "document",
        value: p.Source && p.Id ? `https://${p.Source === "Pastebin" ? "pastebin.com/" : ""}${p.Id}` : `${p.Source}:${p.Id}`,
        label: "appears in paste",
        props: { "paste.source": p.Source ?? "", "paste.date": p.Date ?? "", "paste.emails": p.EmailCount != null ? String(p.EmailCount) : "" },
      })),
    };
  },
};

// ---------- DeHashed (API v2) ----------

const DEHASHED_FIELD: Record<string, string> = { email: "email", username: "username", domain: "domain", phone: "phone", person: "name" };

const dehashedSearch: Transform = {
  id: "dehashed.search",
  name: "DeHashed: credential-exposure records",
  description: "Breach records matching this value (emails, usernames, names, hashes, and passwords where present). Authorized assessments only; passwords are masked unless you turn masking off in Settings.",
  provider: "dehashed",
  inputs: ["email", "username", "domain", "phone", "person"],
  async run(e, ctx) {
    const key = await requireField("dehashed", "apiKey");
    const field = DEHASHED_FIELD[e.type] ?? "email";
    const r = await ctx.json("https://api.dehashed.com/v2/search", {
      method: "POST",
      headers: { "Dehashed-Api-Key": key, "content-type": "application/json" },
      body: JSON.stringify({ query: `${field}:"${e.value}"`, size: Math.min(ctx.settings.maxResultsPerTransform, 100) }),
    });
    const entries = asArray<any>(r?.entries);
    const out: ResultEntity[] = [];
    const seen = { emails: new Set<string>(), users: new Set<string>(), names: new Set<string>(), phones: new Set<string>() };
    for (const rec of entries) {
      const db = asArray<string>(rec.database_name)[0] ?? rec.database_name ?? "";
      const add = (type: ResultEntity["type"], value: string, set: Set<string>, extra: Record<string, string> = {}) => {
        const v = String(value ?? "").trim();
        if (!v || set.has(v.toLowerCase())) return;
        set.add(v.toLowerCase());
        out.push({ type, value: v, label: "breach record", props: { "breach.database": db, ...extra } });
      };
      for (const em of asArray<string>(rec.email)) if (em.toLowerCase() !== e.value.toLowerCase()) add("email", em, seen.emails);
      for (const un of asArray<string>(rec.username)) add("username", un, seen.users);
      for (const nm of asArray<string>(rec.name)) if (/\s/.test(nm)) add("person", nm, seen.names);
      for (const ph of asArray<string>(rec.phone)) add("phone", ph, seen.phones);
    }
    // Password reuse is a key finding; attach a sample to the input entity (masked by default).
    const passwords = uniq(entries.flatMap((rec) => asArray<string>(rec.password)).filter(Boolean));
    const props: Record<string, string> = { "dehashed.records": String(entries.length) };
    if (passwords.length) {
      props["dehashed.passwords-found"] = String(passwords.length);
      props["dehashed.password-sample"] = passwords.slice(0, 10).map((p) => (ctx.settings.maskPasswords ? maskSecret(p) : p)).join(", ");
    }
    return { props, entities: out.slice(0, ctx.settings.maxResultsPerTransform) };
  },
};

// ---------- Intelligence X (phonebook) ----------

const intelxPhonebook: Transform = {
  id: "intelx.phonebook",
  name: "Intelligence X: related emails & subdomains",
  description: "Phonebook search — emails, subdomains and URLs IntelX has tied to this selector.",
  provider: "intelx",
  inputs: ["domain", "email", "person"],
  async run(e, ctx) {
    const key = await requireField("intelx", "apiKey");
    const base = (await requireField("intelx", "baseUrl")).replace(/\/$/, "");
    const headers = { "x-key": key, "content-type": "application/json" };
    const start = await ctx.json(`${base}/phonebook/search`, { method: "POST", headers, body: JSON.stringify({ term: e.value, maxresults: ctx.settings.maxResultsPerTransform, media: 0, target: 0 }) });
    const id = start?.id;
    if (!id) return { notes: "IntelX returned no search id (check key/plan).", entities: [] };
    let selectors: any[] = [];
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      const res = await ctx.json(`${base}/phonebook/search/result?id=${encodeURIComponent(id)}&limit=${ctx.settings.maxResultsPerTransform}`, { headers });
      selectors = asArray<any>(res?.selectors);
      if (res?.status === 1 || selectors.length) break; // 1 = done
    }
    const out: ResultEntity[] = [];
    for (const s of selectors) {
      const v = String(s.selectorvalue ?? "").trim();
      if (!v) continue;
      if (/@/.test(v)) out.push({ type: "email", value: v, label: "IntelX" });
      else if (/^https?:\/\//.test(v)) out.push({ type: "url", value: v, label: "IntelX" });
      else if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) out.push({ type: "hostname", value: v, label: "IntelX" });
    }
    return { props: { "intelx.selectors": String(selectors.length) }, entities: out.slice(0, ctx.settings.maxResultsPerTransform) };
  },
};

export const PEOPLE_TRANSFORMS: Transform[] = [
  hunterDomain, hunterVerify, hibpBreaches, hibpPastes, dehashedSearch, intelxPhonebook,
];
