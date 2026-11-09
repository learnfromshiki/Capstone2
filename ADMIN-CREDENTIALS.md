# Admin Credentials

## Admin Panel Access

Admin access uses a **real Supabase account** with `profiles.user_type = 'admin'`.
There is no demo password, no hardcoded bypass, and no `sessionStorage` flag.

**URL:** `/shop/admin` (for example `https://your-deployment.vercel.app/shop/admin`)

**Current admin account:**
- **Email:** shiki@gmail.com
- **Password:** shiki1234

> Change this password from the Supabase dashboard before sharing the deployment
> publicly. The password in this document is only for the capstone demo.

## Sign-in flow

1. Open `/shop` and click **Sign In**, or go directly to `/shop/admin`.
2. Enter the admin email and password.
3. Supabase authenticates the account.
4. The app reads `profiles.user_type`. Admin accounts are redirected to
   `/shop/admin`; other accounts continue to the shop or seller dashboard.
5. The admin page itself also requires a signed-in session whose profile is
   `user_type = 'admin'`. Direct URL access without that session shows the
   login screen.

## Important notes

- Authentication is enforced by Supabase Auth on the server side.
- The admin session persists through Supabase's normal session refresh and ends
  on **Log Out** or when the refresh token expires.
- Suspended accounts are signed out and blocked from dashboards.
- Do **not** add credentials to source code. If you need another admin, create
  the auth user in Supabase and run:
  ```sql
  update profiles set user_type = 'admin' where email = 'new-admin@example.com';
  ```
- Run `supabase-security-hardening.sql` in the Supabase SQL Editor to replace
  the old permissive testing policies. Until it is applied, database-level
  admin authorization is not fully enforced.

## What the admin panel can do

- View dashboard statistics (products, orders, revenue, sellers, customers)
- Add, edit, activate/deactivate and delete products
- Approve, reject, suspend and restore seller accounts
- View all orders and move them through valid status transitions
- Cancel orders with automatic stock restoration
- View and suspend customer accounts
- Manage categories, website settings and reports
- Generate CSV reports

---

**Last Updated:** November 2026
