const Stripe = require('stripe');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

let cachedTaxRateId = null;

async function getOrCreateTaxRate() {
  if (process.env.STRIPE_TAX_RATE_ID) {
    return String(process.env.STRIPE_TAX_RATE_ID);
  }

  if (!stripe) {
    throw new Error('Stripe is not configured.');
  }

  if (cachedTaxRateId) {
    return cachedTaxRateId;
  }

  const taxRate = await stripe.taxRates.create({
    display_name: 'GST',
    percentage: 9,
    inclusive: false,
    country: 'SG'
  });

  cachedTaxRateId = taxRate.id;
  return cachedTaxRateId;
}

module.exports = {
  getOrCreateTaxRate
};
