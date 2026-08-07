# Deploying to Vercel

Follow these in order. Steps 4 and 6 are the two people usually miss, and both
cause the same symptom: invite links that go nowhere.

---

## Before you start

There is **no git repository** in this project, so the fastest route is Vercel's
own CLI, which uploads the folder directly. (You can move to GitHub later for
automatic deploys — see the last section.)

You will need:

- a Vercel account — free, sign up at vercel.com
- the values in your local `.env.local` file, which you will copy across

---

## 1 · Check it builds

The dev server and the build both write to `.next`, so **stop the dev server
first** (Ctrl-C in that terminal), then:

```
npm run build
```

It must finish without errors. If it fails, deployment will fail the same way —
fix it here where the message is easier to read.

---

## 2 · Deploy

In the project folder:

```
npx vercel login
npx vercel
```

Answer the prompts:

| Prompt | Answer |
|---|---|
| Set up and deploy? | **y** |
| Which scope? | your own account |
| Link to existing project? | **n** |
| Project name? | `appraise` (or anything) |
| In which directory is your code? | `./` |
| Modify build settings? | **n** — Next.js is detected |

It will print a URL like `https://appraise-xxxx.vercel.app`. **Copy it.**

At this point the app is online but will not work yet — it has no settings.

---

## 3 · Add the settings

Vercel dashboard → your project → **Settings** → **Environment Variables**.

Add each of these. Tick **all three** environments (Production, Preview,
Development) unless noted.

| Name | Value | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://jzhgwcgiksraprmwrcpj.supabase.co` | already known |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | copy from `.env.local` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | copy from `.env.local` | Supabase → Settings → API. **Secret — server only** |
| `NEXT_PUBLIC_APP_URL` | the URL from step 2 | see step 4 |
| `MAYTAPI_PRODUCT_ID` | copy from `.env.local` | Maytapi console |
| `MAYTAPI_PHONE_ID` | copy from `.env.local` | Maytapi console |
| `MAYTAPI_API_TOKEN` | copy from `.env.local` | Maytapi console. **Secret** |
| `RESEND_API_KEY` | copy from `.env.local` — **without the quotes** | resend.com/api-keys. **Secret** |
| `MAIL_FROM` | `Appraise <noreply@yourdomain.com>` | see step 5 |
| `CRON_SECRET` | copy from `.env.local` | any long random string. **Secret** |
| `DEFAULT_COUNTRY_CODE` | `+91` | — |

> **Do not paste the quotes.** In `.env.local` the Resend key is written
> `RESEND_API_KEY="re_..."`. Vercel's box takes the value only: `re_...`

---

## 4 · Point the app at itself

`NEXT_PUBLIC_APP_URL` is what every invite link is built from. Until it is the
real address, links open nothing — see §P28 in CLAUDE.md.

Set it to the URL from step 2, with **no trailing slash**:

```
https://appraise-xxxx.vercel.app
```

**Then redeploy.** `NEXT_PUBLIC_*` values are baked in when the app is built, so
changing one does nothing until the next build:

Deployments → the top one → ⋯ → **Redeploy**

---

## 5 · Email

Two ways. Pick one — whichever credentials you set decide which is used.

### Option A · Your Gmail account (no DNS, quickest)

Sends as `harshali.linkd@gmail.com`. Roughly **500 emails a day**, and the
address your employees see is a personal one.

1. Turn on **2-Step Verification**: myaccount.google.com/security
   (App Passwords do not exist without it)
2. Go to **myaccount.google.com/apppasswords**
3. Name it `Appraise` → **Create** → copy the **16-character** password
4. Set these:

```
SMTP_USER      = harshali.linkd@gmail.com
SMTP_PASSWORD  = the 16-character App Password (not your Google password)
MAIL_FROM      = Appraise <harshali.linkd@gmail.com>
```

> `MAIL_FROM` **must** contain `SMTP_USER`. Gmail rewrites a From address it
> does not own, so the message would arrive from somebody other than the app
> recorded — the app refuses rather than let that happen silently.

Leave `RESEND_API_KEY` blank. If both are set, SMTP wins.

### Option B · Your own domain via Resend (better long term)

Sends as `noreply@linkdprints.com`. No daily cap, not tied to a personal
account, and better deliverability.

1. resend.com → **Domains** → add `send.linkdprints.com` (a subdomain, so your
   existing Google Workspace mail records are untouched)
2. Add the three DNS records it gives you, at your registrar
3. Wait for **Verified**
4. Set `MAIL_FROM = Appraise <noreply@send.linkdprints.com>` and leave the
   `SMTP_*` keys blank

Switching later is a settings change, not a code change.

## 6 · Tell Supabase about the new address

Sign-in redirects back to the app, and Supabase refuses any address it does not
recognise. **Miss this and nobody can log in.**

Supabase dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: `https://appraise-xxxx.vercel.app`
- **Redirect URLs** — add both:
  - `https://appraise-xxxx.vercel.app/**`
  - `http://localhost:3000/**` (keep, so local development still works)

---

## 7 · The nightly job

`vercel.json` schedules it and needs no setup beyond `CRON_SECRET` being present.

```
"schedule": "30 4 * * *"
```

**That is 04:30 UTC, which is 10:00 Asia/Kolkata.** Vercel runs crons in UTC and
offers no timezone setting, so the offset is baked into the number — if India
ever changed its offset, or you wanted a different send time, this is the line
to edit. P17-5 chose 10:00 local deliberately: a reminder that arrives at
half past four in the morning is a reminder people learn to ignore.

> The explanation used to live in `vercel.json` as a `"//"` key. Vercel
> validates that file against a strict schema and rejects any property it does
> not recognise, so the whole deployment failed with
> *"crons[0] should NOT have additional property //"*. **`vercel.json` cannot
> carry comments** — anything worth saying about it belongs here.

Vercel's free plan allows one cron per day, which is exactly what this is.

---

## 8 · Put the app in the same part of the world as the database

**Do this if the deployed app feels slow while localhost feels fine.** It is
almost always the whole explanation, and it is a two-minute setting.

Vercel defaults new projects to **Washington DC (`iad1`)**. If your Supabase
project is in Mumbai or Singapore, every single database query crosses an ocean
and comes back — 200–300ms each. Nothing is "slow"; it is just far away.

It compounds badly, because the app talks to the database more than once per
page:

- `middleware.ts` calls `supabase.auth.getUser()` on **every** request. That is
  deliberate and cannot be removed — it revalidates the JWT with the auth
  server rather than trusting the cookie, which is what stops a stale or forged
  session getting through. But it is one round trip before the page even starts.
- the page's own queries then follow.

At 250ms a hop, a page needing four trips spends a second doing nothing but
waiting. In the same region those same four trips cost under 50ms in total.

**Find your database's region:** Supabase dashboard → **Settings** → **General**
→ *Region*.

**Set the app to match:** Vercel → your project → **Settings** → **Functions** →
*Function Region* → pick the nearest, then redeploy.

| Supabase region | Choose on Vercel |
|---|---|
| `ap-south-1` (Mumbai) | Mumbai — `bom1` |
| `ap-southeast-1` (Singapore) | Singapore — `sin1` |
| `ap-northeast-1` (Tokyo) | Tokyo — `hnd1` |
| `us-east-1` (N. Virginia) | Washington DC — `iad1` (the default) |

> If the region picker is not available on your plan, the alternative is to move
> the Supabase project to a region near `iad1` instead. Same principle: the two
> must be neighbours. What matters is not which continent — it is that they are
> on the same one.

## 9 · Check it worked

1. Open the Vercel URL and sign in.
2. Admin → Cycles → open a cycle → **Send links**.
   The red banner about localhost should be **gone**.
3. Send one link to yourself on both channels.
4. On your phone: the WhatsApp link should be blue and tappable, and open the
   evaluation form.

---

## Later: automatic deploys from GitHub

Once it is working, this is worth doing so a change goes live by pushing:

```
git init
git add .
git commit -m "Appraise"
```

Create an empty repository on GitHub — **private**, this is HR data — then:

```
git remote add origin https://github.com/YOU/appraise.git
git push -u origin main
```

Vercel → your project → Settings → Git → Connect the repository.

`.gitignore` already excludes `.env*`, so no keys are committed. Check that
before your first push.
