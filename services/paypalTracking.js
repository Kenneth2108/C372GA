const crypto = require("crypto");
const { getAccessToken } = require("./paypal");

let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = require("node-fetch");
}

const DEFAULT_BASE = "https://api-m.sandbox.paypal.com";

function getTrackingBaseUrl() {
  const envUrl = process.env.PAYPAL_TRACKING_API || process.env.PAYPAL_API || "";

  if (!envUrl) return DEFAULT_BASE;

  if (envUrl.includes("api-m.")) return envUrl;

  return envUrl.replace("api.sandbox.paypal.com", "api-m.sandbox.paypal.com")
               .replace("api.paypal.com", "api-m.paypal.com");
}

async function addTrackingBatch(payload) {
  const accessToken = await getAccessToken();
  const baseUrl = getTrackingBaseUrl();
  const requestId = crypto.randomUUID();

  const response = await fetchFn(`${baseUrl}/v1/shipping/trackers-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "PayPal-Request-Id": requestId
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  return { status: response.status, data };
}

module.exports = { addTrackingBatch };
