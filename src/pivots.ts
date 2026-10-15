// Manual search pivots for organization and infrastructure recon: curated links
// that open in your browser for sources that need a human (login walls,
// CAPTCHAs, judgement). Nothing here is fetched automatically.

import type { Entity, EntityTypeId } from "./model";

export interface Pivot {
  group: string;
  name: string;
  url: string;
}

const q = encodeURIComponent;
const google = (query: string) => `https://www.google.com/search?q=${q(query)}`;

function searchEngines(term: string): Pivot[] {
  const quoted = `"${term}"`;
  return [
    { group: "Search engines", name: "Google (exact)", url: google(quoted) },
    { group: "Search engines", name: "Bing (exact)", url: `https://www.bing.com/search?q=${q(quoted)}` },
    { group: "Search engines", name: "DuckDuckGo (exact)", url: `https://duckduckgo.com/?q=${q(quoted)}` },
  ];
}

function domain(d: string): Pivot[] {
  return [
    { group: "Registration", name: "who.is", url: `https://who.is/whois/${q(d)}` },
    { group: "Registration", name: "ViewDNS WHOIS", url: `https://viewdns.info/whois/?domain=${q(d)}` },
    { group: "DNS & infrastructure", name: "SecurityTrails", url: `https://securitytrails.com/domain/${q(d)}/dns` },
    { group: "DNS & infrastructure", name: "crt.sh", url: `https://crt.sh/?q=${q("%." + d)}` },
    { group: "DNS & infrastructure", name: "Shodan", url: `https://www.shodan.io/search?query=${q(`hostname:${d}`)}` },
    { group: "DNS & infrastructure", name: "Censys", url: `https://platform.censys.io/search?q=${q(d)}` },
    { group: "DNS & infrastructure", name: "DNSDumpster", url: "https://dnsdumpster.com/" },
    { group: "DNS & infrastructure", name: "ViewDNS reverse IP", url: `https://viewdns.info/reverseip/?host=${q(d)}&t=1` },
    { group: "Reputation", name: "VirusTotal", url: `https://www.virustotal.com/gui/domain/${q(d)}` },
    { group: "Reputation", name: "urlscan.io", url: `https://urlscan.io/search/#${q(`domain:${d}`)}` },
    { group: "Technology", name: "BuiltWith", url: `https://builtwith.com/${q(d)}` },
    { group: "Archives", name: "Wayback Machine", url: `https://web.archive.org/web/*/${q(d)}/*` },
    { group: "Search engines", name: "Google: site:", url: google(`site:${d}`) },
    { group: "Search engines", name: "Google: exposed documents", url: google(`site:${d} (filetype:pdf OR filetype:docx OR filetype:xlsx OR filetype:pptx)`) },
    { group: "Search engines", name: "Google: login/admin pages", url: google(`site:${d} (inurl:login OR inurl:admin OR inurl:portal OR intitle:"index of")`) },
    { group: "Code", name: "GitHub code search", url: `https://github.com/search?q=${q(`"${d}"`)}&type=code` },
  ];
}

function ip(a: string): Pivot[] {
  return [
    { group: "Infrastructure", name: "Shodan", url: `https://www.shodan.io/host/${q(a)}` },
    { group: "Infrastructure", name: "Censys", url: `https://platform.censys.io/hosts/${q(a)}` },
    { group: "Infrastructure", name: "ipinfo.io", url: `https://ipinfo.io/${q(a)}` },
    { group: "Infrastructure", name: "Hurricane Electric BGP", url: `https://bgp.he.net/ip/${q(a)}` },
    { group: "Reputation", name: "VirusTotal", url: `https://www.virustotal.com/gui/ip-address/${q(a)}` },
    { group: "Reputation", name: "AbuseIPDB", url: `https://www.abuseipdb.com/check/${q(a)}` },
    { group: "Reputation", name: "GreyNoise", url: `https://viz.greynoise.io/ip/${q(a)}` },
  ];
}

function url(u: string): Pivot[] {
  return [
    { group: "Archives", name: "Wayback Machine", url: `https://web.archive.org/web/*/${u}` },
    { group: "Analysis", name: "urlscan.io", url: `https://urlscan.io/search/#${q(`page.url:"${u}"`)}` },
  ];
}

function organization(o: string): Pivot[] {
  return [
    ...searchEngines(o),
    { group: "Corporate records", name: "OpenCorporates", url: `https://opencorporates.com/companies?q=${q(o)}` },
    { group: "Corporate records", name: "SEC EDGAR", url: `https://www.sec.gov/cgi-bin/browse-edgar?company=${q(o)}&action=getcompany` },
    { group: "Footprint", name: "Job postings (tech stack)", url: google(`"${o}" (site:greenhouse.io OR site:lever.co OR site:myworkdayjobs.com)`) },
    { group: "Code", name: "GitHub code search", url: `https://github.com/search?q=${q(`"${o}"`)}&type=code` },
  ];
}

const BUILDERS: Partial<Record<EntityTypeId, (v: string) => Pivot[]>> = {
  domain,
  hostname: domain,
  ip,
  url,
  document: url,
  organization,
  asn: (a) => [
    { group: "Routing", name: "Hurricane Electric BGP", url: `https://bgp.he.net/AS${q(a)}` },
    { group: "Routing", name: "Shodan (hosts in AS)", url: `https://www.shodan.io/search?query=${q(`asn:AS${a}`)}` },
  ],
  netblock: (n) => [
    { group: "Routing", name: "Hurricane Electric BGP", url: `https://bgp.he.net/net/${n}` },
    { group: "Routing", name: "Shodan (hosts in range)", url: `https://www.shodan.io/search?query=${q(`net:${n}`)}` },
  ],
  vuln: (c) => [
    { group: "Vulnerability", name: "NVD", url: `https://nvd.nist.gov/vuln/detail/${q(c)}` },
    { group: "Vulnerability", name: "CISA KEV", url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${q(c)}` },
  ],
  location: (l) => [{ group: "Maps", name: "Google Maps", url: `https://www.google.com/maps/search/${q(l)}` }],
};

export function pivotsFor(e: Entity): Pivot[] {
  return BUILDERS[e.type]?.(e.value) ?? searchEngines(e.value);
}
