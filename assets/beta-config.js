/* Beta analytics collector. Empty = analytics off: nothing leaves the browser.
   Set to the Google Apps Script web-app URL from tools/analytics/README.md (ends in /exec). */
window.BETA_ANALYTICS = { endpoint: "https://script.google.com/macros/s/AKfycbx7y2wrhG7-4vsiqe1bYgqT0icwV4JOgxgaOs_BKtg4hBNvkjjSeWLlB8y77G267Q-SPg/exec" };
/* Google Calendar import (read-only). Off until a dedicated beta origin is set up: the OAuth client ID and the exact
   origins it is authorized for. Never enabled on raw.githack.com. */
window.BETA_CALENDAR = { clientId: "", origins: [] };
