const db = require('../db');

function getOrdersSummary(start, end, callback) {
  const sql = `
    SELECT
      COUNT(*) AS orderCount,
      COALESCE(SUM(total), 0) AS grossRevenue,
      COALESCE(AVG(total), 0) AS avgOrderValue
    FROM orders
    WHERE created_at BETWEEN ? AND ?
  `;
  db.query(sql, [start, end], (err, rows) => {
    if (err) return callback(err);
    return callback(null, rows && rows[0] ? rows[0] : { orderCount: 0, grossRevenue: 0, avgOrderValue: 0 });
  });
}

function getRefundsSummary(start, end, callback) {
  const sql = `
    SELECT COALESCE(SUM(amount), 0) AS refundsTotal
    FROM refunds
    WHERE created_at BETWEEN ? AND ?
  `;
  db.query(sql, [start, end], (err, rows) => {
    if (err) return callback(err);
    return callback(null, rows && rows[0] ? rows[0] : { refundsTotal: 0 });
  });
}

function getDailyRevenue(start, end, callback) {
  const sql = `
    SELECT
      DATE(created_at) AS day,
      COUNT(*) AS orderCount,
      COALESCE(SUM(total), 0) AS revenue
    FROM orders
    WHERE created_at BETWEEN ? AND ?
    GROUP BY DATE(created_at)
    ORDER BY day ASC
  `;
  db.query(sql, [start, end], callback);
}

function getPaymentBreakdown(start, end, callback) {
  const sql = `
    SELECT payment_label AS payment, COUNT(*) AS orderCount, COALESCE(SUM(total), 0) AS revenue
    FROM (
      SELECT
        CASE
          WHEN o.payment_method IS NOT NULL AND o.payment_method != '' THEN UPPER(o.payment_method)
          WHEN o.paypal_capture_id IS NOT NULL THEN 'PAYPAL'
          ELSE 'NETS'
        END AS payment_label,
        o.total
      FROM orders o
      WHERE o.created_at BETWEEN ? AND ?
    ) AS payments
    GROUP BY payment_label
    ORDER BY revenue DESC
  `;
  db.query(sql, [start, end], callback);
}

function getTopProducts(start, end, limit, callback) {
  const sql = `
    SELECT
      oi.product_id AS productId,
      oi.product_name AS productName,
      COALESCE(SUM(oi.quantity), 0) AS totalQty,
      COALESCE(SUM(oi.line_total), 0) AS revenue
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at BETWEEN ? AND ?
    GROUP BY oi.product_id, oi.product_name
    ORDER BY revenue DESC
    LIMIT ?
  `;
  db.query(sql, [start, end, limit], callback);
}

module.exports = {
  getOrdersSummary,
  getRefundsSummary,
  getDailyRevenue,
  getPaymentBreakdown,
  getTopProducts
};
