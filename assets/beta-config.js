/* Beta analytics collector. Empty = analytics off: nothing leaves the browser.
   Set to the Google Apps Script web-app URL from tools/analytics/README.md (ends in /exec). */
window.BETA_ANALYTICS = { endpoint: "https://script.google.com/macros/s/AKfycbx7y2wrhG7-4vsiqe1bYgqT0icwV4JOgxgaOs_BKtg4hBNvkjjSeWLlB8y77G267Q-SPg/exec" };
/* Google Calendar import (read-only). Live only on the dedicated beta origin below (Cloudflare Pages, beta-previews
   branch); everywhere else, including raw.githack.com, the import offers the sample calendar only.
   The OAuth client ID is public by design; the client secret is never used here. */
window.BETA_CALENDAR = { clientId: "194107562342-hutpdsodiktf5j439n2laka2jkqk1ehe.apps.googleusercontent.com", origins: ["https://forecast-ops-beta.pages.dev"] };
/* Venue search provider for Add/Edit Event, Add Venue and calendar import. Searches run only when a planner presses
   Search on a place or address they have reviewed; calendar locations are never looked up automatically.
   Without a LocationIQ token for this origin: public OpenStreetMap Nominatim (the geocoder OPE uses), for occasional
   user-started searches only. */
/* LocationIQ ("Search by LocationIQ.com") is used only on the origins listed with its token: a token dedicated to this
   beta, restricted by HTTP referrer to forecast-ops-beta.pages.dev. Elsewhere (e.g. the Githack demo) the reviewed public
   search is used and the token is never sent. */
window.BETA_GEOCODER = { locationiq: { key: "pk.373d7a892d05fd1086f525af6a916b25", origins: ["https://forecast-ops-beta.pages.dev"] } };
