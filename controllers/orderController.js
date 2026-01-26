const Orders = require('../models/orderModel');
const orderTracking = require('./paypalTrackingController');

const ORDER_STATUSES = [
  'On Hold',
  'In Process',
  'Shipped',
  'Delivered'
];

exports.listUserOrders = function (req, res) {
  const userSession = req.session && req.session.user;
  const userId = userSession && (userSession.userId || userSession.id);

  if (!userId) {
    req.flash('error', 'Please log in to view your orders.');
    return res.redirect('/login');
  }

  Orders.getByUserId(userId, function (err, orders) {
    if (err) {
      console.error('Fetch orders error:', err);
      req.flash('error', 'Unable to load your orders right now.');
      return res.redirect('/');
    }

    const normalized = (orders || []).map((order) => ({
      ...order,
      status: order.status || 'On Hold',
      createdAt: order.createdAt ? new Date(order.createdAt) : null,
      items: order.items || []
    }));

    const numbered = normalized.map((order, index) => ({
      ...order,
      displayNumber: index + 1
    }));

    return res.render('orders', {
      user: userSession,
      orders: numbered
    });
  });
};

exports.showUserInvoice = function (req, res) {
  const userSession = req.session && req.session.user;
  const userId = userSession && (userSession.userId || userSession.id);
  const orderId = parseInt(req.params.id, 10);

  if (!userId || isNaN(orderId)) {
    req.flash('error', 'Invalid request.');
    return res.redirect('/orders');
  }

  Orders.getById(orderId, function (err, order) {
    if (err) {
      console.error('User invoice fetch error:', err);
      req.flash('error', 'Unable to load invoice.');
      return res.redirect('/orders');
    }

    if (!order || order.user_id !== userId) {
      req.flash('error', 'Order not found.');
      return res.redirect('/orders');
    }

    const items = (order.items || []).map((item) => ({
      productName: item.product_name,
      product_id: item.product_id,
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 0),
      lineTotal: Number(item.line_total || 0)
    }));

    const subtotal = order.subtotal != null ? Number(order.subtotal) : items.reduce((sum, item) => sum + item.lineTotal, 0);
    const taxRate = 0.09;
    const taxAmount = order.taxAmount != null ? Number(order.taxAmount) : subtotal * taxRate;
    const summary = {
      subtotal,
      taxRate,
      taxAmount,
      total: order.total != null ? Number(order.total) : subtotal + taxAmount
    };

    const invoiceMeta = {
      number: order.invoice_number,
      date: order.created_at ? new Date(order.created_at) : new Date()
    };

    const rawPayment = order.payment_method || order.paymentMethod || '';
    const paymentMethod = rawPayment
      ? String(rawPayment)
      : (order.paypal_capture_id ? 'PayPal' : 'NETS');

    return res.render('checkout_invoice', {
      user: {
        ...(userSession || {}),
        contact: userSession && userSession.contact ? userSession.contact : null
      },
      items,
      summary,
      invoiceMeta,
      paymentMethod,
      adminView: false,
      backLink: '/orders',
      backLabel: 'Back to Orders'
    });
  });
};

exports.listAllOrders = function (req, res) {
  Orders.getAllWithItems(function (err, orders) {
    if (err) {
      console.error('Admin orders fetch error:', err);
      req.flash('error', 'Unable to load orders right now.');
      return res.redirect('/admin');
    }

    return res.render('admin_orders', {
      user: req.session.user,
      orders: orders || [],
      orderStatuses: ORDER_STATUSES,
      success: req.flash('success'),
      error: req.flash('error')
    });
  });
};

exports.showAdminInvoice = function (req, res) {
  const orderId = parseInt(req.params.id, 10);
  if (isNaN(orderId)) {
    req.flash('error', 'Invalid order ID.');
    return res.redirect('/admin/orders');
  }

  Orders.getById(orderId, function (err, order) {
    if (err) {
      console.error('Admin invoice fetch error:', err);
      req.flash('error', 'Unable to load invoice.');
      return res.redirect('/admin/orders');
    }

    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/admin/orders');
    }

    const items = (order.items || []).map((item) => ({
      productName: item.product_name,
      product_id: item.product_id,
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 0),
      lineTotal: Number(item.line_total || 0)
    }));

    const subtotal = order.subtotal != null ? Number(order.subtotal) : items.reduce((sum, item) => sum + item.lineTotal, 0);
    const taxRate = 0.09;
    const taxAmount = order.taxAmount != null ? Number(order.taxAmount) : subtotal * taxRate;
    const summary = {
      subtotal,
      taxRate,
      taxAmount,
      total: order.total != null ? Number(order.total) : subtotal + taxAmount
    };

    const invoiceMeta = {
      number: order.invoice_number,
      date: order.created_at ? new Date(order.created_at) : new Date()
    };

    const invoiceUser = {
      username: order.username || 'Customer',
      email: order.email || '',
      contact: order.contact || ''
    };

    const rawPayment = order.payment_method || order.paymentMethod || '';
    const paymentMethod = rawPayment
      ? String(rawPayment)
      : (order.paypal_capture_id ? 'PayPal' : 'NETS');

    return res.render('checkout_invoice', {
      user: invoiceUser,
      items,
      summary,
      invoiceMeta,
      paymentMethod,
      adminView: true,
      backLink: '/admin/orders',
      backLabel: 'Back to Orders'
    });
  });
};

exports.editOrderStatusForm = function (req, res) {
  const orderId = parseInt(req.params.id, 10);
  if (isNaN(orderId)) {
    req.flash('error', 'Invalid order ID.');
    return res.redirect('/admin/orders');
  }

  Orders.getById(orderId, function (err, order) {
    if (err) {
      console.error('Admin edit order fetch error:', err);
      req.flash('error', 'Unable to load order.');
      return res.redirect('/admin/orders');
    }
    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/admin/orders');
    }

    return res.render('admineditorder', {
      order,
      statuses: ORDER_STATUSES,
      success: req.flash('success'),
      error: req.flash('error')
    });
  });
};

exports.updateOrderStatus = function (req, res) {
  const orderId = parseInt(req.params.id, 10);
  const status = req.body.status;
  const captureId = (req.body.captureId || '').trim();
  const trackingNumber = (req.body.trackingNumber || '').trim();
  const carrier = (req.body.carrier || '').trim();
  const trackingNumberType = (req.body.trackingNumberType || '').trim();
  const shipmentDate = (req.body.shipmentDate || '').trim();
  const carrierNameOther = (req.body.carrierNameOther || '').trim();
  const syncPaypal = (req.body.syncPaypal || '').toLowerCase() === 'true';

  if (isNaN(orderId) || !status || !ORDER_STATUSES.includes(status)) {
    req.flash('error', 'Invalid status update.');
    return res.redirect('/admin/orders');
  }

  Orders.updateStatus(orderId, status, carrier, shipmentDate, function (err) {
    if (err) {
      console.error('Order status update error:', err);
      req.flash('error', 'Unable to update status.');
      return res.redirect('/admin/orders');
    }

    if (!syncPaypal) {
      req.flash('success', 'Order status updated.');
      return res.redirect('/admin/orders');
    }

    orderTracking.sendTracking({
      status,
      captureId,
      trackingNumber,
      carrier,
      trackingNumberType,
      shipmentDate,
      carrierNameOther
    })
      .then((result) => {
        if (result.skipped) {
          req.flash('success', 'Order status updated.');
          return res.redirect('/admin/orders');
        }
        if (result.status < 200 || result.status >= 300) {
          console.error('PayPal tracking response:', result.data);
          req.flash('error', 'Order updated, but PayPal tracking failed.');
          return res.redirect('/admin/orders');
        }
        req.flash('success', 'Order status updated and PayPal tracking sent.');
        return res.redirect('/admin/orders');
      })
      .catch((trackErr) => {
        console.error('PayPal tracking error:', trackErr);
        req.flash('error', 'Order updated, but PayPal tracking failed.');
        return res.redirect('/admin/orders');
      });
  });
};
