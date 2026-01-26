//Isaac start
// models/productModel.js
const db = require('../db');

const Product = {
  // Get all products (include description)
  getAllProducts: function (callback) {
    const sql = 'SELECT id, productName, category, quantity, price, image, description FROM products';
    db.query(sql, function (err, results) {
      if (err) return callback(err);
      callback(null, results);
    });
  },

  // Get a single product by ID (include description)
  getProductById: function (id, callback) {
    const sql = 'SELECT id, productName, category, quantity, price, image, description FROM products WHERE id = ?';
    db.query(sql, [id], function (err, results) {
      if (err) return callback(err);
      callback(null, results[0] || null);
    });
  },

  // Add a new product (persist description)
  addProduct: function (productData, callback) {
    const sql = `
      INSERT INTO products (productName, category, quantity, price, image, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const params = [
      productData.productName,
      productData.category,
      productData.quantity,
      productData.price,
      productData.image,
      productData.description || null
    ];
    db.query(sql, params, function (err, result) {
      if (err) return callback(err);
      callback(null, result.insertId);
    });
  },

  // Update an existing product (persist description)
  updateProduct: function (id, productData, callback) {
    const sql = `
      UPDATE products
      SET productName = ?, category = ?, quantity = ?, price = ?, image = ?, description = ?
      WHERE id = ?
    `;
    const params = [
      productData.productName,
      productData.category,
      productData.quantity,
      productData.price,
      productData.image,
      productData.description || null,
      id
    ];
    db.query(sql, params, function (err, result) {
      if (err) return callback(err);
      callback(null, result.affectedRows);
    });
  },

  //Kenneth Start
  // Increase product stock quantities for restocks
  increaseQuantities: function (items, callback) {
    if (!Array.isArray(items) || items.length === 0) {
      return callback(null);
    }

    const queue = items.slice();

    function next() {
      if (queue.length === 0) {
        return callback(null);
      }

      const item = queue.shift();
      const id = item && item.id != null ? Number(item.id) : null;
      const qty = item && item.quantity != null ? Number(item.quantity) : 0;

      if (!id || !Number.isFinite(qty) || qty <= 0) {
        return next();
      }

      db.query(
        'UPDATE products SET quantity = quantity + ? WHERE id = ?',
        [qty, id],
        function (err) {
          if (err) return callback(err);
          next();
        }
      );
    }

    next();
  },
  //Kenneth End

    // jiaxuan start
    // Delete a product
  deleteProduct: function (id, callback) {
    const sql = 'DELETE FROM products WHERE id = ?';
    db.query(sql, [id], function (err, result) {
      if (err) return callback(err);
      callback(null, result.affectedRows);
    });
  },
// jiaxuan end
};

module.exports = Product;
//Isaac end
