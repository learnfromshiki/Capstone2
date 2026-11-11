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

## Step 3 — Send from your own email address (optional)

By default Supabase sends from its own address and **limits free projects to a
few emails per hour**, which is fine for a demo but not for a defence day with
many sign-ups. To use your own address — the PHPMailer equivalent:

1. In Supabase, go to **Project Settings → Authentication → SMTP Settings**.
2. Turn on **Enable Custom SMTP** and fill in your mail provider's details.

For a Gmail account:

| Field | Value |
|-------|-------|
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | your full Gmail address |
| Password | a Google **App Password**, not your normal password |
| Sender email | the same Gmail address |
| Sender name | `CONNECT-Daet.ph` |

An App Password is created at **Google Account → Security → 2-Step
Verification → App passwords**. Gmail blocks normal passwords for SMTP, exactly
as it does with PHPMailer.

3. Press **Save** and register a test account. The email now comes from you.

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
| Reset email never arrives | Free projects are limited to a few emails per hour, and password resets share that limit with sign-ups. Wait, or do Step 3. |
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
Wait an hour, or do **Step 3** to send through your own Gmail — that limit is
much higher and is the real fix before a demo.

**2. The email template cannot be built.**
Open **Authentication → Emails → Confirm signup** and compare it with the
template in Step 1. If it contains `{{ if ... }}`, a misspelled field or an
unclosed `{{`, Supabase fails at send time with exactly this error. Paste the
simple template again and save.

**3. Custom SMTP is on but wrong.**
If **Project Settings → Authentication → SMTP Settings** is enabled, check the
host, port and password. With Gmail the password must be a 16-character **App
Password**, never the normal account password. To rule SMTP out, turn Custom
SMTP off, save, and register again — if the code arrives, the SMTP details are
the problem.

To see the real reason, open **Logs → Auth Logs** in Supabase right after a
failed registration; the entry names the provider's own error.
