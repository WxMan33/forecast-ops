/* CI only: share Open-Meteo model metadata (static/meta.json) between the fresh browsers a check opens, the way the app's
   own session cache would for one person. Each answer comes from the provider the first time. Later browsers start with it
   in their session cache under the app's own key ("ops_c:" + exact URL) with its ORIGINAL retrieval time and an expiry 15
   minutes from that retrieval, so the app's normal cache path serves it and reports when it was really retrieved. Only
   successful JSON answers are shared; a GET is required; anything else reaches the page as it is. A browser opened without
   attach() (the direct-browser check) is never intercepted. */
"use strict";
const META_RE = /^https:\/\/api\.open-meteo\.com\/data\/[a-z0-9_]+\/static\/meta\.json(\?|$)/;
function createMetaShare({ ttlMs = 15 * 60e3, now = () => Date.now(), upstream = (r) => r.fetch({ timeout: 30000 }), pattern = META_RE } = {}) {
  const store = new Map(), stats = { fetched: 0, seeded: 0, shared: 0 };
  async function attach(ctx) {
    await ctx.route(pattern, async (r) => {
      if (r.request().method() !== "GET") return r.fallback();
      try {
        const resp = await upstream(r); stats.fetched++;
        if (resp.status() === 200) { try { const json = JSON.parse((await resp.body()).toString("utf8")); if (json && typeof json === "object" && !json.error) { store.set(r.request().url(), { at: now(), json }); stats.shared = store.size; } } catch (e) { /* not JSON: not shared */ } }
        return r.fulfill({ response: resp }).catch(() => {});
      } catch (e) { return r.abort("failed").catch(() => {}); }
    });
    const t = now(), seeds = [...store].filter(([, v]) => t - v.at < ttlMs).map(([url, v]) => ["ops_c:" + url, JSON.stringify({ at: v.at, exp: v.at + ttlMs, json: v.json })]);
    stats.seeded += seeds.length;
    if (seeds.length) await ctx.addInitScript((list) => { try { for (const [k, v] of list) if (sessionStorage.getItem(k) == null) sessionStorage.setItem(k, v); } catch (e) { /* no storage on this page */ } }, seeds);
    return seeds.length;
  }
  return { attach, stats, pattern };
}
module.exports = { createMetaShare, META_RE };
