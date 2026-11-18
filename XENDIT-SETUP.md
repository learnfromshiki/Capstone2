# Xendit online payments

CONNECT-Daet takes online payments (GCash, Maya, QR Ph, cards, GrabPay, ShopeePay and the other
Philippine channels on your Xendit account) through **Xendit Payment Sessions**: the customer is sent
to a Xendit-hosted payment page and comes back to the shop when they finish.

Until the keys below are set, the "Pay online" choice simply does not appear at checkout. GCash /
bank transfer with a receipt and Cash on Delivery keep working either way.

## 1. Database (once)

Run `supabase-xendit.sql` in Supabase -> SQL Editor, then `supabase-deep-scan-nov19.sql`.

## 2. Keys

| Variable | Where it comes from |
| --- | --- |
| `XENDIT_SECRET_KEY` | Xendit Dashboard -> Settings -> API keys. Create a key with **Money-in: Write** permission. Use the `xnd_development_...` key while testing, `xnd_production_...` when live. |
| `XENDIT_WEBHOOK_TOKEN` | Xendit Dashboard -> Settings -> Webhooks -> **Webhook verification token**. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase -> Project Settings -> API keys -> `service_role` (secret). |
| `NEXT_PUBLIC_SITE_URL` | Your public site, e.g. `https://capstone2-tawny-iota.vercel.app`. Xendit only accepts **https** return links. |
| `XENDIT_PAYMENT_CHANNELS` | Optional, e.g. `GCASH,PAYMAYA,QRPH,CARDS`. Leave it out to offer every channel switched on in Xendit. |

Put them in `.env.local` for local testing and in Vercel -> Project -> Settings -> Environment
Variables for the live site, then redeploy. None of them may start with `NEXT_PUBLIC_` except the
site address: the others are secrets.

## 3. Webhook

Xendit Dashboard -> Settings -> Webhooks -> **Payment Session** events
(`payment_session.completed` and `payment_session.expired`):

```
https://<your-site>/api/xendit/webhook
```

The webhook is what marks an order paid even if the customer closes the tab before returning, and
what cancels an order whose payment link expired. The return page also asks Xendit directly, so a
local test (where Xendit cannot reach `localhost`) still updates the order when you come back.

## How an online order behaves

1. The customer chooses **Pay online** and places the order. It is created as *pending /
   awaiting online payment* and they are sent to Xendit.
2. The payment link stays open for **24 hours**. The customer can reopen it from **My Orders ->
   Pay now**.
3. **Paid**: the order shows *Paid online*, the shop is notified, and only then can the shop
   confirm, pack and ship it (the database refuses to move an unpaid online order forward).
4. **Not paid in 24 hours**: the order is cancelled automatically, its stock goes back on sale
   and any reward points spent on it are returned.
5. **Cancelled before paying** (by the customer, the shop or the admin): the payment link is
   closed so nobody pays for it. If a payment still arrives for a cancelled order, the admin gets a
   *Refund needed* notification - refund it from the Xendit dashboard.

## Testing with the development key

Xendit's test mode charges nothing. On the hosted page, choose a channel and use Xendit's test
simulation (each channel's page in the Xendit docs lists the test numbers / flows). After paying,
the order in **My Orders** should switch to *Paid online* and the seller should get a notification.
