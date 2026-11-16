/** "Paid online" / "Awaiting payment" for an order paid through PayMongo. */
export default function PaymongoStatus({ order, className = '' }) {
  if (order?.payment_method !== 'paymongo') return null;

  if (order.payment_status === 'paid') {
    return (
      <span className={`inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800 ${className}`}>
        Paid online ✓
        {order.paid_at && (
          <span className="ml-1 font-normal">· {new Date(order.paid_at).toLocaleDateString('en-PH')}</span>
        )}
      </span>
    );
  }

  if (order.payment_status === 'refunded') {
    return (
      <span className={`inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 ${className}`}>
        Refunded
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 ${className}`}>
      Awaiting online payment
    </span>
  );
}
