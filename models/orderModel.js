const db = require('../db');

let orderColumnSupport = null;

function detectOrderColumns(callback) {
  if (orderColumnSupport !== null) {
    return callback(null, orderColumnSupport);
  }

  const checks = [
    "SHOW COLUMNS FROM orders LIKE 'payment_method'",
    "SHOW COLUMNS FROM orders LIKE 'payment_status'",
    "SHOW COLUMNS FROM orders LIKE 'stripe_session_id'",
    "SHOW COLUMNS FROM orders LIKE 'stripe_payment_intent_id'"
  ];

  const support = {
    payment_method: false,
    payment_status: false,
    stripe_session_id: false,
    stripe_payment_intent_id: false
  };

  let idx = 0;
  function next() {
    if (idx >= checks.length) {
      orderColumnSupport = support;
      return callback(null, support);
    }

    const sql = checks[idx++];
    db.query(sql, function (err, rows) {
      if (err) {
        return callback(err);
      }
      if (sql.includes('payment_method')) support.payment_method = Array.isArray(rows) && rows.length > 0;
      if (sql.includes('payment_status')) support.payment_status = Array.isArray(rows) && rows.length > 0;
      if (sql.includes('stripe_session_id')) support.stripe_session_id = Array.isArray(rows) && rows.length > 0;
      if (sql.includes('stripe_payment_intent_id')) support.stripe_payment_intent_id = Array.isArray(rows) && rows.length > 0;
      next();
    });
  }

  next();
}

function insertOrderItems(orderId, items, callback) {
  if (!items || items.length === 0) {
    return callback(null);
  }

  const sql = `
    INSERT INTO order_items
      (order_id, product_id, product_name, quantity, price, line_total)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const queue = [...items];

  function next() {
    if (queue.length === 0) {
      return callback(null);
    }

    const item = queue.shift();
    const price = item.price != null ? Number(item.price) : 0;
    const quantity = item.quantity != null ? Number(item.quantity) : 0;
    const lineTotal = item.lineTotal != null ? Number(item.lineTotal) : price * quantity;
    const productId = item.product_id || item.id || null;
    const productName = item.productName || item.name || '';
    const values = [orderId, productId, productName, quantity, price, lineTotal];

    function insertOrderItem() {
      db.query(sql, values, function (err) {
        if (err) {
          return callback(err);
        }
        next();
      });
    }

    if (!productId || quantity <= 0) {
      return insertOrderItem();
    }

    const stockSql = `
      UPDATE products
      SET quantity = quantity - ?
      WHERE id = ? AND quantity >= ?
    `;

    db.query(stockSql, [quantity, productId, quantity], function (stockErr, result) {
      if (stockErr) {
        return callback(stockErr);
      }

      if (!result.affectedRows) {
        return callback(new Error(`Not enough stock for product "${productName || productId}"`));
      }

      insertOrderItem();
    });
  }

  next();
}

const Orders = {
  createOrder(orderData, items, callback) {
    const userId = orderData && (orderData.userId || orderData.user_id);
    const invoiceNumber = orderData && orderData.invoiceNumber ? String(orderData.invoiceNumber) : null;
    const paypalOrderId = orderData && orderData.paypalOrderId ? String(orderData.paypalOrderId) : null;
    const paypalCaptureId = orderData && orderData.paypalCaptureId ? String(orderData.paypalCaptureId) : null;
    const stripeSessionId = orderData && orderData.stripeSessionId ? String(orderData.stripeSessionId) : null;
    const stripePaymentIntentId = orderData && orderData.stripePaymentIntentId ? String(orderData.stripePaymentIntentId) : null;
    const paymentMethod = orderData && (orderData.paymentMethod || orderData.payment_method)
      ? String(orderData.paymentMethod || orderData.payment_method)
      : null;
    const paymentStatus = orderData && (orderData.paymentStatus || orderData.payment_status)
      ? String(orderData.paymentStatus || orderData.payment_status)
      : 'Paid';

    const subtotal = (() => {
      if (orderData && orderData.subtotal != null) {
        return Number(orderData.subtotal);
      }
      return (items || []).reduce((sum, item) => {
        const price = item.price != null ? Number(item.price) : 0;
        const qty = item.quantity != null ? Number(item.quantity) : 0;
        const line = item.lineTotal != null ? Number(item.lineTotal) : price * qty;
        return sum + line;
      }, 0);
    })();

    const defaultTax = subtotal * 0.09;
    const taxAmount = orderData && orderData.taxAmount != null ? Number(orderData.taxAmount) : defaultTax;
    const total = orderData && orderData.total != null ? Number(orderData.total) : subtotal + taxAmount;

    if (!userId) {
      return callback(new Error('User id is required to create an order'));
    }

    db.beginTransaction(function (txErr) {
      if (txErr) {
        return callback(txErr);
      }

      detectOrderColumns(function (detectErr, supports) {
        if (detectErr) {
          return db.rollback(function () {
            callback(detectErr);
          });
        }

        const columns = ['user_id', 'subtotal', 'tax_amount', 'total', 'invoice_number', 'status', 'paypal_order_id', 'paypal_capture_id'];
        const values = [userId, subtotal, taxAmount, total, invoiceNumber, 'On Hold', paypalOrderId, paypalCaptureId];

        if (supports.stripe_session_id) {
          columns.push('stripe_session_id');
          values.push(stripeSessionId);
        }
        if (supports.stripe_payment_intent_id) {
          columns.push('stripe_payment_intent_id');
          values.push(stripePaymentIntentId);
        }
        if (supports.payment_method) {
          columns.push('payment_method');
          values.push(paymentMethod);
        }
        if (supports.payment_status) {
          columns.push('payment_status');
          values.push(paymentStatus);
        }

        columns.push('carrier', 'shipment_date', 'created_at');
        values.push(null, null, new Date());

        const placeholders = columns.map(() => '?').join(', ');
        const finalColumns = columns.join(', ');
        const orderSql = `INSERT INTO orders (${finalColumns}) VALUES (${placeholders})`;

        db.query(orderSql, values, function (orderErr, result) {
          if (orderErr) {
            return db.rollback(function () {
              callback(orderErr);
            });
          }

          const orderId = result.insertId;

          insertOrderItems(orderId, items, function (itemsErr) {
            if (itemsErr) {
              return db.rollback(function () {
                callback(itemsErr);
              });
            }

            db.commit(function (commitErr) {
              if (commitErr) {
                return db.rollback(function () {
                  callback(commitErr);
                });
              }

              callback(null, { id: orderId, invoiceNumber: invoiceNumber });
            });
          });
        });
      });
    });
  },

  getByUserId(userId, callback) {
    if (!userId) {
      return callback(new Error('User id is required to fetch orders'));
    }

    detectOrderColumns(function (detectErr, supports) {
      if (detectErr) {
        return callback(detectErr);
      }

      const sql = supports.stripe_session_id || supports.stripe_payment_intent_id || supports.payment_method || supports.payment_status
        ? `
      SELECT
        o.id AS order_id,
        o.invoice_number,
        o.subtotal,
        o.tax_amount,
        o.total,
        o.status,
        o.carrier,
        o.shipment_date,
        o.paypal_order_id,
        o.paypal_capture_id,
        ${supports.stripe_session_id ? 'o.stripe_session_id,' : ''}
        ${supports.stripe_payment_intent_id ? 'o.stripe_payment_intent_id,' : ''}
        ${supports.payment_method ? 'o.payment_method,' : ''}
        ${supports.payment_status ? 'o.payment_status,' : ''}
        o.created_at,
        oi.id AS order_item_id,
        oi.product_id,
        oi.product_name,
        oi.quantity,
        oi.price,
        oi.line_total
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = ?
      ORDER BY o.created_at ASC, oi.id ASC
    `
        : `
      SELECT
        o.id AS order_id,
        o.invoice_number,
        o.subtotal,
        o.tax_amount,
        o.total,
        o.status,
        o.carrier,
        o.shipment_date,
        o.paypal_order_id,
        o.paypal_capture_id,
        o.created_at,
        oi.id AS order_item_id,
        oi.product_id,
        oi.product_name,
        oi.quantity,
        oi.price,
        oi.line_total
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = ?
      ORDER BY o.created_at ASC, oi.id ASC
    `;

      db.query(sql, [userId], function (err, rows) {
        if (err) {
          return callback(err);
        }

        const grouped = [];
        const orderMap = new Map();

        (rows || []).forEach((row) => {
          let order = orderMap.get(row.order_id);
          if (!order) {
            order = {
              id: row.order_id,
              invoiceNumber: row.invoice_number,
              subtotal: row.subtotal != null ? Number(row.subtotal) : 0,
              taxAmount: row.tax_amount != null ? Number(row.tax_amount) : 0,
              total: row.total != null ? Number(row.total) : 0,
              status: row.status || 'On Hold',
              carrier: row.carrier || null,
              shipment_date: row.shipment_date || null,
              paypal_order_id: row.paypal_order_id,
              paypal_capture_id: row.paypal_capture_id,
              stripe_session_id: row.stripe_session_id || null,
              stripe_payment_intent_id: row.stripe_payment_intent_id || null,
              payment_method: row.payment_method || null,
              payment_status: row.payment_status || null,
              createdAt: row.created_at,
              items: []
            };
            orderMap.set(row.order_id, order);
            grouped.push(order);
          }

          if (row.order_item_id) {
            order.items.push({
              id: row.order_item_id,
              product_id: row.product_id,
              productName: row.product_name,
              quantity: row.quantity != null ? Number(row.quantity) : 0,
              price: row.price != null ? Number(row.price) : 0,
              lineTotal: row.line_total != null ? Number(row.line_total) : 0
            });
          }
        });

        callback(null, grouped);
      });
    });
  },

  getAllWithItems(callback) {
    detectOrderColumns(function (detectErr, supports) {
      if (detectErr) {
        return callback(detectErr);
      }

      const sql = supports.stripe_session_id || supports.stripe_payment_intent_id || supports.payment_method || supports.payment_status
        ? `
      SELECT
        o.id AS order_id,
        o.user_id,
        o.invoice_number,
        o.subtotal,
        o.tax_amount,
        o.total,
        o.status,
        o.carrier,
        o.shipment_date,
        o.paypal_order_id,
        o.paypal_capture_id,
        ${supports.stripe_session_id ? 'o.stripe_session_id,' : ''}
        ${supports.stripe_payment_intent_id ? 'o.stripe_payment_intent_id,' : ''}
        ${supports.payment_method ? 'o.payment_method,' : ''}
        ${supports.payment_status ? 'o.payment_status,' : ''}
        o.created_at,
        u.username,
        u.email,
        oi.id AS order_item_id,
        oi.product_id,
        oi.product_name,
        oi.quantity,
        oi.price,
        oi.line_total
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ORDER BY o.created_at ASC, oi.id ASC
    `
        : `
      SELECT
        o.id AS order_id,
        o.user_id,
        o.invoice_number,
        o.subtotal,
        o.tax_amount,
        o.total,
        o.status,
        o.carrier,
        o.shipment_date,
        o.paypal_order_id,
        o.paypal_capture_id,
        o.created_at,
        u.username,
        u.email,
        oi.id AS order_item_id,
        oi.product_id,
        oi.product_name,
        oi.quantity,
        oi.price,
        oi.line_total
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ORDER BY o.created_at ASC, oi.id ASC
    `;

      db.query(sql, function (err, rows) {
        if (err) {
          return callback(err);
        }

        const grouped = [];
        const orderMap = new Map();

        (rows || []).forEach((row) => {
          let order = orderMap.get(row.order_id);
          if (!order) {
            order = {
              id: row.order_id,
              user_id: row.user_id,
              invoice_number: row.invoice_number,
              subtotal: row.subtotal != null ? Number(row.subtotal) : 0,
              taxAmount: row.tax_amount != null ? Number(row.tax_amount) : 0,
              total: row.total != null ? Number(row.total) : 0,
              status: row.status || 'On Hold',
              carrier: row.carrier || null,
              shipment_date: row.shipment_date || null,
              paypal_order_id: row.paypal_order_id,
              paypal_capture_id: row.paypal_capture_id,
              stripe_session_id: row.stripe_session_id || null,
              stripe_payment_intent_id: row.stripe_payment_intent_id || null,
              payment_method: row.payment_method || null,
              payment_status: row.payment_status || null,
              created_at: row.created_at,
              username: row.username,
              email: row.email,
              items: []
            };
            orderMap.set(row.order_id, order);
            grouped.push(order);
          }

          if (row.order_item_id) {
            order.items.push({
              id: row.order_item_id,
              product_id: row.product_id,
              product_name: row.product_name,
              quantity: row.quantity != null ? Number(row.quantity) : 0,
              price: row.price != null ? Number(row.price) : 0,
              line_total: row.line_total != null ? Number(row.line_total) : 0
            });
          }
        });

        callback(null, grouped);
      });
    });
  },

  getById(orderId, callback) {
    if (!orderId) {
      return callback(new Error('Order id is required to fetch order'));
    }

    detectOrderColumns(function (detectErr, supports) {
      if (detectErr) {
        return callback(detectErr);
      }

      const sql = supports.stripe_session_id || supports.stripe_payment_intent_id || supports.payment_method || supports.payment_status
        ? `
      SELECT
        o.id AS order_id,
        o.user_id,
        o.invoice_number,
        o.subtotal,
        o.tax_amount,
        o.total,
        o.status,
        o.carrier,
        o.shipment_date,
        o.paypal_order_id,
        o.paypal_capture_id,
        ${supports.stripe_session_id ? 'o.stripe_session_id,' : ''}
        ${supports.stripe_payment_intent_id ? 'o.stripe_payment_intent_id,' : ''}
        ${supports.payment_method ? 'o.payment_method,' : ''}
        ${supports.payment_status ? 'o.payment_status,' : ''}
        o.created_at,
        u.username,
        u.email,
        oi.id AS order_item_id,
        oi.product_id,
        oi.product_name,
        oi.quantity,
        oi.price,
        oi.line_total
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.id = ?
    `
        : `
      SELECT
        o.id AS order_id,
        o.user_id,
        o.invoice_number,
        o.subtotal,
        o.tax_amount,
        o.total,
        o.status,
        o.carrier,
        o.shipment_date,
        o.paypal_order_id,
        o.paypal_capture_id,
        o.created_at,
        u.username,
        u.email,
        oi.id AS order_item_id,
        oi.product_id,
        oi.product_name,
        oi.quantity,
        oi.price,
        oi.line_total
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.id = ?
    `;

      db.query(sql, [orderId], function (err, rows) {
        if (err) {
          return callback(err);
        }

        if (!rows || rows.length === 0) {
          return callback(null, null);
        }

        const base = {
          id: rows[0].order_id,
          user_id: rows[0].user_id,
          invoice_number: rows[0].invoice_number,
          subtotal: rows[0].subtotal != null ? Number(rows[0].subtotal) : 0,
          taxAmount: rows[0].tax_amount != null ? Number(rows[0].tax_amount) : 0,
          total: rows[0].total != null ? Number(rows[0].total) : 0,
          created_at: rows[0].created_at,
          status: rows[0].status || 'On Hold',
          carrier: rows[0].carrier || null,
          shipment_date: rows[0].shipment_date || null,
          paypal_order_id: rows[0].paypal_order_id,
          paypal_capture_id: rows[0].paypal_capture_id,
          stripe_session_id: rows[0].stripe_session_id || null,
          stripe_payment_intent_id: rows[0].stripe_payment_intent_id || null,
          payment_method: rows[0].payment_method || null,
          payment_status: rows[0].payment_status || null,
          username: rows[0].username,
          email: rows[0].email,
          items: []
        };

        rows.forEach((row) => {
          if (row.order_item_id) {
            base.items.push({
              id: row.order_item_id,
              product_id: row.product_id,
              product_name: row.product_name,
              quantity: row.quantity != null ? Number(row.quantity) : 0,
              price: row.price != null ? Number(row.price) : 0,
              line_total: row.line_total != null ? Number(row.line_total) : 0
            });
          }
        });

        callback(null, base);
      });
    });
  },

  updateStatus(orderId, status, carrier, shipmentDate, callback) {
    if (!orderId) {
      return callback(new Error('Order id is required to update status'));
    }
    const sql = `
      UPDATE orders
      SET
        status = ?,
        carrier = COALESCE(NULLIF(?, ''), carrier),
        shipment_date = COALESCE(NULLIF(?, ''), shipment_date)
      WHERE id = ?
    `;
    db.query(sql, [status, carrier || '', shipmentDate || '', orderId], callback);
  },

  getByStripeSessionId(sessionId, callback) {
    if (!sessionId) {
      return callback(new Error('Stripe session id is required'));
    }
    detectOrderColumns(function (detectErr, supports) {
      if (detectErr) {
        return callback(detectErr);
      }

      if (!supports.stripe_session_id) {
        return callback(null, null);
      }

      const sql = `
        SELECT
          id,
          user_id,
          invoice_number,
          subtotal,
          tax_amount,
          total,
          status,
          carrier,
          shipment_date,
          paypal_order_id,
          paypal_capture_id,
          stripe_session_id,
          stripe_payment_intent_id,
          payment_method,
          payment_status,
          created_at
        FROM orders
        WHERE stripe_session_id = ?
        LIMIT 1
      `;

      db.query(sql, [sessionId], function (err, rows) {
        if (err) {
          return callback(err);
        }
        if (!rows || rows.length === 0) {
          return callback(null, null);
        }
        callback(null, rows[0]);
      });
    });
  },

  getLatestByUserAndMethod(userId, paymentMethod, callback) {
    if (!userId) {
      return callback(new Error('User id is required'));
    }
    detectOrderColumns(function (detectErr, supports) {
      if (detectErr) {
        return callback(detectErr);
      }

      if (!supports.payment_method) {
        return callback(null, null);
      }

      const sql = `
        SELECT
          id,
          user_id,
          invoice_number,
          subtotal,
          tax_amount,
          total,
          status,
          payment_method,
          created_at
        FROM orders
        WHERE user_id = ? AND payment_method = ?
        ORDER BY created_at DESC
        LIMIT 1
      `;

      db.query(sql, [userId, paymentMethod], function (err, rows) {
        if (err) {
          return callback(err);
        }
        if (!rows || rows.length === 0) {
          return callback(null, null);
        }
        callback(null, rows[0]);
      });
    });
  }
};

module.exports = Orders;
