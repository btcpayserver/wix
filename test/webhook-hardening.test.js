// Tests for the pure logic used by the BTCPay Wix integration backend.
// Run with: node test/webhook-hardening.test.js
//
// The Velo files (backend/http-functions.js, backend/service-plugins/
// payment-provider/BTCPay/BTCPay.js) must stay single-file for copy-paste
// deployment into the Wix editor, so the tested functions are mirrored here.
// If you change them in the backend files, update the mirrors and the tests.
'use strict';

const assert = require('assert');
const { createHmac, timingSafeEqual } = require('crypto');

let pass = 0;
let fail = 0;
function check(name, got, want) {
  try {
    assert.deepStrictEqual(got, want);
    pass++;
  } catch (e) {
    fail++;
    console.log('FAIL', name, '- got', JSON.stringify(got), 'want', JSON.stringify(want));
  }
}

// --- mirrored from backend/http-functions.js -------------------------------

function verifySignature(secret, message, signature) {
  if (typeof secret !== 'string' || typeof message !== 'string' || typeof signature !== 'string') {
    return false;
  }
  // A SHA-256 HMAC is exactly 64 hex characters; Buffer.from would silently
  // decode a truncated prefix and ignore trailing junk.
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(message).digest();
  const actual = Buffer.from(signature, 'hex');
  return timingSafeEqual(actual, expected);
}

function parseStoredCredentials(raw) {
  if (raw && typeof raw === 'object') {
    raw = raw.value ?? raw.secret ?? '';
  }
  if (typeof raw !== 'string') {
    raw = String(raw);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: 'not valid JSON' };
  }
  // The value may be stored JSON-in-JSON: the first parse then resolves to a
  // string, unwrap that one more layer.
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (e) {
      return { ok: false, reason: 'not valid JSON' };
    }
  }
  if (!parsed || !parsed.btcpayUrl || !parsed.apiKey || !parsed.storeId || !parsed.webhookSecret) {
    return { ok: false, reason: 'incomplete' };
  }
  return { ok: true, credentials: parsed };
}

// --- mirrored from backend/service-plugins/payment-provider/BTCPay/BTCPay.js

function validateServerUrl(sUrl) {
  try {
    const u = new URL(sUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return false;
    }
    if (u.protocol === 'http:') {
      const host = u.hostname.toLowerCase();
      if (host === 'localhost' || host === '::1' || host === '[::1]') {
        return true;
      }
      // Private ranges only apply to IPv4 literals. A DNS name such as
      // "10.example.com" is a public host and requires https.
      const parts = host.split('.');
      const isIpv4 = parts.length === 4 &&
        parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
      if (!isIpv4) {
        return false;
      }
      const [a, b] = parts.map(Number);
      const isPrivate = a === 10 || a === 127 ||
        (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
      if (!isPrivate) {
        return false;
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Zero-decimal currencies map to 0 in the currencies table and must be
// detected with a property check, not truthiness (refund amount scaling).
const currencies = { USD: 2, JPY: 0, ISK: 0, BHD: 3 };
function isKnownCurrency(c) {
  return Object.prototype.hasOwnProperty.call(currencies, c);
}

// --- signature verification -------------------------------------------------

const SECRET = 'real-webhook-secret-3n9Xk2';
const BODY = JSON.stringify({ type: 'InvoiceSettled', invoiceId: 'abc', metadata: { wixTxId: 't1' } });
const validSig = createHmac('sha256', SECRET).update(BODY).digest('hex');

check('accepts a genuine delivery', verifySignature(SECRET, BODY, validSig), true);
check('rejects a tampered body', verifySignature(SECRET, BODY.replace('abc', 'xyz'), validSig), false);
check('rejects a signature from another secret', verifySignature('other', BODY, validSig), false);

// Malformed signatures must all be rejected, not crash or silently truncate.
check('rejects valid hex + trailing junk (Buffer.from truncation trap)',
  verifySignature(SECRET, BODY, validSig + 'NOTHEX'), false);
check('rejects a truncated signature', verifySignature(SECRET, BODY, validSig.slice(0, 62)), false);
check('rejects non-hex characters', verifySignature(SECRET, BODY, 'z'.repeat(64)), false);
check('rejects an empty signature', verifySignature(SECRET, BODY, ''), false);
check('rejects a 63-char signature', verifySignature(SECRET, BODY, validSig.slice(0, 63)), false);
check('rejects a 65-char signature', verifySignature(SECRET, BODY, validSig + 'a'), false);
check('accepts uppercase hex', verifySignature(SECRET, BODY, validSig.toUpperCase()), true);
check('rejects non-string signature', verifySignature(SECRET, BODY, undefined), false);
check('rejects non-string message', verifySignature(SECRET, 42, validSig), false);
check('rejects missing secret', verifySignature(undefined, BODY, validSig), false);

// --- stored credentials parsing ---------------------------------------------

const CREDS = { btcpayUrl: 'https://btcpay.example.com/', apiKey: 'k', storeId: 's', webhookSecret: 'w' };
const CREDS_JSON = JSON.stringify(CREDS);
check('parses a plain JSON string value', parseStoredCredentials(CREDS_JSON),
  { ok: true, credentials: CREDS });
check('unwraps a record-shaped response (value prop)',
  parseStoredCredentials({ value: CREDS_JSON }), { ok: true, credentials: CREDS });
check('unwraps a record-shaped response (secret prop)',
  parseStoredCredentials({ secret: CREDS_JSON }), { ok: true, credentials: CREDS });
check('unwraps JSON-in-JSON', parseStoredCredentials(JSON.stringify(CREDS_JSON)),
  { ok: true, credentials: CREDS });
check('rejects non-JSON values', parseStoredCredentials('gibberish'),
  { ok: false, reason: 'not valid JSON' });
check('rejects incomplete credentials', parseStoredCredentials('{"btcpayUrl":"x"}'),
  { ok: false, reason: 'incomplete' });
check('rejects a null value', parseStoredCredentials(null),
  { ok: false, reason: 'incomplete' });

// --- server URL validation ---------------------------------------------------

// https is always fine
check('https public host allowed', validateServerUrl('https://btcpay.example.com/'), true);
// cleartext http: only local instances
check('http localhost allowed', validateServerUrl('http://localhost:23000/'), true);
check('http 127.0.0.1 allowed', validateServerUrl('http://127.0.0.1/'), true);
check('http 10.x IP allowed', validateServerUrl('http://10.0.0.1/'), true);
check('http 192.168.x IP allowed', validateServerUrl('http://192.168.1.5/'), true);
check('http 172.16.x IP allowed', validateServerUrl('http://172.16.0.1/'), true);
// regression: public DNS names that start with a private-looking prefix
check('http 10.example.com rejected', validateServerUrl('http://10.example.com/'), false);
check('http 192.168.example.com rejected', validateServerUrl('http://192.168.example.com/'), false);
check('http 172.16.example.com rejected', validateServerUrl('http://172.16.example.com/'), false);
check('http public host rejected', validateServerUrl('http://btcpay.example.com/'), false);
check('http out-of-range private prefix rejected', validateServerUrl('http://172.32.0.1/'), false);
check('http non-octal junk rejected', validateServerUrl('http://10.999.999.999/'), false);
check('unsupported scheme rejected', validateServerUrl('ftp://btcpay.example.com/'), false);
check('unparseable URL rejected', validateServerUrl('not a url'), false);

// --- zero-decimal currency handling ------------------------------------------

check('zero-decimal currency (JPY) counts as known', isKnownCurrency('JPY'), true);
check('zero-decimal currency (ISK) counts as known', isKnownCurrency('ISK'), true);
check('three-decimal currency counts as known', isKnownCurrency('BHD'), true);
check('unknown currency counts as unknown', isKnownCurrency('XXX'), false);
check('missing currency counts as unknown', isKnownCurrency(undefined), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
