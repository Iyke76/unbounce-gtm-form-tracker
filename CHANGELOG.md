# Changelog

## 3.3.0 (2026-11-06)

Rebuilt from the universal tracker v3.3.0. Existing event names and keys are unchanged, so current triggers and variables keep working.

- `ec_first_name`, `ec_last_name`, `ec_company`, `ec_street`, `ec_city`, `ec_region`, `ec_postal_code` and `ec_country`
- Phone validation to E.164, with `defaultCountryCode` and `countryCodeField`
- Consent queue: events raised while analytics consent is denied replay when it is granted
- First and last touch attribution with click IDs
- Failure diagnostics: `ec_submit_attempt`, `ec_time_to_submit_s`, `ec_fast_submit`, `ec_failed_fields`
- `strictSuccess` to drop inferred successes
- `rawFields` and `redactFields`. The GTM file now ships `rawFields: false`, so `ec_raw_fields` is off unless you turn it on
- Password, card, SSN and IBAN style field names are always stripped

## 3.0.1

Initial standalone Unbounce release prepared for public GitHub publishing.

### Included

- Unbounce-only confirmation-render-based tracking.
- `unbounce_form_success` and `unbounce_form_failed` dataLayer events.
- First-interaction event: `ec_form_interaction`.
- Load diagnostic event: `ec_tracker_initialized`.
- Consent detection for Google Consent Mode v2, OneTrust, and Cookiebot.
- `window.EC_FORM_CONSENT_CHECK` override hook.
- PII redaction when PII consent is denied.
- Optional SHA-256 hashing for normalized email and phone values.
- Duplicate success suppression using a 5-minute session dedupe ledger.
- SPA route-change rescanning.
- GTM Custom HTML paste-ready file and raw JavaScript file.

### Privacy hardening

- Debug logging defaults to disabled.
- Dedupe runs after PII redaction.
- Analytics-denied consent prevents event firing and storage writes.
- PII-denied consent redacts both stored and in-memory recall data.

### Fixed before public release

- Corrected heartbeat tracker version reference for the Unbounce standalone.
- Removed `<script>` wrapper from the raw `.js` file.
- Added native validity checking to the `pagehide` fallback guard.
