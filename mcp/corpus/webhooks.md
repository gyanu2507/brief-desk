# Webhooks

invoice.paid handling is not idempotent. Stripe retries plus our retries can charge twice.
Store processed Stripe event ids and skip duplicates.
