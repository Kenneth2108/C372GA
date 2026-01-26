const orderModel = require("../models/orderModel");
const refundModel = require("../models/refundModel");
const productModel = require("../models/productModel");
const refundItemModel = require("../models/refundItemModel");
const paypalRefund = require("../services/paypalRefund");
const stripeRefund = require("../services/stripeRefund");

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

function formatPaypalError(result) {
  const data = result && result.data ? result.data : {};
  const messageParts = [];
  if (data.message) {
    messageParts.push(String(data.message));
  }
  if (data.name) {
    messageParts.push(`(${data.name})`);
  }
  if (Array.isArray(data.details) && data.details.length) {
    const detailText = data.details
      .map((detail) => {
        if (!detail) return null;
        const issue = detail.issue ? String(detail.issue) : '';
        const description = detail.description ? String(detail.description) : '';
        if (issue && description) return `${issue}: ${description}`;
        return issue || description || null;
      })
      .filter(Boolean);
    if (detailText.length) {
      messageParts.push(detailText.join(' | '));
    }
  }
  if (data.debug_id) {
    messageParts.push(`Debug ID: ${data.debug_id}`);
  }
  const message = messageParts.join(' ').trim();
  return message || 'PayPal refund failed.';
}

function parsePaypalAmount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

      const paymentMethod = String(order.payment_method || order.paymentMethod || "").toLowerCase();
      const isStripeOrder = paymentMethod === "stripe";

      refundModel.getTotalForOrder(orderId, (sumErr, refundedAmount) => {
        if (sumErr) return res.status(500).send("Database error");

        refundItemModel.getRefundedByOrder(orderId, async (itemsErr, refundedMap = {}) => {
          if (itemsErr) return res.status(500).send("Database error");

          const total = Number(order.total || 0);
          const subtotal = Number(order.subtotal || 0);
          const remainingAmount = Number((total - Number(refundedAmount || 0)).toFixed(2));
          const priceMultiplier = subtotal > 0 ? total / subtotal : 1;
          const items = Array.isArray(order.items) ? order.items : [];

          const orderItems = items.map((item) => {
            const orderedQty = Number(item.quantity || 0);
            const refundedQty = Number(refundedMap[String(item.product_id || item.productId)] || 0);
            const remainingQty = Math.max(orderedQty - refundedQty, 0);
            const basePrice = Number(item.price || 0);
            const refundUnitPriceExact = basePrice * priceMultiplier;
            const refundUnitPrice = Number(refundUnitPriceExact.toFixed(2));
            return {
              productId: item.product_id || item.productId,
              productName: item.product_name || item.productName,
              quantity: orderedQty,
              unitPrice: basePrice,
              refundedQty,
              remainingQty,
              refundUnitPrice,
              refundUnitPriceExact
            };
          });

          return view(res, "adminRefundOrder", {
            order: {
              ...order,
              invoiceNumber: order.invoiceNumber || order.invoice_number,
              paymentMethod: paymentMethod
            },
            orderItems,
            messages,
            remainingAmount: Number.isFinite(remainingAmount) ? remainingAmount : 0
          });
        });
      });
    });
  },

  async refund(req, res) {
    const orderId = Number(req.params.id);
    if (Number.isNaN(orderId)) {
      return res.redirect("/admin/orders");
    }

    const refundType = String(req.body.refundType || "full_restock").toLowerCase();
    const refundReason = typeof req.body.refundReason === "string"
      ? req.body.refundReason.trim()
      : "";
    const isPartialRefund = refundType === "custom";

    orderModel.getById(orderId, async (err, order) => {
      if (err) return res.status(500).send("Database error");
      if (!order) return res.redirect("/admin/orders");

      const paymentMethod = String(order.payment_method || order.paymentMethod || "").toLowerCase();
      const isStripeOrder = paymentMethod === "stripe";
      const captureId = isStripeOrder
        ? (order.stripe_payment_intent_id || order.stripePaymentIntentId)
        : (order.paypal_capture_id || order.paypalCaptureId);

      if (!captureId) {
        req.session.messages = [
          isStripeOrder
            ? "This order does not have a Stripe payment intent ID."
            : "This order does not have a PayPal capture ID."
        ];
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

        refundItemModel.getRefundedByOrder(orderId, async (itemsErr, refundedMap = {}) => {
          if (itemsErr) {
            return res.status(500).send("Database error");
          }

          const items = Array.isArray(order.items) ? order.items : [];
          const subtotal = Number(order.subtotal || 0);
          const priceMultiplier = subtotal > 0 ? total / subtotal : 1;
          const itemMap = new Map(
            items.map((item) => [String(item.product_id || item.productId), item])
          );

          let requestedAmount = 0;
          const restockItems = [];
          const refundSelections = [];
          let isFullSelection = true;

          if (isPartialRefund) {
            const rawProductIds = [].concat(req.body.refundProductId || []);
            const rawRestockQtys = [].concat(req.body.refundQtyRestock || []);
            const rawNoRestockQtys = [].concat(req.body.refundQtyNoRestock || []);
            let isValid = rawProductIds.length === rawRestockQtys.length
              && rawProductIds.length === rawNoRestockQtys.length;

            rawProductIds.forEach((productId, index) => {
              if (!isValid) return;
              const orderItem = itemMap.get(String(productId));
              if (!orderItem) {
                isValid = false;
                return;
              }

              const orderedQty = Number(orderItem.quantity) || 0;
              const refundedQty = Number(refundedMap[String(productId)] || 0);
              const remainingQty = Math.max(orderedQty - refundedQty, 0);
              const restockQty = Number(rawRestockQtys[index]) || 0;
              const noRestockQty = Number(rawNoRestockQtys[index]) || 0;
              const totalQty = restockQty + noRestockQty;
              const isWholeNumber = Number.isInteger(restockQty) && Number.isInteger(noRestockQty);

              if (!Number.isFinite(restockQty) || !Number.isFinite(noRestockQty)
                || !isWholeNumber || restockQty < 0 || noRestockQty < 0
                || totalQty > remainingQty) {
                isValid = false;
                return;
              }

              if (totalQty !== remainingQty) {
                isFullSelection = false;
              }

              if (totalQty > 0) {
                const basePrice = Number(orderItem.price) || 0;
                const refundUnitPriceExact = basePrice * priceMultiplier;
                const refundUnitPrice = Number(refundUnitPriceExact.toFixed(2));
                requestedAmount += refundUnitPriceExact * totalQty;
                if (restockQty > 0) {
                  restockItems.push({ id: orderItem.product_id || orderItem.productId, quantity: restockQty });
                }
                refundSelections.push({
                  productId: orderItem.product_id || orderItem.productId,
                  quantity: totalQty,
                  unitPrice: refundUnitPrice
                });
              }
            });

            requestedAmount = isFullSelection
              ? remainingAmount
              : Number(requestedAmount.toFixed(2));

            if (!isValid || refundSelections.length === 0) {
              req.session.messages = ["Select valid quantities for a partial refund."];
              return res.redirect(`/admin/orders/${orderId}/refund`);
            }
          } else {
            items.forEach((item) => {
              const orderedQty = Number(item.quantity) || 0;
              const refundedQty = Number(refundedMap[String(item.product_id || item.productId)] || 0);
              const remainingQty = Math.max(orderedQty - refundedQty, 0);
              if (remainingQty > 0) {
                const basePrice = Number(item.price) || 0;
                const refundUnitPriceExact = basePrice * priceMultiplier;
                const refundUnitPrice = Number(refundUnitPriceExact.toFixed(2));
                requestedAmount += refundUnitPriceExact * remainingQty;
                if (refundType === "full_restock") {
                  restockItems.push({ id: item.product_id || item.productId, quantity: remainingQty });
                }
                refundSelections.push({
                  productId: item.product_id || item.productId,
                  quantity: remainingQty,
                  unitPrice: refundUnitPrice
                });
              }
            });

            if (refundSelections.length === 0) {
              req.session.messages = ["No refundable items remaining."];
              return res.redirect(`/admin/orders/${orderId}/refund`);
            }
            requestedAmount = remainingAmount;
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
            if (isStripeOrder) {
              const refund = await stripeRefund.refundPaymentIntent(captureId, requestedAmount);
              const createdAt = refund && refund.created
                ? new Date(refund.created * 1000)
                : new Date();

              refundModel.create(orderId, {
                amount: requestedAmount,
                currency: (refund && refund.currency) ? String(refund.currency).toUpperCase() : "SGD",
                status: refund && refund.status ? String(refund.status).toUpperCase() : "COMPLETED",
                paypalRefundId: refund && refund.id ? String(refund.id) : null,
                paypalCaptureId: captureId,
                createdAt,
                refundReason
              }, (err2, refundId) => {
                if (err2) {
                  req.session.messages = ["Refund sent, but failed to store history."];
                  return res.redirect("/admin/orders");
                }

                refundItemModel.createMany(refundId, orderId, refundSelections, (err3) => {
                  if (err3) {
                    req.session.messages = ["Refund sent, but failed to store item history."];
                    return res.redirect("/admin/orders");
                  }

                  if (!restockItems.length) {
                    return res.redirect("/admin/orders");
                  }

                  productModel.increaseQuantities(restockItems, (err4) => {
                    if (err4) {
                      req.session.messages = ["Refund submitted, but failed to restock items."];
                      return res.redirect("/admin/orders");
                    }
                    return res.redirect("/admin/orders");
                  });
                });
              });
              return;
            }

            const captureDetails = await paypalRefund.getCaptureDetails(captureId);
            if (captureDetails.status >= 200 && captureDetails.status < 300) {
              const data = captureDetails.data || {};
              const captureAmount = parsePaypalAmount(data.amount && data.amount.value);
              const refundedAmount = parsePaypalAmount(
                data.seller_receivable_breakdown
                  && data.seller_receivable_breakdown.total_refunded_amount
                  && data.seller_receivable_breakdown.total_refunded_amount.value
              );
              if (Number.isFinite(captureAmount)) {
                const refunded = Number.isFinite(refundedAmount) ? refundedAmount : 0;
                const remainingCapture = Number((captureAmount - refunded).toFixed(2));
                if (requestedAmount > remainingCapture) {
                  req.session.messages = [
                    `PayPal shows only $${remainingCapture.toFixed(2)} remaining for this capture.`
                  ];
                  return res.redirect(`/admin/orders/${orderId}/refund`);
                }
              }
            }

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
                createdAt,
                refundReason
              }, (err2, refundId) => {
                if (err2) {
                  req.session.messages = ["Refund sent, but failed to store history."];
                  return res.redirect("/admin/orders");
                }

                refundItemModel.createMany(refundId, orderId, refundSelections, (err3) => {
                  if (err3) {
                    req.session.messages = ["Refund sent, but failed to store item history."];
                    return res.redirect("/admin/orders");
                  }

                  if (!restockItems.length) {
                    return res.redirect("/admin/orders");
                  }

                  productModel.increaseQuantities(restockItems, (err4) => {
                    if (err4) {
                      req.session.messages = ["Refund submitted, but failed to restock items."];
                      return res.redirect("/admin/orders");
                    }
                    return res.redirect("/admin/orders");
                  });
                });
              });
              return;
            }

            console.error("PayPal refund error response:", {
              status: result.status,
              data: result.data
            });
            req.session.messages = [formatPaypalError(result)];
            return res.redirect(`/admin/orders/${orderId}/refund`);
          } catch (error) {
            console.error("Refund error:", error);
            req.session.messages = [isStripeOrder ? "Stripe refund failed." : "PayPal refund failed."];
            return res.redirect(`/admin/orders/${orderId}/refund`);
          }
        });
      });
    });
  }
};
