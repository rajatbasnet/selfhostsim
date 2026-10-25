# Sendline web console

The browser UI for Sendline: a self-hosted SMS + email marketing tool that sends
through your own Android phone. One codebase for the laptop console and the
phone home-screen app.

## Run it

```bash
cd web
npm install
cp .env.example .env.local      # point it at your API if it is not on localhost:3001
npm run dev                     # http://localhost:3000
```

Production:

```bash
npm run build
npm start                       # serves on port 3000
```

Sign in with the same username and password you created in the API
(`POST /auth/register`, or the Swagger UI the API serves at its root).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001/api/v1` | Where the Sendline API lives. Baked in at build time. |

Nothing else. Auth is a JWT from `POST /auth/login`, kept in `localStorage`.

## Install it on a phone

Open the URL once in Safari (iOS) or Chrome (Android), then
**Share → Add to Home Screen**. The manifest, icons and service worker in
`public/` make it install like an app. Over Tailscale it works from anywhere,
which is the point: you can pause a bad send from a bus.

## What is where

```
src/app/
  login/                 sign in
  (app)/                 everything behind the sidebar
    page.tsx             dashboard: is the phone alive, what is sending
    contacts/            people, consent column, CSV import, add one
    lists/               groups of people
    templates/           reusable messages with live SMS segment count
    campaigns/           list · new/ three-step composer · [id]/ report
    inbox/               replies, newest first, Reply / Suppress
    reports/             finished campaigns
    settings/            phone, pacing knobs, SMTP, API keys, do-not-contact
src/components/          shell, status pill, UI primitives, template editor
src/lib/                 typed API client, SMS maths, merge tags, CSV parser
public/                  manifest.json, sw.js, icons, offline page
```

## Design rules this UI follows

- Every number carries the word that explains it ("112 sent today", never "112").
- The phone status pill is on every screen; the real failure mode is a phone
  that quietly went offline.
- Consent is a visible column. Someone marked STOP stays searchable but can
  never be put in a send.
- The composer's right-hand pane shows the first real recipient's real message,
  the true audience count, who is held back and why, and how long it will take.
- Reports explain every message that was not sent.
- No raw JSON, no stack traces, no bare `undefined`. If the API is down you get a
  sentence and a Try again button.

Dark mode follows the system setting.
