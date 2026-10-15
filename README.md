# puw-slot-bot

A Telegram bot that watches the online booking system of the **Pomeranian Voivodeship Office in Gdańsk
(PUW, Pomorski Urząd Wojewódzki)** and messages you as soon as a free appointment slot appears.

PUW releases slots in small batches that are gone within minutes. This bot checks the booking API every
minute and pings you on Telegram with the free dates, times and a direct booking link, so you don't
have to keep refreshing the website.

- 🔔 Notifies only about **new** dates, with no repeats on every poll or after a restart
- 🔒 Private by design: a single owner controls the bot and receives notifications, everyone else is ignored
- 🔧 Switch office or service at runtime with `/setbranch` and `/setservice`, no redeploy needed
- 🐳 Ships with a Dockerfile; runs on any VPS, Docker host or Railway

> The defaults target the **citizenship (_obywatelstwo_)** service in Gdańsk. Any other service, or any
> other office running Qmatic Web Booking, works too: see
> [Watching a different service or office](#watching-a-different-service-or-office).

---

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Bot commands](#bot-commands)
- [Watching a different service or office](#watching-a-different-service-or-office)
- [Deployment](#deployment)
- [TLS certificate note](#tls-certificate-note)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## How it works

```
every POLL_INTERVAL_SEC
        │
        ▼
GET …/branches/<BRANCH_ID>/dates;servicePublicId=<SERVICE_ID>       → list of free dates
GET …/branches/<BRANCH_ID>/dates/<date>/times;servicePublicId=…     → free times for each date
        │
        ▼
compare with dates already seen (stored in state.json)
        │
        ├── nothing new → log and wait
        └── new dates   → Telegram message to the owner with dates, times and a "Book now" link
```

1. **Baseline.** On the very first poll, and after you change the branch or service, the bot only *records*
   the dates that are already open. You aren't notified about slots that were there before you started.
2. **Polling.** After that, every `POLL_INTERVAL_SEC` seconds (60 by default, never less than 30) it asks the
   Qmatic REST API for free dates and then the free times for each date.
3. **Notifying.** If a date shows up that wasn't seen before, the owner gets a message. Seen dates are saved
   to `state.json`, so a restart doesn't cause duplicate notifications.
4. **Ownership.** The first person to send `/start` becomes the owner, unless you pin one with
   `OWNER_CHAT_ID`. Messages from any other chat are silently ignored.

The bot uses Telegram long polling, so it needs **no public URL, webhook or open port**. Outgoing internet
access is enough.

---

## Requirements

- **Node.js 20+** (or Docker)
- A **Telegram account**
- Network access to `rezerwacja.gdansk.uw.gov.pl:8445` (see
  [Troubleshooting](#connect-timeout--etimedout-when-polling) if it times out)

---

## Quick start

### 1. Create a Telegram bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot`, choose a display name, then a username ending in `bot` (e.g. `my_puw_slots_bot`).
3. BotFather replies with a token like `123456789:AAH...`. This is your `BOT_TOKEN`. Keep it secret.

### 2. (Optional) Find your chat ID

Pinning the owner with `OWNER_CHAT_ID` is recommended for any deployment whose disk may be wiped
(Docker without a volume, Railway, etc.). Otherwise a redeploy forgets the owner and someone else could
claim the bot with `/start`.

To get your ID, message [@userinfobot](https://t.me/userinfobot); it replies with your numeric `Id`.

### 3. Install

```bash
git clone git@github.com:Junk-debug/puw-slot-bot.git
cd puw-slot-bot
npm install
```

### 4. Configure

```bash
cp .env.example .env
```

Open `.env` and set at least `BOT_TOKEN` (and `OWNER_CHAT_ID` if you have it). Everything else has working
defaults; see [Configuration](#configuration).

### 5. Run

```bash
npm start
```

You should see:

```
Polling every 60s. Owner=(unclaimed) Branch=…e4918569 Service=…2d80b8e0
Baseline seeded: 3 date(s).
Bot started.
```

### 6. Claim the bot

Open your bot in Telegram and send `/start`. It replies that you're the owner. Send `/check` to see the
slots available right now. From then on, you'll get a message whenever new dates open up.

To test notifications end to end, send `/reset`: on the next poll you'll get a notification about every
currently free date.

> ⚠️ Always start the bot with the npm scripts (`npm start`, `npm run dev`, `npm run serve`) or Docker.
> Running `node`/`tsx` directly skips the extra TLS certificate and every request fails; see
> [TLS certificate note](#tls-certificate-note).

---

## Configuration

All settings are environment variables, read from `.env` locally or from your host's variables in production.

| Variable             | Required | Default                                                     | Description                                                                                                                  |
| -------------------- | :------: | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `BOT_TOKEN`          |    ✅    | –                                                           | Bot token from @BotFather.                                                                                                   |
| `OWNER_CHAT_ID`      |          | _(empty)_                                                   | Your Telegram chat ID. Pins the owner and overrides whatever is in `state.json`. Empty: the first `/start` claims the bot.    |
| `POLL_INTERVAL_SEC`  |          | `60`                                                        | Seconds between checks. Values below `30` are raised to `30`, to be polite to the server.                                    |
| `STATE_DIR`          |          | _(project root)_                                            | Directory for `state.json`. Point it at a persistent volume on hosts with an ephemeral disk.                                  |
| `PUW_BASE`           |          | `https://rezerwacja.gdansk.uw.gov.pl:8445/qmaticwebbooking` | Base URL of the Qmatic Web Booking instance.                                                                                 |
| `BRANCH_ID`          |          | Gdańsk PUW branch                                           | Initial 64-character branch (office) ID. Can be changed at runtime with `/setbranch`.                                        |
| `SERVICE_ID`         |          | Citizenship service                                         | Initial 64-character service ID. Can be changed at runtime with `/setservice`.                                               |
| `CUSTOM_SLOT_LENGTH` |          | `40`                                                        | Slot length in minutes, passed to the API as `customSlotLength`. Keep whatever the booking site itself sends.                 |

### State file

The bot keeps its runtime state in `state.json` (git-ignored):

```json
{
  "ownerId": 123456789,
  "branchId": "1cf1e3…",
  "serviceId": "2c5251…",
  "active": true,
  "initialized": true,
  "seenDates": ["2026-10-20", "2026-10-21"]
}
```

Branch and service changes made with `/setbranch` / `/setservice` are stored here and take priority over
`BRANCH_ID` / `SERVICE_ID`. To go back to the `.env` values, stop the bot and delete `state.json`.

---

## Bot commands

All commands are also listed in Telegram's command menu (the **/** button).

| Command              | What it does                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/start`             | First use: claims the bot. After that: resumes notifications.                                                    |
| `/stop`              | Pauses notifications. The bot keeps polling, so it doesn't re-notify about old dates when you resume.            |
| `/status`            | Shows whether notifications are on, the poll interval and the last 8 characters of the branch/service IDs.       |
| `/check`             | Fetches and shows every free date and time right now, with a booking link.                                       |
| `/config`            | Shows the full branch and service IDs.                                                                           |
| `/setbranch <id>`    | Switches to another branch (office). Takes a 64-character hex ID. Resets the baseline.                           |
| `/setservice <id>`   | Switches to another service. Takes a 64-character hex ID. Resets the baseline.                                    |
| `/reset`             | Forgets seen dates, so the next poll notifies about everything currently free. Handy for testing. Keeps settings. |

"Resets the baseline" means the next poll silently records the dates already open for the new target, and
you're only notified about dates that appear after that.

---

## Watching a different service or office

Branch and service IDs are 64-character hex strings that only show up in the booking site's API calls.
Here's how to find them:

1. Open the booking site, e.g.
   <https://rezerwacja.gdansk.uw.gov.pl:8445/qmaticwebbooking/#/>, in Chrome or Firefox.
2. Open DevTools (`F12` or `Cmd+Option+I`) → **Network** tab, and type `dates` into the filter box.
3. On the site, choose the office and the service you want, until the calendar appears.
4. A request like this shows up in the Network tab:

   ```
   …/rest/schedule/branches/1cf1e3e6…918569/dates;servicePublicId=2c5251d5…80b8e0;customSlotLength=40
   ```

   - the segment after `branches/` is the **branch ID**
   - the value of `servicePublicId=` is the **service ID**
   - `customSlotLength=` is the slot length; copy it to `CUSTOM_SLOT_LENGTH` if it differs from `40`

5. Apply the new IDs in either of two ways:
   - **At runtime:** send `/setbranch <branch id>` and/or `/setservice <service id>` to the bot. The change takes
     effect on the next poll and is saved in `state.json`.
   - **As defaults:** put them in `BRANCH_ID` / `SERVICE_ID` in `.env`. These only apply when there's no
     `state.json` yet, because saved runtime changes win.

**Another voivodeship office.** If its booking site is also Qmatic Web Booking (the URL contains
`/qmaticwebbooking/`), set `PUW_BASE` to that URL without the `/#/` part and find the IDs as described above.
If its server also sends an incomplete TLS chain, you may need a different intermediate certificate; see
[TLS certificate note](#tls-certificate-note).

---

## Deployment

The bot is a single long-running process with no inbound traffic. Anything that can keep a Node process or a
container alive works. Run **exactly one instance** per bot token: two instances fight over Telegram updates
(HTTP 409).

### Docker

```bash
docker build -t puw-slot-bot .

docker run -d --name puw-slot-bot --restart unless-stopped \
  --env-file .env \
  -e STATE_DIR=/data \
  -v puw-slot-bot-data:/data \
  puw-slot-bot
```

- `--env-file .env` passes your configuration in; the `.env` file itself is not copied into the image.
- The `/data` volume keeps `state.json` (owner, seen dates, runtime branch/service) across container rebuilds.
- Logs: `docker logs -f puw-slot-bot`.
- Update: `git pull`, then rebuild and recreate the container. The bot stops cleanly on `SIGTERM`.

### Railway

1. Create a new project → **Deploy from GitHub repo** and pick this repository. Railway detects the
   `Dockerfile` and builds it.
2. In the service's **Variables** tab, add `BOT_TOKEN`, `OWNER_CHAT_ID` and `STATE_DIR=/data`
   (plus any other variable from [Configuration](#configuration) you want to override).
3. Add a **Volume** to the service with mount path `/data`. Without a volume, `state.json` is lost
   on every deploy: you get re-notified about dates you've already seen, and `/setbranch` changes are lost.
4. Keep the service at **1 replica**. During a redeploy the old and new instances overlap for a few seconds;
   the bot logs `Polling stopped (… 409 …). Retrying in 10s…` and recovers on its own.

No public domain or port is needed.

### Plain Node (VPS, Raspberry Pi, …)

```bash
npm ci
npm run build
npm run serve
```

To keep it running and start it on boot, use a process manager. For example, with `pm2`:

```bash
npm install -g pm2
pm2 start npm --name puw-slot-bot -- run serve
pm2 save
pm2 startup
```

Use `npm run serve` rather than `node dist/index.js`, so the TLS certificate is loaded.

---

## TLS certificate note

The PUW server sends an **incomplete TLS certificate chain**: the intermediate Certum certificate is missing.
Browsers fill the gap automatically, but Node.js doesn't, and every request fails with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

Instead of turning TLS verification off, the repo ships the missing intermediate in
[`certs/certum-dv-tls-g2-r39.pem`](certs/certum-dv-tls-g2-r39.pem) and adds it to Node's trust store with
`NODE_EXTRA_CA_CERTS`:

- in the npm scripts (`start`, `dev`, `serve`)
- in the `Dockerfile`

Verification stays fully on. If you run Node any other way, set the variable yourself:

```bash
NODE_EXTRA_CA_CERTS=./certs/certum-dv-tls-g2-r39.pem node dist/index.js
```

---

## Troubleshooting

### `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `fetch failed`

The extra certificate isn't loaded. Start the bot via `npm start` / `npm run serve` / Docker, or set
`NODE_EXTRA_CA_CERTS` manually (see [TLS certificate note](#tls-certificate-note)).

### Connect timeout / `ETIMEDOUT` when polling

The booking server isn't reachable from where the bot runs. Check from the same machine:

```bash
curl -I https://rezerwacja.gdansk.uw.gov.pl:8445/qmaticwebbooking/
```

If that times out too, the problem is the network, not the bot. Typical causes are a firewall blocking
outgoing traffic to port `8445`, or the server rejecting traffic from your hosting region. Try a host in
Poland or elsewhere in the EU.

### `HTTP 4xx` or `Non-JSON response`

The API path or IDs are wrong, or the booking site changed. Check `/config`, then repeat the steps in
[Watching a different service or office](#watching-a-different-service-or-office) and compare against the
requests the website makes now.

### `Polling stopped (… 409: Conflict …)`

Another instance is using the same bot token. This is expected for a few seconds during a redeploy, and the bot
retries every 10 seconds. If it keeps happening, find and stop the other instance (an old container, a local
`npm run dev`, etc.).

### The bot doesn't reply at all

- Check the logs for `Bot started.`
- If `OWNER_CHAT_ID` is set, the bot ignores every chat except that one. Make sure it's your ID (see
  [step 2](#2-optional-find-your-chat-id)).
- If the bot was claimed by someone else, set `OWNER_CHAT_ID` to your ID and restart.

### No notifications even though slots appear

- `/status`: are notifications **enabled**? Send `/start` to resume them.
- You only get **new** dates. Dates that were already free at startup, or after `/setbranch` / `/setservice`,
  are part of the baseline. Use `/check` to see everything free right now, or `/reset` to be notified about
  all of it once.
- Look for `Poll error:` lines in the logs.

---

## Development

```bash
npm run dev        # run with auto-restart on file changes
npm run typecheck  # type-check without emitting
npm run build      # compile TypeScript to dist/
npm run serve      # run the compiled build
```

### Project structure

```
src/
  index.ts    Telegram bot: owner gate, commands, polling loop, notifications
  qmatic.ts   Qmatic REST client: builds URLs, fetches free dates and times, normalizes responses
  state.ts    Persistent state (owner, target, seen dates) in state.json
  config.ts   Reads and validates environment variables
certs/        Intermediate TLS certificate for the PUW server
Dockerfile    Two-stage build: compile TypeScript, then a slim runtime image
```

### Notes

- PUW opens bookings at most ~2 weeks ahead. New slots are usually released overnight or early in the morning
  and get taken quickly, so keep the bot running around the clock.
- Please keep the poll interval reasonable. The bot is meant to save you from refreshing the page, not to
  load-test a public service.
