//Isaac start
// controllers/productController.js
const Product = require('../models/productModel');

// Admin: list all products
exports.getAllProducts = function (req, res) {
  Product.getAllProducts(function (err, products) {
    if (err) {
      console.error('Error fetching products:', err);
      req.flash('error', 'Failed to load products.');
      return res.redirect('/admin');
    }

    res.render('admin/products', {
      products: products,
      success: req.flash('success'),
      error: req.flash('error')
    });
  });
};

// User: View single product details
exports.showProductDetails = function (req, res) {
  const id = req.params.id;

  Product.getProductById(id, function (err, product) {
    if (err) {
      console.error('Error fetching product:', err);
      req.flash('error', 'Failed to load product.');
      return res.redirect('/products');
    }

    if (!product) {
      req.flash('error', 'Product not found.');
      return res.redirect('/products');
    }

    res.render('viewproduct', {
      product: product,
      success: req.flash('success'),
      error: req.flash('error')
    });
  });
};

// Admin: show "add product" form
exports.newProductForm = function (req, res) {
  res.render('admin/product_add_form', {
    success: req.flash('success'),
    error: req.flash('error')
  });
};

// Admin: add product (POST)
exports.addProduct = function (req, res) {
  const productData = {
    productName: req.body.productName,
    category: req.body.category,
    quantity: req.body.quantity,
    price: req.body.price,
    image: req.file ? req.file.filename : null,
    description: req.body.description 
  };

  Product.addProduct(productData, function (err) {
    if (err) {
      console.error('Error adding product:', err);
      req.flash('error', 'Failed to add product.');
      return res.redirect('/admin/products');
    }

    req.flash('success', 'Product added successfully.');
    res.redirect('/admin/products');
  });
};

// Admin: edit form for 1 product
exports.getProductById = function (req, res) {
  const id = req.params.id;

  Product.getProductById(id, function (err, product) {
    if (err) {
      console.error('Error fetching product:', err);
      req.flash('error', 'Failed to load product.');
      return res.redirect('/admin/products');
    }

    if (!product) {
      req.flash('error', 'Product not found.');
      return res.redirect('/admin/products');
    }

    res.render('admin/product_edit', {
      product: product,
      success: req.flash('success'),
      error: req.flash('error')
    });
  });
};

// Admin: update product (POST)
exports.updateProduct = function (req, res) {
  const id = req.params.id;

  const productData = {
    productName: req.body.productName,
    category: req.body.category,
    quantity: req.body.quantity,
    price: req.body.price,
    image: req.file ? req.file.filename : req.body.currentImage,
    description: req.body.description 
  };

  Product.updateProduct(id, productData, function (err) {
    if (err) {
      console.error('Error updating product:', err);
      req.flash('error', 'Failed to update product.');
      return res.redirect('/admin/products');
    }

    req.flash('success', 'Product updated successfully.');
    res.redirect('/admin/products');
  });
};

exports.showStore = function (req, res) {
  const query = req.query.q || '';
  const category = req.query.category || '';

  Product.getAllProducts(function (err, products) {
    if (err) {
      console.error('Error fetching products for store:', err);
      req.flash('error', 'Failed to load products.');
      return res.redirect('/');
    }

    // (Optional) basic filtering in JS:
    let filtered = products;

    if (category) {
      filtered = filtered.filter(function (p) {
        return p.category && p.category.toLowerCase() === category.toLowerCase();
      });
    }

    if (query) {
      const qLower = query.toLowerCase();
      filtered = filtered.filter(function (p) {
        return (
          (p.productName && p.productName.toLowerCase().includes(qLower)) ||
          (p.category && p.category.toLowerCase().includes(qLower))
        );
      });
    }

    res.render('UserProducts', {
      products: filtered,
      query: query,
      selectedCategory: category, 
      cartCount: req.session.cart ? req.session.cart.length : 0,
      success: req.flash('success'),
      error: req.flash('error')
    });
  });
};
//Isaac end