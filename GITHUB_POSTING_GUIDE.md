# GitHub Posting Guide

Use this guide when creating the public GitHub repository.

## Suggested repository name

```text
unbounce-gtm-form-tracker
```

Alternative names:

```text
unbounce-form-tracker
unbounce-dataLayer-form-tracker
unbounce-confirmation-form-tracker
```

## Repository description

```text
Confirmation-render-based Unbounce form tracking for Google Tag Manager. Fires success/failure events to dataLayer with consent gating, PII redaction, dedupe, optional hashing, and SPA support.
```

## Suggested topics

```text
google-tag-manager
gtm
dataLayer
ga4
unbounce
landing-pages
form-tracking
conversion-tracking
server-side-gtm
meta-capi
enhanced-conversions
analytics
javascript
```

## Files to publish

```text
README.md
LICENSE
CHANGELOG.md
.gitignore
unbounce-form-tracker.js
unbounce-form-tracker.gtm.html
GITHUB_POSTING_GUIDE.md
```

## First commit message

```text
Initial Unbounce GTM form tracker release
```

## Release title

```text
Unbounce GTM Form Tracker v3.0.1
```

## Release notes

```text
Initial standalone Unbounce release.

Includes:
- Confirmation-render-based success tracking
- Unbounce validation failure tracking
- dataLayer events for success, failure, interaction, and initialization
- Consent detection for Google Consent Mode v2, OneTrust, and Cookiebot
- PII redaction when consent is denied
- Optional SHA-256 hashing for email and phone
- Duplicate success suppression
- SPA route-change support
- Raw JS and GTM Custom HTML versions
```

## Publish from local terminal

If the GitHub repo already exists and is empty:

```bash
cd "/Users/iyke-abel/Documents/Form Trackers/unbounce-gtm-form-tracker"
git init
git add README.md LICENSE CHANGELOG.md .gitignore unbounce-form-tracker.js unbounce-form-tracker.gtm.html GITHUB_POSTING_GUIDE.md
git commit -m "Initial Unbounce GTM form tracker release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/unbounce-gtm-form-tracker.git
git push -u origin main
```

If this folder is already a Git repo, skip `git init`.

## GitHub UI checklist

1. Create a new public repository.
2. Use the suggested description above.
3. Do not initialize with README, license, or gitignore if you are pushing these files from local.
4. Push the local files.
5. Add the suggested topics in the repo sidebar.
6. Confirm the README renders correctly.
7. Open `unbounce-form-tracker.js` and confirm it does not include `<script>` tags.
8. Open `unbounce-form-tracker.gtm.html` and confirm it does include `<script>` tags.
9. Create release `v3.0.1`.
10. Paste the release notes above.

## Pre-publish QA

Before announcing it publicly:

1. Install `unbounce-form-tracker.gtm.html` in a GTM Preview container.
2. Submit a real Unbounce form with valid data.
3. Confirm `ec_tracker_initialized` fires once.
4. Confirm `ec_form_interaction` fires once after input.
5. Confirm `unbounce_form_success` fires after success.
6. Submit invalid data and confirm `unbounce_form_failed` fires.
7. Test a redirect action and check `ec_detection_method`.
8. Test pages with popups/chat/A-B testing and inspect any `generic_node` successes.
9. Test `debug:true` only in preview.
10. Test `pii:false` through `EC_FORM_CONSENT_CHECK` and confirm raw PII is removed.
11. Confirm raw PII is not mapped into GA4 event parameters.
12. Check `window._ecFormTrackers.unbounce.status()` in the browser console.

## Important README promise

Keep the README privacy wording aligned with the code. If you change dedupe, storage, hashing, or consent behavior later, update the README in the same commit.
