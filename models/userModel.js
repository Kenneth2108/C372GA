const db = require('../db');

/**
 * Create a user
 * @param {{username, email, password, address, contact, role, twofa_enabled?, twofa_secret?}} data
 * @param {(err: any, insertId?: number) => void} cb
 */
function createUser(
  { username, email, password, address, contact, role, twofa_enabled = 0, twofa_secret = null },
  cb
) {
  const sql = `
    INSERT INTO users (username, email, password, address, contact, role, twofa_enabled, twofa_secret)
    VALUES (?, ?, SHA1(?), ?, ?, ?, ?, ?)
  `;
  const params = [username, email, password, address, contact, role, twofa_enabled, twofa_secret];
  db.query(sql, params, (err, result) => {
    if (err) return cb(err);
    return cb(null, result.insertId);
  });
}

/**
 * Convenience: create user (admin path) with 2FA disabled by default
 */
function createUserAdmin({ username, email, password, address, contact, role }, cb) {
  return createUser(
    { username, email, password, address, contact, role, twofa_enabled: 0, twofa_secret: null },
    cb
  );
}

/**
 * Auth lookup by email + password
 * @param {string} email
 * @param {string} password
 * @param {(err: any, user?: object|null) => void} cb
 */
function getByEmailAndPassword(email, password, cb) {
  const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
  db.query(sql, [email, password], (err, rows) => {
    if (err) return cb(err);
    return cb(null, rows && rows[0] ? rows[0] : null);
  });
}

/**
 * Get user by id
 */
function getById(id, cb) {
  const sql = 'SELECT * FROM users WHERE id = ?';
  db.query(sql, [id], (err, rows) => {
    if (err) return cb(err);
    return cb(null, rows && rows[0] ? rows[0] : null);
  });
}

/**
 * List users (limited columns)
 */
function listUsers(cb) {
  const sql = 'SELECT id, username, email, address, contact, role FROM users ORDER BY id ASC';
  db.query(sql, (err, rows) => {
    if (err) return cb(err);
    return cb(null, rows);
  });
}

/**
 * Enable 2FA and save secret
 */
function setTwoFA(id, base32Secret, cb) {
  const sql = 'UPDATE users SET twofa_enabled=1, twofa_secret=? WHERE id=?';
  db.query(sql, [base32Secret, id], (err, result) => {
    if (err) return cb(err);
    return cb(null, result);
  });
}

/**
 * Update user with password change (hash in SQL)
 */
function updateUserWithPassword(id, { username, email, password, address, contact, role }, cb) {
  const sql = `
    UPDATE users
    SET username=?, email=?, password=SHA1(?), address=?, contact=?, role=?
    WHERE id=?
  `;
  db.query(sql, [username, email, password, address, contact, role, id], (err, result) => {
    if (err) return cb(err);
    return cb(null, result);
  });
}

/**
 * Update user without password change
 */
function updateUser(id, { username, email, address, contact, role }, cb) {
  const sql = `
    UPDATE users
    SET username=?, email=?, address=?, contact=?, role=?
    WHERE id=?
  `;
  db.query(sql, [username, email, address, contact, role, id], (err, result) => {
    if (err) return cb(err);
    return cb(null, result);
  });
}

/**
 * Update only role
 */
function updateUserRole(id, role, cb) {
  const sql = 'UPDATE users SET role=? WHERE id=?';
  db.query(sql, [role, id], (err, result) => {
    if (err) return cb(err);
    return cb(null, result);
  });
}

/**
 * Delete user
 */
function deleteUser(id, cb) {
  const sql = 'DELETE FROM users WHERE id = ?';
  db.query(sql, [id], (err, result) => {
    if (err) return cb(err);
    return cb(null, result);
  });
}

module.exports = {
  createUser,
  createUserAdmin,
  getByEmailAndPassword,
  getById,
  listUsers,
  setTwoFA,
  updateUserWithPassword,
  updateUser,
  updateUserRole,
  deleteUser,
};
