# Sendline

Self-hosted SMS and email marketing that runs on your laptop and sends through
your own Android phone and SIM. No per-message fee, no vendor holding your
contact list, nothing exposed to the open internet.

Forked from [ampilares/selfhostsim](https://github.com/ampilares/selfhostsim),
which solved the hard half: getting bytes to a SIM and a delivery receipt back.
This adds the marketing half — contacts, consent, templates, campaigns, pacing,
reports, an email channel and a UI — and removes the GoHighLevel coupling.

**The full design, with diagrams, is [`docs/blueprint.html`](docs/blueprint.html).**
Open it in a browser. It is one self-contained file and explains the whole
system better than this README can.

---

## What it is for

200–500 messages a day, SMS and email, from one screen that a non-technical
person can drive — plus an HTTP API your other apps can call for transactional
messages like order confirmations.

```
your other apps ─┐
                 ├─→ API ─→ audience ─→ render ─→ queue ─→ pacer ─┬─→ Android phone + SIM
web UI ──────────┘                                                └─→ SMTP relay
```

## The four rules it will not bend

1. **Nobody gets a message they did not ask for.** Consent is a field with a
   source and a timestamp, not a habit. `STOP` suppresses in seconds, and
   suppression outranks every other table — no CSV import can undo it.
2. **The phone paces itself.** 10 a minute, a hard daily cap, nothing outside
   09:00–20:00. A phone that emits 500 texts in four minutes looks exactly like
   a spam bot to a carrier, and the punishment is your SIM.
3. **Nothing leaves your laptop but the message.** One Mongo volume, Tailscale
   only, no port forwarded, no analytics.
4. **Every send is explainable a year later.** Who, when, which template, the
   exact rendered text, and what the carrier said back — stored, not recomputed.

---

## Getting started

### 1. Secrets

```bash
./scripts/generate-secrets.sh
```

Writes `.env` and `api/.env` with real random secrets and prints the admin
password once. Fill in the `FIREBASE_*` and `SMTP_*` blocks by hand afterwards.

> The upstream project shipped `JWT_SECRET=secret` and an admin password of
> `selfhostsim`, and nothing in the code makes you change them. This script
> exists so doing the right thing is the easy thing.

### 2. Bring it up

```bash
docker compose up -d --build
```

| Service | Address | Notes |
|---|---|---|
| Web UI | `http://localhost:3000` | installable to a phone home screen |
| API + Swagger | `http://localhost:3001` | generated API docs at the root |
| MongoDB | `127.0.0.1:27018` | loopback only |
| Redis | `127.0.0.1:6379` | loopback only |

There is no `mongo-express`. It shipped on `:8081` with admin enabled and
default credentials; use `docker exec -it sendline-db mongosh` instead.

### 3. Tailscale

So the phone and your other devices can reach it from any network, with no port
forwarding and no certificate to renew.

```bash
brew install tailscale && sudo tailscale up
tailscale ip -4          # the 100.x.y.z to point everything at
```

Install the Tailscale app on the phone and sign in with the same account.

### 4. The Android gateway

**Set the API address before you build anything.** In `android/gradle.properties`:

```properties
SENDLINE_API_BASE_URL=http://100.x.y.z:3001/api/v1/
```

> Upstream hardcoded `https://api.selfhostsim.com/api/v1/` here for *both* the
> dev and prod build types. Built unmodified, the phone registers with someone
> else's server, hands it your API key and forwards every SMS it receives
> there. This fork reads the address from a property instead, and the Firebase
> analytics and Crashlytics dependencies have been removed outright.

Then:

1. Create a free Firebase project, download `google-services.json` into
   `android/app/src/prod/`, and copy the service-account values into `api/.env`.
2. Build and install: `cd android && ./gradlew assembleProdDebug`
3. In the app, paste an API key generated from the Settings screen, enable the
   gateway, grant SMS permissions, and **turn battery optimisation off** — this
   is the single most common cause of a gateway that silently stops working.

---

## Layout

```
api/     NestJS. Gateway (forked) + the marketing layer (new).
  src/gateway/      devices, send-sms, delivery status  [from upstream]
  src/contacts/     contacts, consent, CSV import, phone normalisation
  src/lists/        static lists and saved dynamic segments
  src/templates/    merge tags, SMS segment counting
  src/campaigns/    audience resolution, the pacer, the Send ledger
  src/suppression/  STOP matching and the do-not-contact list
  src/email/        SMTP channel
  src/messaging/    POST /v1/messages — the transactional API
android/ The gateway app  [from upstream, de-telemetried and re-pointed]
web/     Next.js UI, installable as a PWA
docs/    blueprint.html — the design
```

## The API your other apps call

```bash
curl -X POST http://100.x.y.z:3001/api/v1/messages \
  -H 'x-api-key: ...' -H 'content-type: application/json' \
  -d '{"channel":"sms","to":"+9779812344112","template":"order-shipped",
       "vars":{"first_name":"Asha","order":"1182"},"lane":"transactional"}'
```

Transactional sends skip pacing and quiet hours — an order confirmation must
never wait behind 400 promos. They never skip the consent check.

## Tests

```bash
cd api && npx jest
```

Unit tests cover the parts where a bug is expensive and silent: phone
normalisation, CSV parsing, merge-tag rendering, SMS segment counting,
opt-out keyword matching, audience resolution and the pacer.

## Backups

The whole system is one volume. Losing it loses every contact and every consent
record, and consent is the one thing you cannot reconstruct.

```bash
docker run --rm -v sendline_data:/d -v ~/Backups:/b alpine \
  tar czf /b/sendline-$(date +%F).tgz /d
```

## Licence

AGPL-3.0, inherited from upstream.
