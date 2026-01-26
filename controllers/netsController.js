const axios = require("axios");
const netsService = require("../services/nets");

// Adjust these paths to match your project (common ones shown)
const CartItems = require("../models/CartItem");        // or ../models/cartModel
const Orders = require("../models/orderModel");         // or ../models/Order

function getUserId(req) {
  const user = req.session && req.session.user;
  return user && (user.userId || user.id);
}

function normalizeCartItems(cartItems) {
  return (cartItems || []).map(function (item) {
    const price = item.price != null ? Number(item.price) : 0;
    const quantity = item.quantity != null ? Number(item.quantity) : 0;

    return {
      // keep whatever your orderModel expects
      product_id: item.product_id || item.productId || item.id,
      productName: item.productName || item.name || "",
      price: price,
      quantity: quantity,
      lineTotal: price * quantity
    };
  });
}

function buildSummary(items) {
  const subtotal = (items || []).reduce(function (sum, it) {
    return sum + (it.lineTotal || 0);
  }, 0);

  // If your project uses a different tax rate, change here
  const taxRate = 0.09;
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount;

  return { subtotal: subtotal, taxRate: taxRate, taxAmount: taxAmount, total: total };
}

function buildInvoiceMeta() {
  return { number: "INV-" + Date.now(), date: new Date().toISOString() };
}

function queryNetsStatus(txnRetrievalRef, frontendTimeoutStatus) {
  return axios.post(
    "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query",
    { txn_retrieval_ref: txnRetrievalRef, frontend_timeout_status: frontendTimeoutStatus },
    {
      headers: {
        "api-key": process.env.API_KEY,
        "project-id": process.env.PROJECT_ID,
        "Content-Type": "application/json"
      }
    }
  );
}

// 1) Generate QR + store cart snapshot in session
exports.generateNETSQR = function (req, res) {
  const userId = getUserId(req);
  if (!userId) {
    req.flash("error", "Please log in to continue checkout.");
    return res.redirect("/login");
  }

  CartItems.getByUserId(userId, function (err, cartItems) {
    if (err) {
      console.error("NETS generate QR - load cart error:", err);
      req.flash("error", "Unable to load cart.");
      return res.redirect("/cart");
    }

    if (!cartItems || cartItems.length === 0) {
      req.flash("error", "Your cart is empty.");
      return res.redirect("/cart");
    }

    const items = normalizeCartItems(cartItems);
    const summary = buildSummary(items);
    const invoiceMeta = buildInvoiceMeta();

    // Save the "pending checkout" in session so success route can use it
    req.session.pendingCheckout = {
      items: items,
      summary: summary,
      invoiceMeta: invoiceMeta,
      paymentMethod: "nets"
    };

    // IMPORTANT: do not trust totals from the browser.
    // If netsService reads req.body.cartTotal, override it server-side:
    req.body.cartTotal = summary.total.toFixed(2);

    return netsService.generateQrCode(req, res);
  });
};

// 2) On success page: verify payment, then create order + deduct stock + clear cart
exports.renderSuccess = async function (req, res) {
  const userId = getUserId(req);
  if (!userId) {
    req.flash("error", "Please log in to continue.");
    return res.redirect("/login");
  }

  const txnRetrievalRef = req.query && req.query.txn_retrieval_ref ? String(req.query.txn_retrieval_ref) : "";
  const pending = req.session && req.session.pendingCheckout;

  if (!txnRetrievalRef) {
    req.flash("error", "Missing transaction reference.");
    return res.redirect("/checkout");
  }

  if (!pending || !pending.items || pending.items.length === 0) {
    req.flash("error", "Checkout session expired. Please try again.");
    return res.redirect("/checkout");
  }

  // Prevent double deduction if user refreshes success URL
  if (req.session.lastCompletedNetsTxn && req.session.lastCompletedNetsTxn === txnRetrievalRef) {
    // If you have invoice route, go there. Otherwise render success page.
    return res.redirect("/invoice");
  }

  // Re-verify NETS status server-side before finalizing
  try {
    const verifyResp = await queryNetsStatus(txnRetrievalRef, 0);
    const data = verifyResp.data && verifyResp.data.result && verifyResp.data.result.data
      ? verifyResp.data.result.data
      : null;

    const isPaid = data && data.response_code == "00" && data.txn_status === 1;

    if (!isPaid) {
      return res.render("netsTxnFailStatus", { message: "Payment not confirmed. Please try again." });
    }
  } catch (e) {
    console.error("NETS verify error:", e);
    return res.render("netsTxnFailStatus", { message: "Unable to verify payment. Please try again." });
  }

  // FINALIZE: create order -> deduct stock -> clear cart
  Orders.createOrder(
    {
      userId: userId,
      subtotal: pending.summary.subtotal,
      taxAmount: pending.summary.taxAmount,
      total: pending.summary.total,
      invoiceNumber: pending.invoiceMeta.number,
      paymentMethod: "NETS" // optional, if your DB supports it
    },
    pending.items,
    function (orderErr) {
      if (orderErr) {
        console.error("NETS finalize order error:", orderErr);
        req.flash("error", "Unable to finalize order: " + (orderErr.message || ""));
        return res.redirect("/cart");
      }

      CartItems.clear(userId, function (clearErr) {
        if (clearErr) console.error("NETS clear cart error:", clearErr);

        // Save invoice session (if your invoice page reads from session)
        req.session.invoiceData = {
          items: pending.items,
          summary: pending.summary,
          invoiceMeta: pending.invoiceMeta,
          paymentMethod: pending.paymentMethod || "nets"
        };

        // Mark txn as completed and clear pending checkout
        req.session.lastCompletedNetsTxn = txnRetrievalRef;
        delete req.session.pendingCheckout;

        // Redirect to invoice/orders page (choose what your app uses)
        return res.redirect("/invoice");
        // or: return res.redirect("/orders");
        // or: return res.render("netsTxnSuccessStatus", { message: "Transaction Successful!" });
      });
    }
  );
};

exports.renderFail = function (req, res) {
  res.render("netsTxnFailStatus", { message: "Transaction Failed. Please try again." });
};

// 3) SSE polling remains (but you can keep it)
exports.ssePaymentStatus = function (req, res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  const txnRetrievalRef = req.params.txnRetrievalRef;

  let pollCount = 0;
  const maxPolls = 60;
  let frontendTimeoutStatus = 0;

  const interval = setInterval(async function () {
    pollCount++;

    try {
      const response = await queryNetsStatus(txnRetrievalRef, frontendTimeoutStatus);

      const data = response.data && response.data.result && response.data.result.data
        ? response.data.result.data
        : null;

      if (data && data.response_code == "00" && data.txn_status === 1) {
        res.write("data: " + JSON.stringify({ success: true }) + "\n\n");
        clearInterval(interval);
        return res.end();
      }

      res.write("data: " + JSON.stringify({ pending: true }) + "\n\n");
    } catch (err) {
      clearInterval(interval);
      res.write("data: " + JSON.stringify({ fail: true, error: err.message }) + "\n\n");
      return res.end();
    }

    if (pollCount >= maxPolls) {
      frontendTimeoutStatus = 1;
      clearInterval(interval);
      res.write("data: " + JSON.stringify({ fail: true, error: "Timeout" }) + "\n\n");
      return res.end();
    }
  }, 5000);

  req.on("close", function () {
    clearInterval(interval);
  });
};
