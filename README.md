# Survey History Tracking

Browser extension for the Workday Salesforce org. On an Ask-an-Expert Appointment (REQ) or Account record, it opens a panel with recent survey answers, a request-CSAT trend, and the return ratio.

- Firefox (temporary add-on): [docs/FIREFOX.md](docs/FIREFOX.md)
- Chrome (Manifest V3, load unpacked): [docs/CHROME.md](docs/CHROME.md)

You need to be logged into `workday.lightning.force.com` in the same browser profile. The extension uses that session. It does not use a Connected App.

## What it does

Click the **Survey History Tracking** toolbar icon on a record page. A panel stays on the page until you click **×**.

| Page | Survey list | Also shown |
|------|-------------|------------|
| Appointment (`Appointment__c`, including `/lightning/r/a3N…`) | 10 newest surveys submitted by that request’s **Primary NSC Contact** | Contact name, average request CSAT (`n.n/5`), CSAT trend, return ratio |
| Account (`Account`, including `/lightning/r/001…`) | 20 newest surveys for the Account | Account name, average request CSAT, CSAT trend by contact, return ratio |

The table columns are **Request #**, **Survey date**, **Customer**, and **Request CSAT**. Request # is the related `REQ-` or `OPR-` number. The survey-result name (`WOH SR-…`) and the Appointment `APP-` name are not used as that number. The CSAT value links to the feedback page.

Request CSAT is the customer’s own answer, shown in English. Row color follows that answer: very satisfied (or 5 stars) is green, satisfied (or 4 stars) is yellow, and other scored answers are red. The average is the mean of those answers on a 1–5 scale. There is no model and no external AI call.

**Return ratio** is every CSAT survey divided by every request, shown as a percent. Appointment pages count both numbers for the same Primary NSC Contact. Account pages count the whole Account. Zero requests shows an em dash.

Results are cached in the browser for **12 hours**. **Refresh now** loads them again. On an Account page the survey table starts collapsed behind **Show N survey results**.

If the Primary NSC Contact is missing, or that customer has no scored survey, the panel says so instead of listing another person’s surveys.

## How it loads the data

1. Read the Account (and, on an Appointment, the Primary NSC Contact) from the Lightning UI API. If the Account link is already on the page, that link is used as a fallback.
2. Run an allowlisted SOQL query against `https://workday.my.salesforce.com` for `WOH_Survey_Result__c`, sorted by `Date_Time_Survey_Submitted__c`. The same background query loads the survey and request counts for the return ratio.
3. Load each answer from the Visualforce page `WHT_FeedBackDetail` (`workday.lightning.force.com`, then `workday--c.vf.force.com`). If that fetch fails, a background tab opens the feedback page, scrapes it, and closes.

Salesforce hosts the extension may access:

- `https://workday.lightning.force.com/*`
- `https://workday.my.salesforce.com/*`
- `https://workday--c.vf.force.com/*`

## Install (Chrome)

```bash
./scripts/stage-chrome.sh
```

Then `chrome://extensions` → Developer mode → **Load unpacked** → `dist/chrome`. Chrome 153 ignores `--load-extension`, so use the button. Full steps: [docs/CHROME.md](docs/CHROME.md).

A teammate rollout on managed Chrome should be an enterprise allowlist of a packed copy, not the public Chrome Web Store. Load unpacked is the local test path.

## Install (Firefox)

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select [`extension/manifest.json`](extension/manifest.json)
3. Pin **Survey History Tracking**
4. Open a REQ or Account record and click the icon

Temporary add-ons are removed when Firefox fully quits. Reload via `about:debugging` after a restart. Load `manifest.json` (Firefox MV2). Loading a Chrome MV3 manifest produces `background.service_worker is currently disabled`.

## Project layout

```
survey/
├── docs/FIREFOX.md
├── docs/CHROME.md
├── scripts/stage-chrome.sh          # writes dist/chrome
├── extension/
│   ├── manifest.json                # Firefox MV2 — load this file
│   ├── manifest.firefox.json        # same Firefox manifest
│   ├── manifest.chrome.json         # Chrome MV3
│   ├── background.js                # toolbar click, SOQL, feedback fetch
│   ├── api.js
│   └── content/
│       ├── appointment.js           # page loader
│       ├── panel.js                 # on-page panel and 12-hour cache
│       ├── sf-api.js                # UI API and allowlisted SOQL
│       ├── primary-nsc.js           # Primary NSC Contact
│       ├── csat-parse.js            # answer text, points, trend
│       ├── request-number.js        # REQ- / OPR- labels
│       ├── scrape-utils.js
│       ├── feedback.js              # background-tab scrape
│       ├── page-context.js
│       ├── spa-router.js
│       └── html-text.js
└── tools/                           # node tests and panel preview
```

`extension/options/`, `apps-script/`, and `userscript/` are not registered in either manifest. The running extension does not post survey data to a webhook.

## Limitations

- Depends on your Salesforce login in this browser (UI API, REST query, and Visualforce HTML).
- Appointment pages list 10 surveys. Account pages list 20. Both are the newest by submitted date.
- The 12-hour cache is `storage.local` on this computer. It is not synced to a browser account.
- A Firefox temporary add-on disappears after a full quit. A Chrome unpacked load stays until you remove it.
- If Workday changes the feedback-page markup or the survey lookup field, the parsers need an update.

## Security / compliance

Survey text stays in the on-page panel and in the local 12-hour cache. Requests go only to the three Salesforce hosts above. The extension reads the Salesforce `sid` cookie so the background query can run as you, and does not store that cookie. Confirm that viewing customer feedback this way matches your data policy.
