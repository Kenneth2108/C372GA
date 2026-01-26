-- Add Stripe columns to orders table for Stripe Checkout tracking
ALTER TABLE orders
  ADD COLUMN stripe_session_id VARCHAR(255) NULL AFTER paypal_capture_id,
  ADD COLUMN stripe_payment_intent_id VARCHAR(255) NULL AFTER stripe_session_id;
