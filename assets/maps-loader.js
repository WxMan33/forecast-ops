/* Run-local, on-demand map data. No weather field is fetched until selected.
   Failed requests can be retried; concurrent requests share one download. */
(function (root) {
  "use strict";
  const dependencies = (field, window) => field === "precip" ? [window === "run" ? "apcp_run" : "apcp_hour"] : [field];
  const supports = (man, field, window) => dependencies(field, window).every((f) => !!man.fields[f]);
  function create({ json, buffer, decode, limit = 2 }) {
    const runs = new Map();
    async function open(key, base) {
      if (runs.has(key)) { const p = runs.get(key); runs.delete(key); runs.set(key, p); return p; }
      const p = (async () => {
        const man = await json(`${base}/manifest.json`), g = man.grid;
        const ll = await buffer(`${base}/${g.latlon.file}`);
        if (ll.byteLength !== g.nx * g.ny * 2 * 4) throw new Error("coordinate size does not match the grid");
        return { key, base, man, lat: new Float32Array(ll), fields: {}, pending: new Map(), loaded: g.latlon.gzipBytes || 0 };
      })();
      runs.set(key, p);
      while (runs.size > limit) runs.delete(runs.keys().next().value);
      try { return await p; } catch (e) { if (runs.get(key) === p) runs.delete(key); throw e; }
    }
    async function ensure(run, field, window) {
      if (!supports(run.man, field, window)) throw new Error("not published in this run");
      await Promise.all(dependencies(field, window).map(async (f) => {
        if (run.fields[f]) return;
        if (!run.pending.has(f)) {
          const p = (async () => {
            const spec = run.man.fields[f], bytes = await buffer(`${run.base}/${spec.file}`), g = run.man.grid;
            const values = decode(spec, bytes, run.man.hours.length, g.ny, g.nx);
            run.fields[f] = values; run.loaded += spec.gzipBytes || 0;
          })();
          run.pending.set(f, p);
          p.finally(() => { if (run.pending.get(f) === p) run.pending.delete(f); }).catch(() => {});
        }
        await run.pending.get(f);
      }));
      return run;
    }
    return { open, ensure };
  }
  const api = { create, supports, dependencies };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MapRunLoader = api;
})(typeof window !== "undefined" ? window : globalThis);
