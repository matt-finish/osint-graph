import { describe, expect, it, beforeEach } from "vitest";
import { detectType, normaliseValue, registeredDomain } from "../src/entities";
import { emptyProject } from "../src/model";
import { Store } from "../src/store";
import { phoneParts, scrapeHtml } from "../src/transforms/free";
import { parseGraphML, toGraphML } from "../src/io/mtgx";

describe("detectType", () => {
  const cases: [string, string][] = [
    ["jane@example.com", "email"],
    ["https://example.com/a", "url"],
    ["https://example.com/p.pdf", "document"],
    ["93.184.216.34", "ip"],
    ["93.184.216.0/24", "netblock"],
    ["AS15133", "asn"],
    ["CVE-2021-44228", "vuln"],
    ["example.com", "domain"],
    ["mail.corp.example.com", "hostname"],
    ["+1 555 123 4567", "phone"],
    ["@jdoe", "username"],
  ];
  it.each(cases)("%s -> %s", (input, type) => expect(detectType(input)).toBe(type));
});

describe("registeredDomain", () => {
  it("handles plain TLDs", () => expect(registeredDomain("a.b.example.com")).toBe("example.com"));
  it("handles multi-part suffixes", () => expect(registeredDomain("mail.example.co.uk")).toBe("example.co.uk"));
});

describe("normaliseValue", () => {
  it("lowercases domains and strips trailing dot", () => expect(normaliseValue("domain", "Example.COM.")).toBe("example.com"));
  it("strips @ from usernames", () => expect(normaliseValue("username", "@Jane")).toBe("Jane"));
  it("strips AS prefix", () => expect(normaliseValue("asn", "AS15133")).toBe("15133"));
});

describe("phoneParts", () => {
  it("parses a NANP number", () => {
    const p = phoneParts("+1 (555) 123-4567");
    expect(p.e164).toBe("+15551234567");
    expect(p.nanp).toBe(true);
    expect(p.formats).toContain("(555) 123-4567");
  });
});

describe("scrapeHtml", () => {
  it("extracts emails, socials and analytics IDs", () => {
    const html = `<title>Acme</title><a href="mailto:ceo@acme.com">mail</a>
      <a href="https://twitter.com/acmecorp">x</a> <a href="https://github.com/acme">gh</a>
      <script>ga('create','UA-1234-5')</script> G-ABCDEF12`;
    const s = scrapeHtml(html, "https://acme.com/");
    expect(s.title).toBe("Acme");
    expect(s.emails).toContain("ceo@acme.com");
    expect(s.socials.map((x) => x.network)).toContain("GitHub");
    expect(s.analytics).toContain("UA-1234-5");
    expect(s.analytics).toContain("G-ABCDEF12");
  });
});

describe("Store", () => {
  let store: Store;
  beforeEach(() => { store = new Store(); store.load(emptyProject(), null); });

  it("merges entities with the same type and value", () => {
    const a = store.addEntity({ type: "domain", value: "Example.com" });
    const b = store.addEntity({ type: "domain", value: "example.com." });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(store.project.entities).toHaveLength(1);
  });

  it("merges props on duplicate add", () => {
    store.addEntity({ type: "ip", value: "1.2.3.4" });
    store.addEntity({ type: "ip", value: "1.2.3.4", props: { "shodan.org": "ACME" } });
    expect(store.project.entities[0].props["shodan.org"]).toBe("ACME");
  });

  it("removes links when an endpoint is deleted", () => {
    const a = store.addEntity({ type: "domain", value: "a.com" }).entity;
    const b = store.addEntity({ type: "ip", value: "1.1.1.1" }).entity;
    store.addLink(a.id, b.id, "resolves");
    expect(store.project.links).toHaveLength(1);
    store.removeEntities([b.id]);
    expect(store.project.links).toHaveLength(0);
  });

  it("supports undo/redo", () => {
    store.checkpoint();
    store.addEntity({ type: "domain", value: "a.com" });
    expect(store.project.entities).toHaveLength(1);
    store.undo();
    expect(store.project.entities).toHaveLength(0);
    store.redo();
    expect(store.project.entities).toHaveLength(1);
  });
});

describe("mtgx round-trip", () => {
  it("preserves entities, props, positions and links", () => {
    const store = new Store();
    store.load(emptyProject("Test"), null);
    const d = store.addEntity({ type: "domain", value: "example.com", props: { "whois.registrar": "GoDaddy" }, x: 10, y: 20 }).entity;
    const ip = store.addEntity({ type: "ip", value: "93.184.216.34", x: 100, y: 200 }).entity;
    store.addLink(d.id, ip.id, "resolves to", "transform", "dns.a");

    const xml = toGraphML(store.project);
    const parsed = parseGraphML(xml);
    expect(parsed.entities).toHaveLength(2);
    const dom = parsed.entities.find((e) => e.type === "domain")!;
    expect(dom.value).toBe("example.com");
    expect(dom.props["whois.registrar"]).toBe("GoDaddy");
    expect(dom.x).toBe(10);
    expect(parsed.links).toHaveLength(1);
    expect(parsed.links[0].label).toBe("resolves to");
    expect(parsed.links[0].kind).toBe("transform");
  });

  it("maps standard Maltego entity ids on import", () => {
    const xml = toGraphML({ ...emptyProject(), entities: [], links: [] });
    // Build a minimal Maltego-style node by hand.
    const maltego = xml.replace("</graph>", `<node id="n1"><data key="d0"><mtg:MaltegoEntity xmlns:mtg="http://maltego.paterva.com/xml/mtgx" type="maltego.EmailAddress"><mtg:Properties><mtg:Property name="email"><mtg:Value>x@y.com</mtg:Value></mtg:Property></mtg:Properties></mtg:MaltegoEntity></data></node></graph>`);
    const parsed = parseGraphML(maltego);
    const email = parsed.entities.find((e) => e.value === "x@y.com");
    expect(email?.type).toBe("email");
  });
});
