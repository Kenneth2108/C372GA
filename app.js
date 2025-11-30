//(Kenneth Start) 
const express = require('express');
const userCtrl = require('./controllers/userController');
//(Isaac Start )
const productCtrl = require('./controllers/productController');
const contactCtrl = require('./controllers/contactController');
//(Isaac End )
const connection = require('./db');
const app = express();
const {
  registerMiddleware,
  checkAuthenticated,
  checkAdmin,
  upload
} = require('./middleware');
//(Kenneth End)
//(Thrish Start)
const CartItemsController = require('./controllers/CartItemController');
//(Thrish End)

// Register common middleware (views, static, session, flash)
registerMiddleware(app);

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
app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, userCtrl.deleteUser);
//(Kenneth End) 

//(Isaac Start )
/* ---------- Storefront: all products (public) ---------- */
app.get('/UserProducts', productCtrl.showStore);
//(Isaac End )

//(Isaac Start )
/* ---------- Admin: Products CRU ---------- */
app.get('/admin/products', checkAuthenticated, checkAdmin, productCtrl.getAllProducts); // render admin/products.ejs
app.get('/viewproduct/:id', productCtrl.showProductDetails); // View single product (front-end)
app.get('/admin/products/new', checkAuthenticated, checkAdmin, productCtrl.newProductForm); // render admin/product-add.ejs
app.post('/admin/products', checkAuthenticated, checkAdmin, upload.single('image'), productCtrl.addProduct);
app.get('/admin/products/:id/edit', checkAuthenticated, checkAdmin, productCtrl.getProductById); // render admin/product-edit.ejs
app.post('/admin/products/:id/edit', checkAuthenticated, checkAdmin, upload.single('image'), productCtrl.updateProduct);
//(Isaac End )


//(Thrish Start)
/* ---------- Cart routes ---------- */
app.get('/cart', checkAuthenticated, CartItemsController.list);
app.post('/cart/add', checkAuthenticated, CartItemsController.add);
app.post('/cart/remove', checkAuthenticated, CartItemsController.remove);
app.post('/cart/clear', checkAuthenticated, CartItemsController.clear);

// Compatibility route: allow legacy forms that POST to /add-to-cart/:id
app.post('/add-to-cart/:id', checkAuthenticated, (req, res, next) => {
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

