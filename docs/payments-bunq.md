# Bunq security-deposit ("caparra") payments

The booking flow charges a **refundable security deposit** via Bunq before a seat is held.
It is **not** a ticket or fare — see the disclaimer copy in
`src/components/booking/BookingConfirmDialog.tsx`.

## Amount

Computed server-side (never trusted from the client) in `src/lib/booking-deposit.ts`:

- €50 per bookable leg by default.
- €100 per leg that is **open-sea** or has **high complexity** (effective complexity ≥ 4).
- Per-person amounts sum across the selected legs, **capped at €250 per person**.
- Total charged = per-person amount **× party size**.

## Flow

1. User accepts the conditions in the confirmation modal and presses *Conferma e paga il deposito*.
2. The booking request is created via the existing `request_voyage_booking` RPC.
3. The client calls `POST /api/payments/bunq/request` with the new `bookingRequestId` and the
   user's Supabase access token.
4. The function recomputes the amount, creates a Bunq **request-inquiry** and stores a row in
   `voyage_booking_deposits`, then returns the shareable `bunq.me` link.
5. The user is redirected to Bunq to pay.
6. Settlement is detected either by the Bunq **webhook** (`POST /api/payments/bunq/webhook`) or,
   as a fallback, by `GET /api/payments/bunq/status?bookingRequestId=...`, which re-checks the
   live request-inquiry status. Either path flips the deposit to `paid`.

If Bunq env vars are missing, `/request` returns `503 not_configured`, the booking is still
created, and the user sees a "deposit link to follow" message — nothing breaks.

## Server code

- `src/server/bunq/client.ts` — Bunq handshake (installation + device + session), request signing.
- `src/server/bunq/payment-requests.ts` — create / read request-inquiries.
- `src/server/bunq/supabase.ts` — service-role + anon Supabase clients.
- `api/payments/bunq/{request,status,webhook}.ts` — Vercel Node functions.

## Database

Migration `supabase/migrations/20260710120500_bunq_deposits.sql`:

- `bunq_api_contexts` — encrypted Bunq context per environment (service-role only).
- `voyage_booking_deposits` — one deposit per booking request (amount, status, Bunq id, share URL).

## Required environment variables (Vercel)

| Variable | Purpose |
| --- | --- |
| `BUNQ_API_TOKEN` | Bunq API key. |
| `BUNQ_USER_ID` | Bunq user id. |
| `BUNQ_MONETARY_ACCOUNT_ID` | Monetary account that issues the requests. |
| `BUNQ_SANDBOX` | `true` for the sandbox API, otherwise production. |
| `BUNQ_PERMITTED_IPS` | Optional, comma-separated allow-list (default `*`). |
| `SUPABASE_URL` | Supabase project URL (falls back to `VITE_SUPABASE_URL`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-only, never exposed to the client). |
| `SUPABASE_ANON_KEY` | Anon key to resolve the caller (falls back to `VITE_SUPABASE_PUBLISHABLE_KEY`). |
| `PUBLIC_SITE_URL` | Base URL for the post-payment redirect (default `https://biteproject.it`). |

To go live: set the production Bunq credentials, flip `BUNQ_SANDBOX=false`, and register the
webhook URL (`/api/payments/bunq/webhook`) as a Bunq NotificationFilter for
`REQUEST`/`MUTATION`/`PAYMENT` events.
