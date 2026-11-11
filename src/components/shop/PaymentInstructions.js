'use client';

import { hasPaymentDetails } from '@/lib/shopSettings';

/**
 * How to pay for a GCash or bank-transfer order, using the details the admin
 * saved in Admin → Settings. Cash on delivery needs no instructions.
 */
export default function PaymentInstructions({ method, settings, amount, orderNumbers = [], compact = false }) {
  if (method !== 'gcash' && method !== 'bank') return null;

  const reference = orderNumbers.filter(Boolean).join(', ');
  const formattedAmount =
    typeof amount === 'number' && Number.isFinite(amount)
      ? `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null;

  const ready = hasPaymentDetails(settings, method);

  return (
    <div className={`rounded-xl border-2 border-blue-200 bg-blue-50 text-left text-sm text-blue-900 ${compact ? 'p-3' : 'p-4'}`}>
      <p className="font-semibold mb-2">
        {method === 'gcash' ? 'How to pay with GCash' : 'How to pay by bank transfer'}
      </p>

      {ready ? (
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          {method === 'gcash' ? (
            <>
              <dt className="text-blue-700">GCash number</dt>
              <dd className="font-mono font-semibold break-all">{settings.gcashNumber}</dd>
              {settings.gcashName && (
                <>
                  <dt className="text-blue-700">Account name</dt>
                  <dd className="font-semibold break-words">{settings.gcashName}</dd>
                </>
              )}
            </>
          ) : (
            <>
              {settings.bankName && (
                <>
                  <dt className="text-blue-700">Bank</dt>
                  <dd className="font-semibold break-words">{settings.bankName}</dd>
                </>
              )}
              <dt className="text-blue-700">Account number</dt>
              <dd className="font-mono font-semibold break-all">{settings.bankAccountNumber}</dd>
              {settings.bankAccountName && (
                <>
                  <dt className="text-blue-700">Account name</dt>
                  <dd className="font-semibold break-words">{settings.bankAccountName}</dd>
                </>
              )}
            </>
          )}
          {formattedAmount && (
            <>
              <dt className="text-blue-700">Amount</dt>
              <dd className="font-semibold">{formattedAmount}</dd>
            </>
          )}
          {reference && (
            <>
              <dt className="text-blue-700">Reference</dt>
              <dd className="font-mono font-semibold break-all">{reference}</dd>
            </>
          )}
        </dl>
      ) : (
        <p>
          The shop will send you the {method === 'gcash' ? 'GCash' : 'bank'} payment details when it confirms
          your order{settings?.contactPhone ? ` (or call ${settings.contactPhone})` : ''}.
        </p>
      )}

      <p className="mt-2 text-xs text-blue-800">
        {settings?.paymentNote ||
          'Put your order number in the payment message, then keep the receipt. Your order is confirmed once the payment is received.'}
      </p>
    </div>
  );
}
