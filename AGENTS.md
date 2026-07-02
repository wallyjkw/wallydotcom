# wallydotcom.com — project guide for AI assistants

This is Wally's personal website. **Wally is a beginner** with domains, GitHub, and
web dev — explain things plainly, avoid jargon, and don't assume prior knowledge.
Keep the site's casual, personal voice in any copy you write.

## What it is / how it's hosted

- Static site + a small Cloudflare Worker, deployed from GitHub.
- GitHub repo: `wallyjkw/wallydotcom` (public), branch `main`.
- Cloudflare Worker project: **`wallydotcomgithub`**. Custom domains: `wallydotcom.com`
  and `www.wallydotcom.com`. Temp URL: `https://wallydotcomgithub.jwall592.workers.dev`.
- Tooling on the machine (Windows): git, `gh` (authed), Node.js, and `wrangler` v4
  (authed to Cloudflare). Shell is PowerShell or Git Bash.

## Repo layout

- `public/` — everything served to the browser:
  - `index.html` — homepage. Links: 🍳 Recipes, 🍸 Cocktails, ♠ Poker, 🃏 Uno. Has a
    visitor counter that calls `/api/count`.
  - `style.css` — shared stylesheet. Warm amber palette via CSS variables
    (`--ink`, `--accent` `#b5651d`, `--bg`, `--card`, `--line`, `--muted`).
  - `recipes.html` — FOOD recipe index, grouped by category (Mains, Salads & Sides,
    Snacks & Dips, Baking, Basics). Has a search box. **No tried-tracking.**
  - `cocktails.html` — COCKTAIL index. One alphabetical list shown as a compact
    multi-column grid (`.cocktail-links`). Has a search box **and** a Tried/Not-tried
    filter. Its inline script scopes search to cocktails, reads `/api/tried`, marks
    tried cocktails with ✓, and filters.
  - `recipes/<slug>.html` — one page per recipe (BOTH food and cocktails live here;
    only the index listing differs). See structure below.
  - `recipes/search-index.json` — generated; powers search on both index pages.
  - `cocktail-slugs.json` — generated; the list of cocktail slugs.
  - `tried.js` — the "Tried it" toggle, injected by the Worker onto recipe detail
    pages (see Tried tracker).
  - `poker.html` / `poker.css` / `poker.js`, `uno.html` / `uno.css` / `uno.js` — games.
- `src/worker.js` — the Cloudflare Worker (see below).
- `wrangler.jsonc` — Worker config. `run_worker_first: true` is REQUIRED (see below).
- `scripts/build-search-index.js` — regenerates the two JSON files (plain Node, no deps).
- `scripts/test-poker.js`, `scripts/test-uno.js` — Node tests for the game engines.

## Deploy workflow (IMPORTANT)

1. Edit files, then `git add` / `git commit` / `git push` to `main`.
2. Cloudflare auto-builds from GitHub and publishes (usually live in ~15s).
3. **If a push doesn't go live after a few minutes** (the auto-build has stalled
   silently before), force it: `npx wrangler deploy` from the repo root. This uploads
   whatever is committed and is the reliable fallback. Both paths use `wrangler.jsonc`.

Notes:
- **Clean URLs:** pages are served without `.html` (e.g. `/recipes/negroni`).
  Requesting the `.html` form 307-redirects to the clean URL. Link with clean URLs.
- **Edge caching:** Cloudflare briefly negative-caches 404s, so a brand-new page can
  404 for a minute right after deploy, then resolve. Verify with a `?v=N` cache-buster
  or the `.html` path if you need to confirm immediately.
- **Do not commit secrets.** The repo is public.

## The Worker (`src/worker.js`)

- `GET /api/count` — increments and returns the visitor count (KV `COUNTER`, key `count`).
- `GET /api/tried` — returns `{tried:[slugs]}` (public read).
- `POST /api/tried` — `{slug, tried, passcode}`; adds/removes a slug. Requires the
  passcode, compared to the Cloudflare **secret `TRIED_PASSCODE`** (NOT in the repo).
  Stored in KV `COUNTER` under key `tried-recipes`.
- All other requests: serves static assets via `env.ASSETS`, and on recipe pages
  injects `<script src="/tried.js"></script>` via HTMLRewriter.
- **`run_worker_first: true` in wrangler.jsonc is required** — otherwise matching
  static assets are served directly and the Worker never runs on them (the injection
  wouldn't fire; `/api/*` would still work because it matches no asset).

## Recipe page structure (keep consistent)

Each `public/recipes/<slug>.html` (kebab-case slug) follows this exact order:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Name · WallyDotCom Recipes</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <main class="card">
        <a class="backlink" href="/recipes">← Back to Recipes</a>
        <div class="wordmark">WallyDotCom</div>
        <h1>Name</h1>
        <h2>Ingredients</h2>
        <ul> ... </ul>
        <h2>Steps</h2>
        <ol> ... </ol>
        <!-- optional --> <h2>Notes</h2><ul>...</ul>
        <!-- optional --> <h2>Source</h2><p><a href="…" target="_blank" rel="noopener">Site — Title</a></p>
    </main>
</body>
</html>
```

- Section order is fixed: Ingredients → Steps → Notes → Source. Notes and Source are
  optional (only include when there's content). No meta/serves/time line.
- Use unicode fractions (½ ¾ ⅓ ¼) and en dashes (–) for ranges, to match existing pages.
- Preserve Wally's own tasting notes / ratings (A/B/C) in the Notes section.

## Adding or editing a recipe

1. Create/edit `public/recipes/<slug>.html` using the structure above.
2. Add a matching `<li><a href="/recipes/<slug>">Name</a></li>` to the correct index,
   in the right **alphabetical** spot:
   - Cocktail → `public/cocktails.html` inside `<ul id="cocktail-list">`.
   - Food → `public/recipes.html` under the right `<h2 class="category">`.
3. Run **`node scripts/build-search-index.js`** — regenerates `recipes/search-index.json`
   (all recipes) and `cocktail-slugs.json` (cocktail slugs, parsed from cocktails.html).
4. Commit all changed files (including both regenerated JSONs), push, and deploy.

## "Tried it" tracker (cocktails only)

- Personal per-cocktail "tried it" marks. `tried.js` renders a toggle under the `<h1>`
  on a detail page **only if the slug is in `cocktail-slugs.json`** — so food pages
  never get a toggle.
- Reading marks is public (anyone sees the ✓). Changing one requires the passcode,
  which is stored server-side as the Cloudflare secret `TRIED_PASSCODE` and remembered
  per-device in `localStorage` after first use. **Never write the passcode value into
  the repo.** To change it: `printf 'newcode' | npx wrangler secret put TRIED_PASSCODE`.

## Games

- Poker (`/poker.html`) and Uno (`/uno.html`): each is a standalone page +
  page-specific CSS + JS, playing against rule-based bots on one device. The JS keeps
  pure engine functions at the top (exported for Node testing at the bottom via
  `module.exports`) and the browser UI in a `DOMContentLoaded` block. ES5 style
  (`var`, function expressions). Run engine tests with
  `node scripts/test-poker.js` / `node scripts/test-uno.js`.

## Conventions

- Vanilla HTML/CSS/JS, no build step or framework. ES5-style JS to match existing code.
- Match the surrounding file's style and comment density.
- Keep Wally's casual, first-person voice in site copy.
