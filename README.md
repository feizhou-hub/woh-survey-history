# Survey History Tracking

Browser extension that shows the newest Ask-an-Expert survey answers for the Account on the Appointment (REQ) or Account page you have open.

- Firefox (temporary add-on): [docs/FIREFOX.md](docs/FIREFOX.md)
- Chrome (Manifest V3, load unpacked): [docs/CHROME.md](docs/CHROME.md)

## What it does

1. You open an `Appointment__c` (REQ) record in Salesforce (already logged in).
2. Click the extension → **Show account surveys**.
3. It resolves the Account, lists related `WOH_Survey_Result__c` rows, takes the newest 10, and scrapes answers from the Visualforce feedback page (`WHT_FeedBackDetail`).
4. Ratings and comments appear in an on-page panel.

## Install (Chrome)

```bash
./scripts/stage-chrome.sh
```

Then `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/chrome`. Full steps: [docs/CHROME.md](docs/CHROME.md).

Company Chrome is managed. A teammate rollout should be an enterprise allowlist, not the public Chrome Web Store.

## Install (Firefox)

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select [`extension/manifest.json`](extension/manifest.json)
3. Pin **WOH Account Surveys**
4. Open a REQ → click the icon → an on-page panel stays open until you click **×** (12h cache).

Temporary add-ons are removed when Firefox fully quits — reload via `about:debugging` after restart.

## Project layout

```
survey/
├── docs/FIREFOX.md          # Firefox install + troubleshooting
├── docs/CHROME.md           # Chrome install
├── scripts/stage-chrome.sh  # Build dist/chrome
├── extension/               # Shared extension
│   ├── manifest.json        # Firefox MV2 (load this in Firefox)
│   ├── manifest.chrome.json # Chrome MV3
│   ├── manifest.firefox.json
│   ├── background.js
│   ├── content/
│   │   ├── appointment.js   # Account survey loader
│   │   ├── sf-api.js        # Lightning UI API helpers
│   │   ├── scrape-utils.js
│   │   └── feedback.js      # VF tab scrape fallback
│   └── popup/
└── README.md
```

## Limitations

- UI / session based — uses your logged-in Salesforce browser session (UI API + VF HTML).
- Caps at **10** most recent surveys per Account (by submitted date).
- Firefox temporary add-on is removed when Firefox fully quits. The Chrome unpacked load stays until you remove it.
- If Workday changes VF markup or related-list API names, parsers may need updates.

## Security / compliance

- Survey data stays in the on-page panel and in `browser.storage.local` on this computer (12-hour cache). The extension does not send it to a server outside Salesforce.
- Confirm viewing customer feedback this way complies with your data policies.
