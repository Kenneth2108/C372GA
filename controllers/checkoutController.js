const CartItems = require('../models/CartItem');
const Orders = require('../models/orderModel');

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
  const taxRate = 0.09; // 9% GST
  const taxAmount = subtotal * taxRate;
  return {
    subtotal,
    taxRate,
    taxAmount,
    total: subtotal + taxAmount
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
      date: payload.invoiceMeta.date.toISOString()
    }
  };
}

exports.generateInvoice = function (req, res) {
  const userSession = req.session.user;
  const userId = userSession && (userSession.userId || userSession.id);

  if (!userId) {
    req.flash('error', 'Please log in to continue checkout.');
    return res.redirect('/login');
  }

  CartItems.getByUserId(userId, function (err, cartItems) {
    if (err) {
      console.error('Checkout invoice error:', err);
      req.flash('error', 'Unable to load cart for checkout.');
      return res.redirect('/cart');
    }
    if (!cartItems || cartItems.length === 0) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/cart');
    }

    const items = normalizeCartItems(cartItems);
    const summary = buildSummary(items);
    const invoiceMeta = {
      number: 'INV-' + Date.now(),
      date: new Date()
    };

    Orders.createOrder(
      { userId: userId, total: summary.total, invoiceNumber: invoiceMeta.number, paymentMethod: 'nets' },
      items,
      function (orderErr) {
        if (orderErr) {
          console.error('Order create error:', orderErr);
        }
        CartItems.clear(userId, function (clearErr) {
          if (clearErr) {
            console.error('Checkout clear cart error:', clearErr);
          }

          storeInvoiceSession(req, { items, summary, invoiceMeta, paymentMethod: 'nets' });
          return res.redirect('/invoice');
        });
      }
    );
  });
};

exports.showInvoice = function (req, res) {
  const invoiceData = req.session && req.session.invoiceData;
  if (!invoiceData) {
    req.flash('error', 'No invoice available to display.');
    return res.redirect('/cart');
  }

  delete req.session.invoiceData;

  const invoiceMeta = invoiceData.invoiceMeta || {};
  const invoiceDate = invoiceMeta.date ? new Date(invoiceMeta.date) : new Date();

  return res.render('checkout_invoice', {
    user: req.session.user,
    items: invoiceData.items || [],
    summary: invoiceData.summary || buildSummary(invoiceData.items || []),
    paymentMethod: invoiceData.paymentMethod || null,
    invoiceMeta: {
      number: invoiceMeta.number,
      date: invoiceDate
    },
    adminView: false,
    backLink: '/cart',
    backLabel: 'Back to Cart'
  });
};
