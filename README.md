# mHustle

A private, single-user CRM and work-management app for corporate client work. It is an installable web app (PWA) for **iPhone Safari** and **Windows browsers**, backed by a secure cloud database, scheduled jobs and push notifications. **Everything runs on free tiers.**

It has six sections: **New Client · All Clients · Feedback · Follow Up · Report · Hustle Tasks**.

---

## 1. Architecture and why

| Need | Solution | Free? |
|---|---|---|
| App on iPhone and Windows | React + TypeScript PWA (`web/`), installable to the iPhone Home Screen | ✅ |
| Hosting | Cloudflare Pages (recommended) or Netlify | ✅ |
| Database, login, privacy | Supabase Postgres in the Singapore region, email + password sign-in, Row Level Security on every table | ✅ Free plan |
| Follow-up rules | Postgres triggers (`supabase/migrations/0001_schema.sql`). They run the same way from any device, so there are no duplicates and nothing is lost | ✅ |
| Friday 11:59 PM report | `pg_cron` → Edge Function `report`. Runs when the app is closed | ✅ |
| Push notifications | Web Push (VAPID) sent by the Edge Function `tick` every 15 minutes | ✅ |
| iPhone / Mac Calendar | Subscribed calendar feed `web/api/calendar` (Vercel) — automatic, with 7d/2d/1d/2h alerts | ✅ |
| Apple Reminders | iOS Shortcut "mHustle Sync" ↔ `web/api/reminders-sync` (Vercel). See [docs/APPLE_SHORTCUT.md](docs/APPLE_SHORTCUT.md) | ✅ |

### Why not iCloud / CloudKit?

I investigated CloudKit. CloudKit JS can reach a user's private database from a browser after Apple ID sign-in. However, it is unsuitable here for three reasons:

1. Creating a CloudKit container requires the **paid Apple Developer Program** ($99/yr).
2. CloudKit's server-to-server keys only work with the *public* database. Nothing could read your *private* records on a schedule, so the **Friday report and follow-up notifications could not run while the app is closed**.
3. CloudKit has no server-side jobs, triggers or push sender of its own.

Supabase meets all the requirements at no cost and keeps the data in Singapore. Browser local storage is used **only** for unsaved form drafts and the login session. It does not sync, and the cloud database is the source of truth.

---

## 2. Deploy (about 30–45 minutes, once)

You need: a free [Supabase](https://supabase.com) account, a free [Cloudflare](https://pages.cloudflare.com) account, a free GitHub account, and Node.js 20+ on any computer (for the two CLI steps).

### Step 1: Create the database

1. Supabase → **New project**. Region: **Southeast Asia (Singapore)**. Save the database password.
2. **SQL Editor → New query**: paste and run `supabase/migrations/0001_schema.sql`, then `0002_sync_and_schedules.sql`, `0003_delete_calendar_sync.sql`, `0004_complete_postpone.sql`, `0005_shared_workspace.sql` and `0006_whatsapp.sql`. To add a colleague, create their login under Authentication → Users; everyone with a login shares the same data.

### Step 2: Lock down sign-in (single user)

1. **Authentication → Users → Add user → Create new user**: enter your email and a strong password, and tick **Auto Confirm User**.
2. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". After this, nobody else can create an account.

### Step 3: Generate secrets

```bash
npx web-push generate-vapid-keys     # gives a Public Key and a Private Key
openssl rand -hex 32                 # CRON_SECRET (or any random 64-character string)
```

### Step 4: Deploy the server functions

```bash
npm i -g supabase
supabase login
cd mhustle                           # this folder
supabase link --project-ref YOUR-PROJECT-REF
supabase secrets set CRON_SECRET=... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
supabase functions deploy report --no-verify-jwt
supabase functions deploy tick --no-verify-jwt
```

`--no-verify-jwt` is intentional. Each function checks its own credential instead: the cron secret, the Shortcut sync token, or your sign-in token.

### Step 5: Turn on the schedules

Open `supabase/setup/schedules.sql`, replace the two placeholders (your project URL and the same `CRON_SECRET`), and run it in the SQL Editor. This creates two scheduled jobs:

- `mhustle-friday-report`: `59 15 * * 5` UTC = **Friday 11:59 PM Singapore time**
- `mhustle-tick`: every 15 minutes (notifications, plus a catch-up if a Friday run was ever missed)

### Step 6: Host the app

1. Push this folder to a **private** GitHub repository.
2. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → choose the repository.
   - Root directory: `web`. Build command: `npm run build`. Output directory: `dist`.
   - Environment variables (see `web/.env.example`):
     `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Supabase → Project Settings → API), `VITE_VAPID_PUBLIC_KEY`.
3. Deploy. You get an address like `https://mhustle.pages.dev`.
4. Optional hardening: `supabase secrets set APP_ORIGIN=https://mhustle.pages.dev` limits which website may call the report function.

> Vercel's free Hobby plan also works technically, but its terms restrict it to non-commercial use. Cloudflare Pages has no such restriction.

### Step 7: Install on your devices

- **iPhone (iOS 16.4+):** open the address in **Safari** → Share → **Add to Home Screen**. Open mHustle from the icon, sign in, then tap **⚙ → Enable notifications**. iOS only allows web push for Home Screen apps.
- **Dell / Windows:** open the address in Edge or Chrome, sign in, and tap **⚙ → Enable notifications**. You can optionally use "Install app" from the browser menu.
- **Apple Reminders:** follow [docs/APPLE_SHORTCUT.md](docs/APPLE_SHORTCUT.md).

---

## 3. How the rules work

| Trigger | What happens automatically | Apple Reminders list |
|---|---|---|
| Appointment saved | 4 alerts: 7 days, 2 days, 1 day and 2 hours before Appointment Date/Time | Clients |
| Lesson saved | 4 alerts from Lesson Date From + Time From. The "To" date and time are kept on the record | Clients |
| Potential client, Emailed unticked | **Initial-email** task (High priority). Push repeats every 4 h (configurable) until done | Follow Up |
| Emailed ticked (in New Client, All Clients, or by ticking the initial-email task) | Records the timestamp, completes the initial-email task, and creates **one** follow-up for the next Monday (a Monday tick → the following Monday). One push at 9:00 AM that Monday | Follow Up |
| Feedback submitted for an Appointment client | **Urgent** follow-up linked to that feedback entry (one per entry; never reopened). Push repeats every 4 h until ticked | Follow Up |
| Follow-up past its due time and unticked | Shown under **Miss** with its original due date and priority until ticked. Never deleted | (kept) |
| Follow-up ticked | Moves to **Completed** with a timestamp. Alerts stop and the reminder is removed | removed |
| Hustle Task saved | 4 alerts from Date + Time (9:00 AM if no time is set) | Hustle Task |

**Due times** (configurable in ⚙ Settings): an initial email is due 24 h after the client is added, urgent feedback follow-ups are due 24 h after the feedback, and next-Monday follow-ups are due by 11:59 PM that Monday. Quiet hours are 10 PM–8 AM by default, so no pushes are sent overnight.

**Edge cases handled:**

- **Unticking Emailed:** cancels the pending Monday follow-up and opens a fresh initial-email task. Completed history is untouched.
- **Changing a Potential client to an Appointment or Lesson:** cancels that client's open potential-client tasks.
- **Duplicate prevention:** submitting a form twice cannot create a duplicate. Each draft carries its own ID, and the database has unique rules for every follow-up type.

### The weekly report

- **Reporting period:** Saturday 00:00 to Friday 23:59 Singapore time. Appointments are selected by appointment date; feedback is selected by creation date, including feedback from potential clients.
- **Seven sections:** Executive Summary · Appointment Summary · Client Feedback · Training Interests and Opportunities · Challenges and Pain Points · Recommended Follow-Up Actions · Weekly Conclusion.
- **No invention.** The generator only states counts and **quotes your own remarks and feedback verbatim**, grouped by theme. It never says an appointment took place unless feedback was recorded after its scheduled time. It labels recommendations as recommendations, and it states when information is insufficient.
- **Versions.** Manual generation always creates a new **version**, and earlier versions are never overwritten. You are asked to confirm before creating another version for the same week. Automatic reports are limited to one per week.

**AI writing (optional, off by default).** The default generator is rule-based and free, and it sends no data anywhere. To have Claude polish the wording:

```bash
supabase secrets set AI_REPORTS=on ANTHROPIC_API_KEY=sk-ant-...
```

This is a **paid** API (a few cents per report). When enabled, the week's draft report is sent to Anthropic, including client names, companies, remarks and feedback. Anthropic does not train on API data by default. If the AI call fails, the rule-based report is saved instead. I do not recommend free AI tiers that may use submitted data for product improvement, because the reports contain client information.

---

## 4. Security and privacy

- **Private by default.** Row Level Security restricts every table to your user ID. Sign-up is disabled, and the browser key cannot read anything without your login.
- **Server-controlled follow-ups.** The app can only *tick* follow-up tasks. Creation, due dates and priorities are set by the database, and tampering is rejected.
- **Secrets stay on the server.** The service-role key, VAPID private key and AI key exist only as Supabase secrets. The cron secret is stored in Supabase Vault. The Shortcut token is stored as a SHA-256 hash and shown to you only once.
- **Encrypted and not indexed.** All traffic uses HTTPS, and the site sends `noindex`.

---

## 5. What is operational vs. needs setup

| Feature | Status |
|---|---|
| All six sections, forms, validation, search, filters, edit flows, feedback history, report history and copy | Works as soon as it is deployed |
| Follow-up automation, Miss detection, Completed history | Works as soon as it is deployed (database triggers) |
| Friday automatic report | Needs Step 5 (scheduled jobs) |
| Push notifications | Needs VAPID keys (Steps 3–4) and you tapping **Enable notifications** on each device. On iPhone it requires a Home Screen install and iOS 16.4+ |
| Apple Reminders | Needs the Shortcut ([docs/APPLE_SHORTCUT.md](docs/APPLE_SHORTCUT.md)). It syncs whenever the Shortcut runs (on your automation schedule or manually), not instantly |
| Supabase free-plan pausing | Free projects pause after about a week with no activity. The 15-minute job and normal use should keep it active, but if it ever pauses, click **Restore** in the dashboard. No data is lost |

Deleting clients is deliberately not offered in the app, to prevent accidental data loss. If you need to remove a test record, use Supabase → Table Editor.

---

## 6. Development

```bash
cd web && cp .env.example .env.local   # fill in values
npm install && npm run dev             # http://localhost:5173
npm run build                          # type-check + production build

cd ../supabase && deno test tests/     # report generator + Singapore date logic
# tests/rules_test.sql exercises every follow-up rule against a local Postgres (see file header)
```

Project layout:

```
web/                      React + TypeScript PWA
  api/calendar.ts         subscribed calendar feed (Vercel function)
  api/reminders-sync.ts   Apple Shortcut bridge (Vercel function)
  src/sections/           NewClient, AllClients, Feedback, FollowUp, Report, HustleTasks
  src/sw.ts               service worker (offline shell + push)
supabase/
  migrations/             schema, RLS, triggers (business rules)
  functions/report        manual + Friday report
  functions/tick          push notifications + report catch-up
  functions/_shared       time.ts, report.ts (shared with the web app)
  setup/schedules.sql     pg_cron jobs
docs/APPLE_SHORTCUT.md
```
