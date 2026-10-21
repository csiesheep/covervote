// Cloudflare Worker: path-prefix router in front of the static assets.
//
// `run_worker_first` (wrangler.jsonc) sends only the bare /covervote here first; every
// other path is served from public/covervote/ by Cloudflare without running this Worker
// (free), and only asset misses come here.
//
// Only public/ is uploaded (tools/build_public.mjs); nothing else of the repo is reachable.

const PREFIX = "/covervote";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === PREFIX) {
      url.pathname = PREFIX + "/";
      return Response.redirect(url.toString(), 301);
    }

    if (!url.pathname.startsWith(PREFIX + "/")) {
      return new Response("Not found", { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
