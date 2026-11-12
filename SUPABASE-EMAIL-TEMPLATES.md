# Supabase email settings

Two of the emails CONNECT-Daet sends come from Supabase itself, not from the
app. If the reset email arrives with only a link and no code, or the link opens
the wrong site, it is one of the settings below — nothing in the code.

Everything here is done once, in the Supabase dashboard.

## 1. URL Configuration

**Authentication → URL Configuration**

- **Site URL**: `https://capstone2-tawny-iota.vercel.app`
  This is the address every email link is built from. If it points at a Vercel
  *preview* deployment (a long name like `capstone2-5b2emwhzt-...`), every reset
  link in every email goes to that old preview instead of the live site, which
  is the usual reason a reset link "does nothing".
- **Redirect URLs**, one per line:
  ```
  https://capstone2-tawny-iota.vercel.app/**
  https://capstone2-tawny-iota.vercel.app/reset-password
  http://localhost:3000/**
  ```

## 2. Email templates

**Authentication → Emails → Templates**

### Reset Password

The default template contains only `{{ .ConfirmationURL }}`, which is why the
email arrives with a link and no code. Replace the body with this so it carries
**both** — the link for people on the same device, the code for everyone else:

```html
<h2>Reset your password</h2>
<p>We received a request to reset your CONNECT-Daet.ph password.</p>

<p><strong>Your reset code is:</strong></p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Type this code into the "I have a code from the email" box on the site.</p>

<p>Or just tap this link on this device:</p>
<p><a href="{{ .ConfirmationURL }}">Reset my password</a></p>

<p style="color:#6b7280;font-size:12px">
  The code expires in one hour. If you did not ask for this, ignore this email.
</p>
```

### Confirm signup

The sign-up screen asks for a code, so this template needs `{{ .Token }}` too:

```html
<h2>Confirm your email</h2>
<p>Welcome to CONNECT-Daet.ph. Here is your verification code:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p style="color:#6b7280;font-size:12px">
  The code expires in one hour. If you did not create this account, ignore this email.
</p>
```

Keep these templates simple. A template using `{{ if .Data.something }}` fails
to render and Supabase then reports "Error sending confirmation email", which
looks like an SMTP problem but is not.

## 3. Code length

**Authentication → Providers → Email → Email OTP Length**

Anything from 6 to 10 works; the app accepts that whole range.

## 4. SMTP

**Authentication → SMTP Settings** — the Brevo *SMTP* key (`xsmtpsib-...`) goes
here, with host `smtp-relay.brevo.com`, port `587`, and your Brevo login as the
username.

Note this is a different credential from the Brevo *API* key (`xkeysib-...`)
used by `supabase-seller-approval-email.sql` for the shop-approval email. Same
Brevo account, two keys, two different jobs.

## Checking it worked

1. Sign out, choose "Forgot password?", enter your address.
2. The email should show a big code **and** a link.
3. The link should open `https://capstone2-tawny-iota.vercel.app/reset-password`
   and let you set a new password.
4. The code should work in the same box without the link.

If the email never arrives at all, the problem is SMTP, not the template:
check Brevo → Statistics → Email.
