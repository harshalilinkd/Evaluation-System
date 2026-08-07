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

## 5 · Make email reach people other than you

`onboarding@resend.dev` is Resend's test sender and delivers **only** to the
address that owns the Resend account. Everyone else is silently dropped.

1. resend.com → **Domains** → Add domain (e.g. `linkdprints.com`)
2. Add the DNS records it gives you, at your domain registrar
3. Wait for it to say Verified
4. Set `MAIL_FROM` in Vercel to an address on that domain:
   `Appraise <noreply@linkdprints.com>`
5. Redeploy

Until this is done, WhatsApp will work and email will not.

---

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

`vercel.json` already schedules it — 04:30 UTC, which is 10:00 in Kolkata. It
needs no setup beyond `CRON_SECRET` being present.

Vercel's free plan allows one cron per day, which is exactly what this is.

---

## 8 · Check it worked

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
