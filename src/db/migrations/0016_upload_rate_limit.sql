CREATE TABLE upload_rate_buckets (
  key text PRIMARY KEY NOT NULL,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL,
  CONSTRAINT upload_rate_attempts_positive CHECK (attempts > 0)
);

