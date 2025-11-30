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
    const values = [
      orderId,
      item.product_id || item.id || null,
      item.productName || item.name || '',
      quantity,
      price,
      lineTotal
    ];

    db.query(sql, values, function (err) {
      if (err) {
        return callback(err);
      }
      next();
    });
  }

  next();
}

const Orders = {
  createOrder(orderData, items, callback) {
    const userId = orderData && (orderData.userId || orderData.user_id);
    const total = orderData && orderData.total != null ? Number(orderData.total) : 0;
    const invoiceNumber = orderData && orderData.invoiceNumber ? String(orderData.invoiceNumber) : null;

    if (!userId) {
      return callback(new Error('User id is required to create an order'));
    }

    db.beginTransaction(function (txErr) {
      if (txErr) {
        return callback(txErr);
      }

      const orderSql = `
        INSERT INTO orders (user_id, total, invoice_number, created_at)
        VALUES (?, ?, ?, NOW())
      `;

      db.query(orderSql, [userId, total, invoiceNumber], function (orderErr, result) {
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
        o.total,
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
            total: row.total != null ? Number(row.total) : 0,
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
        o.total,
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
            total: row.total != null ? Number(row.total) : 0,
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
  }
};

module.exports = Orders;
