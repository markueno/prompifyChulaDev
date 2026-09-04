# Email — setup and go-live (Resend)

Email is **already built**. `app/lib/email.ts` is a dependency-free Resend client (there is no
`resend` package to install) with five templates wired into the app:

| Template | Fires when | Sent from |
|---|---|---|
| Verification | Account registered | `api.auth.register.ts:209` |
| **Welcome** | Verification link clicked | `api.auth.verify.ts` |
| Password reset | Reset requested | `api.auth.forgot-password.ts` |
| Invitation | Someone is invited to a project | `api.chats.$id.invite.ts:42` |
| **Inactivity nudge** | 30 days idle, again at 60 | `api.cron.inactivity.ts` |

What follows is configuration, not construction.

> Email stays inert until `RESEND_API_KEY` is set — every template logs to the console instead of
> sending. Nothing breaks by leaving it unset; people simply never receive mail.

## What changed from SendGrid

SendGrid has been removed entirely — `@sendgrid/mail` is gone from `package.json`, and
`SENDGRID_API_KEY` is no longer read anywhere. The transport is the only thing that changed; all
four pre-existing templates are untouched and keep working.

| Old | New |
|---|---|
| `SENDGRID_API_KEY` | `RESEND_API_KEY` |
| `FROM_EMAIL` | `FROM_EMAIL` (unchanged) |
| — | `FROM_NAME` (optional, defaults to `Prompify`) |

**Remove `SENDGRID_API_KEY` from prod `.env` once this is live**, so nobody later mistakes a dead
key for a working config.

---

## Part A — create the Resend account

1. Sign up at [resend.com](https://resend.com).
2. **Domains → Add Domain → `prompify.com`.**
3. Resend prints DNS records — typically an `MX` and two `TXT` (SPF and DKIM). Add them at whoever
   hosts prompify.com's DNS, then hit **Verify**.

   This is the step that actually gates everything. Until the domain reads **Verified** (not
   *Pending*), every send from `noreply@prompify.com` is refused with a 403 and no mail goes out.
   DNS propagation is usually minutes but can take hours — start here, not last.

   Do **not** work around a pending domain by sending from Resend's shared `onboarding@resend.dev`.
   It only delivers to your own account address, so it will look like it works for you and silently
   fail for every real customer.
4. **API Keys → Create API Key**, permission **Sending access**. Copy the `re_...` value — it is
   shown once.

### Why a fresh domain needs care

A brand-new sending domain has no reputation, so early mail lands in spam more often. Two things in
the build already account for this, and both are worth leaving alone:

- The welcome email is sent **after** verification, not at signup, so only confirmed addresses are
  ever mailed.
- The inactivity job only selects `is_verified = TRUE` accounts, and stops after two nudges.

Set up DMARC on the domain once DKIM/SPF verify, and don't bulk-mail the back catalogue on day one
(see D2).

---

## Part B — prove it locally

### B1. Test the credentials before touching the app

```bash
RESEND_API_KEY=re_... FROM_EMAIL=noreply@prompify.com ./scripts/test-resend.sh you@example.com
```

The app fails soft on email — a refused send is logged and the request carries on — so a bad key is
otherwise invisible until someone reports never getting a verification link. This script makes that
failure loud. A 401/403 here means the key is wrong or the domain isn't verified; fix that before
going further.

### B2. Local env

```
RESEND_API_KEY=re_...
FROM_EMAIL=noreply@prompify.com
FROM_NAME=Prompify
APP_URL=http://localhost:5173
EMAIL_VERIFICATION_REQUIRED=true
```

### B3. Walk the signup path

Register a fresh account, then check `email_logs` rather than the Resend UI:

```sql
SELECT email_type, delivered, error_message, sent_at
FROM email_logs WHERE user_id = '<userId>' ORDER BY sent_at;
-- expect: verification / true
```

Click the verification link, then re-run it:

```sql
-- expect a second row: welcome / true
```

`delivered = false` with an error message is a send that Resend refused — the message says why.
Re-clicking a used verification link must **not** produce a second welcome row; the `is_verified`
guard in `verifyToken` returns early.

---

## Part C — go live

Live keys go **only** into prod's `~/prompifyChulaDev/.env`. Never into the repo, a commit
message, or a doc — `details/security/SECURITY_NOW.md` CRIT-2 is an open finding about secrets
already in this repo's git history. `.env.example` carries the names with empty values only.

1. Back the file up first — it is the rollback:
   ```bash
   cd ~/prompifyChulaDev && cp .env .env.bak.$(date +%F)
   ```
2. Add to prod `.env`, and delete the `SENDGRID_API_KEY` line:
   ```
   RESEND_API_KEY=re_...
   FROM_EMAIL=noreply@prompify.com
   FROM_NAME=Prompify
   ```
   `APP_URL` and `CRON_SECRET` are already set; the email links and the cron endpoint both depend
   on them.
3. Deploy per `DEPLOY.md`, then recreate **both** containers — `cron` is an aux service that
   `up -d app` does not touch, and it carries the new nightly schedule:
   ```bash
   sudo docker compose -f docker-compose.prod.yaml --profile production up -d --build app
   sudo docker compose -f docker-compose.prod.yaml --profile production up -d cron
   sudo docker compose -f docker-compose.prod.yaml --profile production exec app printenv | grep -E 'RESEND|FROM_'
   ```
   An env var edited in `.env` but missing here means the container was restarted rather than
   recreated — `up -d` recreates it, `restart` does not.
4. Register one real account on prod and confirm both the verification and welcome mails arrive,
   then check `email_logs` as in B3.

---

## Part D — turn on the inactivity nudges

The cron container already calls the endpoint nightly at ~04:45 UTC
(`docker-compose.prod.yaml`). It runs **dry-run by default** — it mails real customers, so sending
is an explicit choice.

### D1. Read the dry run first

```bash
curl -s -X POST http://localhost:5173/api/cron/inactivity \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

```json
{ "mode": "dry-run", "due": 42, "sent": 0, "more": false,
  "preview": [ { "email": "...", "daysInactive": 63, "nudgeNumber": 1 } ] }
```

`due` is how many people would be mailed **on the first run**. Check it against the database before
switching it on:

```sql
SELECT COUNT(*) FROM users
WHERE is_verified = TRUE
  AND COALESCE(last_login, created_at) < NOW() - INTERVAL '30 days';
```

### D2. The first run is the big one

Every account that has ever gone quiet is due at once — the backlog, not the daily trickle. If
`due` is in the hundreds on a domain verified last week, that single batch is what gets the domain
marked as a spam source.

Ramp it instead. The endpoint takes a `limit`:

```bash
curl -s -X POST "http://localhost:5173/api/cron/inactivity?apply=true&limit=50" \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

Run that manually for a few days, watching Resend's bounce and complaint rates, before letting the
nightly cron send unlimited. `more: true` means the batch was saturated and a backlog remains.

### D3. Switch the cron to apply

Edit `docker-compose.prod.yaml`, adding `?apply=true` to the inactivity line:

```
curl -s -X POST \"http://app:5173/api/cron/inactivity?apply=true\" ...
```

Then `sudo docker compose -f docker-compose.prod.yaml --profile production up -d cron`. Steady
state is small — only accounts crossing 30 or 60 days that day.

### D4. Tuning

Both thresholds are constants in `app/lib/engagement/inactivity.server.ts`:

| Constant | Default | Effect |
|---|---|---|
| `INACTIVITY_DAYS` | 30 | First nudge at 30 days; the second waits a further 30 (60 total) |
| `MAX_INACTIVITY_NUDGES` | 2 | Reminders per lapse, then silence |

Signing in resets the clock, so someone who returns and lapses again is nudged afresh. Raising
`MAX_INACTIVITY_NUDGES` mails dormant mailboxes indefinitely — that is how a sender reputation is
spent, and the cap exists on purpose.

---

## Rollback

Restore `.env.bak.<date>` and re-run the `up -d` commands from C3. Emptying `RESEND_API_KEY` stops
all sending immediately without breaking any request path — every template falls back to logging.
That is the fastest kill switch and needs no code change.

To stop only the nudges, remove `?apply=true` from the cron line and recreate `cron`. Nothing else
is affected; the job writes no account state.

---

## Related

- `STRIPE-SETUP.md` — billing configuration, including **Part C** for the annual plan price ids.
- `DEPLOY.md` — the deploy procedure referenced in C3.
