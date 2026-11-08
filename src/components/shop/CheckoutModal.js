'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { addPoints } from '@/lib/rewards';

export default function CheckoutModal({ cart, total, onClose, onSuccess }) {
  const [step, setStep] = useState(1); // 1: Contact Info, 2: Payment, 3: Success
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    address: '',
    paymentMethod: 'gcash',
    notes: '',
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmitOrder = async () => {
    setLoading(true);
    let createdOrderId = null;

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      // Validate all cart items have sufficient stock before proceeding
      const stockCheckPromises = cart.map(async (item) => {
        const { data: product, error } = await supabase
          .from('shop_products')
          .select('stock, name')
          .eq('id', item.id)
          .single();

        if (error) throw error;

        if (product.stock < item.quantity) {
          throw new Error(`${product.name} has insufficient stock. Available: ${product.stock}, Requested: ${item.quantity}`);
        }

        return product;
      });

      await Promise.all(stockCheckPromises);
      
      // Create order
      const { data: order, error: orderError } = await supabase
        .from('shop_orders')
        .insert({
          user_id: user?.id || null,
          customer_name: formData.fullName,
          customer_email: formData.email,
          customer_phone: formData.phone,
          delivery_address: formData.address,
          payment_method: formData.paymentMethod,
          total_amount: total,
          status: 'pending',
          notes: formData.notes,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      createdOrderId = order.id;

      // Create order items
      const orderItems = cart.map((item) => ({
        order_id: order.id,
        product_id: item.id,
        product_name: item.name,
        quantity: item.quantity,
        price: item.price,
      }));

      const { error: itemsError } = await supabase
        .from('shop_order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;

      // Update product stock with optimistic concurrency control
      const stockUpdatePromises = cart.map(async (item) => {
        // First, get current stock to verify availability
        const { data: currentProduct, error: fetchError } = await supabase
          .from('shop_products')
          .select('stock')
          .eq('id', item.id)
          .single();

        if (fetchError) throw fetchError;

        // Check if there's enough stock
        if (currentProduct.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${item.name}. Available: ${currentProduct.stock}, Requested: ${item.quantity}`);
        }

        // Update stock
        const { data: updated, error: stockError } = await supabase
          .from('shop_products')
          .update({ stock: currentProduct.stock - item.quantity })
          .eq('id', item.id)
          .eq('stock', currentProduct.stock) // Optimistic locking
          .select('id');

        if (stockError) throw stockError;

        // Another buyer took the stock between our check and this update
        if (!updated || updated.length === 0) {
          throw new Error(`${item.name} was just sold out. Please review your cart and try again.`);
        }
      });

      // Wait for all stock updates to complete
      await Promise.all(stockUpdatePromises);

      // Award points for purchase (10 points per 100 pesos spent)
      if (user?.id) {
        const pointsToAward = Math.floor(total / 100) * 10;
        await addPoints(user.id, pointsToAward, 'shop_purchase');
      }

      setStep(3);
    } catch (error) {
      console.error('Error creating order:', error);

      // Roll back a half-created order so nobody sees an empty order in their history
      if (createdOrderId) {
        const { error: cleanupError } = await supabase
          .from('shop_order_items')
          .delete()
          .eq('order_id', createdOrderId);

        if (!cleanupError) {
          await supabase.from('shop_orders').delete().eq('id', createdOrderId);
        }
      }

      alert('Failed to place order: ' + (error.message || 'Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Step 1: Contact Information */}
        {step === 1 && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Contact Information</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number *
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Delivery Address *
                </label>
                <textarea
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  rows="3"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Order Notes (Optional)
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  rows="2"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Special instructions or requests..."
                />
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!formData.fullName || !formData.email || !formData.phone || !formData.address}
              className="w-full mt-6 bg-blue-600 text-white py-4 rounded-full font-bold text-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              Continue to Payment
            </button>
          </div>
        )}

        {/* Step 2: Payment Method */}
        {step === 2 && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Payment Method</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Order Summary */}
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <h3 className="font-semibold mb-2">Order Summary</h3>
              {cart.map((item) => (
                <div key={item.id} className="flex justify-between text-sm mb-1">
                  <span>{item.name} x{item.quantity}</span>
                  <span>₱{(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
              <div className="border-t mt-2 pt-2 flex justify-between font-bold">
                <span>Total</span>
                <span className="text-blue-600">₱{total.toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Options */}
            <div className="space-y-3 mb-6">
              <label className="flex items-center p-4 border-2 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="gcash"
                  checked={formData.paymentMethod === 'gcash'}
                  onChange={handleInputChange}
                  className="w-5 h-5 text-blue-600"
                />
                <span className="ml-3 font-medium">GCash</span>
              </label>

              <label className="flex items-center p-4 border-2 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cod"
                  checked={formData.paymentMethod === 'cod'}
                  onChange={handleInputChange}
                  className="w-5 h-5 text-blue-600"
                />
                <span className="ml-3 font-medium">Cash on Delivery</span>
              </label>

              <label className="flex items-center p-4 border-2 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="bank"
                  checked={formData.paymentMethod === 'bank'}
                  onChange={handleInputChange}
                  className="w-5 h-5 text-blue-600"
                />
                <span className="ml-3 font-medium">Bank Transfer</span>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 bg-gray-200 text-gray-700 py-4 rounded-full font-bold hover:bg-gray-300 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSubmitOrder}
                disabled={loading}
                className="flex-1 bg-blue-600 text-white py-4 rounded-full font-bold hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
              >
                {loading ? 'Processing...' : 'Place Order'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Success */}
        {step === 3 && (
          <div className="p-6 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Order Placed Successfully!</h2>
            <p className="text-gray-600 mb-6">
              Thank you for supporting local artisans of Daet. We&apos;ll contact you shortly to confirm your order.
            </p>
            <div className="bg-blue-50 rounded-xl p-4 mb-6">
              <p className="text-sm text-gray-600">
                You&apos;ve earned <span className="font-bold text-blue-600">{Math.floor(total / 100) * 10} points</span> for this purchase!
              </p>
            </div>
            <button
              onClick={() => {
                if (onSuccess) onSuccess();
                onClose();
              }}
              className="w-full bg-blue-600 text-white py-4 rounded-full font-bold hover:bg-blue-700 transition-colors"
            >
              Continue Shopping
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
