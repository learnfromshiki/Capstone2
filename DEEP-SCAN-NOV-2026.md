# Deep Scan, 11 November 2026

Scope: every page, component and library file in `src/`, the Supabase SQL files,
and the deployed site at https://capstone2-tawny-iota.vercel.app/.

## Critical problems found (security / money)

| # | Problem | Fix |
|---|---------|-----|
| 1 | Checkout ran in the browser. A signed-in user could call the API directly and create an order with any total (e.g. ₱1 for a ₱5,000 basket). | New `place_order()` database function calculates prices, checks stock, creates the order(s), reduces stock and awards points in one transaction. `CheckoutModal.js` now uses it. |
| 2 | Every signed-in user could change the stock of any product (e.g. set a competitor to "Sold Out"). | Policy removed; stock changes only through checkout, cancellation, the owning seller or the admin. |
| 3 | `add_reward_points()` could be called by anyone, any number of times = unlimited free points. | Locked; points are only granted inside `place_order()` and taken back when an order is cancelled. |
| 4 | A seller could cancel an order that also contained another seller's products. Status changes were not validated in the database. | New `update_order_status()` checks ownership and the allowed flow (pending → confirmed → processing → shipped → delivered). |
| 5 | Any signed-in user could upload any file type to any folder of the image bucket. | Images only, 5 MB max, own folder only. |
| 6 | The admin password was written in 12 project documents (README, HOW-TO-RUN, guides…) that are pushed to GitHub. | Redacted everywhere except the git-ignored `ADMIN-CREDENTIALS.md`. **Change the admin password**: it is still in the git history. |

All database fixes are in `supabase-checkout-security.sql`.

## Functional bugs fixed

- Sellers could not see the **delivery address or buyer notes** on their orders, so they could not ship.
- No **"Forgot password?"**: added to the sign-in window, plus a new `/reset-password` page.
- Buyers could not **cancel** an order; they can now cancel while it is still Pending.
- After checkout there was no **order number** or way to pay by GCash/bank; the success screen now shows order number(s), total and payment instructions, and a "Track my order" button.
- One checkout with products from two shops is now split into **one order per shop** (like Shopee/Lazada), so each seller manages only their own order.
- "Out of stock" alert could appear twice (alert inside a React state update).
- Login errors now say "Incorrect email or password" / "Please confirm your email first" instead of raw Supabase text.
- The buyer dashboard showed a made-up "Up to 50% OFF" promotion; replaced with an honest banner.
- `orders.js`: a helper had been inserted between a function and its documentation comment.

## Features added to reach a professional shop

- Storefront: **sort** (Newest, Price low/high, Top rated, Name) and **In stock only**; sold-out items listed last.
- Storefront **footer** with contact email/phone from Admin → Settings.
- Admin → Settings: **GCash and bank account details** and a payment note, shown to buyers at checkout and in My Orders.
- Admin → Orders: **search** (order number, name, email, phone), **filter by status**, order numbers, notes, peso formatting, empty state.
- Checkout: saves phone/address to the profile for next time, autofill hints, address validation, reward-points preview.
- Page titles and link previews for `/shop`; admin, seller, buyer and reset pages are hidden from search engines.

## What you must do

1. **Supabase → SQL Editor**: run `supabase-checkout-security.sql` once (after `supabase-security-hardening.sql`).
2. **Supabase → Authentication → URL Configuration**: Site URL = your Vercel URL; add `https://capstone2-tawny-iota.vercel.app/reset-password` to Redirect URLs.
3. **Change the admin password** (Admin → Settings → Security).
4. Admin → Settings: fill in the GCash / bank details and save.
5. Commit and push to GitHub so Vercel redeploys.
6. Test: place an order with two products from different shops → two order numbers; cancel one from My Orders → stock goes back up.

## Suggestions for later (not done)

- Sessions are kept per browser tab (sessionStorage), so a new tab or visit is signed out. Most shops keep people signed in; consider switching to localStorage once multi-account testing is over.
- Payment proof upload (GCash receipt screenshot) and an admin "mark as paid" step.
- Email notifications to buyer and seller when an order is placed or its status changes (Supabase Edge Function + an email service).
- Shipping fee / delivery zones; currently every order total is items only.
- Server-side pagination for products and orders once there are hundreds of rows.
- Use `next/image` for product photos (faster loading; flagged by the build).
