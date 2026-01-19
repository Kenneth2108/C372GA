const axios = require("axios");
const netsService = require("../services/nets");

exports.generateNETSQR = function(req, res) {
  return netsService.generateQrCode(req, res);
};

exports.renderSuccess = function(req, res) {
  res.render("netsTxnSuccessStatus", { message: "Transaction Successful!" });
};

exports.renderFail = function(req, res) {
  res.render("netsTxnFailStatus", { message: "Transaction Failed. Please try again." });
};

exports.ssePaymentStatus = function(req, res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  const txnRetrievalRef = req.params.txnRetrievalRef;

  let pollCount = 0;
  const maxPolls = 60;
  let frontendTimeoutStatus = 0;

  const interval = setInterval(async function() {
    pollCount++;

    try {
      const response = await axios.post(
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

  req.on("close", function() {
    clearInterval(interval);
  });
};
