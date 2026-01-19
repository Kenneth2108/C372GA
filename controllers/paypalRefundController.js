const orderModel = require("../models/orderModel");
const refundModel = require("../models/refundModel");
const paypalRefund = require("../services/paypalRefund");

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
  show(req, res) {
    const orderId = Number(req.params.id);
    if (Number.isNaN(orderId)) {
      return res.redirect("/admin/orders");
    }

    const messages = popMessages(req);

    orderModel.getById(orderId, (err, order) => {
      if (err) return res.status(500).send("Database error");
      if (!order) return res.redirect("/admin/orders");

      const total = Number(order.total || 0);
      refundModel.getTotalForOrder(orderId, (sumErr, refundedAmount) => {
        if (sumErr) return res.status(500).send("Database error");
        const remainingAmount = Number((total - Number(refundedAmount || 0)).toFixed(2));

        return view(res, "adminRefundOrder", {
          order,
          messages,
          remainingAmount: Number.isFinite(remainingAmount) ? remainingAmount : 0
        });
      });
    });
  },

  async refund(req, res) {
    const orderId = Number(req.params.id);
    if (Number.isNaN(orderId)) {
      return res.redirect("/admin/orders");
    }

    const requestedAmount = Number(req.body.amount);

    orderModel.getById(orderId, async (err, order) => {
      if (err) return res.status(500).send("Database error");
      if (!order) return res.redirect("/admin/orders");

      const captureId = order.paypal_capture_id || order.paypalCaptureId;

      if (!captureId) {
        req.session.messages = ["This order does not have a PayPal capture ID."];
        return res.redirect(`/admin/orders/${orderId}/refund`);
      }

      const total = Number(order.total);
      if (!Number.isFinite(total) || total <= 0) {
        req.session.messages = ["Invalid order total for refund."];
        return res.redirect(`/admin/orders/${orderId}/refund`);
      }

      refundModel.getTotalForOrder(orderId, async (sumErr, refundedAmount) => {
        if (sumErr) {
          return res.status(500).send("Database error");
        }

        const remainingAmount = Number((total - Number(refundedAmount || 0)).toFixed(2));
        if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) {
          req.session.messages = ["No refundable balance remaining."];
          return res.redirect(`/admin/orders/${orderId}/refund`);
        }

        if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
          req.session.messages = ["Refund amount must be greater than 0."];
          return res.redirect(`/admin/orders/${orderId}/refund`);
        }

        if (requestedAmount > remainingAmount) {
          req.session.messages = ["Refund amount cannot exceed remaining balance."];
          return res.redirect(`/admin/orders/${orderId}/refund`);
        }

        try {
          const result = await paypalRefund.refundCapture(captureId, requestedAmount, "SGD");
          if (result.status >= 200 && result.status < 300) {
            const refundData = result.data || {};
            const createdAt = refundData.create_time
              ? new Date(refundData.create_time)
              : new Date();

            refundModel.create(orderId, {
              amount: requestedAmount,
              currency: "SGD",
              status: refundData.status || "COMPLETED",
              paypalRefundId: refundData.id,
              paypalCaptureId: captureId,
              createdAt
            }, (err2) => {
            if (err2) {
              req.flash("error", "Refund sent, but failed to store history.");
              return res.redirect("/admin/orders");
            }

            req.flash("success", "Refund submitted to PayPal.");
            return res.redirect("/admin/orders");
            });
            return;
          }

          const errorInfo = result.data && result.data.message
            ? result.data.message
            : "PayPal refund failed.";
          req.session.messages = [errorInfo];
          return res.redirect(`/admin/orders/${orderId}/refund`);
        } catch (error) {
          console.error("PayPal refund error:", error);
          req.session.messages = ["PayPal refund failed."];
          return res.redirect(`/admin/orders/${orderId}/refund`);
        }
      });
    });
  }
};
