import wixPaymentProviderBackend from "wix-payment-provider-backend";
import { ok, badRequest, notFound } from "wix-http-functions";
import { secrets } from 'wix-secrets-backend.v2';
import wixSecretsBackendV1 from 'wix-secrets-backend';
import { elevate } from 'wix-auth';
import { createHmac, timingSafeEqual } from 'crypto';

// Credentials (incl. the webhook secret) saved by connectAccount() in BTCPay.js,
// stored in the site's Secret Manager and read by the webhook handler below.
const SECRET_NAME = 'btcpay_wix_credentials';

// An endpoint for receiving updates about transactions.
export async function post_btcpayTrxWebHook(request) {

  // Read the raw body first so the HMAC is verified against the exact bytes
  // BTCPay signed, then parse it.
  let rawBody;
  let req;
  try {
    rawBody = await request.body.text();
    req = JSON.parse(rawBody);
  } catch (e) {
    return badRequest();
  }

  const validTypes = ["InvoiceProcessing", "InvoiceSettled", "InvoiceReceivedPayment", "InvoicePaymentSettled", "InvoiceExpired", "InvoiceInvalid"];
  if (!req || typeof req.invoiceId !== 'string' || typeof req.type !== 'string' ||
      req.invoiceId.startsWith("__test__") || !validTypes.includes(req.type)) {
    return ok();
  }

  // The HMAC key is the webhook secret from the Secret Manager.
  const credentials = await getCredentials();
  if (!credentials) {
    // Plugin not connected / secret not configured.
    return notFound();
  }

  const sigHeader = request.headers["btcpay-sig"];
  if (typeof sigHeader !== 'string' || sigHeader.indexOf('sha256=') !== 0) {
    return badRequest();
  }
  if (!verifySignature(credentials.webhookSecret, rawBody, sigHeader.substring('sha256='.length))) {
    return badRequest();
  }

  // Re-read the invoice from the BTCPay API and act on its current state,
  // rather than on the event type carried in the webhook payload.
  let invoice;
  try {
    const sUrl = normalizeUrl(credentials.btcpayUrl);
    const invResponse = await fetch(sUrl + "api/v1/stores/" + credentials.storeId + "/invoices/" + encodeURIComponent(req.invoiceId), {
      method: 'get',
      headers: {
        "Authorization": "token " + credentials.apiKey
      }
    });
    if (invResponse.status != 200) {
      return badRequest();
    }
    invoice = await invResponse.json();
  } catch (e) {
    return badRequest();
  }

  if (!invoice || !invoice.metadata || !invoice.metadata.wixTxId) {
    // Not an invoice created by this plugin - nothing to update in Wix.
    return ok();
  }

  const trx = {
          wixTransactionId: invoice.metadata.wixTxId,
          pluginTransactionId: invoice.id + "|" + invoice.currency
        };

  // Map the invoice status to Wix reason codes.
  // "New" (no payment seen yet) is ignored. "Processing" approves at 0-conf;
  // require confirmations via the BTCPay store settings if needed.
  switch (invoice.status) {
    case "Processing":
    case "Settled":
      trx.reasonCode = 5009;
      break;
    case "Expired":
      trx.reasonCode = 3035;
      trx.errorCode = "Expired";
      trx.errorMessage = "An invoice expired";
      break;
    case "Invalid":
      trx.reasonCode = 3000;
      trx.errorCode = "Invalid";
      trx.errorMessage = "An invoice became invalid";
      break;
    default:
      return ok();
  }

  await wixPaymentProviderBackend.submitEvent({
    event: {
      transaction: trx,
    },
  });
  return ok();
}

// An endpoint for receiving updates about refunds.
// Refund state is returned synchronously from refundTransaction() in
// BTCPay.js; refund status callbacks are not tracked.
export async function post_updateRefund(request) {}

function normalizeUrl(url) {
  let sUrl = (url || '').trim();
  if (sUrl && !sUrl.endsWith('/')) {
    sUrl += '/';
  }
  return sUrl;
}

async function getCredentials() {
  let raw;
  let source;
  try {
    // v2 secrets require elevated auth, which http-function requests may
    // not carry (they run without a user identity).
    const getSecretValue = elevate(secrets.getSecretValue);
    raw = await getSecretValue(SECRET_NAME);
    source = 'v2';
  } catch (e) {
    // Fall back to the deprecated v1 read, which needs no elevation.
    console.error('BTCPay webhook: v2 secret read failed, trying v1:', e && (e.message || e));
    try {
      raw = await wixSecretsBackendV1.getSecret(SECRET_NAME);
      source = 'v1';
    } catch (e2) {
      console.error('BTCPay webhook: reading credentials from the Secret Manager failed:', e2 && (e2.message || e2));
      return null;
    }
  }

  // Normalize what the secrets API returned: it should be the JSON string
  // written by connectAccount, but some SDK versions resolve to a record
  // object or wrap the value. Log shapes only - never secret contents.
  if (raw && typeof raw === 'object') {
    console.error('BTCPay webhook: secret read via', source, 'returned an object with keys:', Object.keys(raw).join(','));
    raw = raw.value ?? raw.secret ?? '';
  }
  if (typeof raw !== 'string') {
    console.error('BTCPay webhook: secret read via', source, 'returned type', typeof raw);
    raw = String(raw);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // The value may be stored JSON-in-JSON; unwrap once before giving up.
    try {
      parsed = JSON.parse(JSON.parse(raw));
    } catch (e2) {
      console.error('BTCPay webhook: stored credentials are not valid JSON (read via', source + ', typeof', typeof raw + ')');
      return null;
    }
  }
  if (!parsed || !parsed.btcpayUrl || !parsed.apiKey || !parsed.storeId || !parsed.webhookSecret) {
    console.error('BTCPay webhook: stored credentials are incomplete (read via', source + ')');
    return null;
  }
  return parsed;
}

// Constant-time comparison of the BTCPay-Sig header against an HMAC-SHA256
// of the raw body, keyed with the webhook secret from the Secret Manager.
function verifySignature(secret, message, signature) {
  if (typeof secret !== 'string' || typeof message !== 'string' || typeof signature !== 'string') {
    return false;
  }
  const expected = createHmac('sha256', secret).update(message).digest();
  const actual = Buffer.from(signature, 'hex');
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
