const Orders = require('../models/orderModel');

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
      success: req.flash('success'),
      error: req.flash('error')
    });
  });
};
