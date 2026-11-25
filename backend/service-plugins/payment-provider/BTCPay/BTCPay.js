import wixSecretsBackend from 'wix-secrets-backend';

/**
 * Credentials saved by connectAccount() and read by the webhook handler in
 * http-functions.js, stored in the site's Secret Manager.
 */
const SECRET_NAME = 'btcpay_wix_credentials';

/**
 * This payment plugin endpoint is triggered when a merchant provides required data to connect their PSP account to a Wix site.
 * The plugin has to verify merchant's credentials, and ensure the merchant has an operational PSP account.
 * @param {import('interfaces-psp-v1-payment-service-provider').ConnectAccountOptions} options
 * @param {import('interfaces-psp-v1-payment-service-provider').Context} context
 * @returns {Promise<import('interfaces-psp-v1-payment-service-provider').ConnectAccountResponse | import('interfaces-psp-v1-payment-service-provider').BusinessError>}
 */
export const connectAccount = async (options, context) => {
    const credentials = options.credentials;
    let returnObj = {
        credentials: credentials
    };

    const sUrl = normalizeUrl(credentials.btcpayUrl);
    if (!validateServerUrl(sUrl)) {
        returnObj.errorCode = 400;
        returnObj.errorMessage = "BTCPay Server URL must be a valid URL (https required, http only for local/private instances)";
        returnObj.reasonCode = 1002;
        return returnObj;
    }
    if (!credentials.apiKey || !credentials.storeId || !credentials.webhookSecret) {
        returnObj.errorCode = 400;
        returnObj.errorMessage = "API Key, Store ID and Webhook Secret are required";
        returnObj.reasonCode = 1002;
        return returnObj;
    }

    let response;
    try {
        response = await fetch(sUrl + "api/v1/stores/" + encodeURIComponent(credentials.storeId), {
            method: 'get',
            headers: {
                "Authorization": "token " + credentials.apiKey
            }
        });
    } catch (e) {
        returnObj.errorCode = 500;
        returnObj.errorMessage = "Error during connection with BTCPay";
        returnObj.reasonCode = 1002;
        return returnObj;
    }

    if (response.status == 200) {
        // Persist the credentials (incl. the webhook secret) in the Secret
        // Manager for the webhook handler in http-functions.js.
        try {
            await storeCredentials(credentials);
        } catch (e) {
            returnObj.errorCode = 500;
            returnObj.errorMessage = "Could not store credentials in the site's Secret Manager";
            returnObj.reasonCode = 1002;
            return returnObj;
        }
        returnObj.accountId = "myId";
        returnObj.accountName = "BTCPayAccount";
    } else {
        returnObj.errorCode = response.status;
        returnObj.errorMessage = "Error during connection with BTCPay";
        returnObj.reasonCode = 1002;
    }
    return returnObj;
};

/**
 * This payment plugin endpoint is triggered when a buyer pays on a Wix site.
 * The plugin has to process this payment request but prevent double payments for the same `wixTransactionId`.
 * @param {import('interfaces-psp-v1-payment-service-provider').CreateTransactionOptions} options
 * @param {import('interfaces-psp-v1-payment-service-provider').Context} context
 * @returns {Promise<import('interfaces-psp-v1-payment-service-provider').CreateTransactionResponse | import('interfaces-psp-v1-payment-service-provider').BusinessError>}
 */
export const createTransaction = async (options, context) => {
    const sUrl = normalizeUrl(options.merchantCredentials.btcpayUrl);

    const invoice = {
        currency: options.order.description.currency,
        amount: parseInt(options.order.description.totalAmount) / Math.pow(10, currencies[options.order.description.currency]) ,
        checkout: {
            defaultLanguage: options.order.description.buyerInfo.buyerLanguage,
            redirectURL: options.order.returnUrls.successUrl,
            redirectAutomatically: true,
            requiresRefundEmail: false
        },
        metadata: {
            buyerEmail: options.order.description.billingAddress.email,
            buyerName: options.order.description.billingAddress.firstName + ' ' + options.order.description.billingAddress.lastName,
            orderId: options.order._id,
            wixTxId: options.wixTransactionId,
            itemDesc: "from Wix",
            currency: options.order.description.currency
        }
    };

    let response;
    try {
        response = await fetch(sUrl + "api/v1/stores/" + encodeURIComponent(options.merchantCredentials.storeId) + "/invoices", {
            method: 'post',
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": "token " + options.merchantCredentials.apiKey
            },
            body: JSON.stringify(invoice)
        });
    } catch (e) {
        return {
            errorCode: 500,
            errorMessage: "Error BTCPay payment",
            reasonCode: 2001
        };
    }

    if (response.status == 200) {
        const json = await response.json();
        return {
            pluginTransactionId: json.id + "|" + options.order.description.currency,
            redirectUrl: json.checkoutLink
        };

    } else {
        return {
            errorCode: response.status,
            errorMessage: "Error BTCPay payment",
            reasonCode: 2001
        };
    }
};

/**
 * This payment plugin endpoint is triggered when a merchant refunds a payment made on a Wix site.
 * The plugin has to process this refund request but prevent double refunds for the same `wixRefundId`.
 * @param {import('interfaces-psp-v1-payment-service-provider').RefundTransactionOptions} options
 * @param {import('interfaces-psp-v1-payment-service-provider').Context} context
 * @returns {Promise<import('interfaces-psp-v1-payment-service-provider').CreateRefundResponse | import('interfaces-psp-v1-payment-service-provider').BusinessError>}
 */
export const refundTransaction = async (options, context) => {
    const credentials = options.merchantCredentials;
    const sUrl = normalizeUrl(credentials.btcpayUrl);

    // pluginTransactionId carries "<btcpayInvoiceId>|<currency>" (older
    // transactions may only carry the invoice id).
    const tblData = (options.pluginTransactionId || '').split("|");
    const btcPayID = tblData[0];
    let currency = tblData.length > 1 ? tblData[1] : undefined;

    if (!btcPayID) {
        return {
            errorCode: 400,
            errorMessage: "Missing BTCPay invoice reference",
            reasonCode: 2001
        };
    }

    try {
        // Resolve the invoice currency from BTCPay when the stored transaction
        // id does not carry it (transactions created by earlier plugin versions).
        if (!currencies[currency]) {
            const invResponse = await fetch(sUrl + "api/v1/stores/" + encodeURIComponent(credentials.storeId) + "/invoices/" + encodeURIComponent(btcPayID), {
                method: 'get',
                headers: {
                    "Authorization": "token " + credentials.apiKey
                }
            });
            if (invResponse.status == 200) {
                const invJson = await invResponse.json();
                currency = invJson.currency;
            } else {
                return {
                    errorCode: invResponse.status,
                    errorMessage: "Error fetching BTCPay invoice for refund",
                    reasonCode: 2001
                };
            }
        }

        const refund = {
            name: "Wix Refund " + options.wixRefundId,
            description: "Wix Refund " + options.wixRefundId,
            refundVariant: "Custom",
            customCurrency: currency,
            paymentMethod: "BTC",
            customAmount: parseInt(options.refundAmount) / Math.pow(10, currencies[currency])
        }

        const response = await fetch(sUrl + "api/v1/stores/" + encodeURIComponent(credentials.storeId) + "/invoices/" + encodeURIComponent(btcPayID) + "/refund", {
            method: 'post',
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": "token " + credentials.apiKey
            },
            body: JSON.stringify(refund)
        });

        if (response.status == 200) {
            const jsonRefund = await response.json();
            return {
                pluginRefundId: jsonRefund.id
            };
        }
        // BTCPay rejects a second refund for an invoice that already has a
        // non-archived refund, which acts as the double-refund guard here.
        return {
            errorCode: response.status,
            errorMessage: "Error BTCPay refund",
            reasonCode: 2001
        };
    } catch (e) {
        return {
            errorCode: 500,
            errorMessage: "Error BTCPay refund",
            reasonCode: 2001
        };
    }
};

function normalizeUrl(url) {
    let sUrl = (url || '').trim();
    if (sUrl && !sUrl.endsWith('/')) {
        sUrl += '/';
    }
    return sUrl;
}

function validateServerUrl(sUrl) {
    try {
        const u = new URL(sUrl);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
            return false;
        }
        if (u.protocol === 'http:') {
            // Allow plain http only for local/private development instances,
            // so API key and webhook secret are never sent in cleartext
            // over the public internet.
            const host = u.hostname;
            const isPrivate = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') ||
                /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
            if (!isPrivate) {
                return false;
            }
        }
        return true;
    } catch (e) {
        return false;
    }
}

async function storeCredentials(credentials) {
    const value = JSON.stringify({
        btcpayUrl: normalizeUrl(credentials.btcpayUrl),
        apiKey: credentials.apiKey,
        storeId: credentials.storeId,
        webhookSecret: credentials.webhookSecret
    });
    // updateSecret() only exists on newer Velo API versions; fall back to
    // delete + create for compatibility.
    try {
        if (typeof wixSecretsBackend.updateSecret === 'function') {
            await wixSecretsBackend.updateSecret(SECRET_NAME, value);
            return;
        }
    } catch (e) {
        // Secret does not exist yet or update unsupported - fall through.
    }
    try {
        await wixSecretsBackend.createSecret(SECRET_NAME, value);
    } catch (e) {
        await wixSecretsBackend.deleteSecret(SECRET_NAME);
        await wixSecretsBackend.createSecret(SECRET_NAME, value);
    }
}

const currencies = {
	"BIF": 0,
	"CLP": 0,
	"DJF": 0,
	"GNF": 0,
	"ISK": 0,
	"JPY": 0,
	"KMF": 0,
	"KRW": 0,
	"PYG": 0,
	"RWF": 0,
	"UGX": 0,
	"VND": 0,
	"VUV": 0,
	"XAF": 0,
	"XOF": 0,
	"XPF": 0,
	"AED": 2,
	"AFN": 2,
	"ALL": 2,
	"AMD": 2,
	"ANG": 2,
	"AOA": 2,
	"ARS": 2,
	"AUD": 2,
	"AWG": 2,
	"AZN": 2,
	"BAM": 2,
	"BBD": 2,
	"BDT": 2,
	"BGN": 2,
	"BMD": 2,
	"BND": 2,
	"BOB": 2,
	"BOV": 2,
	"BRL": 2,
	"BSD": 2,
	"BTN": 2,
	"BWP": 2,
	"BYN": 2,
	"BZD": 2,
	"CAD": 2,
	"CDF": 2,
	"CHE": 2,
	"CHF": 2,
	"CHW": 2,
	"CNY": 2,
	"COP": 2,
	"COU": 2,
	"CRC": 2,
	"CUC": 2,
	"CUP": 2,
	"CVE": 2,
	"CZK": 2,
	"DKK": 2,
	"DOP": 2,
	"DZD": 2,
	"EGP": 2,
	"ERN": 2,
	"ETB": 2,
	"EUR": 2,
	"FJD": 2,
	"FKP": 2,
	"GBP": 2,
	"GEL": 2,
	"GHS": 2,
	"GIP": 2,
	"GMD": 2,
	"GTQ": 2,
	"GYD": 2,
	"HKD": 2,
	"HNL": 2,
	"HRK": 2,
	"HTG": 2,
	"HUF": 2,
	"IDR": 2,
	"ILS": 2,
	"INR": 2,
	"IRR": 2,
	"JMD": 2,
	"KES": 2,
	"KGS": 2,
	"KHR": 2,
	"KPW": 2,
	"KYD": 2,
	"KZT": 2,
	"LAK": 2,
	"LBP": 2,
	"LKR": 2,
	"LRD": 2,
	"LSL": 2,
	"MAD": 2,
	"MDL": 2,
	"MGA": 2,
	"MKD": 2,
	"MMK": 2,
	"MNT": 2,
	"MOP": 2,
	"MRU": 2,
	"MUR": 2,
	"MVR": 2,
	"MWK": 2,
	"MXN": 2,
	"MXV": 2,
	"MYR": 2,
	"MZN": 2,
	"NAD": 2,
	"NGN": 2,
	"NIO": 2,
	"NOK": 2,
	"NPR": 2,
	"NZD": 2,
	"PAB": 2,
	"PEN": 2,
	"PGK": 2,
	"PHP": 2,
	"PKR": 2,
	"PLN": 2,
	"QAR": 2,
	"RON": 2,
	"RSD": 2,
	"RUB": 2,
	"SAR": 2,
	"SBD": 2,
	"SCR": 2,
	"SDG": 2,
	"SEK": 2,
	"SGD": 2,
	"SHP": 2,
	"SLL": 2,
	"SOS": 2,
	"SRD": 2,
	"SSP": 2,
	"STN": 2,
	"SVC": 2,
	"SYP": 2,
	"SZL": 2,
	"THB": 2,
	"TJS": 2,
	"TMT": 2,
	"TOP": 2,
	"TRY": 2,
	"TTD": 2,
	"TWD": 2,
	"TZS": 2,
	"UAH": 2,
	"USD": 2,
	"UYU": 2,
	"UZS": 2,
	"VES": 2,
	"WST": 2,
	"XCD": 2,
	"YER": 2,
	"ZMW": 2,
	"ZAR": 2,
	"BHD": 3,
	"IQD": 3,
	"JOD": 3,
	"KWD": 3,
	"LYD": 3,
	"OMR": 3,
	"TND": 3
};
