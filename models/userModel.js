const db = require('../db');
const pool = db.promise ? db.promise() : null;

function ensurePool() {
  if (!pool) throw new Error('DB connection does not support promises');
}

async function createUser({ username, email, password, address, contact, role, twofa_enabled = 0, twofa_secret = null }) {
  ensurePool();
  const sql = 'INSERT INTO users (username, email, password, address, contact, role, twofa_enabled, twofa_secret) VALUES (?, ?, SHA1(?), ?, ?, ?, ?, ?)';
  const params = [username, email, password, address, contact, role, twofa_enabled, twofa_secret];
  const [result] = await pool.query(sql, params);
  return result.insertId;
}

async function getByEmailAndPassword(email, password) {
  ensurePool();
  const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
  const [rows] = await pool.query(sql, [email, password]);
  return rows[0] || null;
}

async function getById(id) {
  ensurePool();
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

async function listUsers() {
  ensurePool();
  const [rows] = await pool.query('SELECT id, username, email, address, contact, role FROM users ORDER BY id ASC');
  return rows;
}

async function setTwoFA(id, base32Secret) {
  ensurePool();
  await pool.query('UPDATE users SET twofa_enabled=1, twofa_secret=? WHERE id=?', [base32Secret, id]);
}

async function createUserAdmin({ username, email, password, address, contact, role }) {
  return createUser({ username, email, password, address, contact, role, twofa_enabled: 0, twofa_secret: null });
}

async function updateUserWithPassword(id, { username, email, password, address, contact, role }) {
  ensurePool();
  const sql = 'UPDATE users SET username=?, email=?, password=SHA1(?), address=?, contact=?, role=? WHERE id=?';
  await pool.query(sql, [username, email, password, address, contact, role, id]);
}

async function updateUser(id, { username, email, address, contact, role }) {
  ensurePool();
  const sql = 'UPDATE users SET username=?, email=?, address=?, contact=?, role=? WHERE id=?';
  await pool.query(sql, [username, email, address, contact, role, id]);
}

async function deleteUser(id) {
  ensurePool();
  await pool.query('DELETE FROM users WHERE id = ?', [id]);
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
  deleteUser,
};

