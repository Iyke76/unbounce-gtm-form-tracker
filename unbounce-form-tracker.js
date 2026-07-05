/**
 * Author: Iyke Abel
 * Linkedin: https://www.linkedin.com/in/iykeabel/
 * Email: abeliyke05@gmail.com
 * License: MIT
 *
 * Unbounce Form Tracking — Confirmation-Render-Based (v3.0.1 standalone)
 * ============================================================
 * Standalone extraction of the Universal Form Tracking script v3.0.1,
 * scoped to Unbounce only. Core logic (classifier, consent, dedupe,
 * hashing, storage) is byte-identical to the universal build. Safe to
 * run alongside the other standalone platform scripts: each uses its
 * own storage key, load guard, and status namespace, and they share
 * one dedupe ledger (fingerprints are platform-scoped).
 *
 * Philosophy:
 *  - Fires on observable confirmation render (DOM-level success signal)
 *  - NOT on submit button click (counts validation failures, rage clicks)
 *  - NOT on thank-you page load alone (counts direct navigations, refreshes)
 *  - Failed submissions fire on real failure render only
 *  - Every success/failure event carries ec_detection_method
 *
 * Unbounce signals:
 *  - Detection : form containing .lp-pom-form-field
 *  - SUCCESS   : form removed/hidden, confirmation node, OR pagehide (redirect)
 *  - FAILURE   : HTML5 invalid event OR error-flagged node render
 *  - Form ID   : pageId (+ :pageVariant) hidden fields
 *  - Recovery  : gated by allowRecoverySuccess (re-arm on valid resubmit)
 *
 * Events pushed to dataLayer:
 *  - unbounce_form_success | unbounce_form_failed
 *  - ec_form_interaction    (first input per form, metadata only)
 *  - ec_tracker_initialized (once per pageload — heartbeat diagnostic)
 *
 * --- CONFIGURATION ---
 * Define window.EC_FORM_CONFIG BEFORE this script loads (shared by all
 * standalone EC tracking scripts on the page):
 *
 *   window.EC_FORM_CONFIG = {
 *     debug: false,                 // [EC] console logging
 *     hashPii: false,               // add ec_email_sha256 / ec_phone_sha256
 *     dedupe: true,                 // suppress duplicate success events (5 min)
 *     allowRecoverySuccess: true,   // fail -> fix -> resubmit fires BOTH events
 *     submitWindowMs: 15000,        // post-click watch window
 *     ttlMs: 600000,                // stored payload freshness (10 min)
 *     defaultCountryCode: '1',      // for E.164 phone normalization ('' disables)
 *     extraThankYouPatterns: []     // additional confirmation-URL substrings
 *   };
 *
 * --- PII & DATALAYER ROUTING (READ BEFORE DEPLOYING) ---
 * The event payload includes ec_email, ec_phone, ec_name, and ec_raw_fields.
 * ec_email is lowercased/trimmed and ec_phone is E.164-normalized best-effort
 * (raw values preserved in ec_raw_fields) — the normalization Google Enhanced
 * Conversions and Meta CAPI expect before hashing. Intended for:
 *   (a) Server-side use (Meta CAPI, Google EC, server-side GTM), where values
 *       are hashed before leaving the browser
 *   (b) First-party CRM integrations
 * DO NOT send raw fields to GA4 via a standard GA4 Event tag — GA4 ToS
 * prohibits PII in event parameters. Either use hashPii:true and send only
 * ec_*_sha256, use server-side GTM hashing, or exclude the ec_* parameters
 * from GA4 tags.
 *
 * --- HASHING MODE (hashPii: true) ---
 * ec_email_sha256 / ec_phone_sha256 are precomputed asynchronously on field
 * blur, so they are ready synchronously at event time (redirect paths keep
 * them). Requires HTTPS; absent on HTTP or if submit beats the hash (rare) —
 * raw fields always present as server-side fallback.
 *
 * --- EVENT ID & DEDUPLICATION ---
 * Every event carries ec_event_id (UUID v4) — pass to Meta CAPI as event_id.
 * With dedupe:true, a success whose fingerprint (platform + form_id + email
 * + phone) fired within 5 minutes is suppressed (logged when debug:true).
 *
 * --- DETECTION METHOD (signal quality, strongest to weakest) ---
 *   confirmation_event, confirmation_class, postmessage, confirmation_render,
 *   form_removed, stored_recall, generic_node, pagehide
 * Failure methods: error_class, validation_message, invalid_event, error_render
 * KNOWN LIMITATION: 'pagehide' fires if the user clicks submit then leaves
 * within the window for ANY reason — segment by ec_detection_method if your
 * pages have off-page CTAs near forms.
 *
 * --- CONSENT GATE ---
 * Auto-detects Google Consent Mode v2, OneTrust, Cookiebot. Override with
 * window.EC_FORM_CONSENT_CHECK (shared by all EC scripts):
 *   analytics denied -> no events, no storage
 *   pii denied       -> events fire without ec_* PII fields/hashes;
 *                       storage strips PII; ec_pii_redacted:true added
 * Default (no CMP, no override): full consent — caller is responsible.
 *
 * --- SPA SUPPORT ---
 * history.pushState/replaceState/popstate hooked: route changes re-scan for
 * forms and re-check thank-you URLs. WeakMap state prevents double-attach.
 *
 * --- DEBUG API ---
 * window._ecFormTrackers.unbounce.status() returns version, consent, forms
 * attached, last event, and config. Paste its output when reporting issues.
 *
 * --- IDEMPOTENCY ---
 * Safe to load multiple times; re-init is a no-op (logged when debug:true).
 *
 * --- KNOWN LIMITATIONS ---
 * 1. pagehide heuristic — see DETECTION METHOD above.
 * 2. Cross-DOMAIN redirect confirmations: pagehide event fires and GA4
 *    (sendBeacon) survives, but older pixel tags may drop, and the
 *    stored_recall backstop cannot run on a different domain.
 * 3. Bot/spam submissions passing platform validation count as success —
 *    pair with server-side lead validation for paid-media optimization.
 * 4. Phone normalization is best-effort E.164; raw value in ec_raw_fields.
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // LOAD GUARD — prevent double-init when script is loaded twice
  // (e.g., GTM Custom HTML + embedded copy on same page)
  // ═══════════════════════════════════════════════════════════════
  if (window._ec_unbounce_tracker_loaded) {
    if (window.console) {
      console.log('[EC] Already initialized (v' + (window._ec_unbounce_tracker_version || '?') + '), skipping re-init');
    }
    return;
  }
  window._ec_unbounce_tracker_loaded = true;
  window._ec_unbounce_tracker_version = '3.0.1';

  // ═══════════════════════════════════════════════════════════════
  // CONFIG — defaults merged with window.EC_FORM_CONFIG
  // ═══════════════════════════════════════════════════════════════
  var USER = (typeof window.EC_FORM_CONFIG === 'object' && window.EC_FORM_CONFIG) || {};
  var CONFIG = {
    debug                : USER.debug                !== undefined ? !!USER.debug                : false,
    hashPii              : USER.hashPii              !== undefined ? !!USER.hashPii              : false,
    dedupe               : USER.dedupe               !== undefined ? !!USER.dedupe               : true,
    allowRecoverySuccess : USER.allowRecoverySuccess !== undefined ? !!USER.allowRecoverySuccess : true,
    submitWindowMs       : typeof USER.submitWindowMs     === 'number' ? USER.submitWindowMs     : 15 * 1000,
    ttlMs                : typeof USER.ttlMs              === 'number' ? USER.ttlMs              : 10 * 60 * 1000,
    defaultCountryCode   : typeof USER.defaultCountryCode === 'string' ? USER.defaultCountryCode : '1',
    extraThankYouPatterns: Array.isArray(USER.extraThankYouPatterns) ? USER.extraThankYouPatterns : []
  };

  var STORAGE_KEY = 'ec_unbounce_form_data';
  var DEDUPE_KEY  = 'ec_form_dedupe';

  function log() {
    if (CONFIG.debug && window.console) console.log.apply(console, ['[EC]'].concat([].slice.call(arguments)));
  }


  // ═══════════════════════════════════════════════════════════════
  // UUID v4 — ec_event_id for Meta CAPI dedup and log correlation
  // ═══════════════════════════════════════════════════════════════
  function uuid() {
    if (window.crypto && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch (e) {}
    }
    var d = Date.now();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (d + Math.random() * 16) % 16 | 0;
      d = Math.floor(d / 16);
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // CONSENT GATE — universal, configurable
  //
  // Returns { analytics: bool, pii: bool }. analytics=false suppresses
  // event firing and storage entirely. pii=false strips PII from both
  // dataLayer pushes and storage (event still fires with metadata only).
  //
  // Detection priority:
  //   1. window.EC_FORM_CONSENT_CHECK override (caller-defined)
  //   2. Google Consent Mode v2 (window.google_tag_data.ics)
  //   3. OneTrust (window.OnetrustActiveGroups)
  //   4. Cookiebot (window.Cookiebot.consent)
  //   5. Default: full consent
  // ═══════════════════════════════════════════════════════════════
  function getConsent() {
    if (typeof window.EC_FORM_CONSENT_CHECK === 'function') {
      try {
        var r = window.EC_FORM_CONSENT_CHECK();
        if (r === true)  return { analytics: true,  pii: true  };
        if (r === false) return { analytics: false, pii: false };
        if (r && typeof r === 'object') {
          return {
            analytics: r.analytics !== false,
            pii: r.pii === true || r.ads === true || r.marketing === true
          };
        }
      } catch (e) { log('Consent check threw:', e); }
    }
    // Google Consent Mode v2 — state codes: 1 = granted, 2 = denied
    if (window.google_tag_data && window.google_tag_data.ics &&
        typeof window.google_tag_data.ics.getConsentState === 'function') {
      try {
        var adUserData = window.google_tag_data.ics.getConsentState('ad_user_data');
        var analytics  = window.google_tag_data.ics.getConsentState('analytics_storage');
        return {
          analytics: analytics !== 2,           // any state except denied
          pii: adUserData === 1                 // strictly granted
        };
      } catch (e) {}
    }
    // OneTrust — common group IDs (C0002=Performance, C0004=Targeting).
    // Adjust in EC_FORM_CONSENT_CHECK if your OneTrust config differs.
    if (typeof window.OnetrustActiveGroups === 'string') {
      return {
        analytics: window.OnetrustActiveGroups.indexOf('C0002') !== -1,
        pii: window.OnetrustActiveGroups.indexOf('C0004') !== -1
      };
    }
    // Cookiebot
    if (window.Cookiebot && window.Cookiebot.consent) {
      return {
        analytics: !!window.Cookiebot.consent.statistics,
        pii: !!window.Cookiebot.consent.marketing
      };
    }
    return { analytics: true, pii: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // NORMALIZATION — the shapes Enhanced Conversions / Meta CAPI expect
  // before hashing. Raw values always preserved in ec_raw_fields.
  // ═══════════════════════════════════════════════════════════════
  function normalizeEmail(v) {
    return (v || '').trim().toLowerCase();
  }
  function normalizePhone(v) {
    if (!v) return '';
    var raw = v.trim();
    var hasPlus = raw.charAt(0) === '+';
    var digits = raw.replace(/[^\d]/g, '');
    if (!digits) return '';
    if (hasPlus) return '+' + digits;
    var cc = CONFIG.defaultCountryCode;
    if (cc) {
      // Already includes the country code (e.g. 1XXXXXXXXXX for cc '1')
      if (digits.indexOf(cc) === 0 && digits.length === cc.length + 10) return '+' + digits;
      // National-format 10-digit number — prepend country code
      if (digits.length === 10) return '+' + cc + digits;
    }
    return digits; // best-effort passthrough; raw kept in ec_raw_fields
  }

  // ═══════════════════════════════════════════════════════════════
  // SHA-256 CACHE — hashes precomputed on field blur so they're ready
  // synchronously at event time (survives redirect paths). Secure
  // context (HTTPS) required; silently unavailable otherwise.
  // ═══════════════════════════════════════════════════════════════
  var hashCache = {};
  function canHash() {
    return CONFIG.hashPii && window.crypto && crypto.subtle &&
           typeof crypto.subtle.digest === 'function' && window.TextEncoder;
  }
  function precomputeHash(normalizedValue) {
    if (!canHash() || !normalizedValue || hashCache[normalizedValue] !== undefined) return;
    hashCache[normalizedValue] = null; // in-flight marker
    try {
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedValue))
        .then(function (buf) {
          var bytes = new Uint8Array(buf), hex = '';
          for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
          hashCache[normalizedValue] = hex;
        })
        .catch(function () { delete hashCache[normalizedValue]; });
    } catch (e) { delete hashCache[normalizedValue]; }
  }
  function getHash(normalizedValue) {
    var h = hashCache[normalizedValue];
    return (typeof h === 'string' && h) ? h : '';
  }
  // Warm the cache for any email/phone-looking values in a fields map
  function warmHashes(fields) {
    if (!canHash() || !fields) return;
    Object.keys(fields).forEach(function (k) {
      var f = fields[k];
      if (!f || !f.value) return;
      if (f.type === 'email' || /email/i.test(k) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value)) {
        precomputeHash(normalizeEmail(f.value));
      }
      if (f.type === 'tel' || /phone|tel|mobile|cell/i.test(k)) {
        precomputeHash(normalizePhone(f.value));
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // STORAGE — persists across same-domain navigation as a backup
  // ═══════════════════════════════════════════════════════════════
  function persist(data) {
    var consent = getConsent();
    if (!consent.analytics) {
      log('Analytics consent denied — skipping storage');
      return;
    }
    data._ts = Date.now();
    var toStore = data;
    if (!consent.pii && data.fields) {
      toStore = JSON.parse(JSON.stringify(data));
      Object.keys(toStore.fields).forEach(function (k) {
        var t = toStore.fields[k].type;
        if (t === 'email' || t === 'tel' || t === 'text' || t === 'textarea' || t === 'description') {
          delete toStore.fields[k];
        }
      });
      toStore._pii_redacted = true;
    }
    // Keep the in-memory recall copy aligned with consent, too. If PII is
    // denied, recall paths get the same redacted payload as browser storage.
    window._ec_unbounce_form_data = toStore;
    var json = JSON.stringify(toStore);
    try { localStorage.setItem(STORAGE_KEY, json);   } catch (e) {}
    try { sessionStorage.setItem(STORAGE_KEY, json); } catch (e) {}
  }
  function recall() {
    var d = window._ec_unbounce_form_data;
    if (!d) { try { var l = localStorage.getItem(STORAGE_KEY);   if (l) d = JSON.parse(l); } catch (e) {} }
    if (!d) { try { var s = sessionStorage.getItem(STORAGE_KEY); if (s) d = JSON.parse(s); } catch (e) {} }
    if (d && d._ts && (Date.now() - d._ts) > CONFIG.ttlMs) { wipe(); return null; }
    return d || null;
  }
  function wipe() {
    try { localStorage.removeItem(STORAGE_KEY);   } catch (e) {}
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
    window._ec_unbounce_form_data = null;
  }

  // ═══════════════════════════════════════════════════════════════
  // DEDUPLICATION — suppress duplicate success events within a window.
  // Fingerprint: platform | form_id | normalized email | normalized phone.
  // sessionStorage-backed with in-memory fallback; capped at 20 entries.
  // ═══════════════════════════════════════════════════════════════
  var DEDUPE_WINDOW = 5 * 60 * 1000;
  var dedupeMemory = [];
  function readDedupe() {
    try {
      var raw = sessionStorage.getItem(DEDUPE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return dedupeMemory;
  }
  function writeDedupe(list) {
    dedupeMemory = list;
    try { sessionStorage.setItem(DEDUPE_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function isDuplicateSuccess(payload) {
    if (!CONFIG.dedupe) return false;
    var fp = [payload.form_platform, payload.form_id, payload.ec_email || '', payload.ec_phone || ''].join('|');
    // No identifier at all — fingerprint too weak to dedupe on safely
    if (!payload.ec_email && !payload.ec_phone) return false;
    var now = Date.now();
    var list = readDedupe().filter(function (e) { return (now - e.ts) < DEDUPE_WINDOW; });
    for (var i = 0; i < list.length; i++) {
      if (list[i].fp === fp) { writeDedupe(list); return true; }
    }
    list.push({ fp: fp, ts: now });
    if (list.length > 20) list = list.slice(-20);
    writeDedupe(list);
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // PAYLOAD BUILDER — three-stage dynamic classification:
  //   1. HTML type       (email, tel, textarea, select/radio/checkbox)
  //   2. Field name hint (a text input NAMED "phone" is a phone)
  //   3. Value pattern   (ZIP checked BEFORE phone so 5-digit ZIPs
  //                       aren't grabbed as phone numbers)
  // Every field is tagged with _bucket so classification decisions are
  // visible in the dataLayer / GTM preview.
  // ═══════════════════════════════════════════════════════════════
  var DESCRIPTIVE_FIELD_RE = /description|message|comment|note|project|about|bio|subject|how|details|inquiry|company|organi[sz]ation|website|url|reason|need|want|interest|budget|industry|role|title|address|city|state|country|referr|source|hear|question|feedback|help|location/i;

  function buildPayload(data) {
    var fields = data.fields || {};
    var nameParts = [], ec_email = '', ec_phone = '';

    function looksLikeEmail(v) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    }
    function looksLikePhone(v) {
      var digits = v.replace(/[^\d]/g, '');
      if (digits.length < 7 || digits.length > 15) return false;
      return /^[\+\(]?[\d\s\-\(\)\.\+]+$/.test(v);
    }
    function looksLikeZip(v) {
      return /^\d{5}(-\d{4})?$/.test(v) ||
             /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i.test(v);
    }
    function nameHintsPhone(k) { return /phone|tel|mobile|cell|contact[_-]?number/i.test(k); }
    function nameHintsEmail(k) { return /email|e[_-]?mail/i.test(k); }
    function nameHintsZip(k)   { return /zip|postal|postcode/i.test(k); }

    var classified = [];
    Object.keys(fields).forEach(function (key) {
      var f = fields[key];
      var v = f.value;
      var t = f.type;
      var bucket = '';

      // Stage 1 — trust strong HTML types
      if      (t === 'email')                       bucket = 'email';
      else if (t === 'tel')                         bucket = 'phone';
      else if (t === 'description' ||
               t === 'textarea')                    bucket = 'description';
      else if (t === 'select' ||
               t === 'radio' ||
               t === 'checkbox')                    bucket = 'choice';

      // Stage 2 — field-name hints (order matters: identifiers before
      // the broad descriptive regex)
      if (!bucket) {
        if      (nameHintsEmail(key))               bucket = 'email';
        else if (nameHintsPhone(key))               bucket = 'phone';
        else if (nameHintsZip(key))                 bucket = 'zip';
        else if (DESCRIPTIVE_FIELD_RE.test(key))    bucket = 'description';
      }

      // Stage 3 — value patterns; ZIP before phone
      if (!bucket) {
        if      (looksLikeEmail(v))                 bucket = 'email';
        else if (looksLikeZip(v))                   bucket = 'zip';
        else if (looksLikePhone(v))                 bucket = 'phone';
      }

      if (!bucket) bucket = 'name';

      f._bucket = bucket;
      classified.push({ key: key, value: v, bucket: bucket });
    });

    classified.forEach(function (c) {
      if      (c.bucket === 'email' && !ec_email) ec_email = c.value;
      else if (c.bucket === 'phone' && !ec_phone) ec_phone = c.value;
      else if (c.bucket === 'name'  && !/^\d+$/.test(c.value)) nameParts.push(c.value);
    });

    // Safety net — if phone still empty, promote strongest unassigned
    // digit-heavy field (10-15 digits, not a ZIP)
    if (!ec_phone) {
      for (var i = 0; i < classified.length; i++) {
        var c = classified[i];
        if (c.bucket !== 'email' && c.bucket !== 'description' && c.bucket !== 'choice') {
          var digits = c.value.replace(/[^\d]/g, '');
          if (digits.length >= 10 && digits.length <= 15 && !/^\d{5}(-\d{4})?$/.test(c.value)) {
            ec_phone = c.value;
            break;
          }
        }
      }
    }

    return {
      ec_name       : nameParts.join(' ').trim(),
      ec_email      : normalizeEmail(ec_email),
      ec_phone      : normalizePhone(ec_phone),
      form_url      : data.entire_url || '',
      form_cta      : data.form_cta   || '',
      form_platform : data.platform   || '',
      form_position : data.position   || '',
      form_index    : data.index      || 0,
      form_id       : data.form_id    || '',
      ec_raw_fields : fields
    };
  }

  var lastEvent = null;

  function pushEvent(eventName, data, detectionMethod) {
    var consent = getConsent();
    if (!consent.analytics) {
      log('Analytics consent denied — skipping event:', eventName);
      return;
    }
    var p = buildPayload(data);
    p.event = eventName;
    p.ec_event_id = uuid();
    p.ec_detection_method = detectionMethod || 'unknown';
    p.ec_tracker_version = window._ec_unbounce_tracker_version;

    if (CONFIG.hashPii && consent.pii) {
      var eh = p.ec_email ? getHash(p.ec_email) : '';
      var ph = p.ec_phone ? getHash(p.ec_phone) : '';
      if (eh) p.ec_email_sha256 = eh;
      if (ph) p.ec_phone_sha256 = ph;
      if ((p.ec_email && !eh) || (p.ec_phone && !ph)) {
        log('Hash not ready at event time — hashed field(s) omitted (raw fields present)');
      }
    }

    if (!consent.pii) {
      delete p.ec_name;
      delete p.ec_email;
      delete p.ec_phone;
      delete p.ec_raw_fields;
      delete p.ec_email_sha256;
      delete p.ec_phone_sha256;
      p.ec_pii_redacted = true;
    }

    var isSuccess = /_success$/.test(eventName);
    if (isSuccess && isDuplicateSuccess(p)) {
      log('Duplicate success suppressed (dedupe window):', eventName, p.form_platform, p.form_id);
      return;
    }

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(p);
    lastEvent = { event: eventName, at: new Date().toISOString(), detection: p.ec_detection_method, platform: p.form_platform };
    log('->', eventName, p);
  }

  // ═══════════════════════════════════════════════════════════════
  // FIRST-INTERACTION EVENT — metadata only (no PII), once per form
  // per pageload. Enables funnel analysis:
  //   ec_form_interaction -> {platform}_form_failed -> {platform}_form_success
  // ═══════════════════════════════════════════════════════════════
  function pushInteraction(state, meta) {
    if (state.interactionFired) return;
    state.interactionFired = true;
    var consent = getConsent();
    if (!consent.analytics) return;
    window.dataLayer = window.dataLayer || [];
    var p = {
      event: 'ec_form_interaction',
      ec_event_id: uuid(),
      ec_tracker_version: window._ec_unbounce_tracker_version,
      form_platform: meta.platform,
      form_position: meta.position,
      form_index: meta.index,
      form_id: meta.form_id || '',
      form_url: window.location.href
    };
    window.dataLayer.push(p);
    lastEvent = { event: 'ec_form_interaction', at: new Date().toISOString(), platform: meta.platform };
    log('->', 'ec_form_interaction', p);
  }

  // ═══════════════════════════════════════════════════════════════
  // STATE — per-form state via WeakMap (per-element fallback for old browsers)
  // ═══════════════════════════════════════════════════════════════
  var STATE = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function getState(el)        { return STATE ? STATE.get(el) : el._ec_state; }
  function setState(el, state) { if (STATE) STATE.set(el, state); else el._ec_state = state; }

  var formsAttached = 0;
  var platformsDetected = [];
  function noteDetected(id) {
    if (platformsDetected.indexOf(id) === -1) platformsDetected.push(id);
  }

  // ═══════════════════════════════════════════════════════════════
  // POSITION — top / middle / footer based on DOM order
  // ═══════════════════════════════════════════════════════════════
  function positionFor(idx, total) {
    if (total <= 1)            return 'top';
    if (idx === 0)             return 'top';
    if (idx === total - 1)     return 'footer';
    return 'middle';
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFIRMATION PAGE HANDLING
  // ═══════════════════════════════════════════════════════════════
  function isThankYouUrl() {
    var url = window.location.href.toLowerCase();
    var patterns = [
      // English
      'thank-you', 'thankyou', 'thank_you', '/thanks', '/ty',
      '/confirmation', '/confirmed', '/success', '/submitted', '/complete',
      // German
      '/danke', '/danke-schoen', '/danke-schon',
      // French
      '/merci', '/succes',
      // Spanish
      '/gracias', '/exito',
      // Italian
      '/grazie',
      // Portuguese
      '/obrigado', '/obrigada',
      // Dutch
      '/bedankt',
      // Polish
      '/dziekuje',
      // Swedish / Norwegian / Danish
      '/tack', '/takk'
    ].concat(CONFIG.extraThankYouPatterns);
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i] && url.indexOf(String(patterns[i]).toLowerCase()) !== -1) return true;
    }
    return false;
  }


  function handleConfirmationPage() {
    var stored = recall();
    if (!stored) { log('Confirmation page: no stored data'); return; }
    if (stored._success_fired) { log('Confirmation page: already fired on form page, skipping'); wipe(); return; }
    pushEvent('unbounce_form_success', stored, 'stored_recall');
    wipe();
  }

  // ═══════════════════════════════════════════════════════════════
  // SHARED WIRING — progressive save + first-interaction + submit stamp
  // ═══════════════════════════════════════════════════════════════
  function wireInputs(inputs, state, collect) {
    inputs.forEach(function (input) {
      ['input', 'blur', 'change'].forEach(function (ev) {
        input.addEventListener(ev, function () {
          var d = collect();
          if (Object.keys(d.fields).length) {
            state.hadInput = true;
            pushInteraction(state, { platform: d.platform, position: d.position, index: d.index, form_id: d.form_id });
            persist(d);
            if (ev === 'blur' || ev === 'change') warmHashes(d.fields);
          }
        });
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // UNBOUNCE HANDLER
  // Success: form removed/hidden, confirmation node, OR pagehide
  // Failure: HTML5 invalid event OR error-flagged node render
  // Recovery: gated by CONFIG.allowRecoverySuccess (re-arm on valid resubmit)
  // ═══════════════════════════════════════════════════════════════
  function initUnbounce() {
    var allForms = document.querySelectorAll('form');
    var forms = [];
    for (var i = 0; i < allForms.length; i++) {
      if (allForms[i].querySelector('.lp-pom-form-field')) forms.push(allForms[i]);
    }
    if (!forms.length) return false;
    noteDetected('unbounce');
    var attachedAny = false;

    forms.forEach(function (form, idx) {
      if (getState(form)) { attachedAny = true; return; }
      var inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea, select');
      if (!inputs.length) return;

      var state = {
        position: positionFor(idx, forms.length),
        index: idx + 1,
        successFired: false, failedFired: false,
        submitAt: 0, hadInput: false, interactionFired: false
      };
      setState(form, state);
      formsAttached++;

      function collect() {
        var fields = {};
        form.querySelectorAll('input:not([type="hidden"]):not([type="submit"])').forEach(function (i) {
          if (i.name && i.value && i.value.trim()) {
            fields[i.name] = { value: i.value.trim(), type: i.type };
          }
        });
        form.querySelectorAll('textarea').forEach(function (t) {
          if (t.name && t.value && t.value.trim()) fields[t.name] = { value: t.value.trim(), type: 'textarea' };
        });
        form.querySelectorAll('select').forEach(function (s) {
          if (s.name && s.value && s.value.trim()) fields[s.name] = { value: s.value.trim(), type: 'select' };
        });
        var btn     = form.querySelector('button[type="submit"], input[type="submit"]');
        var label   = btn ? (btn.querySelector('.label') || btn) : null;
        var pageId  = form.querySelector('input[name="pageId"]');
        var variant = form.querySelector('input[name="pageVariant"]');
        return {
          fields: fields,
          entire_url: window.location.href,
          form_cta: label ? label.textContent.trim() : '',
          platform: 'unbounce',
          position: state.position,
          index: state.index,
          form_id: pageId ? (pageId.value + (variant ? ':' + variant.value : '')) : (form.id || '')
        };
      }

      function fireSuccess(method) {
        if (state.successFired) return;
        if (state.failedFired && !CONFIG.allowRecoverySuccess) return;
        state.successFired = true;
        var d = collect();
        if (Object.keys(d.fields).length || recall()) {
          var data = Object.keys(d.fields).length ? d : recall();
          data._success_fired = true;
          persist(data);
          pushEvent('unbounce_form_success', data, method);
        }
      }
      function fireFailed(method) {
        if (state.failedFired || state.successFired || !state.hadInput) return;
        state.failedFired = true;
        pushEvent('unbounce_form_failed', collect(), method);
      }
      function hasNativeInvalidState() {
        return !!(form.checkValidity && !form.checkValidity());
      }

      wireInputs(inputs, state, collect);

      var submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) {
        submitBtn.addEventListener('click', function () {
          state.submitAt = Date.now();
          persist(collect());
          // Recovery — re-arm after a prior failure if HTML5 validity now passes
          if (CONFIG.allowRecoverySuccess && state.failedFired &&
              (!form.checkValidity || form.checkValidity())) {
            log('Unbounce: recovery attempt after prior failure, re-arming');
            state.failedFired = false;
          }
        });
      }

      inputs.forEach(function (input) {
        input.addEventListener('invalid', function () {
          if (state.successFired || !state.hadInput) return;
          if (!state.submitAt || (Date.now() - state.submitAt) > 2000) return;
          fireFailed('invalid_event');
        });
      });

      var parent = form.parentNode;
      new MutationObserver(function (mutations) {
        if (state.successFired || (state.failedFired && !CONFIG.allowRecoverySuccess)) return;
        if (!state.submitAt || (Date.now() - state.submitAt) > CONFIG.submitWindowMs) return;
        if (!document.body.contains(form) || form.offsetParent === null) {
          fireSuccess('form_removed');
          return;
        }
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1 || n === form || form.contains(n)) continue;
            var cls = (n.className || '') + ' ' + (n.querySelector ? (n.querySelector('*') || {className:''}).className || '' : '');
            if (/error|invalid|wrong|fail/i.test(cls)) { fireFailed('error_render'); return; }
            if (/confirmation|success|thank/i.test(cls)) { fireSuccess('confirmation_render'); return; }
            fireSuccess('generic_node');
            return;
          }
        }
      }).observe(parent, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

      // pagehide (not beforeunload) — reliable on mobile Safari + bfcache.
      // Covers redirect-on-success where no in-page render happens.
      window.addEventListener('pagehide', function () {
        if (state.successFired || (state.failedFired && !CONFIG.allowRecoverySuccess)) return;
        if (!state.submitAt || (Date.now() - state.submitAt) > CONFIG.submitWindowMs) return;
        if (hasNativeInvalidState()) return;
        fireSuccess('pagehide');
      });

      attachedAny = true;
    });

    if (attachedAny) log('Unbounce:', forms.length, 'form(s) attached');
    return attachedAny;
  }

  // ═══════════════════════════════════════════════════════════════
  // HEARTBEAT — ec_tracker_initialized, once per pageload. Fires on
  // first attach, or after the poll exhausts with nothing found.
  // Lets deployers verify the script works WITHOUT a test submission.
  // ═══════════════════════════════════════════════════════════════
  var heartbeatFired = false;
  function fireHeartbeat() {
    if (heartbeatFired) return;
    heartbeatFired = true;
    var consent = getConsent();
    if (!consent.analytics) { log('Heartbeat suppressed — analytics consent denied'); return; }
    window.dataLayer = window.dataLayer || [];
    var p = {
      event: 'ec_tracker_initialized',
      ec_event_id: uuid(),
      ec_tracker_version: window._ec_unbounce_tracker_version,
      ec_platforms_detected: platformsDetected.slice(),
      ec_forms_attached: formsAttached,
      ec_consent_analytics: consent.analytics,
      ec_consent_pii: consent.pii,
      ec_hash_pii_enabled: CONFIG.hashPii,
      ec_secure_context: !!(window.isSecureContext)
    };
    window.dataLayer.push(p);
    log('->', 'ec_tracker_initialized', p);
  }

  // ═══════════════════════════════════════════════════════════════
  // DEBUG API — window._ecFormTrackers.unbounce.status()
  // ═══════════════════════════════════════════════════════════════
  window._ecFormTrackers = window._ecFormTrackers || {};
  window._ecFormTrackers.unbounce = {
    version: window._ec_unbounce_tracker_version,
    status: function () {
      return {
        version: window._ec_unbounce_tracker_version,
        consent: getConsent(),
        platformsDetected: platformsDetected.slice(),
        formsAttached: formsAttached,
        lastEvent: lastEvent,
        secureContext: !!(window.isSecureContext),
        config: {
          debug: CONFIG.debug,
          hashPii: CONFIG.hashPii,
          dedupe: CONFIG.dedupe,
          allowRecoverySuccess: CONFIG.allowRecoverySuccess,
          submitWindowMs: CONFIG.submitWindowMs,
          ttlMs: CONFIG.ttlMs,
          defaultCountryCode: CONFIG.defaultCountryCode,
          extraThankYouPatterns: CONFIG.extraThankYouPatterns
        }
      };
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // BOOTSTRAP — initial scan, late-render poll, dynamic-injection
  // observer, SPA route-change hook
  // ═══════════════════════════════════════════════════════════════
  function runHandlers() {
    var ran = initUnbounce();
    if (ran) fireHeartbeat();
    return ran;
  }

  function checkConfirmationState() {
    // 2. Thank-you URL fallback — works for ANY platform with stored data.
    //    Safe because stored data has TTL — direct visits with no recent
    //    submission won't have data to fire.
    if (isThankYouUrl()) {
      var stored = recall();
      if (stored && !stored._success_fired) {
        handleConfirmationPage();
        // Don't return true — thank-you page may host its own forms
        // (site-wide top/footer) we still want to attach to
      }
    }
    return false;
  }

  function bootstrap() {
    if (checkConfirmationState()) { fireHeartbeat(); return; }

    if (runHandlers()) { /* heartbeat fired inside */ }

    var tries = 0;
    var poll = setInterval(function () {
      if (runHandlers() || ++tries >= 40) {
        clearInterval(poll);
        fireHeartbeat(); // fires with 0 forms if nothing was ever found — diagnostic
      }
    }, 300);

    new MutationObserver(function () { runHandlers(); })
      .observe(document.body, { childList: true, subtree: true });

    // SPA route changes — re-scan and re-check confirmation URLs.
    // WeakMap state prevents double-attachment on unchanged forms.
    var lastHref = window.location.href;
    function onRouteChange() {
      if (window.location.href === lastHref) return;
      lastHref = window.location.href;
      log('Route change detected:', lastHref);
      setTimeout(function () {
        checkConfirmationState();
        runHandlers();
      }, 100);
    }
    try {
      var origPush    = history.pushState;
      var origReplace = history.replaceState;
      history.pushState = function () {
        var r = origPush.apply(this, arguments);
        onRouteChange();
        return r;
      };
      history.replaceState = function () {
        var r = origReplace.apply(this, arguments);
        onRouteChange();
        return r;
      };
      window.addEventListener('popstate', onRouteChange);
    } catch (e) { log('SPA hook failed (history API unavailable):', e); }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', bootstrap)
    : bootstrap();

})();
