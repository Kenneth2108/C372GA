const Stripe = require('stripe');
const CartItems = require('../models/CartItem');
const Orders = require('../models/orderModel');
const stripeTax = require('../services/stripeTax');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

function getUserId(req) {
  const userSession = req.session && req.session.user;
  return userSession && (userSession.userId || userSession.id);
}

function normalizeCartItems(cartItems) {
  return (cartItems || []).map((item) => {
    const price = item.price != null ? Number(item.price) : 0;
    const quantity = item.quantity != null ? Number(item.quantity) : 0;
    return {
      product_id: item.product_id || item.productId || item.id,
      productName: item.productName || item.name || item.product_name || '',
      price,
      quantity,
      lineTotal: price * quantity
    };
  });
}

function buildSummary(items) {
  const subtotal = (items || []).reduce((sum, item) => sum + (item.lineTotal || 0), 0);
  const taxRate = 0.09;
  const taxAmount = subtotal * taxRate;
  return {
    subtotal,
    taxRate,
    taxAmount,
    total: subtotal + taxAmount
  };
}

function getBaseUrl(req) {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

function buildStripeLineItems(items, summary) {
  return (items || []).map((item) => ({
    price_data: {
      currency: 'sgd',
      product_data: {
        name: item.productName || 'Pet Shop Item',
        metadata: {
          product_id: String(item.product_id || '')
        }
      },
      unit_amount: Math.round((item.price || 0) * 100)
    },
    quantity: item.quantity || 1
  }));
}

function waitForStripeOrder(sessionId, attempts, delayMs) {
  return new Promise((resolve, reject) => {
    const tryFetch = () => {
      Orders.getByStripeSessionId(sessionId, function (err, order) {
        if (err) {
          return reject(err);
        }

        if (order) {
          return resolve(order);
        }

        if (attempts <= 0) {
          return resolve(null);
        }

        attempts -= 1;
        setTimeout(tryFetch, delayMs);
      });
    };

    tryFetch();
  });
}

async function finalizeStripeOrder(session) {
  if (!session || session.payment_status !== 'paid') {
    return null;
  }

  const sessionId = session.id;
  const existing = await new Promise((resolve, reject) => {
    Orders.getByStripeSessionId(sessionId, function (err, order) {
      if (err) return reject(err);
      resolve(order);
    });
  });

  if (existing) {
    return existing;
  }

  const userId = session.client_reference_id || (session.metadata && session.metadata.userId);
  if (!userId) {
    throw new Error('Missing user reference for Stripe session');
  }

  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 100,
    expand: ['data.price.product']
  });

  const items = (lineItems.data || [])
    .filter((line) => {
      const product = line.price && line.price.product && line.price.product.metadata;
      if (product && product.is_tax === 'true') {
        return false;
      }
      return true;
    })
    .map((line) => {
      const product = line.price && line.price.product ? line.price.product : null;
      const metadata = product && product.metadata ? product.metadata : {};
      const productId = metadata.product_id ? Number(metadata.product_id) : null;
      const unitAmount = line.price && line.price.unit_amount ? Number(line.price.unit_amount) / 100 : 0;
      const quantity = line.quantity != null ? Number(line.quantity) : 1;
      return {
        product_id: productId,
        productName: (product && product.name) || line.description || 'Pet Shop Item',
        price: unitAmount,
        quantity: quantity,
        lineTotal: unitAmount * quantity
      };
    });

  const summary = buildSummary(items);
  const paymentIntentId = session.payment_intent ? String(session.payment_intent) : null;

  return await new Promise((resolve, reject) => {
    Orders.createOrder(
      {
        userId: Number(userId),
        subtotal: summary.subtotal,
        taxAmount: summary.taxAmount,
        total: summary.total,
        invoiceNumber: 'INV-' + Date.now(),
        paymentMethod: 'stripe',
        paymentStatus: 'Paid',
        stripeSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId
      },
      items,
      function (err, order) {
        if (err) return reject(err);
        CartItems.clear(Number(userId), function (clearErr) {
          if (clearErr) {
            console.error('Stripe clear cart error:', clearErr);
          }
          resolve(order);
        });
      }
    );
  });
}

exports.createCheckoutSession = function (req, res) {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured.' });
  }

  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Please log in to continue checkout.' });
  }

  CartItems.getByUserId(userId, async function (err, cartItems) {
    if (err) {
      console.error('Stripe create session error:', err);
      return res.status(500).json({ error: 'Unable to load cart for checkout.' });
    }

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    const items = normalizeCartItems(cartItems);
    const summary = buildSummary(items);

    try {
      const lineItems = buildStripeLineItems(items, summary);
      const taxRateId = await stripeTax.getOrCreateTaxRate();
      const baseUrl = getBaseUrl(req);

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: lineItems.map((item) => ({
          ...item,
          tax_rates: taxRateId ? [taxRateId] : []
        })),
        success_url: `${baseUrl}/checkout/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/checkout/stripe/cancel`,
        client_reference_id: String(userId),
        metadata: {
          userId: String(userId),
          subtotal: summary.subtotal.toFixed(2),
          taxAmount: summary.taxAmount.toFixed(2),
          total: summary.total.toFixed(2)
        }
      });

      return res.json({ id: session.id });
    } catch (stripeErr) {
      console.error('Stripe session create failed:', stripeErr);
      return res.status(502).json({ error: 'Stripe checkout is unavailable right now.' });
    }
  });
};

exports.handleSuccess = async function (req, res) {
  const sessionId = req.query && req.query.session_id ? String(req.query.session_id) : '';

  if (!sessionId) {
    req.flash('error', 'Missing Stripe session.');
    return res.redirect('/checkout');
  }

  if (!stripe) {
    req.flash('error', 'Stripe is not configured.');
    return res.redirect('/checkout');
  }

  try {
    const order = await waitForStripeOrder(sessionId, 6, 1200);
    if (order && order.id) {
      return res.redirect(`/orders/${order.id}/invoice`);
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== 'paid') {
      req.flash('error', 'Payment not completed.');
      return res.redirect('/checkout');
    }

    const createdOrder = await finalizeStripeOrder(session);
    if (createdOrder && createdOrder.id) {
      return res.redirect(`/orders/${createdOrder.id}/invoice`);
    }
  } catch (err) {
    console.error('Stripe success error:', err);
  }

  req.flash('info', 'Payment received. We are confirming your order.');
  return res.redirect('/orders');
};

exports.handleCancel = function (req, res) {
  req.flash('error', 'Stripe payment was cancelled. Please choose another method.');
  return res.redirect('/checkout');
};

exports.handleWebhook = function (req, res) {
  if (!stripe || !stripeWebhookSecret) {
    console.error('Stripe webhook not configured.');
    return res.status(500).send('Webhook not configured');
  }

  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data && event.data.object;
    finalizeStripeOrder(session)
      .then(() => res.json({ received: true }))
      .catch((err) => {
        console.error('Stripe finalize order error:', err);
        res.status(500).send('Webhook processing failed');
      });
    return;
  }

  res.json({ received: true });
};
