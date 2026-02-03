const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');

// ORDER INVOICE EMAIL: render and send an order invoice email.
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

async function renderOrderInvoiceEmail({ order, items }) {
  const templatePath = path.join(__dirname, '..', 'views', 'emails', 'orderInvoiceEmail.ejs');
  return ejs.renderFile(templatePath, { order, items });
}

async function sendOrderInvoiceEmail({ order, items, to }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) throw new Error('SMTP_FROM or SMTP_USER is required.');
  if (!to) throw new Error('Recipient email missing.');

  const transporter = createTransporter();
  const html = await renderOrderInvoiceEmail({ order, items });
  const subject = `Order Invoice ${order.invoiceNumber || ''}`.trim();

  return transporter.sendMail({ from, to, subject, html });
}

module.exports = { sendOrderInvoiceEmail };
