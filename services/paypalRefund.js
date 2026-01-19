const { getAccessToken } = require("./paypal");

let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = require("node-fetch");
}

const PAYPAL_API = process.env.PAYPAL_API;

async function refundCapture(captureId, amount, currencyCode) {
  const accessToken = await getAccessToken();
  const payload = {};

  if (Number.isFinite(amount)) {
    payload.amount = {
      value: amount.toFixed(2),
      currency_code: currencyCode || "SGD"
    };
  }

  const response = await fetchFn(`${PAYPAL_API}/v2/payments/captures/${captureId}/refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  return { status: response.status, data };
}

module.exports = { refundCapture };
