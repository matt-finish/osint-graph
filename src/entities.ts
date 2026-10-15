// Entity type catalogue. `maltego` / `maltegoProp` map each type onto Maltego's
// standard entity ids and main property so .mtgx graphs round-trip.

import {
  AtSign, Bug, Building, Car, DatabaseZap, FileText, Globe, Hash, Image, Link, Mail,
  MapPin, Network, Phone, Plug, Quote, Server, Share2, User, Waypoints,
} from "lucide-static";
import type { EntityTypeId } from "./model";

export interface EntityTypeDef {
  id: EntityTypeId;
  label: string;
  category: "People" | "Identity" | "Infrastructure" | "Web" | "Findings" | "Other";
  color: string;
  icon: string;
  maltego: string;
  maltegoProp: string;
  placeholder: string;
}

export const ENTITY_TYPES: EntityTypeDef[] = [
  { id: "person", label: "Person", category: "People", color: "#f59e0b", icon: User, maltego: "maltego.Person", maltegoProp: "person.fullname", placeholder: "Jane Doe" },
  { id: "organization", label: "Organization", category: "People", color: "#d97706", icon: Building, maltego: "maltego.Company", maltegoProp: "title", placeholder: "Acme Corp" },
  { id: "location", label: "Location", category: "People", color: "#a3a3a3", icon: MapPin, maltego: "maltego.Location", maltegoProp: "location.name", placeholder: "123 Main St, Springfield" },
  { id: "username", label: "Username", category: "Identity", color: "#e879f9", icon: AtSign, maltego: "maltego.Alias", maltegoProp: "alias", placeholder: "jdoe1984" },
  { id: "email", label: "Email", category: "Identity", color: "#c084fc", icon: Mail, maltego: "maltego.EmailAddress", maltegoProp: "email", placeholder: "jane@example.com" },
  { id: "phone", label: "Phone", category: "Identity", color: "#fb7185", icon: Phone, maltego: "maltego.PhoneNumber", maltegoProp: "phonenumber", placeholder: "+1 555 123 4567" },
  { id: "social", label: "Social profile", category: "Identity", color: "#f472b6", icon: Share2, maltego: "maltego.Affiliation", maltegoProp: "affiliation.profile-url", placeholder: "https://github.com/jdoe" },
  { id: "vehicle", label: "Vehicle", category: "Identity", color: "#94a3b8", icon: Car, maltego: "maltego.VehicleRegistration", maltegoProp: "vehicle.registration", placeholder: "Plate or 17-char VIN" },
  { id: "domain", label: "Domain", category: "Infrastructure", color: "#38bdf8", icon: Globe, maltego: "maltego.Domain", maltegoProp: "fqdn", placeholder: "example.com" },
  { id: "hostname", label: "Hostname", category: "Infrastructure", color: "#0ea5e9", icon: Server, maltego: "maltego.DNSName", maltegoProp: "fqdn", placeholder: "mail.example.com" },
  { id: "ip", label: "IP address", category: "Infrastructure", color: "#22c55e", icon: Network, maltego: "maltego.IPv4Address", maltegoProp: "ipv4-address", placeholder: "93.184.216.34" },
  { id: "netblock", label: "Netblock", category: "Infrastructure", color: "#16a34a", icon: Waypoints, maltego: "maltego.Netblock", maltegoProp: "ipv4-range", placeholder: "93.184.216.0/24" },
  { id: "asn", label: "AS number", category: "Infrastructure", color: "#15803d", icon: Hash, maltego: "maltego.AS", maltegoProp: "as.number", placeholder: "15133" },
  { id: "service", label: "Service / port", category: "Infrastructure", color: "#84cc16", icon: Plug, maltego: "maltego.Phrase", maltegoProp: "text", placeholder: "443/tcp nginx" },
  { id: "url", label: "URL", category: "Web", color: "#2dd4bf", icon: Link, maltego: "maltego.URL", maltegoProp: "url", placeholder: "https://example.com/about" },
  { id: "image", label: "Image", category: "Web", color: "#14b8a6", icon: Image, maltego: "maltego.Image", maltegoProp: "url", placeholder: "https://…/photo.jpg" },
  { id: "document", label: "Document", category: "Web", color: "#0d9488", icon: FileText, maltego: "maltego.Document", maltegoProp: "url", placeholder: "https://…/report.pdf" },
  { id: "breach", label: "Breach", category: "Findings", color: "#ef4444", icon: DatabaseZap, maltego: "maltego.Phrase", maltegoProp: "text", placeholder: "LinkedIn 2016" },
  { id: "vuln", label: "Vulnerability", category: "Findings", color: "#dc2626", icon: Bug, maltego: "maltego.Phrase", maltegoProp: "text", placeholder: "CVE-2021-44228" },
  { id: "phrase", label: "Note / phrase", category: "Other", color: "#64748b", icon: Quote, maltego: "maltego.Phrase", maltegoProp: "text", placeholder: "Any text" },
];

const BY_ID = new Map(ENTITY_TYPES.map((t) => [t.id, t]));

export function typeDef(id: EntityTypeId): EntityTypeDef {
  return BY_ID.get(id) ?? BY_ID.get("phrase")!;
}

/** Maltego entity id → our type, including common subtypes and transform-hub entities. */
export const MALTEGO_TO_TYPE: Record<string, EntityTypeId> = {
  "maltego.Person": "person",
  "maltego.Company": "organization",
  "maltego.Organization": "organization",
  "maltego.OnlineGroup": "organization",
  "maltego.EducationInstitution": "organization",
  "maltego.Location": "location",
  "maltego.City": "location",
  "maltego.Country": "location",
  "maltego.GPS": "location",
  "maltego.Alias": "username",
  "maltego.EmailAddress": "email",
  "maltego.PhoneNumber": "phone",
  "maltego.PhoneNumberMobile": "phone",
  "maltego.PhoneNumberOffice": "phone",
  "maltego.PhoneNumberResidential": "phone",
  "maltego.Affiliation": "social",
  "maltego.affiliation.Facebook": "social",
  "maltego.affiliation.Twitter": "social",
  "maltego.affiliation.LinkedIn": "social",
  "maltego.VehicleRegistration": "vehicle",
  "maltego.VinNumber": "vehicle",
  "maltego.Domain": "domain",
  "maltego.DNSName": "hostname",
  "maltego.MXRecord": "hostname",
  "maltego.NSRecord": "hostname",
  "maltego.Website": "hostname",
  "maltego.IPv4Address": "ip",
  "maltego.IPv6Address": "ip",
  "maltego.Netblock": "netblock",
  "maltego.AS": "asn",
  "maltego.URL": "url",
  "maltego.Image": "image",
  "maltego.Document": "document",
  "maltego.Phrase": "phrase",
};

/** Guess the entity type of a pasted string. */
export function detectType(raw: string): EntityTypeId {
  const s = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return "email";
  if (/^https?:\/\//i.test(s)) {
    if (/\.(png|jpe?g|gif|webp|bmp|heic)(\?|$)/i.test(s)) return "image";
    if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv)(\?|$)/i.test(s)) return "document";
    return "url";
  }
  if (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(s)) return "netblock";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s) || /^[0-9a-f:]+:[0-9a-f:]*$/i.test(s)) return "ip";
  if (/^AS\d+$/i.test(s)) return "asn";
  if (/^CVE-\d{4}-\d+$/i.test(s)) return "vuln";
  if (/^\+?[\d\s().-]{7,}$/.test(s) && s.replace(/\D/g, "").length >= 7) return "phone";
  if (/^@[\w.]{2,}$/.test(s)) return "username";
  if (/^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i.test(s)) {
    return s.split(".").length > 2 && !isMultiPartSuffix(s) ? "hostname" : "domain";
  }
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(s)) return "vehicle";
  if (/^[\w.-]{3,30}$/.test(s) && !/\s/.test(s)) return "username";
  if (/^[A-Z][a-z]+(\s[A-Z][a-z.'-]+){1,3}$/.test(s)) return "person";
  return "phrase";
}

const MULTI_PART_SUFFIXES = ["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "com.br", "com.mx", "co.za", "co.in", "com.cn", "com.tr"];

function isMultiPartSuffix(host: string): boolean {
  const parts = host.toLowerCase().split(".");
  return parts.length === 3 && MULTI_PART_SUFFIXES.includes(parts.slice(1).join("."));
}

/** Registered domain for a hostname, e.g. mail.corp.example.co.uk → example.co.uk. */
export function registeredDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  const lastTwo = parts.slice(-2).join(".");
  const keep = MULTI_PART_SUFFIXES.includes(lastTwo) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

export function normaliseValue(type: EntityTypeId, raw: string): string {
  let s = raw.trim();
  if (type === "username") s = s.replace(/^@/, "");
  if (type === "asn") s = s.replace(/^AS/i, "");
  if (type === "domain" || type === "hostname" || type === "email") s = s.toLowerCase().replace(/\.$/, "");
  return s;
}
