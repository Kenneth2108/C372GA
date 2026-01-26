//(Kenneth Start) 
const express = require('express');
const userCtrl = require('./controllers/userController');
const checkoutCtrl = require('./controllers/checkoutController');
const paymentCtrl = require('./controllers/paymentController');
const stripeCtrl = require('./controllers/stripeController');
const paypalRefundCtrl = require('./controllers/paypalstripeRefundController');
const reportsCtrl = require('./controllers/adminReportsController');
const adminRefundsCtrl = require('./controllers/adminRefundsController');
const refundCtrl = require('./controllers/refundController');
const orderCtrl = require('./controllers/orderController');
const contactCtrl = require('./controllers/contactController');

//(Kenneth End) 


//(Isaac Start )
const productCtrl = require('./controllers/productController');
const netsController = require("./controllers/netsController");
require("dotenv").config();
//(Isaac End )


//(Kenneth Start) 
const connection = require('./db');
const app = express();
const {
  registerMiddleware,
  checkAuthenticated,
  checkAdmin,
  checkUser,
  blockAdminFromUserPages,
  upload
} = require('./middleware');
// Stripe webhook needs raw body before urlencoded middleware
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), stripeCtrl.handleWebhook);
// Register common middleware (views, static, session, flash)
registerMiddleware(app);
//(Kenneth End)


//(Thrish Start)
const CartItemsController = require('./controllers/CartItemController');
//(Thrish End)

//(Kenneth Start 
/* ---------- Checkout ---------- */
app.get('/checkout', checkAuthenticated, checkUser, paymentCtrl.showPaymentOptions);
app.post('/checkout/paypal/create-order', checkAuthenticated, checkUser, paymentCtrl.createPaypalOrder);
app.post('/checkout/paypal/capture', checkAuthenticated, checkUser, paymentCtrl.capturePaypalOrder);
app.post('/checkout/stripe/create-session', checkAuthenticated, checkUser, stripeCtrl.createCheckoutSession);
app.get('/checkout/stripe/success', checkAuthenticated, checkUser, stripeCtrl.handleSuccess);
app.get('/checkout/stripe/cancel', checkAuthenticated, checkUser, stripeCtrl.handleCancel);
app.get('/invoice', checkAuthenticated, checkUser, checkoutCtrl.showInvoice);
app.get('/orders', checkAuthenticated, checkUser, orderCtrl.listUserOrders);
app.get('/orders/:id/invoice', checkAuthenticated, checkUser, orderCtrl.showUserInvoice);
app.get('/refunds', checkAuthenticated, checkUser, refundCtrl.list);
app.get('/refunds/:id', checkAuthenticated, checkUser, refundCtrl.details);

/* ---------- Core pages ---------- */
// Home
app.get('/', userCtrl.home);

// Contact
app.get('/contact', contactCtrl.showContact);

/* ---------- Register ---------- */
// GET register — show form + (optional) 2FA QR during registration
app.get('/register', userCtrl.showRegister);

// POST register — SHA1 in SQL, optional 2FA verify first code
app.post('/register', userCtrl.register);

/* ---------- Login ---------- */
// GET
app.get('/login', userCtrl.showLogin);

// POST password step — if account has 2FA, go to /2fa/verify
app.post('/login', userCtrl.login);

/* ---------- 2FA ---------- */
// SETUP (for logged-in user) — show QR
app.get('/2fa/setup', userCtrl.twofaSetupForm);

// SETUP confirm
app.post('/2fa/setup', userCtrl.twofaSetupConfirm);

// VERIFY after password step
app.get('/2fa/verify', userCtrl.twofaVerifyForm);

app.post('/2fa/verify', userCtrl.twofaVerify);

/* ---------- Logout ---------- */
app.get('/logout', userCtrl.logout);

/* ---------- Admin dashboard ---------- */
app.get('/admin', checkAuthenticated, checkAdmin, userCtrl.adminDashboard);

/* ---------- Admin: Users CRUD ---------- */
app.get('/admin/users',           checkAuthenticated, checkAdmin, userCtrl.listUsers);
app.get('/admin/users/new',       checkAuthenticated, checkAdmin, userCtrl.newUserForm);
app.post('/admin/users',          checkAuthenticated, checkAdmin, userCtrl.createUser);
app.get('/admin/users/:id/edit',  checkAuthenticated, checkAdmin, userCtrl.editUserForm);
app.post('/admin/users/:id/edit', checkAuthenticated, checkAdmin, userCtrl.updateUser);
app.post('/admin/users/:id/role', checkAuthenticated, checkAdmin, userCtrl.updateUserRole);
app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, userCtrl.deleteUser);
app.get('/admin/orders', checkAuthenticated, checkAdmin, orderCtrl.listAllOrders);
app.get('/admin/orders/:id/invoice', checkAuthenticated, checkAdmin, orderCtrl.showAdminInvoice);
app.get('/admin/orders/:id/edit', checkAuthenticated, checkAdmin, orderCtrl.editOrderStatusForm);
app.post('/admin/orders/:id/edit', checkAuthenticated, checkAdmin, orderCtrl.updateOrderStatus);
app.get('/admin/orders/:id/refund', checkAuthenticated, checkAdmin, paypalRefundCtrl.show);
app.post('/admin/orders/:id/refund', checkAuthenticated, checkAdmin, paypalRefundCtrl.refund);
app.get('/admin/refunds', checkAuthenticated, checkAdmin, adminRefundsCtrl.list);
app.get('/admin/refunds/:id', checkAuthenticated, checkAdmin, adminRefundsCtrl.details);
app.get('/admin/reports/sales', checkAuthenticated, checkAdmin, reportsCtrl.salesReport);

//(Kenneth End) 

//(Isaac Start )
/* ---------- Storefront: all products (public) ---------- */
app.get('/UserProducts', blockAdminFromUserPages, productCtrl.showStore);

/* ---------- Admin: Products CRU ---------- */
app.get('/admin/products', checkAuthenticated, checkAdmin, productCtrl.getAllProducts); // render admin/products.ejs
app.get('/viewProduct/:id', blockAdminFromUserPages, productCtrl.showProductDetails); // View single product (front-end)
app.get('/admin/products/new', checkAuthenticated, checkAdmin, productCtrl.newProductForm); // render admin/product-add.ejs
app.post('/admin/products', checkAuthenticated, checkAdmin, upload.single('image'), productCtrl.addProduct);
app.get('/admin/products/:id/edit', checkAuthenticated, checkAdmin, productCtrl.getProductById); // render admin/product-edit.ejs
app.post('/admin/products/:id/edit', checkAuthenticated, checkAdmin, upload.single('image'), productCtrl.updateProduct);

// jiaxuan start
// Admin: delete product
app.get('/admin/products/:id/delete', checkAuthenticated, checkAdmin, productCtrl.deleteProduct);
// jiaxuan end

// Add to cart from UserProducts without going to /cart
app.post('/UserProducts/add/:id', checkAuthenticated, checkUser, CartItemsController.addFromUserProducts);

/* ---------- NETS Checkout ---------- */
app.post("/generateNETSQR", netsController.generateNETSQR);
app.get("/nets-qr/success", netsController.renderSuccess);
app.get("/nets-qr/fail", netsController.renderFail);
app.get("/sse/payment-status/:txnRetrievalRef", netsController.ssePaymentStatus);
//(Isaac End )


//(Thrish Start)
/* ---------- Cart routes ---------- */
app.get('/cart', checkAuthenticated, checkUser, CartItemsController.list);
app.post('/cart/add', checkAuthenticated, checkUser, CartItemsController.add);
app.post('/cart/remove', checkAuthenticated, checkUser, CartItemsController.remove);
app.post('/cart/update', checkAuthenticated, checkUser, CartItemsController.updateQuantity);
app.post('/cart/clear', checkAuthenticated, checkUser, CartItemsController.clear);

// Compatibility route: allow legacy forms that POST to /add-to-cart/:id
app.post('/add-to-cart/:id', checkAuthenticated, checkUser, (req, res, next) => {
    // support different field names: fineId, productId or params.id
    req.body.fineId = req.body.fineId || req.body.productId || req.params.id;
    return CartItemsController.add(req, res, next);
});
//(Thrish End)

//(Kenneth Start) 
/* ---------- Start server ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running at http://localhost:' + PORT));
//(Kenneth End) 


