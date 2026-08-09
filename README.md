# WOH Account Surveys (Firefox)

Firefox temporary add-on that shows the **10 most recent Ask-an-Expert survey answers** for the **Account** on the Appointment (REQ) you have open.

Company Chrome/Firefox stores often block non-allowlisted extensions — load this as a **temporary add-on** instead.

→ Full Firefox steps: [docs/FIREFOX.md](docs/FIREFOX.md)

## What it does

1. You open an `Appointment__c` (REQ) record in Salesforce (already logged in).
2. Click the extension → **Show account surveys**.
3. It resolves the Account, lists related `WOH_Survey_Result__c` rows, takes the newest 10, and scrapes answers from the Visualforce feedback page (`WHT_FeedBackDetail`).
4. Ratings and comments appear in the popup.

## Install (Firefox)

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select [`extension/manifest.json`](extension/manifest.json)
3. Pin **WOH Account Surveys**
4. Open a REQ → click the icon → an on-page panel stays open until you click **×** (12h cache).

Temporary add-ons are removed when Firefox fully quits — reload via `about:debugging` after restart.

## Project layout

```
survey/
├── docs/FIREFOX.md          # Install + troubleshooting
├── extension/               # Firefox temporary WebExtension
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
- Temporary Firefox add-on only (not signed for permanent install).
- If Workday changes VF markup or related-list API names, parsers may need updates.

## Security / compliance

- Survey data stays in your browser popup unless you copy it elsewhere.
- Confirm viewing customer feedback this way complies with your data policies.
