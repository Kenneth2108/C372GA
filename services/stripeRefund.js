const Stripe = require('stripe');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

async function refundPaymentIntent(paymentIntentId, amount) {
  if (!stripe) {
    throw new Error('Stripe is not configured.');
  }

  if (!paymentIntentId) {
    throw new Error('Stripe payment intent id is required.');
  }

  const payload = { payment_intent: String(paymentIntentId) };

  if (Number.isFinite(amount)) {
    payload.amount = Math.round(Number(amount) * 100);
  }

  return stripe.refunds.create(payload);
}

module.exports = { refundPaymentIntent };
