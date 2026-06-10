export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API route: bump the visitor count and return the new total.
    if (url.pathname === "/api/count") {
      const current = parseInt((await env.COUNTER.get("count")) || "0", 10);
      const next = current + 1;
      await env.COUNTER.put("count", String(next));
      return new Response(JSON.stringify({ count: next }), {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    }

    // Everything else: serve the static site from /public.
    return env.ASSETS.fetch(request);
  },
};
