# Cincinnati weather-history stories

Reviewed 2026-11-11. The Almanac shows local event anniversaries first, with the existing daily climate-record fallback on dates without a curated story. This pass expands 23 entries to 92 stories on 83 distinct month/day anniversaries. It does not claim a major event on every date.

## Calendar scan and editorial checks

- `weather-history-calendar-audit.json` indexes all 366 calendar dates, including Feb. 29, against the existing climate-record fallback, the NWS Wilmington event index and its daily anniversary cards.
- Attempted all 365 non-leap anniversary-card URLs. 364 were retrieved; card 287 (Oct. 14) returned unavailable. NWS does not provide a separate Feb. 29 card in that calendar. OCR was used to discover leads, not to publish text automatically. Some cards are marked draft and some have inconsistent dates or links. The public stories are individually selected summaries, not an unreviewed import of the cards.
- Regional storm entries explicitly name the Ohio Valley or the affected Tri-State communities. Central Ohio-only stories were not relabelled as Cincinnati events.
- Event dates drive anniversaries. Publication dates stay in source labels: the July 7, 1915 windstorm links to a July 8 newspaper transcription; October 19, 1989 snow links to an October 20 newspaper archive.
- Multi-day events identify their date span in the summary. Spotter amounts are labelled reports or storm totals rather than official daily climate totals.
- Some dates still have only their existing climate observation. Candidate links in the coverage index are research leads, not verified publishable stories and not a claim of an exhaustive newspaper search for that day.

## Open research sources

- [NWS Wilmington significant-event archive](https://www.weather.gov/iln/events) and [local anniversary calendar](https://www.weather.gov/iln/wxhistory). Dated storm pages, their survey subpages and the original `source/iln/events/YYYYMMDD/lsr.xml` reports supply local details for several modern events.
- [Library of Congress: Cincinnati at flood time](https://www.loc.gov/item/2014691624/) provides the documentary photograph below.
- [Midwestern Regional Climate Center: Cincinnati in the 1913 flood](https://mrcc.purdue.edu/1913Flood/communities/cincinnati) supplies the rapid river-rise context and relief history.
- [Kentucky Post first-day account of the July 7, 1915 storm](https://www.nkyviews.com/kenton/text/1915_tornado_post_2.html), transcribed by NKyViews, and its [photo and newspaper collection](https://www.nkyviews.com/Links/tornado_July_7_1915.htm). Use the neutral term windstorm: historical newspaper uses of tornado/cyclone do not establish a modern tornado classification.
- [Williams’ Cincinnati Directory, 1927-28, Part 1](https://apps.cincinnatilibrary.org/citydirectory/WilliamsCincinnatiDirectory_1927-28_Pt01.pdf), printed pages 25-26, contains the contemporary annual weather account for 1926. Its observations distinguish snow depth from snowfall.
- [Daily Pilot, Jan. 18, 1977, page A4](https://archive.newportbeachlibrary.org/NBPL/0/edoc/1233723/1977-01-18%20-%20Orange%20Coast%20Pilot.pdf) and [The Observer, Oct. 20, 1989, page 2](https://archives.nd.edu/observer/1989-10-20_v23_040.pdf) are open newspaper archives with contemporary reports covering Cincinnati weather.
- Cincinnati Library’s open flood exhibit, Ohio Memory’s photo catalog, the Bengals’ first-party Freezer Bowl retrospective and selected local newsroom retrospectives provide additional reading and photo galleries. The application links to those pages; it does not republish their photographs.

## Hosted photograph and rights

`assets/history/cincinnati-flood-1913-bain.jpg` is the unmodified 640-pixel JPEG from the [Library of Congress resource](https://www.loc.gov/resource/ggbain.12028/), item 2014691624, George Grantham Bain Collection. Credit: Bain News Service / Library of Congress. The item’s rights advisory states “No known restrictions on publication.” Original download: https://tile.loc.gov/storage-services/service/pnp/ggbain/12000/12028r.jpg

The caption preserves the distinction between the archive’s March 27 creation/publication date and the April 1 river crest. The photograph is hosted with the site, with descriptive alt text, intrinsic dimensions and a link back to the catalog. Other photos are linked at their archives because reuse rights have not been established.

## Updating the collection

Edit `assets/cincinnati-weather-history.js` with a precise local event date, an original short summary, named source and public URL. Optional `links` provide additional articles, scans or photo collections. A `photo` additionally requires local file, caption, credit, rights advisory and catalog URL. Update the calendar audit when adding dates, run `node tests/weather-history.test.js` and stamp assets. The day’s weather measurements remain in the climate report; these stories do not change observations or records.
