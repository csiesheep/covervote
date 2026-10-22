// Cloudflare Worker: path-prefix router in front of the static assets.
//
// `run_worker_first` (wrangler.jsonc) sends only the bare /covervote and /covervote/api/* here
// first; every other path is served from public/covervote/ by Cloudflare without running this
// Worker (free), and only asset misses come here.
//
// /covervote/api/* → worker/api.mjs (counters in D1, binding DB). The data it judges guesses
// against is bundled into the Worker by these imports; it is never served as a file.
//
// Only public/ is uploaded as assets (tools/build_public.mjs); nothing else of the repo is reachable.

import { handleApi } from './api.mjs';
import { d1Store } from './d1store.mjs';
import elections from '../data/elections.json' with { type: 'json' };
import races from '../data/races.json' with { type: 'json' };
import candidates from '../data/candidates.json' with { type: 'json' };
import passages from '../data/passages.json' with { type: 'json' };

const PREFIX = "/covervote";
const data = { elections, races, candidates, passages };

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

    // POST_LIMITER: Workers Rate Limiting binding (wrangler.jsonc `ratelimits`, #32). worker/api.mjs keys it by
    // CF-Connecting-IP and hands the IP to the binding only — never to D1, a response, or a log line.
    const api = await handleApi(request, { store: d1Store(env.DB), now: new Date(), data, limiter: env.POST_LIMITER });
    if (api) return api;

    return env.ASSETS.fetch(request);
  },
};
