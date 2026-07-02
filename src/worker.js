export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API route: bump the visitor count and return the new total.
    if (url.pathname === "/api/count") {
      const current = parseInt((await env.COUNTER.get("count")) || "0", 10);
      const next = current + 1;
      await env.COUNTER.put("count", String(next));
      return json({ count: next });
    }

    // API route: Wally's personal "tried it" list.
    //   GET  → the list of tried recipe slugs (public; anyone can read).
    //   POST → add/remove a slug; requires the passcode (only Wally can change).
    if (url.pathname === "/api/tried") {
      return handleTried(request, env);
    }

    // Everything else: serve the static site from /public.
    const response = await env.ASSETS.fetch(request);

    // On recipe pages, inject the little script that shows/toggles "tried it".
    // Doing it here means every recipe page — including future ones — gets it
    // without editing each file.
    const isRecipePage = url.pathname === "/recipes" ||
      url.pathname === "/recipes.html" ||
      url.pathname.startsWith("/recipes/");
    const isHtml = (response.headers.get("content-type") || "").includes("text/html");
    if (isRecipePage && isHtml) {
      return new HTMLRewriter()
        .on("body", {
          element(el) {
            el.append('<script src="/tried.js"></script>', { html: true });
          },
        })
        .transform(response);
    }

    return response;
  },
};

const TRIED_KEY = "tried-recipes";

async function handleTried(request, env) {
  if (request.method === "GET") {
    const list = JSON.parse((await env.COUNTER.get(TRIED_KEY)) || "[]");
    return json({ tried: list });
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad request" }, 400);
    }

    // Only Wally, who knows the passcode, may change the list.
    if (!env.TRIED_PASSCODE || body.passcode !== env.TRIED_PASSCODE) {
      return json({ error: "unauthorized" }, 401);
    }

    const slug = body.slug;
    if (typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(slug)) {
      return json({ error: "bad slug" }, 400);
    }

    const set = new Set(JSON.parse((await env.COUNTER.get(TRIED_KEY)) || "[]"));
    if (body.tried) set.add(slug);
    else set.delete(slug);
    const list = Array.from(set).sort();
    await env.COUNTER.put(TRIED_KEY, JSON.stringify(list));
    return json({ tried: list });
  }

  return json({ error: "method not allowed" }, 405);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
