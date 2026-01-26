const db = require('../db');

function create(orderId, data, callback) {
  const payload = data || {};
  const amount = Number(payload.amount) || 0;
  const currency = payload.currency || 'SGD';
  const status = payload.status || 'UNKNOWN';
  const refundId = payload.paypalRefundId || null;
  const captureId = payload.paypalCaptureId || null;
  const createdAt = payload.createdAt || null;
  const refundReason = payload.refundReason != null ? String(payload.refundReason) : null;

  db.query(
    'INSERT INTO refunds (order_id, paypal_refund_id, paypal_capture_id, amount, currency, status, created_at, refund_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [orderId, refundId, captureId, amount, currency, status, createdAt, refundReason],
    (err, result) => {
      if (callback) {
        return callback(err, result ? result.insertId : null, result);
      }
    }
  );
}

function getAll(callback) {
  const sql = `
    SELECT r.id, r.order_id AS orderId, r.amount, r.currency, r.status, r.paypal_refund_id AS paypalRefundId,
           r.paypal_capture_id AS paypalCaptureId, r.created_at AS createdAt, r.refund_reason AS refundReason,
           o.invoice_number AS invoiceNumber, o.total, u.username, u.email
    FROM refunds r
    INNER JOIN orders o ON o.id = r.order_id
    INNER JOIN users u ON u.id = o.user_id
    ORDER BY r.created_at DESC
  `;
  db.query(sql, callback);
}

function getById(refundId, callback) {
  const sql = `
    SELECT r.id, r.order_id AS orderId, r.amount, r.currency, r.status, r.paypal_refund_id AS paypalRefundId,
           r.paypal_capture_id AS paypalCaptureId, r.created_at AS createdAt, r.refund_reason AS refundReason,
           o.invoice_number AS invoiceNumber, o.subtotal, o.tax_amount AS taxAmount, o.total, o.created_at AS orderCreatedAt,
           u.username, u.email, u.contact,
           (
             SELECT COALESCE(SUM(r2.amount), 0)
             FROM refunds r2
             WHERE r2.order_id = r.order_id
               AND (r2.created_at < r.created_at OR (r2.created_at = r.created_at AND r2.id <= r.id))
           ) AS refundedToDate
    FROM refunds r
    INNER JOIN orders o ON o.id = r.order_id
    INNER JOIN users u ON u.id = o.user_id
    WHERE r.id = ?
    LIMIT 1
  `;
  db.query(sql, [refundId], (err, rows) => {
    if (err) return callback(err);
    return callback(null, rows[0] || null);
  });
}

function getByUser(userId, callback) {
  const sql = `
    SELECT r.id, r.order_id AS orderId, r.amount, r.currency, r.status, r.created_at AS createdAt,
           o.invoice_number AS invoiceNumber, o.total, o.created_at AS orderCreatedAt, r.refund_reason AS refundReason
    FROM refunds r
    INNER JOIN orders o ON o.id = r.order_id
    WHERE o.user_id = ?
    ORDER BY r.created_at DESC
  `;
  db.query(sql, [userId], callback);
}

function getByIdForUser(refundId, userId, callback) {
  const sql = `
    SELECT r.id, r.order_id AS orderId, r.amount, r.currency, r.status, r.paypal_refund_id AS paypalRefundId,
           r.paypal_capture_id AS paypalCaptureId, r.created_at AS createdAt, r.refund_reason AS refundReason,
           o.invoice_number AS invoiceNumber, o.subtotal, o.tax_amount AS taxAmount, o.total, o.created_at AS orderCreatedAt,
           u.username, u.email, u.contact,
           (
             SELECT COALESCE(SUM(r2.amount), 0)
             FROM refunds r2
             WHERE r2.order_id = r.order_id
               AND (r2.created_at < r.created_at OR (r2.created_at = r.created_at AND r2.id <= r.id))
           ) AS refundedToDate
    FROM refunds r
    INNER JOIN orders o ON o.id = r.order_id
    INNER JOIN users u ON u.id = o.user_id
    WHERE r.id = ? AND o.user_id = ?
    LIMIT 1
  `;
  db.query(sql, [refundId, userId], (err, rows) => {
    if (err) return callback(err);
    return callback(null, rows[0] || null);
  });
}

function getTotalForOrder(orderId, callback) {
  const sql = `
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM refunds
    WHERE order_id = ?
  `;
  db.query(sql, [orderId], (err, rows) => {
    if (err) return callback(err);
    const total = rows && rows[0] ? Number(rows[0].total || 0) : 0;
    return callback(null, total);
  });
}

module.exports = { create, getAll, getById, getByUser, getByIdForUser, getTotalForOrder };
