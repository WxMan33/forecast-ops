/* Token persistence is opt-in; weaker modes delete the token from stronger stores; legacy tokens are removed. */
"use strict";
const assert = require("assert"), T = require("../assets/token-store.js");
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
let n = 0; const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };
{ const L = mem(), S = mem(), t = T.create({ local: L, session: S }); const b = t.init();
  eq([b.mode, b.token], ["page", ""], "default: nothing persisted, page-only mode");
  t.keep("tok1"); eq([L.getItem("vf_tok"), S.getItem("vf_tok"), t.token()], [null, null, "tok1"], "page mode keeps the token in memory only");
  t.setMode("session"); eq([L.getItem("vf_tok"), S.getItem("vf_tok")], [null, "tok1"], "session mode: sessionStorage only");
  t.setMode("device"); eq([L.getItem("vf_tok"), S.getItem("vf_tok")], ["tok1", null], "device mode is an explicit opt-in to localStorage");
  t.setMode("session"); eq([L.getItem("vf_tok"), S.getItem("vf_tok")], [null, "tok1"], "lowering from device removes the remembered token");
  t.setMode("page"); eq([L.getItem("vf_tok"), S.getItem("vf_tok"), t.token()], [null, null, "tok1"], "page mode removes it from the tab too");
  t.setMode("device"); t.forget(); eq([L.getItem("vf_tok"), S.getItem("vf_tok"), t.token()], [null, null, ""], "Forget clears every store");
  eq(L.getItem("vf_tok_mode"), "device", "only the mode preference (not the token) is remembered by Forget");
}
{ const L = mem(), S = mem(); L.setItem("vf_tok", "legacy"); const t = T.create({ local: L, session: S }), b = t.init();
  eq([b.mode, b.token, L.getItem("vf_tok"), !!b.message], ["page", "legacy", null, true], "a token remembered by the old version is removed from localStorage and kept for this page only");
}
{ const L = mem(), S = mem(); L.setItem("vf_tok_mode", "device"); L.setItem("vf_tok", "kept"); const b = T.create({ local: L, session: S }).init();
  eq([b.mode, b.token, L.getItem("vf_tok"), b.message], ["device", "kept", "kept", null], "an explicit device opt-in survives reloads");
}
{ const L = mem(), S = mem(); L.setItem("vf_tok_mode", "session"); S.setItem("vf_tok", "tab"); L.setItem("vf_tok", "stale"); const b = T.create({ local: L, session: S }).init();
  eq([b.token, L.getItem("vf_tok")], ["tab", null], "session mode restores from this tab and clears any copy on the device");
}
{ const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const t = T.create({ local: boom, session: boom }); const b = t.init(); t.keep("x"); eq([b.mode, t.token()], ["page", "x"], "blocked storage still works in memory");
}
console.log(`ok - ${n} token storage checks passed`);
