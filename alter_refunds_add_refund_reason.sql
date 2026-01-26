-- Add refund_reason column to refunds table
ALTER TABLE refunds
  ADD COLUMN refund_reason VARCHAR(500) NULL AFTER status;
