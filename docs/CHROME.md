# Chrome setup — Survey History Tracking

Chrome package for the same extension as Firefox. It is Manifest V3. Shared scripts live in `extension/`; `scripts/stage-chrome.sh` copies them to `dist/chrome` and installs `manifest.chrome.json` as `manifest.json`.

## Install (load unpacked)

1. From the repo root:

   ```bash
   ./scripts/stage-chrome.sh
   ```

2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder. Chrome 153 ignores `--load-extension`, so use this button:

   ```
   dist/chrome
   ```

5. Pin **Survey History Tracking**.
6. Open a Salesforce Appointment (REQ) or Account page, then click the toolbar icon. The panel stays on the page until you click **×**. Results are cached in the browser for 12 hours.

Reload the extension from `chrome://extensions` after pulling script changes. Re-run `./scripts/stage-chrome.sh` first so `dist/chrome` picks up those changes.

## Where it runs

Only these Workday Salesforce hosts:

- `https://workday.lightning.force.com/*` — Appointment and Account record pages, and the Visualforce feedback page
- `https://workday.my.salesforce.com/*` — logged-in REST query for survey rows
- `https://workday--c.vf.force.com/*` — Visualforce feedback page fallback

## Company distribution

This build is not published on the Chrome Web Store. For teammates on managed Chrome, ask IT to allowlist or force-install a packed copy. Load unpacked is the local test path and needs Developer mode.

## Requirements

- Chrome 120+
- Logged into `workday.lightning.force.com` in the same Chrome profile
