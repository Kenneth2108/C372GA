const refundModel = require('../models/refundModel');
const refundItemModel = require('../models/refundItemModel');
const { sendRefundInvoiceEmail } = require('../services/refundInvoiceEmailService');

function view(res, name, data = {}) {
  return res.render(name, { ...data, user: res.locals.user });
}

function addMessage(req, message) {
  if (!req.session) return;
  const next = Array.isArray(req.session.messages) ? req.session.messages : [];
  next.push(message);
  req.session.messages = next;
}

function popMessages(req) {
  const messages = Array.isArray(req.session.messages)
    ? [...req.session.messages]
    : [];
  req.session.messages = [];
  return messages;
}

module.exports = {
  list(req, res) {
    const messages = popMessages(req);

    refundModel.getAll((err, refunds = []) => {
      if (err) {
        return res.status(500).send('Database error');
      }

      return view(res, 'adminRefunds', { refunds, messages });
    });
  },

  details(req, res) {
    const refundId = Number(req.params.id);
    if (Number.isNaN(refundId)) {
      return res.redirect('/admin/refunds');
    }

    const messages = popMessages(req);

    refundModel.getById(refundId, (err, refund) => {
      if (err) {
        return res.status(500).send('Database error');
      }
      if (!refund) {
        return res.redirect('/admin/refunds');
      }

      refundItemModel.getByRefund(refundId, (itemsErr, refundItems = []) => {
        if (itemsErr) {
          return res.status(500).send('Database error');
        }
        return view(res, 'adminRefundInvoice', { refund, refundItems, messages });
      });
    });
  }


  ,sendEmail(req, res) {
    const refundId = Number(req.params.id);
    if (Number.isNaN(refundId)) {
      addMessage(req, 'Invalid refund ID.');
      return res.redirect('/admin/refunds');
    }

    refundModel.getById(refundId, (err, refund) => {
      if (err) {
        addMessage(req, 'Unable to send refund invoice email.');
        return res.redirect('/admin/refunds');
      }
      if (!refund) {
        addMessage(req, 'Refund not found.');
        return res.redirect('/admin/refunds');
      }
      if (!refund.email) {
        addMessage(req, 'Customer email not available.');
        return res.redirect(`/admin/refunds/${refundId}`);
      }

      refundItemModel.getByRefund(refundId, (itemsErr, refundItems = []) => {
        if (itemsErr) {
          addMessage(req, 'Unable to load refund items.');
          return res.redirect(`/admin/refunds/${refundId}`);
        }

        sendRefundInvoiceEmail({ refund, refundItems, to: refund.email })
          .then(() => {
            addMessage(req, 'Refund invoice email sent.');
            return res.redirect(`/admin/refunds/${refundId}`);
          })
          .catch((mailErr) => {
            console.error('Refund invoice email send error:', mailErr);
            addMessage(req, 'Unable to send refund invoice email.');
            return res.redirect(`/admin/refunds/${refundId}`);
          });
      });
    });
  }
};
