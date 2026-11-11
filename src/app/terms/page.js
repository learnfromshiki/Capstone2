import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service & Privacy Policy | CONNECT-Daet.ph',
  description: 'The rules for using the CONNECT-Daet.ph marketplace and how customer information is handled.',
};

const UPDATED = 'November 2026';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/shop" className="text-lg font-bold text-gray-900">
            CONNECT-Daet.ph
          </Link>
          <Link href="/shop" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            ← Back to the shop
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold text-gray-900">Terms of Service</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: {UPDATED}</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-gray-700">
          <section>
            <h2 className="text-lg font-bold text-gray-900">1. About this marketplace</h2>
            <p className="mt-2">
              CONNECT-Daet.ph is an online marketplace where sellers in Daet, Camarines Norte offer their own
              products. Each seller is responsible for the items they list, their prices, their stock and the
              delivery of their orders. CONNECT-Daet.ph provides the platform and collects a service fee from each
              sale.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900">2. Your account</h2>
            <p className="mt-2">
              You need an account to place an order. Give accurate details, keep your password to yourself, and tell
              us if you think someone else is using your account. You are responsible for what happens under your
              login. Accounts that are used for fraud, abuse or anything illegal may be suspended.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900">3. Orders and payment</h2>
            <p className="mt-2">
              Placing an order is an offer to buy. The seller confirms it, prepares it and ships it. Prices are in
              Philippine pesos. Payment is by GCash, bank transfer or cash on delivery, as shown at checkout. For
              GCash and bank transfers, your order is confirmed once the seller receives the payment.
            </p>
            <p className="mt-2">
              You can cancel an order yourself while it is still Pending. After the seller starts preparing it,
              contact the shop directly.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900">4. Delivery</h2>
            <p className="mt-2">
              Delivery times depend on the seller and your location. Please give a complete address and a working
              phone number. Mark an order as received once it arrives, so the seller is credited for the sale and you
              can review what you bought.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900">5. Reviews</h2>
            <p className="mt-2">
              Only buyers whose order was delivered may review a product. Your display name and profile picture are
              shown with your review. Reviews that are abusive, dishonest or unrelated to the product may be removed.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900">6. Sellers</h2>
            <p className="mt-2">
              Shops are reviewed before they can sell. Sellers agree to list only products they can actually supply,
              describe them honestly, keep stock up to date and fulfil confirmed orders. A platform fee is deducted
              from each sale, shown in the seller dashboard. Shops that mislead customers may be suspended.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900">7. Reward points</h2>
            <p className="mt-2">
              Points are earned on completed orders and have no cash value. Points from a cancelled order are
              removed.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900">8. Changes</h2>
            <p className="mt-2">
              These terms may change as the marketplace grows. The date above shows the current version.
            </p>
          </section>
        </div>

        <hr className="my-10 border-gray-200" />

        <h1 id="privacy" className="scroll-mt-6 text-3xl font-bold text-gray-900">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: {UPDATED}</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-gray-700">
          <section>
            <h2 className="text-lg font-bold text-gray-900">What we collect</h2>
            <p className="mt-2">
              Your name, email address, phone number and delivery address; your orders, reviews and reward points;
              and a profile picture if you upload one. Sellers also give their shop details. Payments through GCash
              or a bank happen outside this website, so card and account numbers are never stored here.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900">How it is used</h2>
            <p className="mt-2">
              To create your account, process and deliver your orders, show your order history, calculate reward
              points, and contact you about an order. We do not sell your information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900">Who can see it</h2>
            <p className="mt-2">
              A seller sees the name, phone number, address and items for their own orders, so they can deliver them.
              Administrators can see accounts and orders to run the marketplace. Other shoppers see only your display
              name and picture on reviews. Account data is stored with Supabase, our hosting provider.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900">Your choices</h2>
            <p className="mt-2">
              You can edit your name, phone number, address and picture any time in My Profile, and change your
              password in Settings. To have your account removed, contact us using the details in the website footer.
            </p>
          </section>
        </div>

        <div className="mt-10">
          <Link
            href="/shop"
            className="inline-flex min-h-[44px] items-center rounded-full bg-blue-600 px-6 font-bold text-white hover:bg-blue-700"
          >
            Back to the shop
          </Link>
        </div>
      </article>
    </main>
  );
}
