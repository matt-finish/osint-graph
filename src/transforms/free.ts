// Transforms that need no API key: public DNS-over-HTTPS, RDAP, certificate
// transparency, the Wayback Machine, Gravatar, NHTSA and the target's own web pages.

import { registeredDomain } from "../entities";
import { asArray, uniq, type ResultEntity, type Transform, type TransformContext } from "./types";

// ---------- DNS over HTTPS ----------

interface DohAnswer { name: string; type: number; data: string }

export async function doh(ctx: TransformContext, name: string, type: string): Promise<DohAnswer[]> {
  const r = await ctx.json<{ Status: number; Answer?: DohAnswer[] }>(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { accept: "application/dns-json" } },
  );
  return r?.Answer ?? [];
}

const stripDot = (s: string) => s.replace(/\.$/, "").toLowerCase();

const dnsA: Transform = {
  id: "dns.a",
  name: "Resolve to IP addresses (A/AAAA)",
  description: "Current A and AAAA records via Cloudflare DNS-over-HTTPS.",
  provider: "free",
  inputs: ["domain", "hostname"],
  async run(e, ctx) {
    const answers = [...(await doh(ctx, e.value, "A")), ...(await doh(ctx, e.value, "AAAA"))];
    const cnames = answers.filter((a) => a.type === 5).map((a) => stripDot(a.data));
    return {
      entities: [
        ...answers.filter((a) => a.type === 1 || a.type === 28).map((a) => ({ type: "ip" as const, value: a.data, label: a.type === 1 ? "A" : "AAAA" })),
        ...uniq(cnames).map((c) => ({ type: "hostname" as const, value: c, label: "CNAME" })),
      ],
    };
  },
};

const dnsMx: Transform = {
  id: "dns.mx",
  name: "Mail servers (MX)",
  description: "MX records; reveals the mail provider (Google, Microsoft, Proofpoint…).",
  provider: "free",
  inputs: ["domain"],
  async run(e, ctx) {
    const answers = (await doh(ctx, e.value, "MX")).filter((a) => a.type === 15);
    return {
      entities: answers.map((a) => {
        const [prio, host] = a.data.split(/\s+/);
        return { type: "hostname" as const, value: stripDot(host), label: "MX", props: { "mx.priority": prio } };
      }),
    };
  },
};

const dnsNs: Transform = {
  id: "dns.ns",
  name: "Name servers (NS)",
  description: "Authoritative name servers; shared NS can link related domains.",
  provider: "free",
  inputs: ["domain"],
  async run(e, ctx) {
    const answers = (await doh(ctx, e.value, "NS")).filter((a) => a.type === 2);
    return { entities: answers.map((a) => ({ type: "hostname" as const, value: stripDot(a.data), label: "NS" })) };
  },
};

const dnsTxt: Transform = {
  id: "dns.txt",
  name: "TXT / SPF / verification records",
  description: "Stores TXT records on the entity and pulls SPF includes and site-verification tokens (which reveal SaaS in use).",
  provider: "free",
  inputs: ["domain"],
  async run(e, ctx) {
    const txt = (await doh(ctx, e.value, "TXT")).filter((a) => a.type === 16).map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
    const dmarc = (await doh(ctx, `_dmarc.${e.value}`, "TXT")).filter((a) => a.type === 16).map((a) => a.data.replace(/"/g, ""));
    const includes = uniq(txt.flatMap((t) => [...t.matchAll(/include:([^\s]+)/g)].map((m) => m[1].toLowerCase())));
    const verifications = txt.filter((t) => /verification|verify|-site-|domain-key/i.test(t));
    const props: Record<string, string> = { "dns.txt": txt.join("\n") };
    if (dmarc.length) props["dns.dmarc"] = dmarc.join("\n");
    return {
      props,
      entities: [
        ...includes.map((d) => ({ type: "domain" as const, value: registeredDomain(d), label: "SPF include", props: { "spf.include": d } })),
        ...verifications.map((v) => ({ type: "phrase" as const, value: v.slice(0, 120), label: "TXT verification" })),
      ],
    };
  },
};

function reverseName(ip: string): string {
  if (ip.includes(":")) {
    const parts = ip.split("::");
    const head = parts[0] ? parts[0].split(":") : [];
    const tail = parts[1] ? parts[1].split(":") : [];
    const groups = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
    return groups.map((g) => g.padStart(4, "0")).join("").split("").reverse().join(".") + ".ip6.arpa";
  }
  return ip.split(".").reverse().join(".") + ".in-addr.arpa";
}

const dnsPtr: Transform = {
  id: "dns.ptr",
  name: "Reverse DNS (PTR)",
  description: "PTR record for the address.",
  provider: "free",
  inputs: ["ip"],
  async run(e, ctx) {
    const answers = (await doh(ctx, reverseName(e.value), "PTR")).filter((a) => a.type === 12);
    return { entities: answers.map((a) => ({ type: "hostname" as const, value: stripDot(a.data), label: "PTR" })) };
  },
};

const cymruAsn: Transform = {
  id: "cymru.asn",
  name: "To ASN and netblock (Team Cymru)",
  description: "Origin AS, announced prefix and registry via Team Cymru's DNS service.",
  provider: "free",
  inputs: ["ip"],
  async run(e, ctx) {
    if (e.value.includes(":")) throw new Error("IPv6 ASN lookup is not supported yet");
    const rows = (await doh(ctx, `${e.value.split(".").reverse().join(".")}.origin.asn.cymru.com`, "TXT")).map((a) => a.data.replace(/"/g, ""));
    if (!rows.length) return { entities: [] };
    const [asn, prefix, cc, registry, allocated] = rows[0].split("|").map((s) => s.trim());
    const asInfo = (await doh(ctx, `AS${asn.split(" ")[0]}.asn.cymru.com`, "TXT")).map((a) => a.data.replace(/"/g, ""))[0];
    const asName = asInfo?.split("|").map((s) => s.trim())[4] ?? "";
    const entities: ResultEntity[] = [
      { type: "netblock", value: prefix, label: "announced in", key: "nb", props: { allocated } },
      { type: "asn", value: asn.split(" ")[0], label: "originated by", parent: "nb", props: { "as.name": asName }, key: "as" },
    ];
    if (asName) entities.push({ type: "organization", value: asName.replace(/,\s*[A-Z]{2}$/, ""), label: "operated by", parent: "as" });
    return { props: { country: cc, registry }, entities };
  },
};

// ---------- RDAP (structured WHOIS) ----------

interface Vcard { fn?: string; org?: string; email?: string; tel?: string; adr?: string }

function parseVcard(arr: any): Vcard {
  const out: Vcard = {};
  for (const [name, , , value] of asArray<any>(arr?.[1])) {
    if (name === "fn") out.fn = String(value);
    if (name === "org") out.org = String(value);
    if (name === "email") out.email = String(value);
    if (name === "tel") out.tel = String(value).replace(/^tel:/, "");
    if (name === "adr") out.adr = asArray(value).flat().filter(Boolean).join(", ");
  }
  return out;
}

function rdapEntities(rdap: any): ResultEntity[] {
  const results: ResultEntity[] = [];
  const walk = (ents: any[]) => {
    for (const ent of ents ?? []) {
      const roles: string[] = ent.roles ?? [];
      const v = parseVcard(ent.vcardArray);
      const role = roles.join(", ");
      const redacted = (s?: string) => !s || /redact|privacy|proxy|withheld|not disclosed|data protected/i.test(s);
      if (roles.includes("registrar")) {
        if (v.fn) results.push({ type: "organization", value: v.fn, label: "registrar" });
      } else {
        const org = v.org || (v.fn && !/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(v.fn) ? v.fn : undefined);
        if (!redacted(org)) results.push({ type: "organization", value: org!, label: role });
        else if (!redacted(v.fn)) results.push({ type: "person", value: v.fn!, label: role });
        if (!redacted(v.email)) results.push({ type: "email", value: v.email!, label: role });
        if (!redacted(v.tel)) results.push({ type: "phone", value: v.tel!, label: role });
        if (!redacted(v.adr) && v.adr!.length > 8) results.push({ type: "location", value: v.adr!, label: role });
      }
      walk(ent.entities);
    }
  };
  walk(rdap.entities);
  return results;
}

const rdapDomain: Transform = {
  id: "rdap.domain",
  name: "WHOIS / RDAP",
  description: "Registrar, dates, name servers and any non-redacted registrant contacts.",
  provider: "free",
  inputs: ["domain"],
  async run(e, ctx) {
    const r = await ctx.json(`https://rdap.org/domain/${encodeURIComponent(e.value)}`);
    const ev = (action: string) => asArray<any>(r.events).find((x) => x.eventAction === action)?.eventDate ?? "";
    return {
      props: {
        "whois.registered": ev("registration"),
        "whois.expires": ev("expiration"),
        "whois.updated": ev("last changed"),
        "whois.status": asArray(r.status).join(", "),
        "whois.nameservers": asArray<any>(r.nameservers).map((n) => n.ldhName?.toLowerCase()).join(", "),
      },
      entities: rdapEntities(r),
    };
  },
};

const rdapIp: Transform = {
  id: "rdap.ip",
  name: "IP WHOIS / RDAP",
  description: "Allocation, owning organization and abuse contacts for the address.",
  provider: "free",
  inputs: ["ip", "netblock"],
  async run(e, ctx) {
    const ip = e.value.split("/")[0];
    const r = await ctx.json(`https://rdap.org/ip/${encodeURIComponent(ip)}`);
    const cidrs = asArray<any>(r.cidr0_cidrs).map((c) => `${c.v4prefix ?? c.v6prefix}/${c.length}`);
    return {
      props: { "rdap.name": r.name ?? "", "rdap.range": `${r.startAddress} - ${r.endAddress}`, "rdap.country": r.country ?? "" },
      entities: [
        ...(e.type === "ip" ? cidrs.map((c) => ({ type: "netblock" as const, value: c, label: "allocated in", props: { "netblock.name": r.name ?? "" } })) : []),
        ...rdapEntities(r),
      ],
    };
  },
};

// ---------- Certificate transparency ----------

const crtsh: Transform = {
  id: "crtsh.subdomains",
  name: "Subdomains from certificates (crt.sh)",
  description: "Hostnames found in public TLS certificate logs. crt.sh can be slow; retry if it times out.",
  provider: "free",
  inputs: ["domain"],
  async run(e, ctx) {
    const rows = await ctx.json<any[]>(`https://crt.sh/?q=${encodeURIComponent("%." + e.value)}&output=json`, { timeoutMs: 90_000 });
    const names = uniq(
      asArray(rows)
        .flatMap((r) => String(r.name_value).split("\n"))
        .map((n) => n.trim().toLowerCase().replace(/^\*\./, ""))
        .filter((n) => n.endsWith("." + e.value) && n !== e.value && !n.includes("@")),
    ).sort();
    const max = ctx.settings.maxResultsPerTransform;
    return {
      notes: names.length > max ? `crt.sh returned ${names.length} hostnames; only the first ${max} were added.` : undefined,
      entities: names.slice(0, max).map((n) => ({ type: "hostname" as const, value: n, label: "certificate" })),
    };
  },
};

// ---------- Wayback Machine ----------

const wayback: Transform = {
  id: "wayback.urls",
  name: "Archived URLs (Wayback Machine)",
  description: "Unique URLs the Internet Archive has captured under this host. Old pages often expose staff, emails and forgotten paths.",
  provider: "free",
  inputs: ["domain", "hostname", "url"],
  async run(e, ctx) {
    const target = e.type === "url" ? e.value.replace(/^https?:\/\//, "") : `${e.value}/*`;
    const max = ctx.settings.maxResultsPerTransform;
    const rows = await ctx.json<string[][]>(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&output=json&fl=original,timestamp,mimetype&collapse=urlkey&filter=statuscode:200&limit=${max}`,
      { timeoutMs: 60_000 },
    );
    const data = asArray(rows).slice(1);
    if (e.type === "url") {
      const ts = data.map((r) => r[1]).sort();
      return { props: { "wayback.captures": String(ts.length), "wayback.first": ts[0] ?? "", "wayback.last": ts.at(-1) ?? "" }, entities: [] };
    }
    return {
      entities: data.map(([orig, ts, mime]) => ({
        type: /pdf|msword|officedocument|spreadsheet/.test(mime) ? ("document" as const) : /^image\//.test(mime) ? ("image" as const) : ("url" as const),
        value: orig,
        label: "archived",
        props: { "wayback.snapshot": `https://web.archive.org/web/${ts}/${orig}` },
      })),
    };
  },
};

// ---------- Web page scraping ----------

const SOCIAL_PATTERNS: [string, RegExp][] = [
  ["X/Twitter", /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!share|intent|home|search)[A-Za-z0-9_]{1,15}/g],
  ["Facebook", /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b)[A-Za-z0-9.\-]{3,}/g],
  ["Instagram", /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore)[A-Za-z0-9_.]{2,}/g],
  ["LinkedIn", /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9\-_%]{2,}/g],
  ["GitHub", /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9\-]{1,39}(?=["'\s/?#]|$)/g],
  ["YouTube", /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)[A-Za-z0-9_\-]{2,}/g],
  ["TikTok", /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]{2,}/g],
  ["Telegram", /https?:\/\/t\.me\/[A-Za-z0-9_]{4,}/g],
  ["Reddit", /https?:\/\/(?:www\.)?reddit\.com\/(?:u|user|r)\/[A-Za-z0-9_\-]{2,}/g],
  ["Mastodon/Bluesky", /https?:\/\/(?:bsky\.app\/profile\/[A-Za-z0-9.\-]+|mastodon\.[a-z]+\/@[A-Za-z0-9_]+)/g],
];

const IGNORED_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|example\.(com|org)|sentry|wixpress|@2x/i;

export function scrapeHtml(html: string, base: string) {
  const title = html.match(/<title[^>]*>([^<]{0,300})<\/title>/i)?.[1]?.trim() ?? "";
  const generator = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1] ?? "";
  const decoded = html.replace(/&#64;|\[at\]|\(at\)/gi, "@").replace(/&#46;/g, ".");
  const emails = uniq((decoded.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((m) => m.toLowerCase())).filter((m) => !IGNORED_EMAIL.test(m));
  const phones = uniq([...html.matchAll(/href=["']tel:([+\d\s().-]{7,})["']/gi)].map((m) => m[1].trim()));
  const socials: { network: string; url: string }[] = [];
  for (const [network, re] of SOCIAL_PATTERNS) {
    for (const m of html.match(re) ?? []) socials.push({ network, url: m.replace(/\/$/, "") });
  }
  const host = new URL(base).hostname;
  const links = uniq([...html.matchAll(/href=["'](https?:\/\/[^"'#]+)["']/gi)].map((m) => m[1]));
  const externalDomains = uniq(
    links.map((l) => { try { return registeredDomain(new URL(l).hostname); } catch { return ""; } })
      .filter((d) => d && d !== registeredDomain(host)),
  );
  const analytics = uniq([
    ...(html.match(/\bUA-\d{4,10}-\d{1,4}\b/g) ?? []),
    ...(html.match(/\bG-[A-Z0-9]{8,12}\b/g) ?? []),
    ...(html.match(/\bGTM-[A-Z0-9]{5,8}\b/g) ?? []),
    ...(html.match(/\bpub-\d{16}\b/g) ?? []),
  ]);
  return { title, generator, emails, phones, socials: uniqBy(socials, (s) => s.url.toLowerCase()), externalDomains, analytics };
}

function uniqBy<T>(xs: T[], key: (x: T) => string) {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

const webScrape: Transform = {
  id: "web.scrape",
  name: "Scrape web page",
  description: "Fetches the page and extracts title, emails, phone links, social profiles, analytics/ad IDs (shared IDs link sites to one owner) and server headers.",
  provider: "free",
  inputs: ["url", "domain", "hostname"],
  async run(e, ctx) {
    const url = e.type === "url" ? e.value : `https://${e.value}/`;
    const r = await ctx.http({ url, timeoutMs: 30_000 });
    const s = scrapeHtml(r.body, r.url || url);
    const props: Record<string, string> = { "http.status": String(r.status) };
    if (s.title) props["web.title"] = s.title;
    if (s.generator) props["web.generator"] = s.generator;
    for (const h of ["server", "x-powered-by", "x-generator", "via"]) if (r.headers[h]) props[`http.${h}`] = r.headers[h];
    if (r.url && r.url !== url) props["http.final-url"] = r.url;
    return {
      props,
      entities: [
        ...s.emails.map((m) => ({ type: "email" as const, value: m, label: "on page" })),
        ...s.phones.map((p) => ({ type: "phone" as const, value: p, label: "on page" })),
        ...s.socials.map((x) => ({ type: "social" as const, value: x.url, label: "linked", props: { network: x.network } })),
        ...s.analytics.map((a) => ({ type: "phrase" as const, value: a, label: "tracking ID" })),
      ],
    };
  },
};

const webOutlinks: Transform = {
  id: "web.outlinks",
  name: "Outbound domains",
  description: "Other domains the page links to (partners, hosting, sister sites).",
  provider: "free",
  inputs: ["url", "domain", "hostname"],
  async run(e, ctx) {
    const url = e.type === "url" ? e.value : `https://${e.value}/`;
    const r = await ctx.http({ url, timeoutMs: 30_000 });
    const s = scrapeHtml(r.body, r.url || url);
    return { entities: s.externalDomains.slice(0, ctx.settings.maxResultsPerTransform).map((d) => ({ type: "domain" as const, value: d, label: "links to" })) };
  },
};

// ---------- Parsing / pivots ----------

const urlToHost: Transform = {
  id: "parse.url-host",
  name: "To hostname / domain",
  description: "Splits a URL into its hostname and registered domain.",
  provider: "free",
  inputs: ["url", "image", "document", "social"],
  async run(e) {
    const host = new URL(e.value).hostname.toLowerCase();
    const domain = registeredDomain(host);
    return {
      entities: host === domain
        ? [{ type: "domain", value: domain, label: "hosted on" }]
        : [{ type: "hostname", value: host, label: "hosted on", key: "h" }, { type: "domain", value: domain, parent: "h", label: "subdomain of" }],
    };
  },
};

const hostToDomain: Transform = {
  id: "parse.host-domain",
  name: "To parent domain",
  description: "Registered domain for a hostname.",
  provider: "free",
  inputs: ["hostname"],
  async run(e) {
    return { entities: [{ type: "domain", value: registeredDomain(e.value), label: "subdomain of" }] };
  },
};

const emailParse: Transform = {
  id: "parse.email",
  name: "Split into username + domain",
  description: "People reuse the local part of an email as a username elsewhere.",
  provider: "free",
  inputs: ["email"],
  async run(e) {
    const [local, domain] = e.value.split("@");
    const user = local.split("+")[0];
    return {
      entities: [
        { type: "username", value: user, label: "local part" },
        { type: "domain", value: domain, label: "email domain" },
      ],
    };
  },
};

export function phoneParts(raw: string) {
  let digits = raw.replace(/[^\d+]/g, "");
  const plus = digits.startsWith("+");
  digits = digits.replace(/\+/g, "");
  let cc = "";
  let national = digits;
  if (!plus && digits.length === 10) cc = "1";
  else if (digits.length === 11 && digits.startsWith("1")) { cc = "1"; national = digits.slice(1); }
  else if (plus) { cc = digits.slice(0, digits.length - 10) || digits.slice(0, 2); national = digits.slice(cc.length); }
  const e164 = cc ? `+${cc}${national}` : digits;
  const nanp = cc === "1" && national.length === 10;
  return {
    cc, national, e164, nanp,
    formats: nanp
      ? [national, `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`, `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`, `${national.slice(0, 3)}.${national.slice(3, 6)}.${national.slice(6)}`, e164]
      : [e164, national],
  };
}

const phoneParse: Transform = {
  id: "parse.phone",
  name: "Normalise phone number",
  description: "E.164 form, country/area code and the search formats people actually write.",
  provider: "free",
  inputs: ["phone"],
  async run(e) {
    const p = phoneParts(e.value);
    return {
      props: {
        "phone.e164": p.e164,
        "phone.country-code": p.cc,
        ...(p.nanp ? { "phone.area-code": p.national.slice(0, 3), "phone.exchange": p.national.slice(3, 6) } : {}),
        "phone.search-formats": p.formats.join(" | "),
      },
      entities: [],
    };
  },
};

// ---------- Gravatar ----------

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const gravatar: Transform = {
  id: "gravatar.profile",
  name: "Gravatar profile",
  description: "Public Gravatar profile: name, location, avatar and verified linked accounts.",
  provider: "free",
  inputs: ["email"],
  async run(e, ctx) {
    const hash = await sha256Hex(e.value.trim().toLowerCase());
    const r = await ctx.http({ url: `https://api.gravatar.com/v3/profiles/${hash}`, headers: { accept: "application/json" } });
    if (r.status === 404) return { entities: [], notes: "No Gravatar profile." };
    if (r.status >= 400) throw new Error(`Gravatar HTTP ${r.status}`);
    const p = JSON.parse(r.body);
    const out: ResultEntity[] = [];
    if (p.profile_url) out.push({ type: "social", value: p.profile_url, label: "Gravatar", props: { network: "Gravatar" } });
    if (p.display_name && /\s/.test(p.display_name)) out.push({ type: "person", value: p.display_name, label: "display name" });
    if (p.location) out.push({ type: "location", value: p.location, label: "location" });
    if (p.avatar_url) out.push({ type: "image", value: `${p.avatar_url}?s=400`, label: "avatar" });
    if (p.job_title || p.company) out.push({ type: "organization", value: p.company || p.job_title, label: "works at" });
    for (const a of asArray<any>(p.verified_accounts)) {
      if (a.url) out.push({ type: "social", value: a.url, label: "verified account", props: { network: a.service_label ?? a.service_type ?? "" } });
    }
    return { entities: out, props: { "gravatar.hash": hash } };
  },
};

// ---------- Vehicles ----------

const vinDecode: Transform = {
  id: "nhtsa.vin",
  name: "Decode VIN (NHTSA)",
  description: "Make, model, year and plant from a 17-character VIN.",
  provider: "free",
  inputs: ["vehicle"],
  async run(e, ctx) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(e.value)) throw new Error("Value is not a 17-character VIN");
    const r = await ctx.json(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(e.value)}?format=json`);
    const v = r?.Results?.[0] ?? {};
    const props: Record<string, string> = {};
    for (const k of ["Make", "Model", "ModelYear", "Trim", "BodyClass", "VehicleType", "PlantCountry", "PlantCity", "Manufacturer"]) {
      if (v[k]) props[`vin.${k.toLowerCase()}`] = String(v[k]);
    }
    return { props, entities: [] };
  },
};

export const FREE_TRANSFORMS: Transform[] = [
  dnsA, dnsMx, dnsNs, dnsTxt, dnsPtr, cymruAsn, rdapDomain, rdapIp, crtsh, wayback,
  webScrape, webOutlinks, urlToHost, hostToDomain, emailParse, phoneParse, gravatar, vinDecode,
];
