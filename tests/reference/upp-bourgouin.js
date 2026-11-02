// Independent reference: line-by-line port of NCEP UPP sorc/ncep_post.fd/CALWXT_BOURG.f
// (NOAA-EMC/UPP, develop branch, fetched 2026-11-02; Baldwin 1999, "energy method" of Bourgouin).
// Used only by tests to check assets/ops-core.js. Layers run top (1) to bottom (lmh) as in UPP.
// Transition zones are returned as "mix" instead of UPP's random draw.
// Input: points ordered surface-up {z (m AGL), p (hPa), t (°C)}; converted to UPP layers whose
// interfaces are midway between points and whose layer temperature is the point temperature.
function classify(pts) {
  const n = pts.length;
  // build UPP layers: layer l (1 = top) with mid temperature t, interfaces zint
  const t = [], pmid = [], zint = [];
  for (let k = n - 1; k >= 0; k--) { t.push(pts[k].t + 273.15); pmid.push(pts[k].p * 100); }
  const zi = [];
  for (let k = n - 1; k >= 0; k--) zi.push(k === n - 1 ? pts[k].z : (pts[k].z + pts[k + 1].z) / 2); // top interface of each layer
  zi.push(0); // ground
  for (let k = 0; k < zi.length; k++) zint.push(zi[k]);
  const lmhk = n; // number of layers; Fortran 1-based -> use L-1 indices below
  const T = (l) => t[l - 1], P = (l) => pmid[l - 1], Z = (l) => zint[l - 1];
  const g = 9.80665;
  const tlmhk = T(lmhk);
  let iwrml = lmhk + 1;
  if (tlmhk >= 273.15) for (let l = lmhk; l >= 2; l--) if (T(l) >= 273.15 && T(l - 1) < 273.15 && iwrml === lmhk + 1) iwrml = l;
  let lhiwrm = lmhk + 1;
  for (let l = lmhk; l >= 1; l--) if (T(l) >= 273.15 && P(l) > 25000) lhiwrm = l;
  let areane = 0, areape = 0, surfw = 0;
  for (let l = lmhk; l >= 1; l--) {
    const dzkl = Z(l) - Z(l + 1);
    const area1 = Math.log(T(l) / 273.15) * g * dzkl;
    if (T(l) >= 273.15 && P(l) > 25000) { if (l < iwrml) areape += area1; if (l >= iwrml) surfw += area1; }
    else if (l > lhiwrm) areane += Math.abs(area1);
  }
  let type;
  if (areape < 2.0) type = surfw < 5.6 ? "snow" : surfw > 13.2 ? "rain" : "mix";
  else if (areane > 66.0 + 0.66 * areape) type = surfw < 5.6 ? "sleet" : surfw > 13.2 ? "rain" : "mix";
  else if (areane < 46.0 + 0.66 * areape) type = tlmhk < 273.15 ? "freezing" : "rain";
  else type = "mix";
  return { type, areape, areane, surfw };
}
module.exports = { classify };
