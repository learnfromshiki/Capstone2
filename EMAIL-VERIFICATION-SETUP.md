# Email setup: verification code and password reset (5 minutes)

New customer and seller registrations now ask for a **6-digit code** that is
emailed to the address being registered. The account is only created once the
code is entered.

---

## About PHPMailer

PHPMailer is a **PHP library**, and this website has no PHP in it. It is a
Next.js (React) app deployed on Vercel, so there is no PHP runtime, no
`send_mail.php` to call, and nothing that could `require 'PHPMailer.php'`.
Adding PHP would mean running a second, separate server just to send mail.

What PHPMailer actually does is connect to an **SMTP server** (Gmail, Hostinger,
your school's mail server) and send a message through it. Supabase — which the
site already uses for accounts — does the same thing, and can use **your own
SMTP credentials**. So the result you asked for is exactly what you get:

- A 6-digit code is generated and emailed when someone registers.
- The code is checked before the account can be used.
- The email can be sent from **your own email address** through SMTP, the same
  credentials you would have put into PHPMailer.

Step 1 below switches the email to a code. Step 3 is optional and is the part
that replaces PHPMailer's SMTP settings.

---

## Step 1 — Send a code instead of a link (required)

1. Open your project at [supabase.com](https://supabase.com).
2. Go to **Authentication → Emails** (older projects: **Email Templates**).
3. Pick the **Confirm signup** template.
4. Replace the whole body with the version below and press **Save**.

```html
<h2>Verify your email</h2>

<p>Welcome to CONNECT-Daet.ph!</p>

<p>Your verification code is:</p>

<p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:24px 0;">{{ .Token }}</p>

<p>Type this code on the registration screen to finish creating your account.
The code expires in 1 hour.</p>

<p>If you did not sign up, you can ignore this email.</p>
```

The important part is **`{{ .Token }}`** — that is the 6-digit code. The default
template uses `{{ .ConfirmationURL }}`, which sends a link instead.

> Keep the template this simple. Anything clever — `{{ if ... }}`, a field that
> does not exist, an unclosed `{{` — makes Supabase fail to build the message
> and registration then shows **"Error sending confirmation email"**.

5. Go to **Authentication → Sign In / Providers → Email** and make sure
   **Confirm email** is **ON**. If it is off, Supabase creates accounts without
   verifying anything, and the site will simply sign people straight in.

---

## Step 2 — Test it

1. Register a new customer on your site with a real email address.
2. The screen asks for the 6-digit code.
3. Open the email, type the 6 digits, press **Verify Email**.
4. You land in the shop, signed in.

"Send a new code" is available after 60 seconds if the email does not arrive.

---

## Step 2b — Make "Forgot password?" work (required)

A reset email that leads to an "invalid or expired link" page, or that never
arrives, is almost always one of these two settings.

### a) Allow the reset page to be opened

1. **Authentication → URL Configuration**.
2. **Site URL**: your live address, e.g. `https://capstone2-tawny-iota.vercel.app`
   (no trailing slash).
3. **Redirect URLs**: add both lines, one per row:

```
https://capstone2-tawny-iota.vercel.app/reset-password
http://localhost:3000/reset-password
```

Supabase refuses to send people to any address that is not on this list, and
silently falls back to the Site URL instead — which is why the link can look
like it does nothing.

### b) Put the 6-digit code in the reset email

1. **Authentication → Emails → Reset Password**.
2. Replace the body with this and press **Save**:

```html
<h2>Reset your password</h2>

<p>Your password reset code is:</p>

<p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:24px 0;">{{ .Token }}</p>

<p>Type this code on the "Reset Your Password" screen together with your new
password. The code expires in 1 hour.</p>

<p>Or click here to choose a new password instead:
<a href="{{ .ConfirmationURL }}">Reset my password</a></p>

<p>If you did not ask for this, you can ignore this email.</p>
```

This template carries **both** ways of resetting, so either works:

- typing the 6-digit code straight into the Sign In window, which needs no
  link and no redirect settings at all; or
- opening the link, which lands on `/reset-password`.

The code path is the reliable one — use it if the link still misbehaves.

---

## Step 3 — Send through Brevo (recommended before your demo)

Supabase's built-in mailer allows only a **handful of auth emails per hour** on
a free project. That is the usual reason registration shows "Error sending
confirmation email" after a few test sign-ups. Pointing Supabase at a real mail
service fixes it, and Brevo's free plan is generous enough for a capstone:
**300 emails a day**.

This is the same job PHPMailer would have done — PHPMailer connects to an SMTP
server, and here Supabase connects to Brevo's SMTP server instead. **No code
changes are needed**, only these settings.

### a) Get your Brevo SMTP key

1. Create a free account at [brevo.com](https://www.brevo.com) and sign in.
2. Go to **Settings → SMTP & API → SMTP**.
3. Press **Generate a new SMTP key** and copy it somewhere safe — it is shown once.
   This is an **SMTP key**, not an API key; the two are different and only the
   SMTP key works here.

### b) Verify who the mail comes from

Brevo refuses to send from an address it has not verified.

- **Quickest:** **Senders, Domains & Dedicated IPs → Senders → Add a sender**,
  enter the address you want the shop to send from, then click the link in the
  confirmation email Brevo sends you.
- **Better, if you have a domain:** add the domain under **Domains** and copy
  the SPF and DKIM records it gives you into your DNS. Mail from an
  authenticated domain is far less likely to land in spam, and Gmail and Yahoo
  increasingly reject anything else.

### c) Point Supabase at Brevo

In Supabase: **Project Settings → Authentication → SMTP Settings** → turn on
**Enable Custom SMTP**:

| Field | Value |
|-------|-------|
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | your Brevo account login email |
| Password | the **SMTP key** from step (a) |
| Sender email | the sender you verified in step (b) |
| Sender name | `CONNECT-Daet.ph` |

Press **Save**.

### d) Raise the Supabase limit

With custom SMTP on, Supabase lifts its own cap from about 2 auth emails per
hour to 30. Check **Authentication → Rate Limits** and raise the emails-per-hour
figure if you expect a busy demo — keep it under Brevo's 300 a day.

Register a test account afterwards: the code should arrive in seconds, and
Brevo's **Transactional → Logs** page shows every message it accepted, which is
the fastest way to tell a delivery problem from a Supabase problem.

### Using Gmail instead

Gmail works too, but its sending limits are lower and it is stricter about
"from" addresses: host `smtp.gmail.com`, port `465`, your Gmail address as the
username, and a 16-character **App Password** (Google Account → Security →
2-Step Verification → App passwords) as the password — never your normal
password.

---

## Troubleshooting

| What you see | What it means |
|--------------|---------------|
| The email contains a link, not a code | The template still uses `{{ .ConfirmationURL }}`. Redo Step 1. |
| "That code is not correct" | The code was mistyped, or a newer code was sent — always use the newest email. |
| "That code has expired" | Codes last 1 hour. Press **Send a new code**. |
| No email arrives | Check the spam folder. On a free project, Supabase's built-in mailer is rate-limited — wait a few minutes, or do Step 3. |
| Registration signs people in with no code | **Confirm email** is off in Supabase (end of Step 1). |
| "Too many attempts" | Supabase's rate limit. Wait 5–10 minutes. |
| **"Error sending confirmation email"** | Supabase could not send. See the three causes below. |
| Reset email arrives but the link says invalid/expired | The address is not in **Redirect URLs** (Step 2b a), or the link was already used. Use the 6-digit code instead. |
| Reset email never arrives | Free projects are limited to a few emails per hour, and password resets share that limit with sign-ups. Wait, or do Step 3 (Brevo). |
| The reset email has no code in it | The Reset Password template still has no `{{ .Token }}`. Redo Step 2b b. |

---

## "Error sending confirmation email"

This message comes from Supabase, not from the website, and it means the email
itself could not be sent. The account is usually created anyway — so do **not**
register again with the same address. Wait a minute and press **"Send a new
code"** on the verification screen.

There are three causes, in the order they actually happen:

**1. The free email limit (most common while testing).**
A free Supabase project may send only a few emails per hour, shared between
sign-ups and password resets. After a morning of test registrations it stops.
Wait an hour, or do **Step 3** and send through Brevo — 300 emails a day on the
free plan, and it is the real fix before a demo.

**2. The email template cannot be built.**
Open **Authentication → Emails → Confirm signup** and compare it with the
template in Step 1. If it contains `{{ if ... }}`, a misspelled field or an
unclosed `{{`, Supabase fails at send time with exactly this error. Paste the
simple template again and save.

**3. Custom SMTP is on but wrong.**
If **Project Settings → Authentication → SMTP Settings** is enabled, check the
host, port and password. With Brevo the password must be the **SMTP key** (not
an API key) and the sender address must be one Brevo has verified. With Gmail it
must be a 16-character **App Password**, never the normal account password. To rule SMTP out, turn Custom
SMTP off, save, and register again — if the code arrives, the SMTP details are
the problem.

To see the real reason, open **Logs → Auth Logs** in Supabase right after a
failed registration; the entry names the provider's own error.
