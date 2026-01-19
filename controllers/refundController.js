const refundModel = require('../models/refundModel');

function view(res, name, data = {}) {
  return res.render(name, { ...data, user: res.locals.user });
}

module.exports = {
  list(req, res) {
    const userSession = req.session && req.session.user;
    const userId = userSession && (userSession.userId || userSession.id);

    if (!userId) {
      return res.redirect('/login');
    }

    refundModel.getByUser(userId, (err, refunds = []) => {
      if (err) {
        return res.status(500).send('Database error');
      }

      return view(res, 'refunds', { refunds });
    });
  },

  details(req, res) {
    const userSession = req.session && req.session.user;
    const userId = userSession && (userSession.userId || userSession.id);
    const refundId = Number(req.params.id);

    if (!userId || Number.isNaN(refundId)) {
      return res.redirect('/refunds');
    }

    refundModel.getByIdForUser(refundId, userId, (err, refund) => {
      if (err) {
        return res.status(500).send('Database error');
      }
      if (!refund) {
        return res.redirect('/refunds');
      }

      return view(res, 'refundInvoice', { refund });
    });
  }
};
