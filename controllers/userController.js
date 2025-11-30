const Users = require('../models/userModel');

// ----------------------- Admin: Users CRUD -----------------------

// List users (callback style)
function listUsers(req, res) {
  Users.listUsers(function (err, users) {
    if (err) {
      console.error(err);
      req.flash('error', 'Failed to load users');
      return res.redirect('/admin');
    }
    res.render('admin_users_index', {
      user: req.session.user,
      users: users,
      success: req.flash('success'),
      error: req.flash('error')
    });
  });
}

// Show "new user" form
function newUserForm(req, res) {
  res.render('admin_users_form', {
    user: req.session.user,
    mode: 'create',
    form: { username: '', email: '', address: '', contact: '', role: 'user' },
    error: req.flash('error')
  });
}

// Create user (admin)
function createUser(req, res) {
  const body = req.body;
  const username = body.username;
  const email = body.email;
  const password = body.password;
  const address = body.address;
  const contact = body.contact;
  const role = body.role;

  if (!username || !email || !password || !address || !contact || !role) {
    req.flash('error', 'All fields are required.');
    return res.redirect('/admin/users/new');
  }

  Users.createUserAdmin(
    { username: username, email: email, password: password, address: address, contact: contact, role: role },
    function (err /*, insertId */) {
      if (err) {
        console.error(err);
        req.flash('error', 'Create user failed. Email may exist.');
        return res.redirect('/admin/users/new');
      }
      req.flash('success', 'User created.');
      return res.redirect('/admin/users');
    }
  );
}

// Edit form (admin)
function editUserForm(req, res) {
  const id = req.params.id;
  Users.getById(id, function (err, user) {
    if (err) {
      console.error(err);
      req.flash('error', 'User load failed');
      return res.redirect('/admin/users');
    }
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/admin/users');
    }
    const form = {
      id: user.id,
      username: user.username,
      email: user.email,
      address: user.address,
      contact: user.contact,
      role: user.role
    };
    res.render('admin_users_form', {
      user: req.session.user,
      mode: 'edit',
      form: form,
      error: req.flash('error')
    });
  });
}

// Update (admin)
function updateUser(req, res) {
  const id = req.params.id;
  const body = req.body;

  if (!body.username || !body.email || !body.address || !body.contact || !body.role) {
    req.flash('error', 'Missing required fields.');
    return res.redirect('/admin/users/' + id + '/edit');
  }

  // If password provided, update with password; else without
  if (body.password && body.password.length > 0) {
    Users.updateUserWithPassword(
      id,
      {
        username: body.username,
        email: body.email,
        password: body.password,
        address: body.address,
        contact: body.contact,
        role: body.role
      },
      function (err /*, result */) {
        if (err) {
          console.error(err);
          req.flash('error', 'Update failed.');
          return res.redirect('/admin/users/' + id + '/edit');
        }
        req.flash('success', 'User updated (password changed).');
        return res.redirect('/admin/users');
      }
    );
  } else {
    Users.updateUser(
      id,
      {
        username: body.username,
        email: body.email,
        address: body.address,
        contact: body.contact,
        role: body.role
      },
      function (err /*, result */) {
        if (err) {
          console.error(err);
          req.flash('error', 'Update failed.');
          return res.redirect('/admin/users/' + id + '/edit');
        }
        req.flash('success', 'User updated.');
        return res.redirect('/admin/users');
      }
    );
  }
}

// Delete (admin)
function deleteUser(req, res) {
  const id = req.params.id;
  Users.deleteUser(id, function (err /*, result */) {
    if (err) {
      console.error(err);
      req.flash('error', 'Delete failed.');
      return res.redirect('/admin/users');
    }
    req.flash('success', 'User deleted.');
    return res.redirect('/admin/users');
  });
}

module.exports = {
  listUsers: listUsers,
  newUserForm: newUserForm,
  createUser: createUser,
  editUserForm: editUserForm,
  updateUser: updateUser,
  deleteUser: deleteUser,
};

// ----------------------- Public / Auth handlers -----------------------
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const connection = require('../db');

// Home
module.exports.home = function (req, res) {
  res.render('index', { user: req.session.user, success: req.flash('success') });
};

// Register form
module.exports.showRegister = function (req, res) {
  const formData = req.flash('formData')[0];

  var base32 = req.session._reg2fa_secret;
  if (!base32) {
    base32 = speakeasy.generateSecret({ name: 'FluffyFriend', length: 20 }).base32;
    req.session._reg2fa_secret = base32;
  }

  const otpauthUrl = 'otpauth://totp/FluffyFriend?secret=' + base32 + '&issuer=FluffyFriend';
  QRCode.toDataURL(otpauthUrl, function (err, dataUrl) {
    if (err) {
      console.error(err);
      return res.render('register', { error: req.flash('error'), formData: formData, twofa: null });
    }
    res.render('register', {
      error: req.flash('error'),
      formData: formData,
      twofa: { secret: base32, qr: dataUrl }
    });
  });
};

// Register submit
module.exports.register = function (req, res) {
  const body = req.body;
  const username = body.username;
  const email = body.email;
  const password = body.password;
  const address = body.address;
  const contact = body.contact;
  const role = body.role;
  const enable2fa = body.enable2fa;
  const twofa_token = body.twofa_token;

  if (!username || !email || !password || !address || !contact || !role) {
    req.flash('error', 'All fields are required.');
    req.flash('formData', body);
    return res.redirect('/register');
  }
  if (password.length < 6) {
    req.flash('error', 'Password must be at least 6 characters.');
    req.flash('formData', body);
    return res.redirect('/register');
  }

  var twofa_enabled = 0;
  var twofa_secret_to_save = null;

  if (enable2fa === 'on') {
    const tempSecret = req.session._reg2fa_secret;
    const token = (twofa_token || '').trim();

    const ok = speakeasy.totp.verify({
      secret: tempSecret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!ok) {
      req.flash('error', 'Invalid 2FA code. Please try again.');
      req.flash('formData', body);
      return res.redirect('/register');
    }

    twofa_enabled = 1;
    twofa_secret_to_save = tempSecret;
  }

  const sql = 'INSERT INTO users (username, email, password, address, contact, role, twofa_enabled, twofa_secret) VALUES (?, ?, SHA1(?), ?, ?, ?, ?, ?)';
  connection.query(sql, [username, email, password, address, contact, role, twofa_enabled, twofa_secret_to_save], function (err) {
    if (err) {
      console.error(err);
      req.flash('error', 'Registration failed. Email may already exist.');
      req.flash('formData', body);
      return res.redirect('/register');
    }
    delete req.session._reg2fa_secret;

    req.flash('success', twofa_enabled ? 'Registration successful with 2FA enabled! Please log in.' : 'Registration successful! Please log in.');
    return res.redirect('/login');
  });
};

// Login form
module.exports.showLogin = function (req, res) {
  delete req.session.pending2FA; // reset any previous 2FA step
  res.render('login', {
    success_msg: req.flash('success'),
    error_msg: req.flash('error')
  });
};

// Login submit
module.exports.login = function (req, res) {
  const email = req.body.email;
  const password = req.body.password;

  if (!email || !password) {
    req.flash('error', 'Email and password are required.');
    return res.redirect('/login');
  }

  const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
  connection.query(sql, [email, password], function (err, results) {
    if (err) {
      console.error(err);
      req.flash('error', 'Login error.');
      return res.redirect('/login');
    }
    if (!results || results.length === 0) {
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
module.exports.twofaSetupForm = function (req, res) {
  if (!req.session.user) return res.redirect('/login');

  const secret = speakeasy.generateSecret({
    name: 'FluffyFriend (' + req.session.user.email + ')',
    length: 20
  });

  req.session._twofa_temp = secret.base32;

  QRCode.toDataURL(secret.otpauth_url, function (err, dataUrl) {
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
module.exports.twofaSetupConfirm = function (req, res) {
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
    token: token,
    window: 1
  });

  if (!ok) {
    req.flash('error', 'Invalid code, try again.');
    return res.redirect('/2fa/setup');
  }

  connection.query(
    'UPDATE users SET twofa_enabled=1, twofa_secret=? WHERE id=?',
    [tempSecret, req.session.user.id],
    function (err) {
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
module.exports.twofaVerifyForm = function (req, res) {
  if (!req.session.pending2FA) return res.redirect('/login');

  // Prevent cache and surface any previous errors on the verify screen
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  res.render('twofa_verify', {
    name: req.session.pending2FA.username || 'User',
    error: req.flash('error')
  });
};

// 2FA verify submit
module.exports.twofaVerify = function (req, res) {
  const pending = req.session.pending2FA;
  if (!pending) return res.redirect('/login');

  const token = (req.body.token || '').trim();

  connection.query('SELECT * FROM users WHERE id=?', [pending.id], function (err, rows) {
    if (err || !rows || rows.length === 0) {
      console.error(err);
      req.flash('error', 'User not found');
      delete req.session.pending2FA;
      return res.redirect('/login');
    }

    const user = rows[0];
    const ok = speakeasy.totp.verify({
      secret: user.twofa_secret,
      encoding: 'base32',
      token: token,
      window: 1
    });

    if (!ok) {
      req.flash('error', 'Wrong code. Please try again.');
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
module.exports.logout = function (req, res) {
  req.session.destroy(function () {
    res.redirect('/');
  });
};

// Example protected page
module.exports.products = function (req, res) {
  if (!req.session.user) return res.redirect('/login');
  res.render('products', { user: req.session.user });
};

// Admin dashboard view
module.exports.adminDashboard = function (req, res) {
  res.render('admin', {
    user: req.session.user,
    success: req.flash('success'),
    error: req.flash('error')
  });
};
