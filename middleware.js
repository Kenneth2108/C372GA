//Kenneth start
const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');

// Multer storage for product images
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

function registerMiddleware(app) {
  // View engine and static assets
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, 'public')));

  // Session + flash messages
  app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
  }));
  app.use(flash());
}

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

const checkUser = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'user') return next();
  req.flash('error', 'User access required');
  return res.redirect('/login');
};

module.exports = {
  registerMiddleware,
  checkAuthenticated,
  checkAdmin,
  checkUser,
  upload
};
//Kenneth End
