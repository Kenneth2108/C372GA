const Product = require('../models/productModel');

function renderStoreView(req, res, viewName) {
  const query = req.query.q || '';
  const category = req.query.category || '';

  Product.getAllProducts(function (err, products) {
    if (err) {
      console.error('Error fetching products for store:', err);
      req.flash('error', 'Failed to load products.');
      return res.redirect('/');
    }

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

    res.render(viewName, {
      products: filtered,
      query: query,
      selectedCategory: category,
      cartCount: req.session.cart ? req.session.cart.length : 0,
      success: req.flash('success'),
      error: req.flash('error')
    });
  });
}

exports.showGuestStore = function (req, res) {
  renderStoreView(req, res, 'GuestProducts');
};
