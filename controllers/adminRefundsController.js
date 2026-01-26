const refundModel = require('../models/refundModel');
const refundItemModel = require('../models/refundItemModel');

function view(res, name, data = {}) {
  return res.render(name, { ...data, user: res.locals.user });
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
};
