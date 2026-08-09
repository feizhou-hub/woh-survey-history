# Extension package distribution — design

**Date:** 2026-08-09  
**Repo:** [feizhou-hub/woh-survey-history](https://github.com/feizhou-hub/woh-survey-history)  
**Status:** Approved for planning

## Goal

Ship installable browser packages so teammates can install **WOH Account Surveys** without the Chrome/Firefox store allowlist, and so the install **survives a full browser restart**.

## Distribution model

| Browser | Artifact | Install method | Survives restart |
|---------|----------|----------------|------------------|
| Chrome / Edge | `woh-survey-history-chrome-vX.Y.Z.zip` | Unzip → Load unpacked | Yes |
| Firefox | `woh-survey-history-firefox-vX.Y.Z.xpi` (AMO-signed, unlisted) | Install Add-on From File | Yes |

Artifacts are published on **GitHub Releases** (option A). No public store listing in this pass.

## Source layout

Keep one shared extension tree; build two packages from it:

```
extension/                    # shared JS, icons, content scripts, options/popup
  manifest.json               # Firefox MV2 (current; input for signed .xpi)
  manifest.chrome.json        # Chrome/Edge MV3 (new)
  background.js               # shared; already has importScripts + action/browserAction
scripts/
  package.sh                  # build chrome zip + sign firefox xpi → dist/
dist/                         # gitignored build output
docs/
  INSTALL.md                  # teammate install steps
  FIREFOX.md                  # keep; temporary-debug path remains documented
```

### Manifests

- **Firefox (`manifest.json`):** MV2, `background.scripts`, `browser_action`, `applications.gecko`. Stable add-on id: `woh-survey-history@feizhou-hub` (replace `woh-account-surveys@local.dev` so updates replace the same add-on).
- **Chrome/Edge (`manifest.chrome.json`):** MV3, `background.service_worker` pointing at `background.js`, `action` (not `browser_action`), host permissions via `host_permissions` as required by MV3. Same permissions/content_scripts/icons intent as Firefox.

### Versioning

Single version string in both manifests; bump together for each release (first packaged release: `0.4.0`).

## Packaging & signing

### Chrome / Edge zip

1. Stage `extension/` into a temp dir.
2. Use `manifest.chrome.json` as `manifest.json` in the stage.
3. Zip to `dist/woh-survey-history-chrome-vX.Y.Z.zip`.

### Firefox signed xpi

1. Build with `web-ext` from `extension/` (Firefox manifest).
2. Sign unlisted via `web-ext sign` using maintainer AMO credentials:
   - `AMO_JWT_ISSUER` + `AMO_JWT_SECRET` (env), or web-ext auth file
   - Credentials are **never committed**
3. Output `dist/woh-survey-history-firefox-vX.Y.Z.xpi`.

`package.sh` fails clearly if AMO creds are missing when signing is requested.

## Teammate install (docs)

Document in `README.md` (short) and `docs/INSTALL.md` (full):

1. Open the latest GitHub Release.
2. **Chrome/Edge:** download chrome zip → unzip → `chrome://extensions` or `edge://extensions` → Developer mode → Load unpacked → select folder.
3. **Firefox:** download `.xpi` → `about:addons` → gear → Install Add-on From File → select `.xpi`.

Keep temporary Firefox load (`about:debugging`) in `docs/FIREFOX.md` for local development only.

## Maintainer release workflow

1. Bump version in both manifests.
2. Run `./scripts/package.sh`.
3. Create GitHub Release `vX.Y.Z` with both artifacts and short notes (`gh release create`).

## Out of scope

- Chrome Web Store / public AMO listing
- Auto-update CDN or enterprise force-install policy
- CI-based signing (local sign + Release is enough for this pass)
- Feature changes to survey scraping / panel behavior

## Success criteria

- Teammate can install Chrome/Edge from Release zip and still see the add-on after restart.
- Teammate can install Firefox from signed `.xpi` and still see the add-on after restart.
- Maintainer can produce both artifacts with one script and publish via GitHub Releases.
- No secrets committed to the repo.
