// Probe: how does Open-Meteo label hourly times across a DST change with timezone set?
(async () => {
  for (const tz of ["America/New_York", "auto"]) {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=39.11&longitude=-84.52&hourly=temperature_2m&models=gfs_seamless&timezone=${encodeURIComponent(tz)}&start_date=2026-10-31&end_date=2026-11-01`;
    const j = await (await fetch(u)).json();
    if (j.error) { console.log(tz, "ERROR", j.reason); continue; }
    const t = j.hourly.time;
    console.log(`${tz}: tz=${j.timezone} abbr=${j.timezone_abbreviation} utc_offset=${j.utc_offset_seconds} n=${t.length} first=${t[0]} last=${t[t.length - 1]}`);
    console.log("  Nov 1 00-04:", t.filter((x) => x >= "2026-11-01T00:00" && x <= "2026-11-01T04:00").join(" "));
    console.log("  duplicates:", t.filter((x, i) => t.indexOf(x) !== i).join(" ") || "none");
  }
  const s = await (await fetch("https://api.open-meteo.com/v1/forecast?latitude=39.11&longitude=-84.52&hourly=temperature_2m&models=gfs_seamless&timezone=America/New_York&start_date=2027-03-13&end_date=2027-03-15")).json();
  if (!s.error) { const t = s.hourly.time; console.log(`spring 2027: n=${t.length}; Mar 14 00-04: ${t.filter((x) => x >= "2027-03-14T00:00" && x <= "2027-03-14T04:00").join(" ")}`); } else console.log("spring:", s.reason);
})();
