const db = require('../db');

const CartItems = {
    getByUserId(userId, callback) {
        const sql = `
            SELECT 
                ci.id,
                ci.user_id,
                ci.product_id,
                ci.quantity,
                p.productName,
                p.price,
                p.image
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            WHERE ci.user_id = ?
        `;
        db.query(sql, [userId], callback);
    },

    // quantity parameter added — will increment by quantity when item exists or insert with quantity
    add(userId, productId, quantity = 1, price, callback) {
    const qty = Number(quantity) || 1;

    // First check if the item already exists
    const checkSql = `
        SELECT id, quantity FROM cart_items
        WHERE user_id = ? AND product_id = ?
    `;
    db.query(checkSql, [userId, productId], (err, rows) => {
        if (err) return callback(err);

        if (rows && rows.length > 0) {
            const updateSql = `
                UPDATE cart_items
                SET quantity = quantity + ?
                WHERE user_id = ? AND product_id = ?
            `;
            return db.query(updateSql, [qty, userId, productId], callback);
        } else {
            const insertSql = `
                INSERT INTO cart_items (user_id, product_id, quantity, price)
                VALUES (?, ?, ?, ?)
            `;
            return db.query(insertSql, [userId, productId, qty, price], callback);
        }
    });
},


    remove(userId, productId, callback) {
        const sql = `DELETE FROM cart_items WHERE user_id = ? AND product_id = ?`;
        db.query(sql, [userId, productId], callback);
    },

    clear(userId, callback) {
        db.query(`DELETE FROM cart_items WHERE user_id = ?`, [userId], callback);
    }
};

module.exports = CartItems;