# Inventory sheet

Stock and price live in a Google Sheet, not this repo. Hajar edits a
spreadsheet; the server reads it as the source of truth before charging
anyone.

## Schema

Tab named exactly `Inventory`. Row 1 is a header. Columns:

`slug | title | price_cad | quantity | notes | updated_at`

Sold out means `quantity <= 0`. No separate status column — one number to
edit.

## Env vars (set by hand on Vercel, not in this repo)

- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the service account's email.
- `GOOGLE_PRIVATE_KEY` — its private key, PEM format, including the
  `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines. Vercel
  stores multi-line values as literal `\n`; the code un-escapes that, you
  don't need to.
- `GOOGLE_SHEETS_ID` — the spreadsheet ID from its URL.

All three are required with no fallback. Missing any of them fails closed.

## One-time setup

1. Create a Google Cloud project.
2. Enable the Google Sheets API for it.
3. Create a service account, then a JSON key for it — download the file.
4. Pull `client_email` and `private_key` out of that JSON into the two env
   vars above.
5. Share the spreadsheet with the service account's email as Editor. This
   is the step everyone forgets. Skip it and every call fails with a 403
   that gives no hint why.
