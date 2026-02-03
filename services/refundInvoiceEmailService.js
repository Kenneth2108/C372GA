const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');

// REFUND INVOICE EMAIL: render and send a refund invoice email.
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false') === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP configuration missing.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

async function renderRefundInvoiceEmail({ refund, refundItems }) {
  const refundedToDate = Number(refund.refundedToDate || 0);
  const orderTotal = Number(refund.total || 0);
  const remaining = Math.max(0, orderTotal - refundedToDate);
  const templatePath = path.join(__dirname, '..', 'views', 'emails', 'refundInvoiceEmail.ejs');

  return ejs.renderFile(templatePath, {
    refund,
    refundItems,
    orderTotal,
    refundedToDate,
    remaining
  });
}

async function sendRefundInvoiceEmail({ refund, refundItems, to }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) throw new Error('SMTP_FROM or SMTP_USER is required.');
  if (!to) throw new Error('Recipient email missing.');

  const transporter = createTransporter();
  const html = await renderRefundInvoiceEmail({ refund, refundItems });
  const subject = `Refund Invoice ${refund.invoiceNumber || ''}`.trim();

  return transporter.sendMail({ from, to, subject, html });
}

module.exports = { sendRefundInvoiceEmail };
