/* Verification locations. Each is an OBSERVING SITE: forecasts are requested at the site's own
   coordinates, never at a city centre, and observations come from the same site.
   CVG metadata was checked on 2026-11-03 against api.weather.gov/stations/KCVG, the NWS point
   lookup, ACIS station metadata (uid 8337) and NCEI GHCN-Daily (see verify/README.md). */
module.exports = {
  CVG: {
    id: "CVG",
    name: "Cincinnati/Northern Kentucky International Airport (KCVG)",
    market: "cincinnati",
    tz: "America/New_York",
    lstOffsetMin: -300, // local STANDARD time (EST) used by NWS climate reports all year
    lat: 39.04456, lon: -84.67229, // api.weather.gov/stations/KCVG
    elevationM: 262.1, // NWS station metadata 262.128 m; ACIS 861 ft
    ids: { icao: "KCVG", faa: "CVG", wban: "93814", ghcnd: "USW00093814", coop: "151855", wmo: "72421", acisUid: 8337, cliSite: "CVG", cliPil: "CLICVG", cf6Pil: "CF6CVG", iem: "CVG", iemNetwork: "KY_ASOS" },
    nws: { office: "ILN", gridX: 30, gridY: 35, zone: "KYZ091", note: "Point lookup at the KCVG coordinates (relative location: Hebron, KY)." },
    climateName: "Cincinnati OH (official climate site is the CVG airport)",
  },
};
