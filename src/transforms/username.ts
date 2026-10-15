// Username enumeration. Each site is checked through an endpoint whose response
// reliably distinguishes "exists" from "doesn't" without logging in. Sites that
// hide profiles behind login walls (Instagram, X, TikTok, Facebook) are covered by
// the manual pivot links in pivots.ts instead of guessed here.

import { pool, type ResultEntity, type Transform, type TransformContext } from "./types";

interface Site {
  name: string;
  /** Endpoint that is checked. */
  check: string;
  /** Public profile URL recorded on the graph. */
  profile: string;
  exists: (status: number, body: string) => boolean;
  /** Optional username constraint for the site. */
  valid?: RegExp;
}

const ok = (s: number) => s === 200;
const json200 = (s: number, b: string) => s === 200 && b.trim() !== "null" && b.trim() !== "[]" && b.trim() !== "";

export const SITES: Site[] = [
  { name: "GitHub", check: "https://api.github.com/users/{u}", profile: "https://github.com/{u}", exists: ok },
  { name: "GitLab", check: "https://gitlab.com/api/v4/users?username={u}", profile: "https://gitlab.com/{u}", exists: json200 },
  { name: "Codeberg", check: "https://codeberg.org/api/v1/users/{u}", profile: "https://codeberg.org/{u}", exists: ok },
  { name: "Bitbucket", check: "https://api.bitbucket.org/2.0/workspaces/{u}", profile: "https://bitbucket.org/{u}/", exists: ok },
  { name: "Docker Hub", check: "https://hub.docker.com/v2/users/{u}/", profile: "https://hub.docker.com/u/{u}", exists: ok },
  { name: "PyPI", check: "https://pypi.org/user/{u}/", profile: "https://pypi.org/user/{u}/", exists: ok },
  { name: "npm", check: "https://www.npmjs.com/~{u}", profile: "https://www.npmjs.com/~{u}", exists: ok },
  { name: "Keybase", check: "https://keybase.io/_/api/1.0/user/lookup.json?usernames={u}", profile: "https://keybase.io/{u}", exists: (s, b) => s === 200 && /"them":\[\{/.test(b) },
  { name: "Hacker News", check: "https://hacker-news.firebaseio.com/v0/user/{u}.json", profile: "https://news.ycombinator.com/user?id={u}", exists: json200 },
  { name: "Reddit", check: "https://www.reddit.com/user/{u}/about.json", profile: "https://www.reddit.com/user/{u}", exists: (s, b) => s === 200 && /"name"/.test(b) },
  { name: "Dev.to", check: "https://dev.to/api/users/by_username?url={u}", profile: "https://dev.to/{u}", exists: ok },
  { name: "Medium", check: "https://medium.com/@{u}", profile: "https://medium.com/@{u}", exists: (s, b) => s === 200 && !/PAGE NOT FOUND|Out of nothing, something/i.test(b) },
  { name: "Gravatar", check: "https://api.gravatar.com/v3/profiles/{u}", profile: "https://gravatar.com/{u}", exists: ok },
  { name: "Mastodon (mastodon.social)", check: "https://mastodon.social/api/v1/accounts/lookup?acct={u}", profile: "https://mastodon.social/@{u}", exists: ok },
  { name: "Bluesky", check: "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor={u}.bsky.social", profile: "https://bsky.app/profile/{u}.bsky.social", exists: ok },
  { name: "Telegram", check: "https://t.me/{u}", profile: "https://t.me/{u}", exists: (s, b) => s === 200 && /tgme_page_title/.test(b) && !/tgme_page_description[^>]*>\s*If you have/i.test(b), valid: /^[A-Za-z][A-Za-z0-9_]{4,31}$/ },
  { name: "Steam", check: "https://steamcommunity.com/id/{u}", profile: "https://steamcommunity.com/id/{u}", exists: (s, b) => s === 200 && !/The specified profile could not be found/i.test(b) },
  { name: "Chess.com", check: "https://api.chess.com/pub/player/{u}", profile: "https://www.chess.com/member/{u}", exists: ok },
  { name: "Lichess", check: "https://lichess.org/api/user/{u}", profile: "https://lichess.org/@/{u}", exists: ok },
  { name: "SoundCloud", check: "https://soundcloud.com/{u}", profile: "https://soundcloud.com/{u}", exists: ok },
  { name: "Vimeo", check: "https://vimeo.com/{u}", profile: "https://vimeo.com/{u}", exists: ok },
  { name: "Linktree", check: "https://linktr.ee/{u}", profile: "https://linktr.ee/{u}", exists: (s, b) => s === 200 && !/"statusCode":404/.test(b) },
  { name: "About.me", check: "https://about.me/{u}", profile: "https://about.me/{u}", exists: ok },
  { name: "Replit", check: "https://replit.com/@{u}", profile: "https://replit.com/@{u}", exists: ok },
  { name: "Wattpad", check: "https://www.wattpad.com/api/v3/users/{u}", profile: "https://www.wattpad.com/user/{u}", exists: ok },
  { name: "Flickr", check: "https://www.flickr.com/people/{u}/", profile: "https://www.flickr.com/people/{u}/", exists: ok },
  { name: "Patreon", check: "https://www.patreon.com/{u}", profile: "https://www.patreon.com/{u}", exists: ok },
  { name: "Imgur", check: "https://imgur.com/user/{u}", profile: "https://imgur.com/user/{u}", exists: (s, b) => s === 200 && !/"status":404/.test(b) },
];

async function checkSite(ctx: TransformContext, site: Site, u: string): Promise<ResultEntity | null> {
  if (site.valid && !site.valid.test(u)) return null;
  const url = site.check.replaceAll("{u}", encodeURIComponent(u));
  try {
    const r = await ctx.http({ url, timeoutMs: 15_000, headers: { accept: "text/html,application/json" } });
    if (!site.exists(r.status, r.body)) return null;
    return { type: "social", value: site.profile.replaceAll("{u}", u), label: "same username", props: { network: site.name, "checked.url": url, "checked.status": String(r.status) } };
  } catch {
    return null;
  }
}

export const usernameCheck: Transform = {
  id: "username.check",
  name: `Check username on ${SITES.length} sites`,
  description: "Looks for accounts with exactly this username. A hit means the name is taken, not that it is the same person. Verify each one.",
  provider: "free",
  inputs: ["username"],
  async run(e, ctx) {
    const u = e.value.replace(/^@/, "");
    const hits = await pool(SITES, ctx.settings.usernameConcurrency, (s) => checkSite(ctx, s, u));
    const found = hits.filter((h): h is ResultEntity => h !== null);
    return { entities: found, props: { "username.checked": new Date().toISOString().slice(0, 10), "username.hits": `${found.length}/${SITES.length}` } };
  },
};
