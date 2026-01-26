const orderModel = require("../models/orderModel");
const refundModel = require("../models/refundModel");
const orderItemModel = require("../models/orderItemModel");
const productModel = require("../models/productModel");
const refundItemModel = require("../models/refundItemModel");
const refundInvoiceEmailService = require("../services/refundInvoiceEmailService");
const paypalRefund = require("../services/paypalRefund");
const stripeRefund = require("../services/stripeRefund");

function view(res, name, data = {}) {
  return res.render(name, { ...data, user: res.locals.user });
}

function popMessages(req) {
  return Array.isArray(req.session.messages)
    ? req.session.messages.splice(0)
    : [];
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

      orderItemModel.getByOrder(orderId, (err2, items = []) => {
        if (err2) return res.status(500).send("Database error");

        refundItemModel.getRefundedByOrder(orderId, (err3, refundedMap = {}) => {
          if (err3) return res.status(500).send("Database error");

          const total = Number(order.total || 0);
          const subtotal = Number(order.subtotal || 0);
          const refundedAmount = Number(order.refundedAmount || 0);
          const remainingAmount = Number((total - refundedAmount).toFixed(2));
          const priceMultiplier = subtotal > 0 ? total / subtotal : 1;

          const orderItems = items.map((item) => {
            const refundedQty = Number(refundedMap[String(item.productId)] || 0);
            const orderedQty = Number(item.quantity || 0);
            const remainingQty = Math.max(orderedQty - refundedQty, 0);
            const basePrice = Number(item.unitPrice || 0);
            const refundUnitPriceExact = basePrice * priceMultiplier;
            const refundUnitPrice = Number(refundUnitPriceExact.toFixed(2));
            return {
              ...item,
              refundedQty,
              remainingQty,
              refundUnitPrice,
              refundUnitPriceExact
            };
          });

          return view(res, "adminRefundOrder", {
            order,
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

    orderModel.getById(orderId, (err, order) => {
      if (err) return res.status(500).send("Database error");
      if (!order) return res.redirect("/admin/orders");

      const captureId = order.paypalCaptureId;
      const paymentMethod = String(order.paymentMethod || "").toLowerCase();
      const isPaypalOrder = paymentMethod === "paypal";
      const isStripeOrder = paymentMethod === "stripe";

      if ((!isPaypalOrder && !isStripeOrder) || !captureId) {
        req.session.messages = ["This order does not have a supported payment ID."];
        return res.redirect(`/admin/orders/${orderId}/refund`);
      }

      const total = Number(order.total);
      const refundedAmount = Number(order.refundedAmount || 0);
      const remainingAmount = Number((total - refundedAmount).toFixed(2));
      if (!Number.isFinite(total) || total <= 0) {
        req.session.messages = ["Invalid order total for refund."];
        return res.redirect(`/admin/orders/${orderId}/refund`);
      }

      if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) {
        req.session.messages = ["No refundable balance remaining."];
        return res.redirect(`/admin/orders/${orderId}/refund`);
      }

      orderItemModel.getByOrder(orderId, (err2, items = []) => {
        if (err2) return res.status(500).send("Database error");

        refundItemModel.getRefundedByOrder(orderId, async (err3, refundedMap = {}) => {
          if (err3) return res.status(500).send("Database error");

          let requestedAmount = 0;
          const restockItems = [];
          const refundItems = [];
          const subtotal = Number(order.subtotal || 0);
          const total = Number(order.total || 0);
          const priceMultiplier = subtotal > 0 ? total / subtotal : 1;
          const itemMap = new Map(
            items.map((item) => [String(item.productId), item])
          );

          if (isPartialRefund) {
            const rawProductIds = [].concat(req.body.refundProductId || []);
            const rawRestockQtys = [].concat(req.body.refundQtyRestock || []);
            const rawNoRestockQtys = [].concat(req.body.refundQtyNoRestock || []);
            let isValid = rawProductIds.length === rawRestockQtys.length
              && rawProductIds.length === rawNoRestockQtys.length;
            let isFullSelection = true;

            rawProductIds.forEach((productId, index) => {
              if (!isValid) return;
              const orderItem = itemMap.get(String(productId));
              if (!orderItem) {
                isValid = false;
                return;
              }

              const orderedQty = Number(orderItem.quantity) || 0;
              const refundedQty = Number(refundedMap[String(orderItem.productId)] || 0);
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
                const basePrice = Number(orderItem.unitPrice) || 0;
                const refundUnitPriceExact = basePrice * priceMultiplier;
                const refundUnitPrice = Number(refundUnitPriceExact.toFixed(2));
                requestedAmount += refundUnitPriceExact * totalQty;
                if (restockQty > 0) {
                  restockItems.push({ id: orderItem.productId, quantity: restockQty });
                }
                refundItems.push({
                  productId: orderItem.productId,
                  quantity: totalQty,
                  unitPrice: refundUnitPrice
                });
              }
            });

            requestedAmount = isFullSelection
              ? remainingAmount
              : Number(requestedAmount.toFixed(2));

            if (!isValid || refundItems.length === 0) {
              req.session.messages = ["Select valid quantities for a partial refund."];
              return res.redirect(`/admin/orders/${orderId}/refund`);
            }
          } else {
            requestedAmount = remainingAmount;
            items.forEach((item) => {
              const orderedQty = Number(item.quantity) || 0;
              const refundedQty = Number(refundedMap[String(item.productId)] || 0);
              const remainingQty = Math.max(orderedQty - refundedQty, 0);
              if (remainingQty > 0) {
                const basePrice = Number(item.unitPrice) || 0;
                const refundUnitPrice = Number((basePrice * priceMultiplier).toFixed(2));
                if (refundType === "full_restock") {
                  restockItems.push({ id: item.productId, quantity: remainingQty });
                }
                refundItems.push({
                  productId: item.productId,
                  quantity: remainingQty,
                  unitPrice: refundUnitPrice
                });
              }
            });
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
            let refundData = {};
            let refundStatus = "COMPLETED";
            let createdAt = new Date();
            let paypalRefundId = null;

            if (isStripeOrder) {
              const refund = await stripeRefund.refundPaymentIntent(captureId, requestedAmount);
              refundData = refund || {};
              refundStatus = refundData.status
                ? String(refundData.status).toUpperCase()
                : "COMPLETED";
              createdAt = refundData.created ? new Date(refundData.created * 1000) : new Date();
              paypalRefundId = refundData.id || null;
            } else {
              const result = await paypalRefund.refundCapture(captureId, requestedAmount, "SGD");
              if (!(result.status >= 200 && result.status < 300)) {
                const errorInfo = result.data && result.data.message
                  ? result.data.message
                  : "PayPal refund failed.";
                req.session.messages = [errorInfo];
                return res.redirect(`/admin/orders/${orderId}/refund`);
              }
              refundData = result.data || {};
              refundStatus = refundData.status || "COMPLETED";
              paypalRefundId = refundData.id || null;
              createdAt = refundData.create_time
                ? new Date(refundData.create_time)
                : new Date();
            }

            refundModel.create(orderId, {
              amount: requestedAmount,
              currency: "SGD",
              status: refundStatus,
              paypalRefundId,
              paypalCaptureId: captureId,
              createdAt,
              refundReason
            }, (err4, refundId) => {
                if (err4) {
                  req.session.messages = ["Refund sent, but failed to store history."];
                  return res.redirect("/admin/orders");
                }

                refundItemModel.createMany(refundId, orderId, refundItems, (err5) => {
                  if (err5) {
                    req.session.messages = ["Refund sent, but failed to store item history."];
                    return res.redirect("/admin/orders");
                  }

                  orderModel.addRefundedAmount(orderId, requestedAmount, (err6) => {
                    if (err6) {
                      req.session.messages = ["Refund sent, but failed to store balance."];
                      return res.redirect("/admin/orders");
                    }

                    const sendRefundEmail = () => {
                      // REFUND INVOICE EMAIL: send after successful refund.
                      refundModel.getById(refundId, (err7, refundRecord) => {
                        if (err7 || !refundRecord) {
                          req.session.messages = ["Refund submitted to PayPal."];
                          return res.redirect("/admin/orders");
                        }
                        const recipient = refundRecord.email;
                        if (!recipient) {
                          req.session.messages = ["Refund submitted to PayPal."];
                          return res.redirect("/admin/orders");
                        }
                        refundItemModel.getByRefund(refundId, async (err8, refundItemsList = []) => {
                          if (err8) {
                            req.session.messages = ["Refund submitted to PayPal."];
                            return res.redirect("/admin/orders");
                          }
                          try {
                            console.log("Refund email auto-send to:", recipient);
                            const info = await refundInvoiceEmailService.sendRefundInvoiceEmail({
                              refund: refundRecord,
                              refundItems: refundItemsList,
                              to: recipient
                            });
                            console.log("Refund email auto-send result:", info && info.messageId ? info.messageId : info);
                          } catch (emailError) {
                            console.error("Refund email error:", emailError);
                          }
                          req.session.messages = ["Refund submitted to PayPal."];
                          return res.redirect("/admin/orders");
                        });
                      });
                    };

                    if (!restockItems.length) {
                      sendRefundEmail();
                      return;
                    }

                    productModel.increaseQuantities(restockItems, (err7) => {
                      if (err7) {
                        req.session.messages = ["Refund submitted, but failed to restock items."];
                        return res.redirect("/admin/orders");
                      }
                      sendRefundEmail();
                    });
                  });
                });
              });
            return;
          } catch (error) {
            console.error("Refund error:", error);
            req.session.messages = ["Refund failed."];
            return res.redirect(`/admin/orders/${orderId}/refund`);
          }
        });
      });
    });
  }
};
