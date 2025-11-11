const Users = require('../models/userModel');

// Admin Users: list
async function listUsers(req, res) {
  try {
    const users = await Users.listUsers();
    res.render('admin_users_index', {
      user: req.session.user,
      users,
      success: req.flash('success'),
      error: req.flash('error')
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load users');
    return res.redirect('/admin');
  }
}

// Admin Users: new form
function newUserForm(req, res) {
  res.render('admin_users_form', {
    user: req.session.user,
    mode: 'create',
    form: { username: '', email: '', address: '', contact: '', role: 'user' },
    error: req.flash('error')
  });
}

// Admin Users: create
async function createUser(req, res) {
  const { username, email, password, address, contact, role } = req.body;
  if (!username || !email || !password || !address || !contact || !role) {
    req.flash('error', 'All fields are required.');
    return res.redirect('/admin/users/new');
  }
  try {
    await Users.createUserAdmin({ username, email, password, address, contact, role });
    req.flash('success', 'User created.');
    return res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Create user failed. Email may exist.');
    return res.redirect('/admin/users/new');
  }
}

// Admin Users: edit form
async function editUserForm(req, res) {
  const id = req.params.id;
  try {
    const user = await Users.getById(id);
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/admin/users');
    }
    const form = { id: user.id, username: user.username, email: user.email, address: user.address, contact: user.contact, role: user.role };
    res.render('admin_users_form', {
      user: req.session.user,
      mode: 'edit',
      form,
      error: req.flash('error')
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'User load failed');
    return res.redirect('/admin/users');
  }
}

// Admin Users: update
async function updateUser(req, res) {
  const id = req.params.id;
  const { username, email, password, address, contact, role } = req.body;
  if (!username || !email || !address || !contact || !role) {
    req.flash('error', 'Missing required fields.');
    return res.redirect(`/admin/users/${id}/edit`);
  }
  try {
    if (password && password.length > 0) {
      await Users.updateUserWithPassword(id, { username, email, password, address, contact, role });
      req.flash('success', 'User updated (password changed).');
    } else {
      await Users.updateUser(id, { username, email, address, contact, role });
      req.flash('success', 'User updated.');
    }
    return res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Update failed.');
    return res.redirect(`/admin/users/${id}/edit`);
  }
}

// Admin Users: delete
async function deleteUser(req, res) {
  const id = req.params.id;
  try {
    await Users.deleteUser(id);
    req.flash('success', 'User deleted.');
    return res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Delete failed.');
    return res.redirect('/admin/users');
  }
}

module.exports = {
  listUsers,
  newUserForm,
  createUser,
  editUserForm,
  updateUser,
  deleteUser,
};


// Public/auth handlers moved from app.js (logic unchanged)
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const connection = require('../db');

// Home
module.exports.home = (req, res) => {
  res.render('index', { user: req.session.user, success: req.flash('success') });
};

// Register form
module.exports.showRegister = (req, res) => {
  const formData = req.flash('formData')[0];

  let base32 = req.session._reg2fa_secret;
  if (!base32) {
    base32 = speakeasy.generateSecret({ name: 'FluffyFriend', length: 20 }).base32;
    req.session._reg2fa_secret = base32;
  }

  const otpauthUrl = `otpauth://totp/FluffyFriend?secret=${base32}&issuer=FluffyFriend`;
  QRCode.toDataURL(otpauthUrl, (err, dataUrl) => {
    if (err) {
      console.error(err);
      return res.render('register', { error: req.flash('error'), formData, twofa: null });
    }
    res.render('register', {
      error: req.flash('error'),
      formData,
      twofa: { secret: base32, qr: dataUrl }
    });
  });
};

// Register submit
module.exports.register = (req, res) => {
  const { username, email, password, address, contact, role, enable2fa, twofa_token } = req.body;

  if (!username || !email || !password || !address || !contact || !role) {
    req.flash('error', 'All fields are required.');
    req.flash('formData', req.body);
    return res.redirect('/register');
  }
  if (password.length < 6) {
    req.flash('error', 'Password must be at least 6 characters.');
    req.flash('formData', req.body);
    return res.redirect('/register');
  }

  let twofa_enabled = 0;
  let twofa_secret_to_save = null;

  if (enable2fa === 'on') {
    const tempSecret = req.session._reg2fa_secret;
    const token = (twofa_token || '').trim();

    const ok = speakeasy.totp.verify({
      secret: tempSecret,
      encoding: 'base32',
      token,
      window: 2
    });

    if (!ok) {
      req.flash('error', 'Invalid 2FA code. Please try again.');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }

    twofa_enabled = 1;
    twofa_secret_to_save = tempSecret;
  }

  const sql = 'INSERT INTO users (username, email, password, address, contact, role, twofa_enabled, twofa_secret) VALUES (?, ?, SHA1(?), ?, ?, ?, ?, ?)';
  connection.query(sql, [username, email, password, address, contact, role, twofa_enabled, twofa_secret_to_save], (err) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Registration failed. Email may already exist.');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }
    delete req.session._reg2fa_secret;

    req.flash('success', twofa_enabled ? 'Registration successful with 2FA enabled! Please log in.' : 'Registration successful! Please log in.');
    return res.redirect('/login');
  });
};

// Login form
module.exports.showLogin = (req, res) => {
  // If user returns to login, cancel any pending 2FA step
  delete req.session.pending2FA;
  res.render('login', {
    success_msg: req.flash('success'),
    error_msg: req.flash('error')
  });
};

// Login submit
module.exports.login = (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    req.flash('error', 'Email and password are required.');
    return res.redirect('/login');
  }

  const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
  connection.query(sql, [email, password], (err, results) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Login error.');
      return res.redirect('/login');
    }
    if (results.length === 0) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }

    const u = results[0];
    if (u.twofa_enabled && u.twofa_secret) {
      req.session.pending2FA = { id: u.id, email: u.email, role: u.role, username: u.username };
      return res.redirect('/2fa/verify');
    }

    req.session.user = u;
    req.flash('success', 'Login successful!');
    if (u.role === 'admin') return res.redirect('/admin');
    return res.redirect('/');
  });
};

// 2FA setup form
module.exports.twofaSetupForm = (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const secret = speakeasy.generateSecret({
    name: `FluffyFriend (${req.session.user.email})`,
    length: 20
  });

  req.session._twofa_temp = secret.base32;

  QRCode.toDataURL(secret.otpauth_url, (err, dataUrl) => {
    if (err) {
      console.error(err);
      req.flash('error', 'Failed to generate QR code');
      return res.redirect('/');
    }
    res.render('twofa_setup', {
      user: req.session.user,
      qrcodeDataUrl: dataUrl
    });
  });
};

// 2FA setup confirm
module.exports.twofaSetupConfirm = (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const tempSecret = req.session._twofa_temp;
  if (!tempSecret) {
    req.flash('error', '2FA secret missing');
    return res.redirect('/2fa/setup');
  }

  const token = (req.body.token || '').trim();
  const ok = speakeasy.totp.verify({
    secret: tempSecret,
    encoding: 'base32',
    token,
    window: 1
  });

  if (!ok) {
    req.flash('error', 'Invalid code, try again.');
    return res.redirect('/2fa/setup');
  }

  connection.query(
    'UPDATE users SET twofa_enabled=1, twofa_secret=? WHERE id=?',
    [tempSecret, req.session.user.id],
    (err) => {
      if (err) {
        console.error(err);
        req.flash('error', 'Failed to enable 2FA');
        return res.redirect('/');
      }
      delete req.session._twofa_temp;
      req.flash('success', '2FA enabled!');
      res.redirect('/');
    }
  );
};

// 2FA verify form
module.exports.twofaVerifyForm = (req, res) => {
  if (!req.session.pending2FA) return res.redirect('/login');
  // Prevent browser from caching this sensitive page
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.render('twofa_verify', { name: req.session.pending2FA.username || 'User' });
};

// 2FA verify submit
module.exports.twofaVerify = (req, res) => {
  const pending = req.session.pending2FA;
  if (!pending) return res.redirect('/login');

  const token = (req.body.token || '').trim();

  connection.query('SELECT * FROM users WHERE id=?', [pending.id], (err, rows) => {
    if (err || rows.length === 0) {
      console.error(err);
      req.flash('error', 'User not found');
      delete req.session.pending2FA;
      return res.redirect('/login');
    }

    const user = rows[0];
    const ok = speakeasy.totp.verify({
      secret: user.twofa_secret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!ok) {
      req.flash('error', 'Invalid or expired code. Try again.');
      return res.redirect('/2fa/verify');
    }

    req.session.user = user;
    delete req.session.pending2FA;
    req.flash('success', 'Login successful!');
    if (user.role === 'admin') return res.redirect('/admin');
    res.redirect('/');
  });
};

// Logout
module.exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/'));
};

// Products page
module.exports.products = (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('products', { user: req.session.user });
};

// Admin dashboard view (auth handled in app.js)
module.exports.adminDashboard = (req, res) => {
  res.render('admin', {
    user: req.session.user,
    success: req.flash('success'),
    error: req.flash('error')
  });
};
