-- Creates refund_items table to track per-item refunds
CREATE TABLE IF NOT EXISTS refund_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  refund_id INT NOT NULL,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_refund_items_order (order_id),
  INDEX idx_refund_items_refund (refund_id),
  INDEX idx_refund_items_product (product_id)
);
