# OSINT Graph

A local, offline-first link-analysis workbench for authorized OSINT and
penetration-testing reconnaissance, in the spirit of Maltego. Everything runs on
your machine: a Tauri (Rust) shell around a TypeScript graph UI. Projects are
plain `.osint` JSON files; API keys live in the macOS Keychain, never in project
files. Scope is organization and infrastructure recon.

## Features

- **Graph canvas** (Cytoscape.js) — add entities, link them, auto-layout, undo/redo.
- **20 entity types** mapped to Maltego ids, with paste auto-detection.
- **Free lookups** (no key): DNS (A/AAAA/MX/NS/TXT/PTR), Team Cymru ASN, WHOIS/RDAP
  for domains and IPs, crt.sh certificate subdomains, Wayback Machine URLs, web-page
  scraping (emails, socials, tracking IDs, headers), username check across ~28 sites.
- **Keyed lookups**: Shodan, Censys, VirusTotal, SecurityTrails. Keys added in
  Settings → API keys, stored in the system keychain.
- **Search pivots** — curated links that open in your browser for sources needing a human.
- **Maltego `.mtgx` import/export**, plus CSV and Markdown case-report export.

## Develop

```bash
export PATH=/opt/homebrew/opt/rustup/bin:$PATH   # once, so the build finds Rust
pnpm install
pnpm test        # unit tests
pnpm build       # type-check + bundle
pnpm app         # run the desktop app (tauri dev)
pnpm bundle      # produce a .app / .dmg
```

`pnpm dev` runs the UI in a plain browser for frontend work; native features
(keychain, CORS-free HTTP, file dialogs) only work under `pnpm app`.

## Notes

- Username hits mean a name is *taken*, not that it is the same person — verify each.
- Record authorization in Case details; it is included in the exported report.
