const paypalTracking = require('../services/paypalTracking');

function resolvePaypalStatus(orderStatus) {
  switch (orderStatus) {
    case 'Shipped':
      return 'SHIPPED';
    case 'In Process':
      return 'LOCAL_PICKUP';
    case 'Delivered':
      return 'DELIVERED';
    case 'On Hold':
    default:
      return 'ON_HOLD';
  }
}

function buildPayload(options) {
  const shipmentDate = options.shipmentDate || new Date().toISOString().slice(0, 10);
  return {
    trackers: [
      {
        transaction_id: String(options.captureId),
        status: resolvePaypalStatus(options.status),
        tracking_number: String(options.trackingNumber),
        carrier: options.carrier || 'DHL',
        tracking_number_type: options.trackingNumberType || 'CARRIER_PROVIDED',
        shipment_date: shipmentDate,
        carrier_name_other: options.carrierNameOther || undefined,
        notify_buyer: true,
        quantity: 1,
        tracking_number_validated: true
      }
    ]
  };
}

async function sendTracking(options) {
  if (!options || !options.captureId || !options.trackingNumber) {
    return { skipped: true };
  }

  const payload = buildPayload(options);
  const result = await paypalTracking.addTrackingBatch(payload);
  return { skipped: false, status: result.status, data: result.data };
}

module.exports = { sendTracking };
