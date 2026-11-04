/* Token storage for the private verification dashboard. Persistence is opt-in.
     page     (default) memory only: gone on reload or close
     session  sessionStorage: this tab only, gone when the tab closes
     device   localStorage: kept on this device until Forget (explicit opt-in)
   Pages on wxman33.github.io share one browser origin, so anything in localStorage is readable by
   every page published there; that is why "device" is never the default. Lowering the mode deletes
   the token from the stronger stores. The chosen mode (not the token) is remembered. A token left in
   localStorage by an earlier version without an opt-in is removed on first load and kept for the
   current page only. Works in the browser and under Node (tests pass storage objects). */
(function (root) {
  "use strict";
  const KEY = "vf_tok", MODE = "vf_tok_mode", MODES = ["page", "session", "device"];
  function create(stores) {
    const safe = (s) => ({
      get: (k) => { try { return s ? s.getItem(k) : null; } catch (e) { return null; } },
      set: (k, v) => { try { if (s) s.setItem(k, v); return true; } catch (e) { return false; } },
      del: (k) => { try { if (s) s.removeItem(k); } catch (e) { /* storage blocked */ } },
    });
    const L = safe(stores.local), S = safe(stores.session);
    let mode = MODES.includes(L.get(MODE)) ? L.get(MODE) : "page", mem = "";
    const purge = (m) => { if (m !== "device") L.del(KEY); if (m === "page") S.del(KEY); };
    function init() {
      let message = null; const legacy = L.get(KEY);
      if (legacy && mode !== "device") { L.del(KEY); mem = legacy; message = "A token saved permanently by an earlier version was removed from this device. It is kept only while this page is open; choose how long to keep it."; }
      purge(mode);
      const token = mode === "device" ? L.get(KEY) : mode === "session" ? S.get(KEY) : null;
      if (token) mem = token;
      return { mode, token: mem || "", message };
    }
    function keep(token) {
      mem = token || ""; purge(mode);
      if (!mem) { L.del(KEY); S.del(KEY); return; }
      if (mode === "session") S.set(KEY, mem);
      if (mode === "device") { S.del(KEY); L.set(KEY, mem); }
    }
    function setMode(m, token) {
      mode = MODES.includes(m) ? m : "page"; L.set(MODE, mode);
      keep(token != null ? token : mem);
      return mode === "device" ? "The token will be kept on this device until you choose Forget. Every page on wxman33.github.io can read it."
        : mode === "session" ? "The token will be kept until this tab closes. It was removed from this device's permanent storage."
        : "The token is kept only while this page is open. It was removed from this tab and this device.";
    }
    function forget() { mem = ""; L.del(KEY); S.del(KEY); }
    return { init, keep, setMode, forget, mode: () => mode, token: () => mem };
  }
  const api = { create, KEY, MODE, MODES };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TokenStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
