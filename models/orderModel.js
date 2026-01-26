const db = require('../db');

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
    const paymentMethod = orderData && (orderData.paymentMethod || orderData.payment_method)
      ? String(orderData.paymentMethod || orderData.payment_method)
      : null;

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

      const orderSql = `
        INSERT INTO orders (user_id, subtotal, tax_amount, total, invoice_number, status, paypal_order_id, paypal_capture_id, payment_method, carrier, shipment_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      db.query(
        orderSql,
        [userId, subtotal, taxAmount, total, invoiceNumber, 'On Hold', paypalOrderId, paypalCaptureId, paymentMethod, null, null],
        function (orderErr, result) {
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
  },

  getByUserId(userId, callback) {
    if (!userId) {
      return callback(new Error('User id is required to fetch orders'));
    }

    const sql = `
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
        o.payment_method,
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
            payment_method: row.payment_method || null,
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
  },

  getAllWithItems(callback) {
    const sql = `
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
        o.payment_method,
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
            payment_method: row.payment_method || null,
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
  },

  getById(orderId, callback) {
    if (!orderId) {
      return callback(new Error('Order id is required to fetch order'));
    }

    const sql = `
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
        o.payment_method,
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
        payment_method: rows[0].payment_method || null,
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
  }
};

module.exports = Orders;
