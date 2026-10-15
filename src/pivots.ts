// Manual search pivots: curated links that open in your browser for sources that
// need a human (login walls, CAPTCHAs, judgement). Nothing is fetched
// automatically. Covers both people and organization/infrastructure recon.

import type { Entity, EntityTypeId } from "./model";
import { phoneParts } from "./transforms/free";

export interface Pivot {
  group: string;
  name: string;
  url: string;
}

const q = encodeURIComponent;
const google = (query: string) => `https://www.google.com/search?q=${q(query)}`;
const bing = (query: string) => `https://www.bing.com/search?q=${q(query)}`;
const ddg = (query: string) => `https://duckduckgo.com/?q=${q(query)}`;

function searchEngines(term: string): Pivot[] {
  const quoted = `"${term}"`;
  return [
    { group: "Search engines", name: "Google (exact)", url: google(quoted) },
    { group: "Search engines", name: "Bing (exact)", url: bing(quoted) },
    { group: "Search engines", name: "DuckDuckGo (exact)", url: ddg(quoted) },
    { group: "Search engines", name: "Yandex (exact)", url: `https://yandex.com/search/?text=${q(quoted)}` },
    { group: "Search engines", name: "Google: documents", url: google(`${quoted} (filetype:pdf OR filetype:doc OR filetype:docx OR filetype:xlsx OR filetype:pptx)`) },
    { group: "Search engines", name: "Google: paste sites", url: google(`${quoted} (site:pastebin.com OR site:ghostbin.site OR site:justpaste.it OR site:rentry.co)`) },
  ];
}

const SOCIAL_SITES: [string, string][] = [
  ["LinkedIn", "linkedin.com"], ["Facebook", "facebook.com"], ["Instagram", "instagram.com"],
  ["X / Twitter", "x.com OR site:twitter.com"], ["TikTok", "tiktok.com"], ["Reddit", "reddit.com"],
  ["YouTube", "youtube.com"], ["GitHub", "github.com"],
];

function person(name: string): Pivot[] {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1) ?? "";
  const dash = `${first}-${last}`.toLowerCase();
  return [
    ...searchEngines(name),
    ...SOCIAL_SITES.map(([n, site]): Pivot => ({ group: "Social", name: `Google: ${n}`, url: google(`site:${site} "${name}"`) })),
    { group: "Social", name: "Facebook people search", url: `https://www.facebook.com/search/people/?q=${q(name)}` },
    { group: "Social", name: "X user search", url: `https://x.com/search?q=${q(`"${name}"`)}&f=user` },
    { group: "Social", name: "LinkedIn people search", url: `https://www.linkedin.com/search/results/people/?keywords=${q(name)}` },
    { group: "People search (US)", name: "TruePeopleSearch", url: `https://www.truepeoplesearch.com/results?name=${q(name)}` },
    { group: "People search (US)", name: "FastPeopleSearch", url: `https://www.fastpeoplesearch.com/name/${q(dash)}` },
    { group: "People search (US)", name: "That's Them", url: `https://thatsthem.com/name/${q(`${first}-${last}`)}` },
    { group: "People search (US)", name: "Radaris", url: `https://radaris.com/p/${q(first)}/${q(last)}/` },
    { group: "People search (US)", name: "Whitepages", url: `https://www.whitepages.com/name/${q(`${first}-${last}`)}` },
    { group: "People search (US)", name: "Voter records", url: `https://voterrecords.com/voters/${q(dash)}/1` },
    { group: "Records", name: "Court records (judyrecords)", url: `https://www.judyrecords.com/getSearchResults/?search=${q(`"${name}"`)}` },
    { group: "Records", name: "OpenCorporates officers", url: `https://opencorporates.com/officers?q=${q(name)}` },
  ];
}

function username(u: string): Pivot[] {
  return [
    ...searchEngines(u),
    { group: "Profiles (manual check)", name: "Instagram", url: `https://www.instagram.com/${q(u)}/` },
    { group: "Profiles (manual check)", name: "X / Twitter", url: `https://x.com/${q(u)}` },
    { group: "Profiles (manual check)", name: "TikTok", url: `https://www.tiktok.com/@${q(u)}` },
    { group: "Profiles (manual check)", name: "Facebook", url: `https://www.facebook.com/${q(u)}` },
    { group: "Profiles (manual check)", name: "YouTube", url: `https://www.youtube.com/@${q(u)}` },
    { group: "Profiles (manual check)", name: "Snapchat", url: `https://www.snapchat.com/add/${q(u)}` },
    { group: "Profiles (manual check)", name: "Threads", url: `https://www.threads.net/@${q(u)}` },
    { group: "Profiles (manual check)", name: "LinkedIn", url: `https://www.linkedin.com/in/${q(u)}` },
    { group: "Enumeration", name: "WhatsMyName", url: `https://whatsmyname.app/?q=${q(u)}` },
    { group: "Enumeration", name: "KnowEm", url: `https://knowem.com/checkusernames.php?u=${q(u)}` },
    { group: "Archives", name: "Wayback: X profile", url: `https://web.archive.org/web/*/x.com/${q(u)}*` },
    { group: "Archives", name: "Wayback: Instagram profile", url: `https://web.archive.org/web/*/instagram.com/${q(u)}*` },
  ];
}

function email(e: string): Pivot[] {
  const domain = e.split("@")[1] ?? "";
  return [
    ...searchEngines(e),
    { group: "Account discovery", name: "Epieos", url: `https://epieos.com/?q=${q(e)}` },
    { group: "Account discovery", name: "Gravatar (by email)", url: `https://gravatar.com/site/check/${q(e)}` },
    { group: "Breach exposure", name: "Have I Been Pwned", url: `https://haveibeenpwned.com/account/${q(e)}` },
    { group: "Context", name: "Email domain WHOIS", url: `https://who.is/whois/${q(domain)}` },
    { group: "Context", name: "Google: other addresses @domain", url: google(`"@${domain}"`) },
  ];
}

function phone(p: string): Pivot[] {
  const parts = phoneParts(p);
  const dashed = parts.nanp ? parts.formats[1] : parts.e164;
  const orQuery = parts.formats.map((f) => `"${f}"`).join(" OR ");
  return [
    { group: "Search engines", name: "Google (all formats)", url: google(orQuery) },
    { group: "Search engines", name: "Bing (all formats)", url: bing(orQuery) },
    { group: "Caller ID / reverse lookup", name: "TruePeopleSearch", url: `https://www.truepeoplesearch.com/resultphone?phoneno=${q(parts.nanp ? parts.formats[2] : parts.e164)}` },
    { group: "Caller ID / reverse lookup", name: "FastPeopleSearch", url: `https://www.fastpeoplesearch.com/${q(dashed)}` },
    { group: "Caller ID / reverse lookup", name: "That's Them", url: `https://thatsthem.com/phone/${q(dashed)}` },
    { group: "Caller ID / reverse lookup", name: "Sync.me", url: `https://sync.me/search/?number=${q(parts.e164.replace("+", ""))}` },
    { group: "Messaging apps", name: "WhatsApp (opens chat)", url: `https://wa.me/${q(parts.e164.replace("+", ""))}` },
  ];
}

function domain(d: string): Pivot[] {
  return [
    { group: "Registration", name: "who.is", url: `https://who.is/whois/${q(d)}` },
    { group: "Registration", name: "ViewDNS WHOIS", url: `https://viewdns.info/whois/?domain=${q(d)}` },
    { group: "Registration", name: "ViewDNS reverse WHOIS", url: `https://viewdns.info/reversewhois/?q=${q(d)}` },
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
    { group: "Staff", name: "Google: LinkedIn employees", url: google(`site:linkedin.com/in "${d}"`) },
    { group: "Code", name: "GitHub code search", url: `https://github.com/search?q=${q(`"${d}"`)}&type=code` },
  ];
}

function ip(a: string): Pivot[] {
  return [
    { group: "Infrastructure", name: "Shodan", url: `https://www.shodan.io/host/${q(a)}` },
    { group: "Infrastructure", name: "Censys", url: `https://platform.censys.io/hosts/${q(a)}` },
    { group: "Infrastructure", name: "ipinfo.io", url: `https://ipinfo.io/${q(a)}` },
    { group: "Infrastructure", name: "Hurricane Electric BGP", url: `https://bgp.he.net/ip/${q(a)}` },
    { group: "Infrastructure", name: "ViewDNS reverse IP", url: `https://viewdns.info/reverseip/?host=${q(a)}&t=1` },
    { group: "Reputation", name: "VirusTotal", url: `https://www.virustotal.com/gui/ip-address/${q(a)}` },
    { group: "Reputation", name: "AbuseIPDB", url: `https://www.abuseipdb.com/check/${q(a)}` },
    { group: "Reputation", name: "GreyNoise", url: `https://viz.greynoise.io/ip/${q(a)}` },
  ];
}

function url(u: string): Pivot[] {
  return [
    { group: "Archives", name: "Wayback Machine", url: `https://web.archive.org/web/*/${u}` },
    { group: "Archives", name: "archive.today", url: `https://archive.ph/${u}` },
    { group: "Analysis", name: "urlscan.io", url: `https://urlscan.io/search/#${q(`page.url:"${u}"`)}` },
  ];
}

function image(u: string): Pivot[] {
  return [
    { group: "Reverse image search", name: "Google Lens", url: `https://lens.google.com/uploadbyurl?url=${q(u)}` },
    { group: "Reverse image search", name: "Bing Visual Search", url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${q(u)}` },
    { group: "Reverse image search", name: "Yandex", url: `https://yandex.com/images/search?rpt=imageview&url=${q(u)}` },
    { group: "Reverse image search", name: "TinEye", url: `https://tineye.com/search?url=${q(u)}` },
  ];
}

function organization(o: string): Pivot[] {
  return [
    ...searchEngines(o),
    { group: "Corporate records", name: "OpenCorporates", url: `https://opencorporates.com/companies?q=${q(o)}` },
    { group: "Corporate records", name: "SEC EDGAR", url: `https://www.sec.gov/cgi-bin/browse-edgar?company=${q(o)}&action=getcompany` },
    { group: "Corporate records", name: "UK Companies House", url: `https://find-and-update.company-information.service.gov.uk/search?q=${q(o)}` },
    { group: "Staff & footprint", name: "LinkedIn company search", url: `https://www.linkedin.com/search/results/companies/?keywords=${q(o)}` },
    { group: "Staff & footprint", name: "Google: LinkedIn employees", url: google(`site:linkedin.com/in "${o}"`) },
    { group: "Staff & footprint", name: "Job postings (tech stack)", url: google(`"${o}" (site:greenhouse.io OR site:lever.co OR site:myworkdayjobs.com)`) },
    { group: "Code", name: "GitHub code search", url: `https://github.com/search?q=${q(`"${o}"`)}&type=code` },
  ];
}

function location(l: string): Pivot[] {
  return [
    { group: "Maps", name: "Google Maps", url: `https://www.google.com/maps/search/${q(l)}` },
    { group: "Maps", name: "Bing Maps", url: `https://www.bing.com/maps?q=${q(l)}` },
    { group: "Maps", name: "OpenStreetMap", url: `https://www.openstreetmap.org/search?query=${q(l)}` },
    { group: "Property & residents", name: "Zillow", url: `https://www.zillow.com/homes/${q(l)}_rb/` },
  ];
}

const BUILDERS: Partial<Record<EntityTypeId, (v: string) => Pivot[]>> = {
  person, username, email, phone, domain, hostname: domain, ip, url, social: url, document: url,
  image, organization, location,
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
    { group: "Vulnerability", name: "Exploit-DB", url: `https://www.exploit-db.com/search?cve=${q(c.replace(/^CVE-/i, ""))}` },
  ],
  vehicle: (v) => (/^[A-HJ-NPR-Z0-9]{17}$/i.test(v)
    ? [{ group: "VIN", name: "NHTSA decoder", url: `https://vpic.nhtsa.dot.gov/decoder/Decoder?VIN=${q(v)}` }]
    : searchEngines(v).slice(0, 3)),
};

export function pivotsFor(e: Entity): Pivot[] {
  const value = e.type === "username" ? e.value.replace(/^@/, "") : e.value;
  return BUILDERS[e.type]?.(value) ?? searchEngines(value);
}
