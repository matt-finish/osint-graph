// Infrastructure transforms backed by keyed APIs: Shodan, Censys, VirusTotal and
// SecurityTrails. Keys come from the keychain via keys.ts.

import { getField, requireField } from "../keys";
import { asArray, uniq, type ResultEntity, type Transform } from "./types";

// ---------- Shodan ----------

const shodanHost: Transform = {
  id: "shodan.host",
  name: "Shodan: open ports, services & CVEs",
  description: "Services, banners, hostnames, OS and vulnerabilities Shodan has recorded for this IP.",
  provider: "shodan",
  inputs: ["ip"],
  async run(e, ctx) {
    const key = await requireField("shodan", "apiKey");
    const r = await ctx.json(`https://api.shodan.io/shodan/host/${encodeURIComponent(e.value)}?key=${encodeURIComponent(key)}`);
    const out: ResultEntity[] = [];
    for (const s of asArray<any>(r.data)) {
      const product = [s.product, s.version].filter(Boolean).join(" ");
      out.push({
        type: "service",
        value: `${e.value}:${s.port}/${s.transport ?? "tcp"}${product ? ` ${product}` : ""}`,
        label: "exposes",
        props: {
          port: String(s.port),
          transport: s.transport ?? "",
          product,
          module: s._shodan?.module ?? "",
          "last-seen": s.timestamp ?? "",
          "ssl.subject-cn": s.ssl?.cert?.subject?.CN ?? "",
          banner: String(s.data ?? "").slice(0, 500),
          source: "Shodan",
        },
      });
    }
    for (const h of asArray<string>(r.hostnames)) out.push({ type: "hostname", value: h, label: "Shodan hostname" });
    for (const v of Object.keys(r.vulns ?? {})) {
      out.push({ type: "vuln", value: v, label: "possibly vulnerable to", props: { source: "Shodan banner match (unverified)" } });
    }
    return {
      props: {
        "shodan.org": r.org ?? "",
        "shodan.isp": r.isp ?? "",
        "shodan.os": r.os ?? "",
        "shodan.country": r.country_name ?? "",
        "shodan.asn": r.asn ?? "",
        "shodan.last-update": r.last_update ?? "",
        "shodan.tags": asArray(r.tags).join(", "),
      },
      entities: out,
    };
  },
};

const shodanDomain: Transform = {
  id: "shodan.domain",
  name: "Shodan: subdomains & DNS",
  description: "Subdomains and their A/AAAA records from Shodan's DNS dataset.",
  provider: "shodan",
  inputs: ["domain"],
  async run(e, ctx) {
    const key = await requireField("shodan", "apiKey");
    const r = await ctx.json(`https://api.shodan.io/dns/domain/${encodeURIComponent(e.value)}?key=${encodeURIComponent(key)}`);
    const subs = uniq(asArray<string>(r.subdomains).filter(Boolean)).slice(0, ctx.settings.maxResultsPerTransform);
    const out: ResultEntity[] = subs.map((sub) => ({ type: "hostname", value: `${sub}.${e.value}`, label: "Shodan DNS", key: `h:${sub}` }));
    const kept = new Set(subs);
    for (const d of asArray<any>(r.data)) {
      if ((d.type === "A" || d.type === "AAAA") && kept.has(d.subdomain)) {
        out.push({ type: "ip", value: d.value, label: d.type, parent: `h:${d.subdomain}` });
      }
    }
    return { entities: out };
  },
};

const shodanSslCn: Transform = {
  id: "shodan.ssl-cn",
  name: "Shodan: hosts with this certificate name",
  description: "IPs serving TLS certificates whose subject CN matches this hostname/domain (finds origin servers behind CDNs).",
  provider: "shodan",
  inputs: ["domain", "hostname"],
  async run(e, ctx) {
    const key = await requireField("shodan", "apiKey");
    const q = encodeURIComponent(`ssl.cert.subject.cn:"${e.value}"`);
    const r = await ctx.json(`https://api.shodan.io/shodan/host/search?key=${encodeURIComponent(key)}&query=${q}&minify=true`);
    const ips = uniq(asArray<any>(r.matches).map((m) => m.ip_str as string)).slice(0, ctx.settings.maxResultsPerTransform);
    return { entities: ips.map((ip) => ({ type: "ip", value: ip, label: "serves cert for" })), props: { "shodan.ssl-cn-total": String(r.total ?? ips.length) } };
  },
};

// ---------- Censys Platform ----------

const censysHost: Transform = {
  id: "censys.host",
  name: "Censys: host services",
  description: "Services, software, DNS names and ASN from Censys Platform.",
  provider: "censys",
  inputs: ["ip"],
  async run(e, ctx) {
    const pat = await requireField("censys", "pat");
    const org = await getField("censys", "orgId");
    const headers: Record<string, string> = { authorization: `Bearer ${pat}`, accept: "application/json" };
    if (org) headers["x-organization-id"] = org;
    const r = await ctx.json(`https://api.platform.censys.io/v3/global/asset/host/${encodeURIComponent(e.value)}`, { headers });
    const h = r?.result?.resource ?? r?.result ?? {};
    const out: ResultEntity[] = [];
    for (const s of asArray<any>(h.services)) {
      const sw = asArray<any>(s.software).map((x) => [x.vendor, x.product, x.version].filter(Boolean).join(" ")).filter(Boolean).join(", ");
      const proto = String(s.transport_protocol ?? "tcp").toLowerCase();
      out.push({
        type: "service",
        value: `${e.value}:${s.port}/${proto}${s.protocol ? ` ${s.protocol}` : ""}`,
        label: "exposes",
        props: { port: String(s.port), protocol: s.protocol ?? "", software: sw, source: "Censys" },
      });
    }
    for (const n of uniq(asArray<string>(h.dns?.names)).slice(0, 100)) out.push({ type: "hostname", value: n, label: "Censys DNS" });
    const as = h.autonomous_system;
    if (as?.asn) out.push({ type: "asn", value: String(as.asn), label: "in AS", props: { "as.name": as.name ?? "" } });
    return {
      props: { "censys.country": h.location?.country ?? "", "censys.city": h.location?.city ?? "", "censys.os": h.operating_system?.product ?? "" },
      entities: out,
    };
  },
};

// ---------- VirusTotal ----------

async function vt(ctx: Parameters<Transform["run"]>[1], path: string) {
  const key = await requireField("virustotal", "apiKey");
  return ctx.json(`https://www.virustotal.com/api/v3/${path}`, { headers: { "x-apikey": key } });
}

const vtSubdomains: Transform = {
  id: "vt.subdomains",
  name: "VirusTotal: subdomains",
  description: "Subdomains VirusTotal has observed.",
  provider: "virustotal",
  inputs: ["domain"],
  async run(e, ctx) {
    const r = await vt(ctx, `domains/${encodeURIComponent(e.value)}/subdomains?limit=40`);
    return { entities: asArray<any>(r?.data).map((d) => ({ type: "hostname" as const, value: d.id, label: "VT subdomain" })) };
  },
};

const vtDomainResolutions: Transform = {
  id: "vt.domain-resolutions",
  name: "VirusTotal: passive DNS (IPs)",
  description: "Historical IPs this name resolved to, with last-seen dates.",
  provider: "virustotal",
  inputs: ["domain", "hostname"],
  async run(e, ctx) {
    const r = await vt(ctx, `domains/${encodeURIComponent(e.value)}/resolutions?limit=40`);
    return {
      entities: asArray<any>(r?.data).map((d) => ({
        type: "ip" as const,
        value: d.attributes?.ip_address,
        label: "resolved to (passive)",
        props: { "pdns.last-seen": d.attributes?.date ? new Date(d.attributes.date * 1000).toISOString().slice(0, 10) : "" },
      })).filter((x) => x.value),
    };
  },
};

const vtIpResolutions: Transform = {
  id: "vt.ip-resolutions",
  name: "VirusTotal: passive DNS (hostnames)",
  description: "Hostnames that have pointed at this IP — finds co-hosted sites.",
  provider: "virustotal",
  inputs: ["ip"],
  async run(e, ctx) {
    const r = await vt(ctx, `ip_addresses/${encodeURIComponent(e.value)}/resolutions?limit=40`);
    return {
      entities: asArray<any>(r?.data).map((d) => ({
        type: "hostname" as const,
        value: d.attributes?.host_name,
        label: "hosted (passive)",
        props: { "pdns.last-seen": d.attributes?.date ? new Date(d.attributes.date * 1000).toISOString().slice(0, 10) : "" },
      })).filter((x) => x.value),
    };
  },
};

const vtReport: Transform = {
  id: "vt.report",
  name: "VirusTotal: reputation",
  description: "Detection stats, reputation score and categories stored on the entity.",
  provider: "virustotal",
  inputs: ["domain", "hostname", "ip"],
  async run(e, ctx) {
    const kind = e.type === "ip" ? "ip_addresses" : "domains";
    const a = (await vt(ctx, `${kind}/${encodeURIComponent(e.value)}`))?.data?.attributes ?? {};
    const stats = a.last_analysis_stats ?? {};
    return {
      props: {
        "vt.malicious": String(stats.malicious ?? 0),
        "vt.suspicious": String(stats.suspicious ?? 0),
        "vt.reputation": String(a.reputation ?? ""),
        "vt.categories": Object.values(a.categories ?? {}).join(", "),
        "vt.as-owner": a.as_owner ?? "",
      },
      entities: [],
    };
  },
};

// ---------- SecurityTrails ----------

async function st(ctx: Parameters<Transform["run"]>[1], path: string) {
  const key = await requireField("securitytrails", "apiKey");
  return ctx.json(`https://api.securitytrails.com/v1/${path}`, { headers: { apikey: key } });
}

const stSubdomains: Transform = {
  id: "st.subdomains",
  name: "SecurityTrails: subdomains",
  description: "Subdomains from SecurityTrails' DNS dataset.",
  provider: "securitytrails",
  inputs: ["domain"],
  async run(e, ctx) {
    const r = await st(ctx, `domain/${encodeURIComponent(e.value)}/subdomains?children_only=false`);
    const subs = asArray<string>(r?.subdomains);
    const max = ctx.settings.maxResultsPerTransform;
    return {
      notes: subs.length > max ? `SecurityTrails returned ${subs.length} subdomains; only the first ${max} were added.` : undefined,
      entities: subs.slice(0, max).map((s) => ({ type: "hostname" as const, value: `${s}.${e.value}`, label: "SecurityTrails" })),
    };
  },
};

const stHistoryA: Transform = {
  id: "st.history-a",
  name: "SecurityTrails: historical A records",
  description: "Every IP the name has pointed to, with first/last seen and the hosting org (reveals pre-CDN origins).",
  provider: "securitytrails",
  inputs: ["domain", "hostname"],
  async run(e, ctx) {
    const r = await st(ctx, `history/${encodeURIComponent(e.value)}/dns/a`);
    const out: ResultEntity[] = [];
    for (const rec of asArray<any>(r?.records)) {
      for (const v of asArray<any>(rec.values)) {
        out.push({
          type: "ip",
          value: v.ip,
          label: "historically resolved to",
          props: { "history.first-seen": rec.first_seen ?? "", "history.last-seen": rec.last_seen ?? "", "history.org": asArray(rec.organizations).join(", ") },
        });
      }
    }
    return { entities: out };
  },
};

export const API_TRANSFORMS: Transform[] = [
  shodanHost, shodanDomain, shodanSslCn, censysHost,
  vtSubdomains, vtDomainResolutions, vtIpResolutions, vtReport,
  stSubdomains, stHistoryA,
];
