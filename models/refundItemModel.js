const db = require('../db');

function createMany(refundId, orderId, items, callback) {
  if (!refundId || !orderId || !Array.isArray(items) || items.length === 0) {
    return callback && callback(null);
  }

  const queue = items.slice();

  function next() {
    if (queue.length === 0) {
      return callback && callback(null);
    }

    const item = queue.shift();
    const productId = item && item.productId != null ? Number(item.productId) : null;
    const quantity = item && item.quantity != null ? Number(item.quantity) : 0;
    const unitPrice = item && item.unitPrice != null ? Number(item.unitPrice) : 0;

    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      return next();
    }

    db.query(
      'INSERT INTO refund_items (refund_id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)',
      [refundId, orderId, productId, quantity, unitPrice],
      function (err) {
        if (err) {
          return callback && callback(err);
        }
        next();
      }
    );
  }

  next();
}

function getRefundedByOrder(orderId, callback) {
  const sql = `
    SELECT product_id, COALESCE(SUM(quantity), 0) AS refundedQty
    FROM refund_items
    WHERE order_id = ?
    GROUP BY product_id
  `;
  db.query(sql, [orderId], (err, rows) => {
    if (err) return callback(err);
    const map = {};
    (rows || []).forEach((row) => {
      map[String(row.product_id)] = Number(row.refundedQty || 0);
    });
    callback(null, map);
  });
}

function getByRefund(refundId, callback) {
  const sql = `
    SELECT product_id AS productId, quantity, unit_price AS unitPrice
    FROM refund_items
    WHERE refund_id = ?
  `;
  db.query(sql, [refundId], callback);
}

module.exports = { createMany, getRefundedByOrder, getByRefund };
