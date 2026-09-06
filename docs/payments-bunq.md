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

1. User accepts the conditions in the confirmation modal.
2. After the booking request exists, the payment-method dialog asks the user to choose either:
   - **pay now**: open the Bunq `bunq.me` link and pay with card / Apple Pay / Google Pay or
     the methods available on Bunq. If the payer has a Bunq account for the same email, they
     may also receive/accept the request directly in the Bunq app;
   - **bank transfer**: show IBAN, holder, amount and mandatory reference.
3. The booking request is created via the existing `request_voyage_booking` RPC.
4. The client calls either `POST /api/payments/bunq/request` or
   `POST /api/payments/bunq/bank-transfer` with the new `bookingRequestId` and the user's
   Supabase access token.
5. The function recomputes the amount and stores a row in `voyage_booking_deposits`.
   For `bunq_link`, it creates a Bunq **request-inquiry** with `counterparty_alias` set to the
   authenticated payer email and returns the shareable `bunq.me` link. Bunq requires the
   counterparty even when `allow_bunqme` is enabled: if the payer uses Bunq with that email,
   the request can also appear in their Bunq app. For `bank_transfer`, it returns the fixed
   bank details plus the unique reference used for automatic reconciliation.
6. The booking's payment deadline is armed for 48 hours (`voyage_booking_requests.expires_at`).
   Bookings waiting only for admin approval do not expire.
7. The user is redirected to Bunq to pay, or sees the bank-transfer dialog with the unique
   reference to include in the transfer. Bank-transfer applications explicitly remain on hold
   and are not reviewed until the incoming payment matches both the expected amount and the
   reference.
8. Settlement is detected either by the Bunq **webhook** (`POST /api/payments/bunq/webhook`) or,
   as a fallback, by `GET /api/payments/bunq/status?bookingRequestId=...`, which re-checks the
   live request-inquiry status or scans incoming account payments by exact amount + reference.
   Either path flips the stored payment row to `paid` and clears the booking-level payment
   deadline once no pending deposits remain.

If Bunq env vars are missing, `/request` returns `503 not_configured`, the booking is still
created, and the user sees a "contribution link to follow" message — nothing breaks.

## Alternative contribution proposal & workaway (opt-in per voyage)

Voyages with `voyage_booking_settings.contribution_proposal_enabled` and/or `workaway_enabled`
let a solo candidate (`party_size` is fixed at 1 server-side — not offered for group bookings)
propose an alternative to the standard contribution instead of accepting it outright: a
different amount, a workaway trade (roles from the global `voyage_workaway_roles` catalog, CV/
portfolio upload to the private `workaway-applications` bucket), or both.

**The €20 fixed minimum is never part of the negotiation.** It is always collected in full
through the same `pending_payment` gate as the standard flow, before the application is even
visible to admin review — only the variable remainder is negotiable. Creation + proposal attach
is atomic (`request_voyage_booking_with_contribution_proposal`, single transaction) so a failed
attach can never leave a `pending_payment` application without its proposal recorded.

**The UI works in TOTAL terms (fixed + variable), not variable alone.** An earlier iteration
asked the candidate to propose only the variable share while the fixed €20 "added on top",
which was confusing and had a real bug (a €0 variable estimate made the percent-of-variable
floor mathematically unreachable for any positive minimum). The slider now represents the whole
contribution: floor = the €20 fixed itself (structural, not a configurable percentage — there is
no `contribution_proposal_min_percent` anymore, that column was dropped), ceiling =
`contribution_proposal_max_percent`% of the standard total (variable + €20), default position =
50% of the standard total. A workaway proposal always shows this same amount field (not a
separate optional step) so the candidate is never left assuming work replaces the fixed share.

**Negotiation is exactly one round.** Candidate proposes → admin
`admin_accept_voyage_booking_contribution_proposal` / `admin_counter_voyage_booking_contribution_proposal`
(counter floor: `max(€20, 50% of standard total)`) / reject (reuses the existing "Scarta"
rejection path, no new code — `refundPolicyPercent` already returns 100% for `admin_rejected`).
On a counter, the candidate can only `accept_voyage_booking_contribution_counter` or decline it
via `POST /api/bookings/status` with the new trigger `user_rejected_contribution_counter` (100%
refund of the €20 already paid) — there is no further back-and-forth.

`admin_set_voyage_booking_status` additionally refuses `admin_approved`/`user_confirmed` while
`voyage_booking_requests.contribution_proposal_status` is unresolved, or once accepted, while
the upfront deposit on the negotiated total (`voyage_booking_negotiated_balance_paid`) is still
unpaid — the balance is governed separately, exactly like any other payer (see next paragraph).

**24h settlement deadline once accepted (2026-09-06).** Either resolution — admin accepting the
candidate's own proposal, or the candidate accepting admin's counter — stamps
`voyage_booking_requests.contribution_settlement_deadline = now() + 24h` and enriches the
`contribution_proposal_accepted` notification with the amount actually due now and that
deadline. The agreed total is split exactly like a standard payer's (`depositTargetEur`: 50%
capped at €499 upfront, balance due the usual 15 days before departure) — **not** collected as
one lump sum as an earlier iteration did. `expire_unpaid_voyage_booking_contribution_settlement()`
(pg_cron, every 10 min) cancels the booking if the deposit is not paid by the deadline: the fixed
€20 already paid is forfeited (`refund_policy = 'contribution_settlement_deadline_missed'`), not
refunded — unlike an explicit rejection, which always refunds 100%. The deadline is cleared
(`clearBookingPaymentDeadlineIfSettled` / `admin_confirm_voyage_booking_payment`) the moment the
deposit settles by any path.

pg_cron cannot call the Bunq REST API, so `api/cron/reconcile-expired-bunq-links.ts` (same
10-minute cadence) does the Node-side half: for every deposit the settlement sweep cancelled
(tagged `voyage_booking_deposits.expiry_kind = 'contribution_settlement'`), it revokes the
still-unpaid Bunq request-inquiry (so the link stops being payable — see the same endpoint's
handling of the unrelated first-payment-gate case below), or, if a payment landed anyway (a race,
or a bank transfer that has no Bunq object to revoke), refunds it automatically via
`refundLateCancelledDeposit` (`src/server/bunq/refunds.ts`) and sends
`late_payment_after_cancellation` telling the payer that booking is no longer valid. This is the
opposite policy from the same endpoint's *legacy* branch (a late payment on a fresh application's
very first, pre-review deposit): there, the booking is reactivated instead (see "Known gap" below
for a related bug that surfaced while building this).

**Known gap, not yet fixed:** `admin_confirm_voyage_booking_payment` only reuses a deposit whose
status is still `pending` — for one the settlement sweep (or the legacy expiry sweep) already
cancelled, it falls through to inserting a new row with the same reference and hits the unique
constraint on `voyage_booking_deposits.reference`. `reconcile_stale_bunq_deposit` (added
2026-09-06) works around this for the automated cron path by reusing the cancelled row directly,
but the admin's own "Registra un pagamento ricevuto" button in `VoyageCandidatesPanel.tsx` would
still fail on exactly this case. Worth generalizing that RPC to reuse any of the booking's own
cancelled deposits, not only a pending one.

**Zero-due edge case.** If the candidate already holds another active application on the same
voyage, `shouldApplyContributionFixedMinimum` waives the €20 fixed to €0 for the new one — but
`resolveDepositPayer` refuses to create a payment request for a €0 amount, so nothing would ever
promote such a booking out of `pending_payment`. `settle_voyage_booking_payment_if_zero_due`
(called by `POST /api/bookings/settle-if-zero-due`) closes that gap: it re-runs
`resolveDepositPayer`'s authoritative price check server-side and, only if it confirms €0 is
genuinely due (and no deposit row exists yet for the booking — defense against bypassing a real
pending payment), promotes the booking directly.

Key tables/functions: `voyage_workaway_roles`, `voyage_booking_contribution_proposals` (history,
mirrors `voyage_booking_plan_changes`), `voyage_booking_requests.contribution_proposal_status` /
`.contribution_fixed_only_payment` / `.contribution_resolved_variable_cents`,
`attach_voyage_booking_contribution_proposal`. Migrations:
`supabase/migrations/20260810090000_voyage_workaway_roles_and_settings.sql` through
`20260811100000_contribution_proposal_total_based_slider.sql`. Client: `src/lib/booking-workaway-proposal.ts`,
`src/lib/booking-proposal-apply.ts`, `src/components/booking/ContributionProposalForm.tsx`. Admin
UI: `src/components/admin/VoyageCandidatesPanel.tsx`, per-voyage toggle in the "Candidature" tab of
`src/pages/AdminVoyageBookings.tsx`.

**Known gap, not addressed:** no financial deterrent against a no-show once a workaway proposal
is *accepted* (see [[24 - Termini e Condizioni]] in the Wiki) — deliberately not solved with a
"charge in full, refund at the end" holdback, since that would condition a refund on a subjective
assessment of the work performed, which reads closer to withholding pay for a job than a charter
deposit.

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
- `admin_set_voyage_booking_status()` refuses `admin_approved` / `user_confirmed` transitions
  while a `voyage_booking_deposits.status = 'pending'` row exists for the request, so bank-transfer
  applications cannot be reviewed/approved before reconciliation.

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
- ~~Schedule `expire_pending_booking_participants()`~~ — done in
  `20260817120000_multi_person_booking_fixes`: pg_cron job `expire-pending-booking-participants`,
  hourly, restricted to bookings that are still active.
- Configure `BUNQ_WEBHOOK_SECRET` in Vercel and include it in the Bunq callback URL as
  `?secret=...` (or send it as `x-bite-bunq-webhook-secret` if using a proxy). The webhook
  rejects unsigned callbacks before attempting to settle a deposit.
