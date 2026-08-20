# Inquiries

`POST /api/inquiry` sends piece enquiries and Special Request submissions as
email, through the Resend REST API (plain `fetch`, no SDK). Replaces the old
`mailto:` link, which did nothing on webmail with no mail client registered.

## Env vars (set by hand on Vercel, not in this repo)

- `RESEND_API_KEY` — Resend API key.
- `INQUIRY_TO` — where enquiries land.
- `INQUIRY_FROM` — the sending address. Must be on a domain verified in
  Resend first, or Resend rejects the send.

All three are required with no fallback. If any is missing the endpoint
returns 500 and sends nothing.

## Honeypot

The `website` field is invisible to real visitors. If it's filled in, the
endpoint returns 200 OK but sends no email — so a bot has no way to tell it
was caught.
