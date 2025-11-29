//(Kenneth Start) 
const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const userCtrl = require('./controllers/userController');
//(Isaac Start )
const productCtrl = require('./controllers/productController');
const multer = require('multer');
//(Isaac End )
const connection = require('./db');
const app = express();
//(Kenneth End) 

//(Kenneth Start) 
/* ---------- View + forms + static ---------- */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

//(Isaac Start )
/* ---------- Multer for product images ---------- */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'public', 'images', 'products'));
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage: storage });
//(Isaac End )

/* ---------- Session + Flash ---------- */
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 1 week
}));
app.use(flash());

/* ---------- Auth helpers ---------- */
const checkAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  req.flash('error', 'Please log in first.');
  return res.redirect('/login');
};
const checkAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  req.flash('error', 'Access denied');
  return res.redirect('/');
};

/* ---------- Core pages ---------- */
// Home
app.get('/', userCtrl.home);

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
/* ---------- Admin: Products CRU ---------- */
//(Isaac Start )
/* ---------- Example protected page ---------- */
/* ---------- Storefront: all products (public) ---------- */
app.get('/products', productCtrl.showStore);
//(Isaac End )
app.get('/admin/products', checkAuthenticated, checkAdmin, productCtrl.getAllProducts); // render admin/products.ejs
app.get('/viewproduct/:id', productCtrl.showProductDetails); // View single product (front-end)
app.get('/admin/products/new', checkAuthenticated, checkAdmin, productCtrl.newProductForm); // render admin/product-add.ejs
app.post('/admin/products', checkAuthenticated, checkAdmin, upload.single('image'), productCtrl.addProduct);
app.get('/admin/products/:id/edit', checkAuthenticated, checkAdmin, productCtrl.getProductById); // render admin/product-edit.ejs
app.post('/admin/products/:id/edit', checkAuthenticated, checkAdmin, upload.single('image'), productCtrl.updateProduct);

//(Isaac End )




//(Kenneth Start) 
/* ---------- Start server ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running at http://localhost:' + PORT));
//(Kenneth End) 

