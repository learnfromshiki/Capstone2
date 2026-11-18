/** "Paid online" / "Awaiting payment" for an order paid through Xendit. */
export default function OnlinePaymentStatus({ order, className = '' }) {
  if (order?.payment_method !== 'xendit') return null;

  const base = `inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${className}`;

  if (order.payment_status === 'paid') {
    return (
      <span className={`${base} bg-green-100 text-green-800`}>
        Paid online ✓
        {order.paid_at && (
          <span className="ml-1 font-normal">· {new Date(order.paid_at).toLocaleDateString('en-PH')}</span>
        )}
      </span>
    );
  }

  if (order.payment_status === 'refunded') {
    return <span className={`${base} bg-gray-100 text-gray-700`}>Refunded</span>;
  }

  if (order.payment_status === 'failed') {
    return <span className={`${base} bg-gray-100 text-gray-700`}>Payment link expired</span>;
  }

  if (order.status === 'cancelled') {
    return <span className={`${base} bg-gray-100 text-gray-700`}>Not paid</span>;
  }

  return <span className={`${base} bg-amber-100 text-amber-800`}>Awaiting online payment</span>;
}
