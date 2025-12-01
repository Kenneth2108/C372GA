const CartItems = require('../models/CartItem');
const db = require('../db'); // <-- needed to fetch product price

const CartItemsController = {
    list(req, res) {
        const userId = (req.session.user && (req.session.user.userId || req.session.user.id));
        if (!userId) return res.status(401).send('Not authenticated');

        CartItems.getByUserId(userId, (err, cartItems) => {
            if (err) {
                console.error('Cart list error:', err);
                return res.status(500).send('Error retrieving cart');
            }

            const normalized = (cartItems || []).map(item => ({
                id: item.id,
                userId: item.user_id || item.userId,
                product_id: item.product_id,
                fineId: item.product_id || item.fine_id || item.fineId,
                productName: item.productName || item.name || item.product_name || '',
                name: item.productName || item.name || item.product_name || '',
                price: (item.price != null) ? Number(item.price) : 0,
                quantity: (item.quantity != null) ? Number(item.quantity) : 0,
                image: item.image || null
            }));

            res.render('cart', { cartItems: normalized, user: req.session.user });
        });
    },

    // 🔥 FIXED VERSION — ONLY this function changed
    add(req, res) {
        const userId = (req.session.user && (req.session.user.userId || req.session.user.id));
        if (!userId) {
            req.flash('error', 'Please log in to add items to cart');
            return res.redirect('/login');
        }

        const idFromBody = req.body.fineId || req.body.productId || req.body.fine_id || req.body.product_id;
        const productId = parseInt(idFromBody || req.params.id, 10);
        if (isNaN(productId)) {
            req.flash('error', 'Invalid product id');
            return res.redirect('/shopping');
        }

        const qty = parseInt(req.body.quantity, 10) || 1;

        // 🔥 NEW: Get product price
        const priceSql = "SELECT price FROM products WHERE id = ?";
        db.query(priceSql, [productId], (err, rows) => {
            if (err || rows.length === 0) {
                req.flash('error', 'Product not found');
                return res.redirect('/shopping');
            }

            const productPrice = rows[0].price;

            // Now add item to cart WITH price
            CartItems.add(userId, productId, qty, productPrice, (err) => {
                if (err) {
                    console.error('Cart add error:', err);
                    req.flash('error', 'Could not add item to cart');
                    return res.redirect('/shopping');
                }

                req.flash('success', 'Item added to cart');
                return res.redirect('/cart');
            });
        });
    },

    remove(req, res) {
        const userId = (req.session.user && (req.session.user.userId || req.session.user.id));
        if (!userId) {
            req.flash('error', 'Please log in');
            return res.redirect('/login');
        }

        const idFromBody = req.body.fineId || req.body.productId || req.body.fine_id || req.body.product_id;
        const productId = parseInt(idFromBody || req.params.id, 10);
        if (isNaN(productId)) {
            req.flash('error', 'Invalid product id');
            return res.redirect('/cart');
        }

        CartItems.remove(userId, productId, (err) => {
            if (err) {
                console.error('Cart remove error:', err);
                req.flash('error', 'Could not remove item');
            } else {
                req.flash('success', 'Item removed');
            }
            res.redirect('/cart');
        });
    },

    clear(req, res) {
        const userId = (req.session.user && (req.session.user.userId || req.session.user.id));
        if (!userId) {
            req.flash('error', 'Please log in');
            return res.redirect('/login');
        }

        CartItems.clear(userId, (err) => {
            if (err) {
                console.error('Cart clear error:', err);
                req.flash('error', 'Could not clear cart');
            } else {
                req.flash('success', 'Cart cleared');
            }
            res.redirect('/cart');
        });
    },

    // Isaac start
    // Add to cart from UserProducts page but stay on same page
    addFromUserProducts(req, res) {
        const userId = (req.session.user && (req.session.user.userId || req.session.user.id));
        if (!userId) {
            req.flash('error', 'Please log in to add items');
            return res.redirect('/login');
        }

        const productId = parseInt(req.params.id, 10);
        if (isNaN(productId)) {
            req.flash('error', 'Invalid product ID');
            return res.redirect('/UserProducts');
        }

        const qty = parseInt(req.body.quantity, 10) || 1;

        // Fetch product price
        const sql = "SELECT price FROM products WHERE id = ?";
        db.query(sql, [productId], (err, rows) => {
            if (err || rows.length === 0) {
                req.flash('error', 'Product not found');
                return res.redirect('/UserProducts');
            }

            const price = rows[0].price;

            CartItems.add(userId, productId, qty, price, (err2) => {
                if (err2) {
                    console.error("Add to cart error:", err2);
                    req.flash('error', 'Could not add item to cart');
                    return res.redirect('/UserProducts');
                }

                req.flash('success', 'Item added to cart!');
                const back = req.get('referer') || '/UserProducts';
                return res.redirect(back);
            });
        });
    }
    // Isaac end
};



module.exports = CartItemsController;