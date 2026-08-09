# Firefox setup — WOH Account Surveys

Company browsers often block store extensions that are not on an allowlist. Firefox still lets you load a **temporary local add-on** for your own session.

## What it does

1. Open an Appointment (REQ) in Salesforce (already logged in).
2. Click the **WOH Account Surveys** toolbar icon.
3. A **panel stays on the page** with the 10 most recent surveys (click **×** to close).
4. Results are **cached for 12 hours** per Account; use **Refresh now** in the panel to force a reload.

No Google Sheets. No Salesforce Connected App — it reuses your Lightning login via UI API + the Visualforce feedback page.

## Install (temporary add-on)

1. Open Firefox and go to:
   ```
   about:debugging#/runtime/this-firefox
   ```
2. Click **Load Temporary Add-on…**
3. Select this file (must be named `manifest.json` — Firefox ignores other names in the folder):
   ```
   /Users/feizhou.li/Projects/survey/extension/manifest.json
   ```
   (`manifest.firefox.json` is the same content; loading it still picks up a nearby Chrome-style `manifest.json` if present, which causes the `service_worker` error.)
4. Pin the add-on from the puzzle icon.
5. Open a REQ page such as:
   ```
   https://workday.lightning.force.com/lightning/r/Appointment__c/.../view
   ```
6. Click the extension → **Show account surveys**.

### Temporary add-ons reset

Firefox removes temporary add-ons when you **fully quit** Firefox. After each restart, reload via `about:debugging`.

Bookmark `about:debugging#/runtime/this-firefox` for quick reload.

## How it finds surveys

1. Reads the **Account** link on the open REQ (same link as `/lightning/r/Account/{accountId}/view`). Falls back to Lightning UI API if the link is not on screen yet.
2. Pages `WOH_Survey_Results__r` for that Account Id.
3. Sorts by `Date_Time_Survey_Submitted__c`, keeps the newest 10.
4. Loads each answer set from `/apex/WHT_FeedBackDetail?appointmentId=…`.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `background.service_worker is currently disabled` | Select `extension/manifest.json` (Firefox MV2 with `background.scripts`). Do not load an old Chrome MV3 manifest. |
| Extension not in toolbar | Pin from puzzle menu |
| “Could not establish connection” | Reload the Salesforce tab after loading the add-on |
| “Could not resolve Account” | Confirm the REQ has an Account; reload page |
| Empty / partial answers | Feedback page may be slow — retry; check that “View Submitted Feedback” works manually |
| Add-on disappears after restart | Normal for temporary add-ons — reload via `about:debugging` |
| IT blocks `about:debugging` | Temporary add-ons are blocked; this approach cannot run |

## Requirements

- Firefox 109+
- Logged into `workday.lightning.force.com` in the same browser profile
