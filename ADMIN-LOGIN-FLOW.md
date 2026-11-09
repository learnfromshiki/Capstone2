# Admin Login Flow - How It Works

## Automatic admin redirect

Admin accounts sign in through the same Supabase Auth form as everyone else.
Role detection happens **after** Supabase authenticates the user.

---

## Step-by-step

### 1. Open the shop or admin URL
- `/shop` → click **Sign In**
- or go directly to `/shop/admin`

### 2. Enter the admin credentials
- **Email:** shiki@gmail.com
- **Password:** shiki1234

### 3. Supabase authenticates the account
- `AuthContext.signIn()` calls `supabase.auth.signInWithPassword()`.
- The session is stored and refreshed by the Supabase client (not `sessionStorage`).

### 4. Role is read from the database
- `getAccountRole(user.id)` reads `profiles.user_type`.
- If it is `admin`, the browser navigates to `/shop/admin`.
- Otherwise the app restores the profile row, checks for seller intent, and
  sends the user to the seller dashboard or `/shop`.

### 5. The admin page verifies the session again
- `AdminPage` subscribes to `supabase.auth.getSession()`.
- It loads the current profile and requires `user_type = 'admin'`.
- It listens for auth changes, so logging out in another tab also locks the panel.
- A non-admin or signed-out visitor only sees the admin login form.

---

## What was removed

The old flow accepted the hardcoded email/password in the browser and set
`sessionStorage.setItem('admin_authenticated', 'true')`. Anyone could forge
that flag, so it has been removed entirely. There is no `DEMO_ADMIN_EMAIL` or
`DEMO_ADMIN_PASSWORD` constant in the codebase anymore.

## Security notes

- Admin authorization is checked against `profiles.user_type`, not email text.
- Suspended accounts are signed out before any dashboard opens.
- Run `supabase-security-hardening.sql` so RLS and database triggers also
  enforce the role, instead of relying only on the UI.
- Admin actions that change seller approval or customer suspension are protected
  by profile/seller field guards after the migration is applied.

---

**Last Updated:** November 2026
