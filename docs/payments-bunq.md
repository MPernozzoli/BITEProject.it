# Bunq voyage-contribution payments

The booking flow charges a **fair-share contribution to voyage out-of-pocket costs** via
Bunq before participation is confirmed. BITE is not presented as a charter, tourism
business, transport service, or other commercial activity: the copy must consistently frame
the voyage as a private trip the crew is already making, open to people who want to join by
fairly sharing part of the actual costs. Food expenses are managed on board during the voyage
and are not included in this amount.

## Amount

Computed server-side (never trusted from the client) in `src/lib/booking-deposit.ts`:

- Fixed minimum: €20 per person per voyage. It is applied to the user's first active
  booking on that voyage only; later bookings for additional legs on the same voyage skip
  this fixed part and charge only the variable leg contribution.
- Variable part: planned nautical miles for each selected leg × the voyage's configurable
  `booking_contribution_per_nm_eur` coefficient. Default: €0.90/NM.
- Leg modifiers apply additively to the variable part only:
  - night navigation: +10%;
  - offshore navigation ("navigazione d'altura", stored as `open_sea`): +20%;
  - dangerous navigation (`danger_level > 0`): +20%.
- Per-person amounts sum across the selected legs, with no per-person cap.
- Total charged = per-person amount **× party size**.
- UI copy should describe the amount as the participant's fair-share contribution to actual
  voyage costs, not as a fare, ticket price, service price, or charter fee.
- Bunq API payments are limited to €500 per single transaction. `/request` returns
  `409 bunq_amount_exceeds_single_transaction_limit` when the payer amount is above €500,
  so the client can route the user to bank-transfer instructions instead of creating an
  invalid Bunq request.

## Flow

1. User accepts the conditions in the confirmation modal and chooses either:
   - **pay now**: open the Bunq `bunq.me` link and pay with card / Apple Pay / Google Pay or
     the methods available on Bunq;
   - **bank transfer**: show IBAN, holder, amount and mandatory reference.
2. The booking request is created via the existing `request_voyage_booking` RPC.
3. The client calls either `POST /api/payments/bunq/request` or
   `POST /api/payments/bunq/bank-transfer` with the new `bookingRequestId` and the user's
   Supabase access token.
4. The function recomputes the amount and stores a row in `voyage_booking_deposits`.
   For `bunq_link`, it creates a Bunq **request-inquiry** without a prefilled counterparty
   and returns the shareable `bunq.me` link. This keeps payment pull-based from the payer's
   link instead of pushing a direct request to an email alias in the Bunq app. For
   `bank_transfer`, it returns the fixed bank details plus the unique reference used for
   automatic reconciliation.
5. The booking's payment deadline is armed for 48 hours (`voyage_booking_requests.expires_at`).
   Bookings waiting only for admin approval do not expire.
6. The user is redirected to Bunq to pay, or sees the bank-transfer dialog with the unique
   reference to include in the transfer.
7. Settlement is detected either by the Bunq **webhook** (`POST /api/payments/bunq/webhook`) or,
   as a fallback, by `GET /api/payments/bunq/status?bookingRequestId=...`, which re-checks the
   live request-inquiry status. Either path flips the stored payment row to `paid` and clears the
   booking-level payment deadline once no pending deposits remain.

If Bunq env vars are missing, `/request` returns `503 not_configured`, the booking is still
created, and the user sees a "contribution link to follow" message — nothing breaks.

## Server code

- `src/server/bunq/client.ts` — Bunq handshake (installation + device + session), request signing.
- `src/server/bunq/payment-requests.ts` — create / read request-inquiries.
- `src/server/bunq/supabase.ts` — service-role + anon Supabase clients.
- `api/payments/bunq/{request,status,webhook}.ts` — Vercel Node functions.

## Database

Migration `supabase/migrations/20260710120500_bunq_deposits.sql`:

- `bunq_api_contexts` — encrypted Bunq context per environment (service-role only).
- `voyage_booking_deposits` — existing storage table for one contribution payment per booking request
  or participant (amount, status, Bunq id, share URL).
- `expire_pending_voyage_booking_payments()` — service-role RPC scheduled hourly with `pg_cron`;
  cancels active bookings with pending contribution payments older than 48 hours and marks their
  pending deposit rows as `cancelled`.

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

## Multi-person bookings (participants)

When a booking is for more than one person, after creating the request the lead is sent to
`/bookings/:id/participants` to:

1. enter each co-traveller's first name, last name and email;
2. choose the payment mode — **pago per tutti** (`lead_pays_all`: the lead pays contribution ×
   party size, guests only accept the terms) or **pago per me** (`each_pays_own`: the lead
   pays their own share, each guest pays their own on acceptance);
3. send the invitations and pay their own share.

Each guest receives the `voyage-participant-invite` email and, from `/bookings`, sees a
**pending invitation**: they accept the same conditions (and pay their contribution if
`each_pays_own`) or decline. Seats are held from booking time; guests that don't complete
before `expires_at` (7 days) are released by `expire_pending_booking_participants()`.

Tables & functions: `voyage_booking_participants`, `voyage_booking_requests.payment_mode`,
`voyage_booking_deposits.participant_id`; RPCs `set_booking_participants`,
`accept_booking_participation`, `decline_booking_participation`, `get_my_participations`,
`expire_pending_booking_participants`. Endpoints: `/api/bookings/invite`,
`/api/payments/bunq/request` (now `participantId`-aware).

**Follow-ups before production:**
- Redeploy the `send-transactional-email` edge function so the new invite template is picked up.
- Schedule `expire_pending_booking_participants()` (pg_cron or a cron edge function) — it is
  granted to `service_role` and is not called automatically yet.
- Configure `BUNQ_WEBHOOK_SECRET` in Vercel and include it in the Bunq callback URL as
  `?secret=...` (or send it as `x-bite-bunq-webhook-secret` if using a proxy). The webhook
  rejects unsigned callbacks before attempting to settle a deposit.
