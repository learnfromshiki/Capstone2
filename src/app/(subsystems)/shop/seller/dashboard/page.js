'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSellerAuth } from '@/contexts/SellerAuthContext';
import { supabase } from '@/lib/supabaseClient';
import { uploadProductImage } from '@/lib/imageUpload';
import { formatOrderNumber, getAllowedStatuses, PAYMENT_LABELS, STATUS_LABELS, transitionOrderStatus } from '@/lib/orders';
import ChangePasswordCard from '@/components/ChangePasswordCard';
import {
  PHONE_HINT,
  describeNameProblem,
  describePhoneProblem,
  describePriceProblem,
  sanitizeName,
  sanitizePhone,
  sanitizePrice,
} from '@/lib/fieldRules';
import SellerPaymentSettings from '@/components/shop/SellerPaymentSettings';
import ProductReviewsModal from '@/components/shop/ProductReviewsModal';
import PaymentProof from '@/components/shop/PaymentProof';
import { fetchProfileRow, joinName, splitName } from '@/lib/profile';
import { describeSelection, readOptions } from '@/lib/productOptions';
import ChatPanel from '@/components/shop/ChatPanel';
import { countUnread, messageCustomer } from '@/lib/messages';
import NotificationCenter from '@/components/ui/NotificationCenter';
import { useDialog } from '@/components/ui/Dialog';
import Avatar from '@/components/ui/Avatar';
import AvatarUpload from '@/components/ui/AvatarUpload';

// Orders grouped the way a shop works through them: what has just come in,
// what is being packed, what is already on the way, and what is finished.
const ORDER_STAGES = [
  { key: 'all', label: 'All orders', statuses: null },
  { key: 'new', label: 'New', statuses: ['pending'] },
  { key: 'preparing', label: 'Preparing', statuses: ['confirmed', 'processing'] },
  { key: 'shipped', label: 'Being shipped', statuses: ['shipped'] },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
];

// Totals for this seller's items over the selected range, used by the dashboard chart
const buildDailySales = (orders, daysCount = 7) => {
  const days = [];

  for (let offset = daysCount - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);

    days.push({
      key: date.toLocaleDateString('en-CA'),
      label: daysCount <= 7
        ? date.toLocaleDateString('en-US', { weekday: 'short' })
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      total: 0,
    });
  }

  orders.forEach((order) => {
    const key = new Date(order.created_at).toLocaleDateString('en-CA');
    const day = days.find((entry) => entry.key === key);

    if (day) {
      day.total += order.my_total;
    }
  });

  return days;
};

const SELLER_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'products', label: 'Products' },
  { id: 'orders', label: 'Orders' },
  { id: 'messages', label: 'Messages' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'settings', label: 'Shop' },
  { id: 'profile', label: 'Profile' },
];

// Set while logging out so the auth guard below does not race the redirect
// and bounce the seller to the login page instead of the shop.
let loggingOut = false;

export default function SellerDashboard() {
  const { user, seller, loading: authLoading, signOut, updateSellerProfile, refreshSellerProfile } = useSellerAuth();
  const { showAlert, showConfirm, showToast } = useDialog();
  const router = useRouter();

  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [stats, setStats] = useState({
    totalProducts: 0,
    activeProducts: 0,
    totalOrders: 0,
    toFulfill: 0,
    totalSales: 0,
    commissionRate: 15,
    platformFee: 0,
    earnings: 0,
    pendingEarnings: null,
    paidEarnings: null,
  });
  const [loading, setLoading] = useState(true);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('📦');
  // The owner's own name, kept on the profiles row (the shop name is separate)
  const [ownerName, setOwnerName] = useState({ first_name: '', last_name: '' });
  const [savingOwnerName, setSavingOwnerName] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [openConversationId, setOpenConversationId] = useState(null);
  const [unreadMessages, setUnreadMessages] = useState(0);

  /** Start (or continue) the chat with the customer behind an order. */
  const handleMessageCustomer = async (order) => {
    try {
      const conversationId = await messageCustomer(order.user_id, order.my_items?.[0]?.product_id || null);
      setOpenConversationId(conversationId);
      setActiveTab('messages');
    } catch (error) {
      showAlert(error.message || 'Could not open the chat.');
    }
  };
  const [savingCategory, setSavingCategory] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  // Which stage of the Orders tab is showing
  const [orderStage, setOrderStage] = useState('all');
  // A product a notification pointed at, so its reviews open on arrival
  const [highlightProductId, setHighlightProductId] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [salesRange, setSalesRange] = useState('7');
  const [rating, setRating] = useState({ average: null, count: 0 });
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [profileForm, setProfileForm] = useState({
    business_name: '',
    contact_phone: '',
    address: '',
    description: '',
    logo_url: '',
  });

  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    price: '',
    stock: '',
    category: 'handicrafts',
    image_url: '',
    artisan_name: '',
    imageFile: null,
    // What the buyer gets to choose: [{ name: 'Colour', values: ['Red'] }]
    options: [],
    // Extra photos. The first one is the cover (image_url).
    images: [],
  });

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        if (!loggingOut) router.push('/shop/seller');
      } else if (!seller) {
        // Signed in without a shop: this is a buyer account, so it belongs in the
        // shop rather than on the seller login form.
        if (!loggingOut) router.push('/shop');
      } else if (!seller.is_approved) {
        // There is no dashboard until an admin approves the shop, so this
        // route does not render one: the seller portal shows where the
        // application stands instead.
        setLoading(false);
        if (!loggingOut) router.push('/shop/seller');
      } else {
        fetchCategories();
        fetchData();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, seller, authLoading, router, activeTab]);

  // Open exactly what a link points at. A notification opened in another tab,
  // or from a phone's notification shade, arrives as a URL rather than as a
  // click inside this page, so the same parts are read here too.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      const conversation = params.get('conversation');
      const order = params.get('order');
      const product = params.get('product');

      if (tab) setActiveTab(tab);
      if (conversation) setOpenConversationId(conversation);
      if (product) setHighlightProductId(product);
      if (order) setSearchQuery(order);
    } catch (error) {
      console.error('Could not read the requested tab:', error);
    }
  }, []);

  // Seed the editable shop settings form from the seller record
  useEffect(() => {
    if (seller) {
      setProfileForm({
        business_name: seller.business_name || '',
        contact_phone: seller.contact_phone || '',
        address: seller.address || '',
        description: seller.description || '',
        logo_url: seller.logo_url || '',
      });
    }
  }, [seller]);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('shop_categories')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) {
        console.warn('Categories table may not exist yet:', error);
        return;
      }
      setCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchData = async () => {
    if (!seller) return;
    
    // Only the first load (loading starts as true) shows the full-page spinner.
    // Tab switches keep the layout mounted, so clicking a sidebar item no longer
    // unmounts the dashboard and flashes an empty screen.
    try {
      if (activeTab === 'products') {
        await fetchProducts();
      } else if (activeTab === 'orders') {
        await fetchOrders();
      } else {
        // Dashboard, Sales & Earnings, Shop Settings and Profile all read these stats
        await fetchDashboardStats();
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // shop_order_items has no seller_id column: scope orders through the seller's products
  const loadSellerOrders = async () => {
    const { data: myProducts, error: productsError } = await supabase
      .from('shop_products')
      .select('id, available')
      .eq('seller_id', seller.id);

    if (productsError) throw productsError;

    const productIds = (myProducts || []).map((product) => product.id);
    if (!productIds.length) {
      return { orders: [], products: myProducts || [] };
    }

    const { data: myItems, error: itemsError } = await supabase
      .from('shop_order_items')
      .select('id, order_id, product_id, product_name, quantity, price, options')
      .in('product_id', productIds);

    if (itemsError) throw itemsError;

    const orderIds = [...new Set((myItems || []).map((item) => item.order_id))];
    if (!orderIds.length) {
      return { orders: [], products: myProducts || [] };
    }

    const ORDER_COLUMNS =
      'id, user_id, customer_name, customer_email, customer_phone, delivery_address, notes, status, payment_method, shipping_fee, created_at';

    const readOrders = (columns) =>
      supabase
        .from('shop_orders')
        .select(columns)
        .in('id', orderIds)
        .order('created_at', { ascending: false });

    // The payment receipt arrives with supabase-notifications-payments.sql;
    // fall back so an older database still lists its orders.
    let { data: orderRows, error: ordersError } = await readOrders(
      `${ORDER_COLUMNS}, payment_proof_url, payment_reference, payment_proof_at`
    );

    if (ordersError && /payment_proof|payment_reference|column/i.test(ordersError.message || '')) {
      ({ data: orderRows, error: ordersError } = await readOrders(ORDER_COLUMNS));
    }

    if (ordersError) throw ordersError;

    const itemsByOrder = (myItems || []).reduce((acc, item) => {
      acc[item.order_id] = acc[item.order_id] || [];
      acc[item.order_id].push(item);
      return acc;
    }, {});

    const orders = (orderRows || []).map((order) => {
      const myItemsForOrder = itemsByOrder[order.id] || [];

      return {
        ...order,
        my_items: myItemsForOrder,
        my_total: myItemsForOrder.reduce(
          (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
          0
        ),
      };
    });

    return { orders, products: myProducts || [] };
  };

  const fetchRating = async (productIds) => {
    if (!productIds.length) {
      setRating({ average: null, count: 0 });
      return;
    }

    const { data, error } = await supabase
      .from('shop_reviews')
      .select('rating')
      .in('product_id', productIds);

    if (error || !data?.length) {
      setRating({ average: null, count: 0 });
      return;
    }

    const total = data.reduce((sum, row) => sum + (Number(row.rating) || 0), 0);
    setRating({ average: (total / data.length).toFixed(1), count: data.length });
  };

  const fetchDashboardStats = async () => {
    try {
      const { orders: orderRows, products: myProducts } = await loadSellerOrders();
      const commissionRate = Number(seller?.commission_rate) || 15;

      // Cancelled orders are refunds, not sales
      const salesOrders = orderRows.filter((order) => order.status !== 'cancelled');
      const totalSales = salesOrders.reduce((sum, order) => sum + order.my_total, 0);
      const platformFee = totalSales * (commissionRate / 100);

      // Real earnings rows are created by a DB trigger; fall back to the commission rate
      const { data: earningRows } = await supabase
        .from('shop_seller_earnings')
        .select('seller_earning, status')
        .eq('seller_id', seller.id);

      const sumByStatus = (status) =>
        (earningRows || [])
          .filter((row) => row.status === status)
          .reduce((sum, row) => sum + (Number(row.seller_earning) || 0), 0);

      const pendingEarnings = earningRows?.length ? sumByStatus('pending') : null;
      const paidEarnings = earningRows?.length ? sumByStatus('paid') : null;

      setStats({
        totalProducts: myProducts.length,
        activeProducts: myProducts.filter((product) => product.available).length,
        totalOrders: orderRows.length,
        toFulfill: salesOrders.filter((order) => ['pending', 'confirmed', 'processing'].includes(order.status)).length,
        totalSales,
        commissionRate,
        platformFee,
        earnings:
          pendingEarnings !== null ? pendingEarnings + paidEarnings : totalSales - platformFee,
        pendingEarnings,
        paidEarnings,
      });

      setOrders(orderRows);
      await fetchRating(myProducts.map((product) => product.id));
    } catch (error) {
      console.error('Error loading seller stats:', error);
    }
  };

  const fetchProducts = async () => {
    const { data, error } = await supabase
      .from('shop_products')
      .select('*')
      .eq('seller_id', seller.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching products:', error);
      return;
    }
    setProducts(data || []);
  };

  const fetchOrders = async () => {
    try {
      const { orders: orderRows } = await loadSellerOrders();
      setOrders(orderRows);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const MAX_PRODUCT_IMAGES = 6;

  /** Add one or more photos to the product gallery. */
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const current = newProduct.images || [];
    const room = MAX_PRODUCT_IMAGES - current.length;

    if (room <= 0) {
      showAlert(`A product can have up to ${MAX_PRODUCT_IMAGES} photos. Remove one first.`);
      return;
    }

    setUploadingImage(true);
    try {
      const uploaded = [];

      for (const file of files.slice(0, room)) {
        const { url: imageUrl, error } = await uploadProductImage(file);
        if (error) throw error;
        uploaded.push(imageUrl);
      }

      const images = [...current, ...uploaded];
      setNewProduct((prev) => ({ ...prev, images, image_url: prev.image_url || images[0] }));
      setImagePreview(images[0]);

      showToast(
        uploaded.length === 1 ? 'Photo uploaded.' : `${uploaded.length} photos uploaded.`,
        'success'
      );
    } catch (error) {
      console.error('Error uploading image:', error);
      showAlert('Failed to upload image: ' + error.message);
    } finally {
      setUploadingImage(false);
    }
  };

  /** Remove one photo; the first remaining one becomes the cover. */
  const removeProductImage = (url) => {
    setNewProduct((prev) => {
      const images = (prev.images || []).filter((entry) => entry !== url);
      const image_url = images.includes(prev.image_url) ? prev.image_url : images[0] || '';
      setImagePreview(image_url);
      return { ...prev, images, image_url };
    });
  };

  /** Make one photo the cover shown on the product card. */
  const makeCoverImage = (url) => {
    setNewProduct((prev) => ({ ...prev, image_url: url }));
    setImagePreview(url);
  };

  // Sellers can add a category while listing a product instead of waiting for an admin
  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) {
      showAlert('Please use letters or numbers in the category name.');
      return;
    }

    // Re-use the category if it is already there (name and slug are unique)
    const existing = categories.find(
      (cat) => cat.slug === slug || (cat.name || '').toLowerCase() === name.toLowerCase()
    );

    if (existing) {
      setNewProduct((prev) => ({ ...prev, category: existing.slug }));
      setShowNewCategory(false);
      setNewCategoryName('');
      showToast(`"${existing.name}" already exists — it is selected now.`, 'success');
      return;
    }

    setSavingCategory(true);
    try {
      const { data, error } = await supabase
        .from('shop_categories')
        .insert([{
          name,
          slug,
          icon: newCategoryIcon || '📦',
          display_order: categories.length,
        }])
        .select()
        .single();

      if (error) throw error;

      setCategories((prev) => [...prev, data]);
      setNewProduct((prev) => ({ ...prev, category: data.slug }));
      setShowNewCategory(false);
      setNewCategoryName('');
      showToast(`Category "${name}" created and selected.`, 'success');
    } catch (error) {
      console.error('Error creating category:', error);
      showAlert('Failed to create category: ' + (error.message || 'unknown error'));
    } finally {
      setSavingCategory(false);
    }
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();

    const name = newProduct.name.trim();
    const description = newProduct.description.trim();
    const price = Number(newProduct.price);
    const stock = Number(newProduct.stock);

    if (!name) {
      showAlert('Please enter a product name.');
      return;
    }

    if (!description) {
      showAlert('Please enter a product description.');
      return;
    }

    const priceProblem = describePriceProblem(newProduct.price);
    if (priceProblem) {
      showAlert(priceProblem);
      return;
    }

    if (!Number.isInteger(stock) || stock < 0) {
      showAlert('Stock must be a whole number of zero or more.');
      return;
    }

    // Two products with the same name in one shop are impossible to tell
    // apart in a cart, an order or a review, so the name has to be new.
    // Compared without case, because "Adobong Manok" and "adobong manok"
    // are the same thing to a customer.
    try {
      let duplicateQuery = supabase
        .from('shop_products')
        .select('id')
        .eq('seller_id', seller.id)
        .ilike('name', name)
        .limit(1);

      if (editingProductId) duplicateQuery = duplicateQuery.neq('id', editingProductId);

      const { data: duplicates, error: duplicateError } = await duplicateQuery;

      if (duplicateError) {
        console.warn('Could not check for a duplicate product name:', duplicateError.message);
      } else if (duplicates && duplicates.length > 0) {
        showAlert(`You already have a product called "${name}". Please use a different name.`);
        return;
      }
    } catch (duplicateError) {
      console.warn('Could not check for a duplicate product name:', duplicateError);
    }

    if (!newProduct.image_url) {
      showAlert('Please add a product photo. Customers will not buy from an empty picture box.');
      return;
    }

    setSavingProduct(true);

    try {
      // Keep only complete groups: a name and at least one value.
      const options = (newProduct.options || [])
        .map((group) => ({
          name: (group.name || '').trim(),
          values: (Array.isArray(group.values) ? group.values : [])
            .map((value) => String(value).trim())
            .filter(Boolean),
        }))
        .filter((group) => group.name && group.values.length > 0);

      // The cover photo leads the gallery, so the order on screen matches.
      const gallery = (newProduct.images || []).filter(Boolean);
      const cover = newProduct.image_url || gallery[0] || null;
      const images = cover ? [cover, ...gallery.filter((url) => url !== cover)] : gallery;

      const payload = {
        name,
        description,
        price,
        stock,
        category: newProduct.category,
        image_url: cover,
        images,
        artisan_name: newProduct.artisan_name.trim() || null,
        options,
      };

      if (editingProductId) {
        const { error } = await supabase
          .from('shop_products')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingProductId)
          .eq('seller_id', seller.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('shop_products')
          .insert([{ ...payload, seller_id: seller.id, available: true }]);

        if (error) throw error;
      }

      closeProductModal();
      fetchProducts();
      showToast(editingProductId ? 'Product updated successfully!' : 'Product added successfully!', 'success');
    } catch (error) {
      console.error('Error adding product:', error);
      showAlert('Failed to add product: ' + error.message);
    } finally {
      setSavingProduct(false);
    }
  };

  const handleDeleteProduct = async (productId) => {
    const confirmed = await showConfirm({
      tone: 'error',
      title: 'Delete this product?',
      message: 'It disappears from your shop and from the storefront. This cannot be undone.',
      confirmLabel: 'Delete product',
    });
    if (!confirmed) return;

    try {
      // A product that already appears in orders must keep its row so past
      // orders stay intact; deactivating hides it from the shop instead.
      const { data: orderedItems, error: orderedError } = await supabase
        .from('shop_order_items')
        .select('id')
        .eq('product_id', productId)
        .limit(1);

      if (orderedError) throw orderedError;

      if (orderedItems && orderedItems.length > 0) {
        showAlert('This product is part of existing orders, so it cannot be deleted. Deactivate it instead to hide it from the shop.');
        return;
      }

      const { error } = await supabase
        .from('shop_products')
        .delete()
        .eq('id', productId)
        .eq('seller_id', seller.id);

      if (error) throw error;
      fetchProducts();
      showToast('Product deleted successfully!', 'success');
    } catch (error) {
      console.error('Error deleting product:', error);
      showAlert('Failed to delete product: ' + error.message);
    }
  };

  const handleToggleAvailability = async (productId, currentStatus) => {
    try {
      const { error } = await supabase
        .from('shop_products')
        .update({ available: !currentStatus })
        .eq('id', productId)
        .eq('seller_id', seller.id);

      if (error) throw error;
      fetchProducts();
    } catch (error) {
      console.error('Error toggling availability:', error);
      showAlert('Failed to update product: ' + error.message);
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    // Only orders that actually contain this seller's products can be updated
    if (!orders.some((order) => order.id === orderId)) {
      showAlert('You can only update orders that contain your products.');
      return;
    }

    const currentOrder = orders.find((order) => order.id === orderId);
    if (currentOrder && currentOrder.status === newStatus) return;

    if (newStatus === 'cancelled') {
      const confirmed = await showConfirm({
        tone: 'warning',
        title: 'Cancel this order?',
        message: 'The stock for its items goes back to your shop and the order cannot be reopened.',
        confirmLabel: 'Cancel order',
        cancelLabel: 'Keep order',
      });
      if (!confirmed) return;
    }

    setUpdatingOrderId(orderId);
    try {
      await transitionOrderStatus(orderId, newStatus);
      await fetchDashboardStats();
      showToast(`Order marked as ${STATUS_LABELS[newStatus] || newStatus}.`, 'success');
    } catch (error) {
      console.error('Error updating order status:', error);
      showAlert('Failed to update order: ' + error.message);
    } finally {
      setUpdatingOrderId(null);
    }
  };

  // ---- product choices (colour, size, flavour...) ----
  const addOptionGroup = () =>
    setNewProduct((prev) => ({
      ...prev,
      options: [...(prev.options || []), { name: '', values: [] }],
    }));

  const updateOptionGroup = (index, patch) =>
    setNewProduct((prev) => ({
      ...prev,
      options: (prev.options || []).map((group, i) => (i === index ? { ...group, ...patch } : group)),
    }));

  const removeOptionGroup = (index) =>
    setNewProduct((prev) => ({
      ...prev,
      options: (prev.options || []).filter((_, i) => i !== index),
    }));

  const openEditProduct = (product) => {
    setEditingProductId(product.id);
    setNewProduct({
      name: product.name || '',
      description: product.description || '',
      price: product.price ?? '',
      stock: product.stock ?? '',
      category: product.category || 'handicrafts',
      image_url: product.image_url || '',
      artisan_name: product.artisan_name || '',
      imageFile: null,
      options: readOptions(product),
      images: Array.isArray(product.images) && product.images.length > 0
        ? product.images
        : [product.image_url].filter(Boolean),
    });
    setImagePreview(product.image_url || '');
    setShowAddProduct(true);
  };

  const closeProductModal = () => {
    setShowAddProduct(false);
    setEditingProductId(null);
    setImagePreview('');
    setShowNewCategory(false);
    setNewCategoryName('');
    setNewProduct({
      name: '',
      description: '',
      price: '',
      stock: '',
      category: 'handicrafts',
      options: [],
      images: [],
      image_url: '',
      artisan_name: '',
      imageFile: null,
    });
  };

  const [settingsFeedback, setSettingsFeedback] = useState({ type: '', text: '' });

  // The owner's name lives on profiles, not on the shop row
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    (async () => {
      const row = await fetchProfileRow(user.id);
      if (cancelled || !row) return;

      const stored = splitName(row.full_name);
      setOwnerName({
        first_name: row.first_name || stored.firstName,
        last_name: row.last_name || stored.lastName,
      });
      setAvatarUrl(row.avatar_url || '');
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  /**
   * Open what a notification is about, not just the tab it lives on: the
   * order itself, the conversation itself, that product's reviews.
   */
  const openNotificationLink = (link) => {
    try {
      const url = new URL(link, window.location.origin);

      // A link to another part of the site is a plain navigation.
      if (!url.pathname.startsWith('/shop/seller/dashboard')) {
        window.location.href = link;
        return;
      }

      const tab = url.searchParams.get('tab');
      const conversation = url.searchParams.get('conversation');
      const order = url.searchParams.get('order');
      const product = url.searchParams.get('product');

      if (tab) setActiveTab(tab);
      if (conversation) setOpenConversationId(conversation);
      if (product) setHighlightProductId(product);

      // Search is how this dashboard narrows a long list, so pointing it at
      // the order number puts that one order on screen on its own.
      if (order) setSearchQuery(order);
      else if (!product) setSearchQuery('');
    } catch (error) {
      console.warn('Could not follow that notification:', error);
    }
  };

  const handleSaveOwnerName = async () => {
    const firstNameProblem = describeNameProblem(ownerName.first_name, 'first name');
    if (firstNameProblem) {
      setSettingsFeedback({ type: 'error', text: firstNameProblem });
      return;
    }

    const lastNameProblem = describeNameProblem(ownerName.last_name, 'last name');
    if (lastNameProblem) {
      setSettingsFeedback({ type: 'error', text: lastNameProblem });
      return;
    }

    const fullName = joinName(ownerName.first_name, ownerName.last_name);

    setSavingOwnerName(true);
    setSettingsFeedback({ type: '', text: '' });

    try {
      const base = { full_name: fullName, updated_at: new Date().toISOString() };

      let { error } = await supabase
        .from('profiles')
        .update({
          ...base,
          first_name: ownerName.first_name.trim() || null,
          last_name: ownerName.last_name.trim() || null,
        })
        .eq('id', user.id);

      // Database without the name columns yet: save the combined name only.
      if (error && /first_name|last_name/.test(error.message || '')) {
        ({ error } = await supabase.from('profiles').update(base).eq('id', user.id));
      }

      if (error) throw error;

      setSettingsFeedback({ type: 'success', text: 'Your name has been saved.' });
      setTimeout(() => setSettingsFeedback({ type: '', text: '' }), 4000);
    } catch (error) {
      console.error('Error saving your name:', error);
      setSettingsFeedback({ type: 'error', text: 'Could not save your name: ' + error.message });
    } finally {
      setSavingOwnerName(false);
    }
  };

  // The bell counts unread messages alongside the stock and order warnings.
  useEffect(() => {
    if (!seller?.id) return undefined;

    let cancelled = false;
    const refresh = async () => {
      const count = await countUnread('seller', seller.id);
      if (!cancelled) setUnreadMessages(count);
    };

    refresh();
    const timer = setInterval(refresh, 30000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [seller?.id, activeTab]);

  const handleSaveShopProfile = async () => {
    const phoneProblem = describePhoneProblem(profileForm.contact_phone, { required: false });
    if (phoneProblem) {
      setSettingsFeedback({ type: 'error', text: phoneProblem });
      return;
    }

    setSavingProfile(true);
    setSettingsFeedback({ type: '', text: '' });

    try {
      const { error } = await updateSellerProfile({
        business_name: profileForm.business_name || seller.business_name,
        contact_phone: profileForm.contact_phone || null,
        address: profileForm.address || null,
        description: profileForm.description || null,
        logo_url: profileForm.logo_url || null,
      });

      if (error) throw error;
      setSettingsFeedback({ type: 'success', text: 'Shop settings saved!' });
      setTimeout(() => setSettingsFeedback({ type: '', text: '' }), 4000);
    } catch (error) {
      console.error('Error saving shop settings:', error);
      setSettingsFeedback({ type: 'error', text: 'Failed to save shop settings: ' + error.message });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);
    try {
      const { url, error } = await uploadProductImage(file);
      if (error) throw error;
      setProfileForm((prev) => ({ ...prev, logo_url: url }));
    } catch (error) {
      console.error('Error uploading logo:', error);
      showAlert('Failed to upload logo: ' + error.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleLogout = async () => {
    const confirmed = await showConfirm({
      tone: 'question',
      title: 'Log out of your shop?',
      message: 'You will need to sign in again to manage products and orders.',
      confirmLabel: 'Log out',
      cancelLabel: 'Stay signed in',
    });
    if (!confirmed) return;

    loggingOut = true;
    await signOut();
    window.location.href = '/shop';
  };

  const searchTerm = searchQuery.trim().toLowerCase();
  const filteredProducts = searchTerm
    ? products.filter((product) =>
        [product.name, product.category, product.artisan_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(searchTerm))
      )
    : products;
  // What actually needs the shop's attention, newest concerns first.
  const outOfStock = products.filter((product) => (Number(product.stock) || 0) === 0);
  const lowStock = products.filter((product) => {
    const stock = Number(product.stock) || 0;
    return stock > 0 && stock <= 5;
  });
  const newOrders = orders.filter((order) => order.status === 'pending');
  const toShip = orders.filter((order) => ['confirmed', 'processing'].includes(order.status));

  const sellerNotifications = [
    unreadMessages > 0 && {
      id: 'messages',
      icon: '💬',
      tone: 'info',
      title: unreadMessages === 1 ? 'A customer messaged you' : `${unreadMessages} unread messages`,
      detail: 'Open your inbox to reply.',
      count: unreadMessages,
      onClick: () => setActiveTab('messages'),
    },
    newOrders.length > 0 && {
      id: 'new-orders',
      icon: '🛒',
      tone: 'success',
      title: newOrders.length === 1 ? 'A new order came in' : `${newOrders.length} new orders`,
      detail: 'Confirm them so the customer knows they are being prepared.',
      count: newOrders.length,
      onClick: () => setActiveTab('orders'),
    },
    toShip.length > 0 && {
      id: 'to-ship',
      icon: '📦',
      tone: 'warning',
      title: `${toShip.length} ${toShip.length === 1 ? 'order is' : 'orders are'} waiting to be shipped`,
      detail: 'Mark them shipped once they are on the way.',
      count: toShip.length,
      onClick: () => setActiveTab('orders'),
    },
    outOfStock.length > 0 && {
      id: 'out-of-stock',
      icon: '⚠️',
      tone: 'danger',
      title:
        outOfStock.length === 1
          ? `${outOfStock[0].name} is out of stock`
          : `${outOfStock.length} products are out of stock`,
      detail: 'Customers cannot buy them until you restock.',
      count: outOfStock.length,
      onClick: () => setActiveTab('products'),
    },
    lowStock.length > 0 && {
      id: 'low-stock',
      icon: '📉',
      tone: 'warning',
      title: `${lowStock.length} ${lowStock.length === 1 ? 'product is' : 'products are'} running low`,
      detail: 'Five or fewer left in stock.',
      count: lowStock.length,
      onClick: () => setActiveTab('products'),
    },
  ].filter(Boolean);

  const orderSearchTerm = searchTerm.replace(/^#/, '');
  const searchedOrders = orderSearchTerm
    ? orders.filter((order) =>
        [order.customer_name, order.customer_email, order.customer_phone, order.status, order.id]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(orderSearchTerm))
      )
    : orders;

  // How many orders sit in each stage, for the chips above the list
  const stageCounts = ORDER_STAGES.reduce((counts, stage) => {
    counts[stage.key] = stage.statuses
      ? searchedOrders.filter((order) => stage.statuses.includes(order.status)).length
      : searchedOrders.length;
    return counts;
  }, {});

  const activeStage = ORDER_STAGES.find((stage) => stage.key === orderStage) || ORDER_STAGES[0];
  const filteredOrders = activeStage.statuses
    ? searchedOrders.filter((order) => activeStage.statuses.includes(order.status))
    : searchedOrders;
  const dailySales = buildDailySales(
    orders.filter((order) => order.status !== 'cancelled'),
    Number(salesRange)
  );

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (seller?.is_rejected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.5 0L3.16 16.25A2 2 0 005 19z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Application Not Approved</h2>
          <p className="text-gray-600 mb-4">
            Your seller application was reviewed and not approved. Please contact CONNECT-Daet support if you need help or want to re-apply.
          </p>
          {seller.rejection_reason && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-6 text-left">
              <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Reason</p>
              <p className="text-sm text-red-800 break-words">{seller.rejection_reason}</p>
            </div>
          )}
          <button
            onClick={() => router.push('/shop')}
            className="w-full min-h-[44px] bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Back to Shop
          </button>
          <button
            onClick={handleLogout}
            className="w-full min-h-[44px] mt-2 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
          >
            Log Out
          </button>
        </div>
      </div>
    );
  }

  if (seller?.is_approved && seller?.is_active === false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Shop Suspended</h2>
          <p className="text-gray-600 mb-6">
            This seller shop has been suspended by an administrator. Your listings are hidden and you cannot manage orders until it is reactivated.
          </p>
          <button
            onClick={() => router.push('/shop')}
            className="w-full min-h-[44px] bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Back to Shop
          </button>
          <button
            onClick={handleLogout}
            className="w-full min-h-[44px] mt-2 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
          >
            Log Out
          </button>
        </div>
      </div>
    );
  }

  if (!seller?.is_approved) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 to-orange-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Pending Approval</h2>
          <p className="text-gray-600 mb-4">
            Your seller account is awaiting admin approval. You&apos;ll be able to access your dashboard once approved.
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-6">
            <p className="text-xs text-gray-500">Signed in as</p>
            <p className="text-sm font-semibold text-gray-800 break-words">
              {user?.email || 'unknown account'}
            </p>
          </div>
          <button
            onClick={() => router.push('/shop')}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Back to Shop
          </button>
          <button
            onClick={handleLogout}
            className="w-full mt-2 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
          >
            Log Out
          </button>
          <p className="text-xs text-gray-500 mt-4">
            Shopping as a buyer? Log out, then sign in with your buyer account.
          </p>
        </div>
      </div>
    );
  }

  const ratingLabel = rating.count ? `${rating.average} ★ (${rating.count} reviews)` : 'No reviews yet';

  return (
    <div className="min-h-screen bg-gray-50 lg:flex lg:h-screen">
      {/* LEFT SIDEBAR */}
      <aside className="hidden w-64 flex-col bg-gradient-to-b from-blue-700 to-blue-900 text-white shadow-xl lg:flex">
        {/* Logo */}
        <div className="p-6 border-b border-blue-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-white">CONNECT-Daet</h1>
              <p className="text-xs text-blue-200">Seller Portal</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'dashboard'
                ? 'bg-blue-700 border-l-4 border-white font-semibold'
                : 'hover:bg-blue-700/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="font-medium">Dashboard</span>
          </button>

          <button
            onClick={() => setActiveTab('products')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'products'
                ? 'bg-blue-700 border-l-4 border-white font-semibold'
                : 'hover:bg-blue-700/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="font-medium">My Products</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'orders'
                ? 'bg-blue-700 border-l-4 border-white font-semibold'
                : 'hover:bg-blue-700/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            <span className="font-medium">Orders</span>
            {stats.totalOrders > 0 && (
              <span className="ml-auto px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full">
                {stats.totalOrders}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('messages')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'messages'
                ? 'bg-blue-700 border-l-4 border-white font-semibold'
                : 'hover:bg-blue-700/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="font-medium">Messages</span>
          </button>

          <button
            onClick={() => setActiveTab('earnings')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'earnings'
                ? 'bg-blue-700 border-l-4 border-white font-semibold'
                : 'hover:bg-blue-700/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="font-medium">Sales & Earnings</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'settings'
                ? 'bg-blue-700 border-l-4 border-white font-semibold'
                : 'hover:bg-blue-700/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <span className="font-medium">Shop Settings</span>
          </button>

          <button
            onClick={() => setActiveTab('profile')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'profile'
                ? 'bg-blue-700 border-l-4 border-white font-semibold'
                : 'hover:bg-blue-700/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="font-medium">Profile</span>
          </button>
        </nav>

        {/* Logout Button */}
        <div className="p-4 border-t border-blue-800">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-left bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="font-medium">Log Out</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex min-h-screen flex-1 flex-col lg:min-h-0 lg:overflow-hidden">
        {/* Top Header */}
        <header className="flex flex-col gap-3 border-b bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-4">
          <div className="flex-1">
            <div className="relative max-w-md">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search my products, orders..."
                aria-label="Search my products and orders"
                className="w-full min-h-[44px] pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <button
              type="button"
              onClick={() => setActiveTab('messages')}
              aria-label={unreadMessages > 0 ? `Messages, ${unreadMessages} unread` : 'Messages'}
              title="Messages"
              className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {unreadMessages > 0 && (
                <span className="absolute right-1 top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unreadMessages > 99 ? '99+' : unreadMessages}
                </span>
              )}
            </button>
            <NotificationCenter
              audience="seller"
              emptyMessage="Nothing new. Your shop is all caught up."
              items={sellerNotifications}
              onNavigate={(link) => openNotificationLink(link)}
            />
            {/* Your own name and picture open your profile */}
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              title="View my profile"
              className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-gray-100"
            >
              <Avatar src={avatarUrl} name={joinName(ownerName.first_name, ownerName.last_name)} email={user?.email} size="md" />
              <span className="max-w-[10rem] text-left sm:max-w-none sm:text-right">
                <span className="block truncate text-sm font-semibold text-gray-900">{seller.business_name}</span>
                <span className="block text-xs text-gray-600">View my profile</span>
              </span>
            </button>
          </div>
        </header>

        {/* Mobile navigation */}
        <nav aria-label="Seller dashboard sections" className="flex gap-2 overflow-x-auto border-b bg-white px-4 py-2 lg:hidden">
          {SELLER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[44px] whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}

          {/* The sidebar (and its Log Out) is hidden on phones, so the tab
              strip carries one. */}
          <button
            onClick={handleLogout}
            className="ml-auto min-h-[44px] whitespace-nowrap rounded-lg bg-red-50 px-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100"
          >
            Log Out
          </button>
        </nav>

        {/* Scrollable Content */}
        <main className="flex-1 p-4 sm:p-6 lg:overflow-y-auto lg:p-8">
          {/* Date Display */}
          <div className="flex justify-end mb-4">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </div>

          {/* Content */}
          {activeTab === 'dashboard' && (
            <div>
              {/* Welcome Message */}
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 mb-1">
                  Welcome back, {seller.business_name}! 👋
                </h1>
                <p className="text-gray-600">Manage your shop, products, and orders here.</p>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                  </div>
                  <p className="text-sm font-medium text-gray-600 mb-1">Total Products</p>
                  <h3 className="text-3xl font-bold text-gray-900 mb-1">{stats.totalProducts}</h3>
                  <p className="text-xs text-gray-600">{stats.activeProducts} active listings</p>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                      </svg>
                    </div>
                  </div>
                  <p className="text-sm font-medium text-gray-600 mb-1">Total Orders</p>
                  <h3 className="text-3xl font-bold text-gray-900 mb-1">{stats.totalOrders}</h3>
                  <p className="text-xs text-gray-600">{stats.toFulfill} to fulfill</p>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <p className="text-sm font-medium text-gray-600 mb-1">Total Sales</p>
                  <h3 className="text-3xl font-bold text-gray-900 mb-1">₱{stats.totalSales.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h3>
                  <p className="text-xs text-gray-600">From your products only</p>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                  </div>
                  <p className="text-sm font-medium text-gray-600 mb-1">Earnings</p>
                  <h3 className="text-3xl font-bold text-gray-900 mb-1">₱{stats.earnings.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h3>
                  <p className="text-xs text-gray-600">(after fees)</p>
                </div>
              </div>

              {/* Sales Overview & Quick Actions Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                {/* Sales Overview Chart */}
                <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">Sales Overview</h3>
                    <select
                      value={salesRange}
                      onChange={(e) => setSalesRange(e.target.value)}
                      aria-label="Sales chart date range"
                      className="min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                    >
                      <option value="7">Last 7 Days</option>
                      <option value="30">Last 30 Days</option>
                      <option value="90">Last 90 Days</option>
                    </select>
                  </div>
                  <div className="flex h-48 items-end gap-1 overflow-hidden rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 p-4">
                    {dailySales.map((day, index) => {
                      const maxDaily = Math.max(...dailySales.map((entry) => entry.total), 1);
                      const height = Math.round((day.total / maxDaily) * 100);
                      const showLabel =
                        dailySales.length <= 7 ||
                        index % Math.ceil(dailySales.length / 7) === 0;

                      return (
                        <div key={day.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                          {dailySales.length <= 7 && (
                            <span className="text-[10px] font-semibold text-gray-700">
                              {day.total > 0 ? `₱${Math.round(day.total).toLocaleString()}` : ''}
                            </span>
                          )}
                          <div
                            className="w-full rounded-t bg-blue-500"
                            style={{ height: `${Math.max(height, 2)}%` }}
                            title={`${day.key}: ₱${day.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          />
                          <span className="text-[10px] text-gray-500">
                            {showLabel ? day.label : ''}
                          </span>
                        </div>
                      );
                    })}
                    {dailySales.length === 0 && (
                      <p className="w-full text-center text-sm text-gray-500">No sales in this period</p>
                    )}
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <h3 className="text-lg font-bold mb-4">Quick Actions</h3>
                  <div className="space-y-3">
                    <button
                      onClick={() => {
                        setActiveTab('products');
                        setShowAddProduct(true);
                      }}
                      className="w-full min-h-[44px] flex items-center justify-between p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </div>
                        <span className="font-semibold text-gray-900 text-sm">Add Product</span>
                      </div>
                    </button>

                    <button
                      onClick={() => setActiveTab('products')}
                      className="w-full flex items-center justify-between p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                        </div>
                        <span className="font-semibold text-gray-900 text-sm">Manage Products</span>
                      </div>
                    </button>

                    <button
                      onClick={() => setActiveTab('orders')}
                      className="w-full flex items-center justify-between p-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                          </svg>
                        </div>
                        <span className="font-semibold text-gray-900 text-sm">View Orders</span>
                      </div>
                    </button>

                    <button
                      onClick={() => setActiveTab('earnings')}
                      className="w-full flex items-center justify-between p-3 bg-yellow-50 hover:bg-yellow-100 rounded-lg transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-yellow-600 rounded-lg flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <span className="font-semibold text-gray-900 text-sm">View Sales</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              {/* Recent Orders & Shop Information Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Recent Orders */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-6 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold">Recent Orders</h3>
                      <button
                        onClick={() => setActiveTab('orders')}
                        className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        View All Orders
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Order ID</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Customer</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Total</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {filteredOrders.slice(0, 4).map((order) => (
                          <tr key={order.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm font-semibold text-blue-600">{formatOrderNumber(order.id)}</td>
                            <td className="px-6 py-4 text-sm text-gray-900">{order.customer_name}</td>
                            <td className="px-6 py-4 text-sm font-semibold text-gray-900">₱{order.my_total?.toLocaleString()}</td>
                            <td className="px-6 py-4">
                              <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                                order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                                order.status === 'shipped' ? 'bg-blue-100 text-blue-700' :
                                order.status === 'confirmed' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {order.status === 'confirmed' ? 'To Ship' : order.status?.charAt(0).toUpperCase() + order.status?.slice(1)}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                              {new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </td>
                          </tr>
                        ))}
                        {filteredOrders.length === 0 && (
                          <tr>
                            <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                              {searchTerm ? 'No orders match your search.' : 'No orders yet'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Shop Information */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <h3 className="text-lg font-bold mb-4">Shop Information</h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                      <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-gray-900">{seller.business_name}</p>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded">+ Active</span>
                        </div>
                      </div>
                      <button
                        onClick={() => setActiveTab('settings')}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between py-2 border-b border-gray-100">
                        <div className="flex items-center gap-2 text-gray-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                          <span>Products</span>
                        </div>
                        <span className="font-bold text-gray-900">{stats.totalProducts}</span>
                      </div>

                      <div className="flex items-center justify-between py-2 border-b border-gray-100">
                        <div className="flex items-center gap-2 text-gray-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                          </svg>
                          <span>Orders</span>
                        </div>
                        <span className="font-bold text-gray-900">{stats.totalOrders}</span>
                      </div>

                      <div className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2 text-gray-600">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                          <span>Shop Rating</span>
                        </div>
                        <span className="text-xs font-semibold text-gray-900">{ratingLabel}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'products' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">My Products</h2>
              <button
                onClick={() => setShowAddProduct(true)}
                className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-all shadow-md hover:shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Product
              </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Product</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Category</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Price</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Stock</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredProducts.map((product) => (
                    <tr key={product.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {product.image_url && (
                            <img src={product.image_url} alt={product.name} className="w-12 h-12 rounded-lg object-cover" />
                          )}
                          <div>
                            <div className="font-semibold text-gray-900">{product.name}</div>
                            <div className="text-sm text-gray-600">{product.artisan_name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                          {product.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-semibold">₱{product.price}</td>
                      <td className="px-6 py-4">
                        <span className={`font-semibold ${product.stock > 5 ? 'text-green-600' : product.stock > 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {product.stock}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                          product.available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {product.available ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEditProduct(product)}
                            className="min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setHighlightProductId(product.id)}
                            className="min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                          >
                            Reviews
                          </button>
                          <button
                            onClick={() => handleToggleAvailability(product.id, product.available)}
                            className="min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200"
                          >
                            {product.available ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(product.id)}
                            className="min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan="6" className="px-6 py-10 text-center text-gray-500">
                        {searchTerm ? 'No products match your search.' : 'No products yet. Add your first product to start selling.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold text-gray-900">Orders</h2>
              {searchTerm && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="min-h-[44px] rounded-lg bg-gray-100 px-3 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  Clear search
                </button>
              )}
            </div>
            {/* Stage chips: new, preparing, being shipped, delivered */}
            <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
              {ORDER_STAGES.map((stage) => (
                <button
                  key={stage.key}
                  type="button"
                  onClick={() => setOrderStage(stage.key)}
                  aria-pressed={orderStage === stage.key}
                  className={`flex min-h-[44px] flex-shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
                    orderStage === stage.key
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {stage.label}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      orderStage === stage.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {stageCounts[stage.key] || 0}
                  </span>
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {filteredOrders.length === 0 && (
                <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-gray-500">
                  {searchTerm
                    ? 'No orders match your search.'
                    : orderStage === 'all'
                    ? 'No orders yet.'
                    : `Nothing in "${activeStage.label}" right now.`}
                </div>
              )}
              {filteredOrders.map((order) => {
                const allowedStatuses = getAllowedStatuses(order.status);
                const isFinal = ['delivered', 'cancelled'].includes(order.status);

                return (
                <div key={order.id} className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border border-gray-100">
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start mb-4">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-blue-600">{formatOrderNumber(order.id)}</p>
                      <h3 className="font-bold text-lg break-words">{order.customer_name}</h3>
                      <p className="text-sm text-gray-600 break-words">{order.customer_email}</p>
                      <p className="text-sm text-gray-600">{order.customer_phone}</p>
                      {order.delivery_address && (
                        <p className="text-sm text-gray-600 break-words whitespace-pre-line">
                          <span className="font-semibold text-gray-700">Deliver to:</span> {order.delivery_address}
                        </p>
                      )}
                      {order.notes && (
                        <p className="mt-2 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-900 break-words">
                          <span className="font-semibold">Buyer note:</span> {order.notes}
                        </p>
                      )}
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="text-2xl font-bold text-blue-600">₱{order.my_total.toLocaleString()}</div>
                      <p className="text-xs text-gray-500">Your items in this order</p>
                      {Number(order.shipping_fee) > 0 && (
                        <p className="text-xs text-gray-500">
                          + ₱{Number(order.shipping_fee).toFixed(2)} delivery collected
                        </p>
                      )}
                      <div className="text-sm text-gray-500">
                        {new Date(order.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-4 mb-4">
                    <h4 className="font-semibold mb-2">Your items:</h4>
                    {order.my_items?.map((item) => (
                      <div key={item.id} className="text-sm text-gray-600">
                        {item.product_name} x{item.quantity} - ₱{(Number(item.price) * Number(item.quantity)).toLocaleString()}
                        {describeSelection(item.options) && (
                          <span className="block text-xs font-medium text-blue-700">
                            {describeSelection(item.options)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      Status:
                      <select
                        value={order.status}
                        onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                        disabled={isFinal || updatingOrderId === order.id}
                        aria-label={`Order status for ${order.customer_name}`}
                        className="min-h-[44px] rounded-lg border border-gray-300 px-3 py-2 disabled:cursor-not-allowed disabled:bg-gray-100"
                      >
                        {allowedStatuses.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status] || status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="text-sm text-gray-600">
                      Payment: {PAYMENT_LABELS[order.payment_method] || order.payment_method}
                    </span>
                    {order.user_id && (
                      <button
                        type="button"
                        onClick={() => handleMessageCustomer(order)}
                        className="min-h-[44px] rounded-lg border border-blue-200 px-4 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50"
                      >
                        💬 Message customer
                      </button>
                    )}
                    {updatingOrderId === order.id && (
                      <span className="text-sm text-blue-600">Updating stock and order…</span>
                    )}
                    {isFinal && (
                      <span className="text-xs text-gray-500">
                        {order.status === 'cancelled'
                          ? 'Cancelled orders cannot be reopened.'
                          : 'Delivered orders cannot be changed.'}
                      </span>
                    )}
                  </div>

                  {/* What the customer sent, for a GCash or bank order */}
                  <div className="mt-3">
                    <PaymentProof
                      url={order.payment_proof_url}
                      reference={order.payment_reference}
                      paidAt={order.payment_proof_at}
                    />
                    {!order.payment_proof_url && order.payment_method !== 'cod' && (
                      <p className="text-xs text-yellow-700">
                        No payment receipt was attached to this order yet.
                      </p>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'messages' && (
          <ChatPanel
            role="seller"
            sellerId={seller.id}
            activeConversationId={openConversationId}
            onOpened={() => setOpenConversationId(null)}
          />
        )}

        {activeTab === 'earnings' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Sales & Earnings</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Total Sales</p>
                  <p className="text-3xl font-bold text-gray-900">₱{stats.totalSales.toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-1">Your products only, cancelled orders excluded</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Platform Fee ({stats.commissionRate}%)</p>
                  <p className="text-3xl font-bold text-red-600">-₱{stats.platformFee.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Your Earnings</p>
                  <p className="text-3xl font-bold text-green-600">₱{stats.earnings.toLocaleString()}</p>
                </div>
              </div>

              {stats.pendingEarnings !== null && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 pt-6 border-t">
                  <div className="p-4 bg-yellow-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Pending Earnings</p>
                    <p className="text-2xl font-bold text-yellow-700">₱{stats.pendingEarnings.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Released when the order is delivered</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Paid Earnings</p>
                    <p className="text-2xl font-bold text-green-700">₱{stats.paidEarnings.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">Already released to you</p>
                  </div>
                </div>
              )}

              <p className="text-sm text-gray-600">
                Monitor your shop revenue and earnings. A {stats.commissionRate}% platform fee is deducted from each sale.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Shop Settings</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Shop Logo</label>
                  <div className="flex items-center gap-4">
                    {profileForm.logo_url ? (
                      <img src={profileForm.logo_url} alt="Shop logo" className="w-16 h-16 rounded-xl object-cover border border-gray-200" />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl">
                        {seller.business_name?.charAt(0) || 'S'}
                      </div>
                    )}
                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="text-sm text-gray-600"
                      />
                      {uploadingLogo && <p className="text-sm text-blue-600 mt-1">Uploading logo...</p>}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Business Name</label>
                  <input
                    type="text"
                    value={profileForm.business_name}
                    onChange={(e) => setProfileForm({ ...profileForm, business_name: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Shop Description</label>
                  <textarea
                    value={profileForm.description}
                    onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })}
                    rows="3"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Tell customers about your shop..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Business Address</label>
                  <textarea
                    value={profileForm.address}
                    onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                    rows="2"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Contact Email</label>
                  <input
                    type="email"
                    value={seller.contact_email}
                    disabled
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-50"
                  />
                  <p className="text-xs text-gray-500 mt-1">Your login email cannot be changed here.</p>
                </div>
                <div>
                  <label htmlFor="shopPhone" className="block text-sm font-semibold text-gray-700 mb-2">
                    Contact Phone
                  </label>
                  <input
                    id="shopPhone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    value={profileForm.contact_phone}
                    onChange={(e) => setProfileForm({ ...profileForm, contact_phone: sanitizePhone(e.target.value) })}
                    placeholder="09171234567"
                    className="w-full min-h-[44px] px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">{PHONE_HINT}</p>
                </div>

                <button
                  onClick={handleSaveShopProfile}
                  disabled={savingProfile || uploadingLogo}
                  className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {savingProfile ? 'Saving...' : 'Save Shop Settings'}
                </button>
                {settingsFeedback.text && (
                  <p
                    role="status"
                    className={`mt-3 text-sm font-medium ${settingsFeedback.type === 'error' ? 'text-red-600' : 'text-green-600'}`}
                  >
                    {settingsFeedback.text}
                  </p>
                )}
              </div>
            </div>

            {/* How customers pay this shop */}
            <div className="mt-6">
              <SellerPaymentSettings
                seller={seller}
                onSaved={() => refreshSellerProfile()}
              />
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Profile</h2>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <div className="space-y-6">
                <div className="flex items-center gap-6">
                  <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-12 h-12 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">{seller.business_name}</h3>
                    <p className="text-gray-600">{user.email}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">Active</span>
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">Verified Seller</span>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t">
                  <h4 className="font-semibold text-gray-900 mb-1">Profile Picture</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    Shown in your dashboard. Your shop logo is set separately in Shop Settings.
                  </p>
                  <AvatarUpload
                    userId={user?.id}
                    url={avatarUrl}
                    name={joinName(ownerName.first_name, ownerName.last_name)}
                    email={user?.email}
                    onChange={setAvatarUrl}
                  />
                </div>

                <div className="pt-6 border-t">
                  <h4 className="font-semibold text-gray-900 mb-1">Your Name</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    The owner of this shop. Customers see the shop name; this is how CONNECT-Daet addresses you.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="ownerFirstName" className="block text-sm font-semibold text-gray-700 mb-2">
                        First Name
                      </label>
                      <input
                        id="ownerFirstName"
                        type="text"
                        value={ownerName.first_name}
                        onChange={(e) => setOwnerName({ ...ownerName, first_name: sanitizeName(e.target.value) })}
                        autoComplete="given-name"
                        maxLength={60}
                        placeholder="Juan"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="ownerLastName" className="block text-sm font-semibold text-gray-700 mb-2">
                        Last Name
                      </label>
                      <input
                        id="ownerLastName"
                        type="text"
                        value={ownerName.last_name}
                        onChange={(e) => setOwnerName({ ...ownerName, last_name: sanitizeName(e.target.value) })}
                        autoComplete="family-name"
                        maxLength={60}
                        placeholder="Dela Cruz"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleSaveOwnerName}
                    disabled={savingOwnerName}
                    className="mt-4 min-h-[44px] rounded-lg bg-blue-600 px-6 font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingOwnerName ? 'Saving...' : 'Save My Name'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6 border-t">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Business Name</label>
                    <input
                      type="text"
                      value={seller.business_name}
                      disabled
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Contact Email</label>
                    <input
                      type="email"
                      value={seller.contact_email}
                      disabled
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="profilePhone" className="block text-sm font-semibold text-gray-700 mb-2">
                      Contact Phone
                    </label>
                    <input
                      id="profilePhone"
                      type="tel"
                      inputMode="numeric"
                      maxLength={11}
                      value={profileForm.contact_phone}
                      onChange={(e) => setProfileForm({ ...profileForm, contact_phone: sanitizePhone(e.target.value) })}
                      placeholder="09171234567"
                      className="w-full min-h-[44px] px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">{PHONE_HINT}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Member Since</label>
                    <input
                      type="text"
                      value={new Date(seller.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                      disabled
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-50"
                    />
                  </div>
                </div>

                <div className="pt-6 border-t">
                  <h4 className="font-semibold text-gray-900 mb-4">Business Statistics</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <p className="text-2xl font-bold text-blue-600">{stats.totalProducts}</p>
                      <p className="text-sm text-gray-600 mt-1">Products</p>
                    </div>
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <p className="text-2xl font-bold text-blue-600">{stats.totalOrders}</p>
                      <p className="text-sm text-gray-600 mt-1">Orders</p>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <p className="text-2xl font-bold text-green-600">₱{stats.totalSales.toLocaleString()}</p>
                      <p className="text-sm text-gray-600 mt-1">Sales</p>
                    </div>
                    <div className="text-center p-4 bg-yellow-50 rounded-lg">
                      <p className="text-2xl font-bold text-yellow-600">{rating.average || '—'}</p>
                      <p className="text-sm text-gray-600 mt-1">
                        Rating{rating.count ? ` (${rating.count})` : ''}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t">
                  <ChangePasswordCard
                    email={user?.email}
                    description="Keep your shop safe. Use your current password, or email yourself a code if you have forgotten it."
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600 flex-1">
                    💡 <strong>Note:</strong> Update your contact number here. Shop name, logo and description are in <strong>Shop Settings</strong>.
                  </p>
                  <button
                    onClick={handleSaveShopProfile}
                    disabled={savingProfile}
                    className="min-h-[44px] px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {savingProfile ? 'Saving...' : 'Save Contact Info'}
                  </button>
                </div>
                {settingsFeedback.text && (
                  <p
                    role="status"
                    className={`mt-3 text-sm font-medium ${settingsFeedback.type === 'error' ? 'text-red-600' : 'text-green-600'}`}
                  >
                    {settingsFeedback.text}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
        </main>
      </div>

      {/* Add Product Modal */}
      {showAddProduct && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">{editingProductId ? 'Edit Product' : 'Add New Product'}</h2>
                <button
                  onClick={closeProductModal}
                  aria-label="Close product form"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <form onSubmit={handleAddProduct} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Product Name *</label>
                <input
                  type="text"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                  className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Description *</label>
                <textarea
                  value={newProduct.description}
                  onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                  rows="3"
                  className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="productPrice" className="block text-sm font-semibold mb-2">Price (₱) *</label>
                  <input
                    id="productPrice"
                    type="text"
                    inputMode="decimal"
                    value={newProduct.price}
                    onChange={(e) => setNewProduct({ ...newProduct, price: sanitizePrice(e.target.value) })}
                    placeholder="1.50"
                    maxLength={10}
                    className="w-full min-h-[44px] px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <p className="mt-1 text-xs text-gray-500">Centavos are fine, for example 1.50 or 249.99.</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2">Stock *</label>
                  <input
                    type="number"
                    value={newProduct.stock}
                    onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                    className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Category *</label>
                <select
                  value={newProduct.category}
                  onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                  className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                >
                  {categories.length > 0 ? (
                    categories.map((cat) => (
                      <option key={cat.id} value={cat.slug}>{cat.icon} {cat.name}</option>
                    ))
                  ) : (
                    <>
                      <option value="handicrafts">Handicrafts</option>
                      <option value="food">Food</option>
                      <option value="souvenirs">Souvenirs</option>
                    </>
                  )}
                </select>

                <button
                  type="button"
                  onClick={() => setShowNewCategory(true)}
                  className="mt-2 min-h-[36px] text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  + Add a new category
                </button>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Artisan Name</label>
                <input
                  type="text"
                  value={newProduct.artisan_name}
                  onChange={(e) => setNewProduct({ ...newProduct, artisan_name: e.target.value })}
                  className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Choices the buyer makes before adding to the cart */}
              <div className="rounded-xl border-2 border-dashed border-gray-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Product Choices (optional)</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Colour, size, flavour and so on. Buyers must pick one of each before they can order.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addOptionGroup}
                    className="min-h-[40px] rounded-lg border-2 border-blue-200 px-3 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                  >
                    + Add a choice
                  </button>
                </div>

                {(newProduct.options || []).length === 0 ? (
                  <p className="mt-3 text-xs text-gray-400">
                    No choices yet. Leave this empty for a product that comes only one way.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {(newProduct.options || []).map((group, index) => (
                      <div key={index} className="rounded-lg bg-gray-50 p-3">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={group.name}
                            onChange={(e) => updateOptionGroup(index, { name: e.target.value })}
                            placeholder="Choice name, e.g. Colour"
                            maxLength={30}
                            className="min-h-[44px] flex-1 rounded-lg border-2 px-3 text-sm focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => removeOptionGroup(index)}
                            aria-label={`Remove the ${group.name || 'unnamed'} choice`}
                            className="min-h-[44px] rounded-lg bg-red-50 px-3 text-sm font-semibold text-red-600 hover:bg-red-100"
                          >
                            Remove
                          </button>
                        </div>

                        <input
                          type="text"
                          value={(group.values || []).join(', ')}
                          onChange={(e) =>
                            updateOptionGroup(index, {
                              values: e.target.value.split(',').map((value) => value.trimStart()),
                            })
                          }
                          placeholder="Options, separated by commas: Red, Blue, Green"
                          className="mt-2 min-h-[44px] w-full rounded-lg border-2 px-3 text-sm focus:ring-2 focus:ring-blue-500"
                        />

                        {(group.values || []).filter(Boolean).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {group.values.filter(Boolean).map((value, valueIndex) => (
                              <span
                                key={valueIndex}
                                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm"
                              >
                                {value.trim()}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Product Photos *</label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  At least one photo is required - customers only see a grey box without it. You can add up to{' '}
                  {MAX_PRODUCT_IMAGES}; the first is the cover shown on the product card. JPG, PNG, GIF or WebP, up
                  to 5 MB each.
                </p>
                {uploadingImage && <p className="text-sm text-blue-600 mt-2">Uploading...</p>}

                {(newProduct.images || []).length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    {(newProduct.images || []).map((url) => {
                      const isCover = url === newProduct.image_url;

                      return (
                        <div key={url} className="w-28">
                          <div
                            className={`relative h-28 w-28 overflow-hidden rounded-lg border-2 ${
                              isCover ? 'border-blue-600' : 'border-gray-200'
                            }`}
                          >
                            <img src={url} alt="Product" className="h-full w-full object-cover" />
                            {isCover && (
                              <span className="absolute left-1 top-1 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
                                Cover
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex gap-1">
                            {!isCover && (
                              <button
                                type="button"
                                onClick={() => makeCoverImage(url)}
                                className="flex-1 rounded-md bg-blue-50 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                              >
                                Cover
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeProductImage(url)}
                              className="flex-1 rounded-md bg-red-50 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={savingProduct || uploadingImage}
                  className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingProduct ? 'Saving...' : editingProductId ? 'Save Changes' : 'Add Product'}
                </button>
                <button
                  type="button"
                  onClick={closeProductModal}
                  className="px-6 py-3 border-2 border-gray-300 rounded-xl font-semibold hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add category */}
      {showNewCategory && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add a new category"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h3 className="text-xl font-bold text-gray-900">Add a new category</h3>
            <p className="mt-1 text-sm text-gray-600">
              It becomes available to every shop on CONNECT-Daet, so please use a clear, general name.
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="categoryName" className="mb-2 block text-sm font-semibold text-gray-700">
                  Category name *
                </label>
                <input
                  id="categoryName"
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Delicacies"
                  maxLength={40}
                  autoFocus
                  className="w-full min-h-[44px] rounded-xl border-2 px-4 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="categoryIcon" className="mb-2 block text-sm font-semibold text-gray-700">
                  Icon
                </label>
                <div className="flex flex-wrap gap-2">
                  {['📦', '🧺', '🍽️', '🎁', '🧵', '🎨', '🪔', '🌿'].map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setNewCategoryIcon(icon)}
                      aria-pressed={newCategoryIcon === icon}
                      className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 text-xl transition-colors ${
                        newCategoryIcon === icon ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleCreateCategory}
                disabled={savingCategory || !newCategoryName.trim()}
                className="min-h-[44px] flex-1 rounded-xl bg-blue-600 font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingCategory ? 'Adding...' : 'Add Category'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewCategory(false);
                  setNewCategoryName('');
                }}
                className="min-h-[44px] rounded-xl border-2 border-gray-300 px-6 font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The reviews a product has received, opened from its row or straight
          from a "new review" notification. */}
      <ProductReviewsModal
        product={products.find((entry) => entry.id === highlightProductId) || null}
        onClose={() => setHighlightProductId(null)}
      />
    </div>
  );
}
