const CartItems = require('../models/CartItem');
const Orders = require('../models/orderModel');
const paypal = require('../services/paypal');
const orderTracking = require('./paypalTrackingController');

function normalizeCartItems(cartItems) {
  return (cartItems || []).map((item) => {
    const price = item.price != null ? Number(item.price) : 0;
    const quantity = item.quantity != null ? Number(item.quantity) : 0;
    return {
      id: item.id,
      product_id: item.product_id,
      productName: item.productName || item.name || item.product_name || '',
      price,
      quantity,
      lineTotal: price * quantity,
      image: item.image || null
    };
  });
}

function buildSummary(items) {
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const taxRate = 0.09;
  const taxAmount = subtotal * taxRate;
  return {
    subtotal,
    taxRate,
    taxAmount,
    total: subtotal + taxAmount
  };
}

function buildInvoiceMeta() {
  return {
    number: 'INV-' + Date.now(),
    date: new Date().toISOString()
  };
}

function storeInvoiceSession(req, payload) {
  if (!req.session) {
    return;
  }
  req.session.invoiceData = {
    items: payload.items,
    summary: payload.summary,
    paymentMethod: payload.paymentMethod || null,
    invoiceMeta: {
      number: payload.invoiceMeta.number,
      date: payload.invoiceMeta.date
    }
  };
}

function storePendingCheckout(req, payload) {
  if (!req.session) {
    return;
  }
  req.session.pendingCheckout = {
    items: payload.items,
    summary: payload.summary,
    invoiceMeta: payload.invoiceMeta,
    paymentMethod: payload.paymentMethod || null
  };
}

function clearPendingCheckout(req) {
  if (req.session) {
    delete req.session.pendingCheckout;
  }
}

function getUserId(req) {
  const userSession = req.session && req.session.user;
  return userSession && (userSession.userId || userSession.id);
}

function extractCaptureId(capture) {
  const units = capture && capture.purchase_units;
  if (!Array.isArray(units) || !units.length) {
    return '';
  }
  const payments = units[0] && units[0].payments;
  const captures = payments && payments.captures;
  if (!Array.isArray(captures) || !captures.length) {
    return '';
  }
  return captures[0] && captures[0].id ? String(captures[0].id) : '';
}

function buildTrackingNumber(invoiceNumber) {
  const digits = String(invoiceNumber || '').replace(/\D/g, '');
  return digits || String(Date.now());
}

exports.showPaymentOptions = function (req, res) {
  const userId = getUserId(req);
  if (!userId) {
    req.flash('error', 'Please log in to continue checkout.');
    return res.redirect('/login');
  }

  CartItems.getByUserId(userId, function (err, cartItems) {
    if (err) {
      console.error('Payment options load error:', err);
      req.flash('error', 'Unable to load cart for checkout.');
      return res.redirect('/cart');
    }

    if (!cartItems || cartItems.length === 0) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/cart');
    }

    const items = normalizeCartItems(cartItems);
    const summary = buildSummary(items);

    res.render('payment', {
      user: req.session.user,
      items,
      summary,
      paypalClientId: process.env.PAYPAL_CLIENT_ID || ''
    });
  });
};

exports.createPaypalOrder = function (req, res) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Please log in to continue checkout.' });
  }

  CartItems.getByUserId(userId, async function (err, cartItems) {
    if (err) {
      console.error('PayPal create order error:', err);
      return res.status(500).json({ error: 'Unable to load cart for checkout.' });
    }

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    const items = normalizeCartItems(cartItems);
    const summary = buildSummary(items);
    const invoiceMeta = buildInvoiceMeta();
    const amount = summary.total.toFixed(2);

    storePendingCheckout(req, { items, summary, invoiceMeta, paymentMethod: 'paypal' });

    try {
      const order = await paypal.createOrder(amount);
      if (!order || !order.id) {
        return res.status(502).json({ error: 'PayPal order creation failed.' });
      }
      return res.json({ id: order.id });
    } catch (paypalErr) {
      console.error('PayPal create order exception:', paypalErr);
      return res.status(502).json({ error: 'PayPal order creation failed.' });
    }
  });
};

exports.capturePaypalOrder = function (req, res) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Please log in to continue checkout.' });
  }

  const orderId = req.body && (req.body.orderId || req.body.orderID);
  if (!orderId) {
    return res.status(400).json({ error: 'Missing PayPal order id.' });
  }

  paypal.captureOrder(orderId)
    .then((capture) => {
      const status = capture && (capture.status || capture.state);
      if (status !== 'COMPLETED') {
        return res.status(400).json({ error: 'Payment was not completed.' });
      }

      const pending = req.session && req.session.pendingCheckout;
      if (!pending || !pending.items || pending.items.length === 0) {
        return res.status(400).json({ error: 'Checkout session expired. Please try again.' });
      }

      const captureId = extractCaptureId(capture);
          Orders.createOrder(
            {
              userId: userId,
              subtotal: pending.summary.subtotal,
              taxAmount: pending.summary.taxAmount,
              total: pending.summary.total,
              invoiceNumber: pending.invoiceMeta.number,
              paypalOrderId: orderId,
              paypalCaptureId: captureId,
              paymentMethod: pending.paymentMethod || 'paypal'
            },
            pending.items,
            function (orderErr) {
          if (orderErr) {
            console.error('Order create error:', orderErr);
            return res.status(500).json({ error: 'Unable to finalize the order.' });
          }

          const trackingNumber = buildTrackingNumber(pending.invoiceMeta.number);
          orderTracking.sendTracking({
            status: 'On Hold',
            captureId: captureId,
            trackingNumber: trackingNumber
          })
            .then((result) => {
              if (!result.skipped && (result.status < 200 || result.status >= 300)) {
                console.error('PayPal tracking response:', result.data);
              }
            })
            .catch((trackErr) => {
              console.error('PayPal auto tracking error:', trackErr);
          });

          CartItems.clear(userId, function (clearErr) {
            if (clearErr) {
              console.error('Checkout clear cart error:', clearErr);
            }

            storeInvoiceSession(req, pending);
            clearPendingCheckout(req);
            return res.json({ success: true, redirectUrl: '/invoice' });
          });
        }
      );
    })
    .catch((paypalErr) => {
      console.error('PayPal capture error:', paypalErr);
      return res.status(502).json({ error: 'PayPal capture failed.' });
    });
};
