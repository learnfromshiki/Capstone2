'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { uploadProductImage, deleteProductImage } from '@/lib/imageUpload';
import { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, getAccountRole } from '@/lib/roles';
import Link from 'next/link';
import Toast from '@/components/Toast';

const REPORT_CONFIG = {
  sales: {
    title: 'Sales Report',
    subtitle: 'Revenue grouped by day (cancelled orders excluded)',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'orders', label: 'Orders' },
      { key: 'revenue', label: 'Revenue (PHP)' }
    ]
  },
  products: {
    title: 'Product Report',
    subtitle: 'Best selling products by units and revenue',
    columns: [
      { key: 'name', label: 'Product' },
      { key: 'units', label: 'Units Sold' },
      { key: 'revenue', label: 'Revenue (PHP)' }
    ]
  },
  customers: {
    title: 'Customer Report',
    subtitle: 'Top customers by total spend',
    columns: [
      { key: 'name', label: 'Customer' },
      { key: 'email', label: 'Email' },
      { key: 'orders', label: 'Orders' },
      { key: 'spent', label: 'Total Spent (PHP)' }
    ]
  },
  sellers: {
    title: 'Seller Report',
    subtitle: 'Sales performance per seller',
    columns: [
      { key: 'name', label: 'Seller' },
      { key: 'products', label: 'Listings' },
      { key: 'units', label: 'Units Sold' },
      { key: 'revenue', label: 'Sales (PHP)' }
    ]
  },
  orders: {
    title: 'Order Report',
    subtitle: 'Order count and value by status',
    columns: [
      { key: 'status', label: 'Status' },
      { key: 'orders', label: 'Orders' },
      { key: 'value', label: 'Value (PHP)' }
    ]
  },
  revenue: {
    title: 'Revenue Report',
    subtitle: 'Revenue breakdown by payment method',
    columns: [
      { key: 'method', label: 'Payment Method' },
      { key: 'orders', label: 'Orders' },
      { key: 'revenue', label: 'Revenue (PHP)' }
    ]
  }
};

export default function ShopAdminPage() {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalCustomers: 0,
    totalSellers: 0,
    totalSales: 0,
    pendingSellers: 0,
    toFulfill: 0
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [salesDaily, setSalesDaily] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('Admin');
  const [adminPassword, setAdminPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [websiteSettings, setWebsiteSettings] = useState({
    siteName: 'Daet Local Shop',
    contactEmail: 'support@connect-daet.ph',
    contactPhone: '+63 900 000 0000'
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState('');
  const [passwordForm, setPasswordForm] = useState({
    current: '',
    next: '',
    confirm: ''
  });
  const [uploadingImage, setUploadingImage] = useState(false);
  const [toast, setToast] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  
  // Helper function to show toast notifications
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };
  
  // Product form state
  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    price: '',
    stock: '',
    category: 'handicrafts',
    image_url: '',
    artisan_name: '',
    imageFile: null
  });

  // Category form state
  const [newCategory, setNewCategory] = useState({
    name: '',
    icon: '📦',
    description: ''
  });

  // Verify admin access: a Supabase account with the admin role, or the demo admin session
  useEffect(() => {
    const verifyAdminAccess = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          const role = await getAccountRole(session.user.id);

          if (role === 'admin') {
            setIsAuthenticated(true);
            setAdminEmail(session.user.email || '');
            setAdminName(session.user.user_metadata?.full_name || 'Admin');
            sessionStorage.setItem('admin_authenticated', 'true');
            sessionStorage.setItem('admin_email', session.user.email || '');
            return;
          }

          // Somebody else is signed in (buyer/seller): the demo flag must not
          // authorize them, so clear it and stay locked out.
          sessionStorage.removeItem('admin_authenticated');
          sessionStorage.removeItem('admin_email');
          return;
        }
      } catch (error) {
        console.error('Error verifying admin access:', error);
      }

      // No Supabase session at all: only the documented demo admin may use the flag
      if (
        sessionStorage.getItem('admin_authenticated') === 'true' &&
        sessionStorage.getItem('admin_email') === DEMO_ADMIN_EMAIL
      ) {
        setIsAuthenticated(true);
        setAdminEmail(DEMO_ADMIN_EMAIL);
      }
    };

    verifyAdminAccess().finally(() => setCheckingAuth(false));
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCategories();
      fetchData();
      fetchSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAuthenticated]);

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

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('shop_settings')
        .select('key, value');

      // Settings table is optional until supabase-admin-policies.sql is run
      if (error) return;

      if (data?.length) {
        const stored = data.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
        setWebsiteSettings((prev) => ({ ...prev, ...stored }));
      }
    } catch (error) {
      console.error('Error loading website settings:', error);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoading(true);

    try {
      // 1. Demo admin account (documented demo login)
      if (
        adminEmail.trim().toLowerCase() === DEMO_ADMIN_EMAIL &&
        adminPassword === DEMO_ADMIN_PASSWORD
      ) {
        setIsAuthenticated(true);
        setAdminName('Admin');
        setAdminEmail(DEMO_ADMIN_EMAIL);
        sessionStorage.setItem('admin_authenticated', 'true');
        sessionStorage.setItem('admin_email', DEMO_ADMIN_EMAIL);
        return;
      }

      // 2. Real admin account: Supabase login + admin role on the profile
      const { data, error } = await supabase.auth.signInWithPassword({
        email: adminEmail.trim(),
        password: adminPassword
      });

      if (error || !data?.user) {
        setLoginError('Invalid email or password');
        return;
      }

      const role = await getAccountRole(data.user.id);

      if (role !== 'admin') {
        // Signed in, but this account is a buyer or seller - do not grant admin access
        await supabase.auth.signOut();
        setLoginError('This account does not have admin access.');
        return;
      }

      setIsAuthenticated(true);
      setAdminName(data.user.user_metadata?.full_name || 'Admin');
      setAdminEmail(data.user.email || adminEmail.trim());
      sessionStorage.setItem('admin_authenticated', 'true');
      sessionStorage.setItem('admin_email', data.user.email || adminEmail.trim());
    } catch (error) {
      console.error('Admin login error:', error);
      setLoginError('Unable to sign in right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsAuthenticated(false);
    sessionStorage.removeItem('admin_authenticated');
    sessionStorage.removeItem('admin_email');

    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }

    window.location.href = '/shop';
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingImage(true);
    try {
      const { url, error } = await uploadProductImage(file, 'admin');
      
      if (error) throw error;
      
      setNewProduct({ ...newProduct, image_url: url, imageFile: file });
      setImagePreview(URL.createObjectURL(file));
      
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image: ' + error.message);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const slug = newCategory.name.toLowerCase().replace(/\s+/g, '-');
      
      const { error } = await supabase
        .from('shop_categories')
        .insert([{
          name: newCategory.name,
          slug: slug,
          icon: newCategory.icon,
          description: newCategory.description,
          display_order: categories.length
        }]);

      if (error) throw error;

      setNewCategory({ name: '', icon: '📦', description: '' });
      setShowAddCategory(false);
      fetchCategories();
      alert('Category added successfully!');
    } catch (error) {
      console.error('Error adding category:', error);
      alert('Failed to add category: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'dashboard') {
        // Fetch all stats AND recent orders for dashboard
        const [ordersRes, customersRes, sellersRes, recentOrdersRes] = await Promise.all([
          supabase.from('shop_orders').select('total_amount, status, created_at', { count: 'exact' }),
          supabase.from('profiles').select('id, user_type'),
          supabase.from('shop_sellers').select('is_approved, user_id', { count: 'exact' }),
          supabase.from('shop_orders').select('*, shop_order_items(*)').order('created_at', { ascending: false }).limit(10)
        ]);

        // Cancelled orders are refunds, not revenue
        const paidOrders = ordersRes.data?.filter(order => order.status !== 'cancelled') || [];
        const totalSales = paidOrders.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0);
        const pendingSellers = sellersRes.data?.filter(s => !s.is_approved).length || 0;
        const toFulfill = paidOrders.filter(order => ['pending', 'confirmed', 'processing'].includes(order.status)).length;

        // Customers are profiles that are neither sellers nor admins
        const sellerUserIds = new Set((sellersRes.data || []).map(s => s.user_id).filter(Boolean));
        const totalCustomers = (customersRes.data || [])
          .filter(profile => profile.user_type !== 'admin' && !sellerUserIds.has(profile.id))
          .length;

        // Last 7 days of revenue for the dashboard chart
        const days = [];
        for (let offset = 6; offset >= 0; offset -= 1) {
          const date = new Date();
          date.setDate(date.getDate() - offset);
          days.push({
            key: date.toLocaleDateString('en-CA'),
            label: date.toLocaleDateString('en-US', { weekday: 'short' }),
            total: 0
          });
        }

        paidOrders.forEach(order => {
          const key = new Date(order.created_at).toLocaleDateString('en-CA');
          const day = days.find(entry => entry.key === key);
          if (day) day.total += Number(order.total_amount) || 0;
        });

        setSalesDaily(days);
        setStats({
          totalOrders: ordersRes.count || 0,
          totalCustomers: totalCustomers,
          totalSellers: sellersRes.count || 0,
          totalSales: totalSales,
          pendingSellers: pendingSellers,
          toFulfill: toFulfill
        });
        setOrders(recentOrdersRes.data || []);
      } else if (activeTab === 'sellers') {
        const { data, error } = await supabase
          .from('shop_sellers')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        setSellers(data || []);
      } else if (activeTab === 'customers') {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        setCustomers(data || []);
      } else if (activeTab === 'products') {
        const { data, error } = await supabase
          .from('shop_products')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        setProducts(data || []);
      } else if (activeTab === 'categories') {
        const { data, error } = await supabase
          .from('shop_categories')
          .select('*')
          .order('display_order', { ascending: true });

        if (error) throw error;
        setCategories(data || []);
      } else {
        const { data, error } = await supabase
          .from('shop_orders')
          .select('*, shop_order_items(*)')
          .order('created_at', { ascending: false });

        if (error) throw error;
        setOrders(data || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // Validate price and stock
      const price = parseFloat(newProduct.price);
      const stock = parseInt(newProduct.stock);
      
      if (price <= 0) {
        alert('Price must be greater than 0');
        setLoading(false);
        return;
      }
      
      if (stock < 0) {
        alert('Stock cannot be negative');
        setLoading(false);
        return;
      }

      // Use uploaded image URL if available, otherwise use entered URL
      const imageUrl = newProduct.image_url || null;
      
      const { error } = await supabase
        .from('shop_products')
        .insert([{
          name: newProduct.name,
          description: newProduct.description,
          price: price,
          stock: stock,
          category: newProduct.category,
          image_url: imageUrl,
          artisan_name: newProduct.artisan_name || null,
          available: true
        }]);

      if (error) throw error;

      setNewProduct({
        name: '',
        description: '',
        price: '',
        stock: '',
        category: 'handicrafts',
        image_url: '',
        artisan_name: '',
        imageFile: null
      });
      setImagePreview('');
      setShowAddProduct(false);
      fetchData();
      alert('Product added successfully!');
    } catch (error) {
      console.error('Error adding product:', error);
      alert('Failed to add product: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleProductAvailability = async (productId, currentStatus) => {
    try {
      const { error } = await supabase
        .from('shop_products')
        .update({ available: !currentStatus })
        .eq('id', productId);

      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error updating product:', error);
      alert('Failed to update product');
    }
  };

  const deleteProduct = async (productId) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    
    try {
      const { error } = await supabase
        .from('shop_products')
        .delete()
        .eq('id', productId);

      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error deleting product:', error);
      alert('Failed to delete product');
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      const { error} = await supabase
        .from('shop_orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', orderId);

      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error updating order:', error);
      alert('Failed to update order');
    }
  };

  const rejectSeller = async (seller) => {
    if (!confirm(`Reject the seller application for "${seller.business_name}"?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('shop_sellers')
        .update({
          is_rejected: true,
          is_approved: false,
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', seller.id);

      if (error) throw error;

      showToast(`Seller application "${seller.business_name}" rejected.`, 'success');
      fetchData();
    } catch (error) {
      console.error('Error rejecting seller:', error);
      showToast(
        error.message?.includes('is_rejected')
          ? 'Rejecting needs the is_rejected column. Run supabase-admin-policies.sql in Supabase.'
          : 'Failed to reject seller: ' + error.message,
        'error'
      );
    }
  };

  const orderTotals = orders.reduce(
    (acc, order) => {
      const amount = Number(order.total_amount) || 0;

      if (order.status === 'delivered') acc.completed += amount;
      else if (order.status === 'cancelled') acc.refunded += amount;
      else acc.pending += amount;

      if (order.payment_method === 'cod') acc.cod += amount;
      if (order.payment_method === 'gcash') acc.gcash += amount;

      return acc;
    },
    { completed: 0, pending: 0, refunded: 0, cod: 0, gcash: 0 }
  );

  const generateReport = async (type) => {
    const config = REPORT_CONFIG[type];
    if (!config) return;

    setReportLoading(type);

    try {
      const salesOrders = orders.filter((order) => order.status !== 'cancelled');
      let rows = [];

      if (type === 'sales') {
        const byDay = {};

        salesOrders.forEach((order) => {
          const day = new Date(order.created_at).toLocaleDateString('en-CA');
          byDay[day] = byDay[day] || { date: day, orders: 0, revenue: 0 };
          byDay[day].orders += 1;
          byDay[day].revenue += Number(order.total_amount) || 0;
        });

        rows = Object.values(byDay)
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((row) => ({ ...row, revenue: row.revenue.toFixed(2) }));
      } else if (type === 'products') {
        const byProduct = {};

        salesOrders.forEach((order) => {
          (order.shop_order_items || []).forEach((item) => {
            const key = item.product_name;
            byProduct[key] = byProduct[key] || { name: key, units: 0, revenue: 0 };
            byProduct[key].units += item.quantity || 0;
            byProduct[key].revenue += (Number(item.price) || 0) * (item.quantity || 0);
          });
        });

        rows = Object.values(byProduct)
          .sort((a, b) => b.revenue - a.revenue)
          .map((row) => ({ ...row, revenue: row.revenue.toFixed(2) }));
      } else if (type === 'customers') {
        const byCustomer = {};

        salesOrders.forEach((order) => {
          const key = order.customer_email || order.customer_name || 'Unknown';
          byCustomer[key] = byCustomer[key] || {
            name: order.customer_name || 'Unknown',
            email: order.customer_email || '-',
            orders: 0,
            spent: 0
          };
          byCustomer[key].orders += 1;
          byCustomer[key].spent += Number(order.total_amount) || 0;
        });

        rows = Object.values(byCustomer)
          .sort((a, b) => b.spent - a.spent)
          .map((row) => ({ ...row, spent: row.spent.toFixed(2) }));
      } else if (type === 'sellers') {
        const [{ data: sellerRows }, { data: productRows }] = await Promise.all([
          supabase.from('shop_sellers').select('id, business_name'),
          supabase.from('shop_products').select('id, seller_id')
        ]);

        const sellerNames = new Map((sellerRows || []).map((seller) => [seller.id, seller.business_name]));
        const productSellers = new Map((productRows || []).map((product) => [product.id, product.seller_id]));
        const bySeller = {};

        (productRows || []).forEach((product) => {
          const key = product.seller_id || 'unassigned';
          bySeller[key] = bySeller[key] || {
            name: product.seller_id ? sellerNames.get(product.seller_id) || 'Unknown seller' : 'Platform listings',
            products: 0,
            units: 0,
            revenue: 0
          };
          bySeller[key].products += 1;
        });

        salesOrders.forEach((order) => {
          (order.shop_order_items || []).forEach((item) => {
            const sellerId = productSellers.get(item.product_id) || 'unassigned';
            bySeller[sellerId] = bySeller[sellerId] || {
              name: sellerId === 'unassigned' ? 'Platform listings' : sellerNames.get(sellerId) || 'Unknown seller',
              products: 0,
              units: 0,
              revenue: 0
            };
            bySeller[sellerId].units += item.quantity || 0;
            bySeller[sellerId].revenue += (Number(item.price) || 0) * (item.quantity || 0);
          });
        });

        rows = Object.values(bySeller)
          .sort((a, b) => b.revenue - a.revenue)
          .map((row) => ({ ...row, revenue: row.revenue.toFixed(2) }));
      } else if (type === 'orders') {
        const statuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

        rows = statuses.map((status) => {
          const matching = orders.filter((order) => order.status === status);
          return {
            status: status.charAt(0).toUpperCase() + status.slice(1),
            orders: matching.length,
            value: matching.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0).toFixed(2)
          };
        });
      } else if (type === 'revenue') {
        const methods = [
          { key: 'gcash', label: 'GCash' },
          { key: 'cod', label: 'Cash on Delivery' },
          { key: 'bank', label: 'Bank Transfer' }
        ];

        rows = methods.map((method) => {
          const matching = salesOrders.filter((order) => order.payment_method === method.key);
          return {
            method: method.label,
            orders: matching.length,
            revenue: matching.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0).toFixed(2)
          };
        });
      }

      setReport({
        type,
        title: config.title,
        subtitle: config.subtitle,
        columns: config.columns,
        rows,
        generatedAt: new Date().toLocaleString()
      });

      showToast(
        rows.length
          ? `${config.title} generated: ${rows.length} row(s).`
          : `${config.title} generated, but there is no data yet.`,
        'success'
      );
    } catch (error) {
      console.error('Error generating report:', error);
      showToast('Failed to generate report: ' + error.message, 'error');
    } finally {
      setReportLoading('');
    }
  };

  const exportReportCsv = () => {
    if (!report || report.rows.length === 0) {
      showToast('Generate a report with data before exporting.', 'error');
      return;
    }

    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      report.columns.map((column) => escape(column.label)).join(','),
      ...report.rows.map((row) => report.columns.map((column) => escape(row[column.key])).join(','))
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.type}-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('CSV file downloaded.', 'success');
  };

  const updateAdminProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        showToast('Demo admin session: sign in with a Supabase admin account to edit the profile.', 'error');
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({ full_name: adminName })
        .eq('id', session.user.id);

      if (error) throw error;

      await supabase.auth.updateUser({ data: { full_name: adminName } });
      showToast('Admin profile updated.', 'success');
    } catch (error) {
      console.error('Error updating admin profile:', error);
      showToast('Failed to update profile: ' + error.message, 'error');
    }
  };

  const saveWebsiteSettings = async () => {
    setSavingSettings(true);

    try {
      const rows = Object.entries(websiteSettings).map(([key, value]) => ({
        key,
        value: String(value)
      }));

      const { error } = await supabase.from('shop_settings').upsert(rows, { onConflict: 'key' });

      if (error) throw error;

      showToast('Website settings saved.', 'success');
    } catch (error) {
      console.error('Error saving website settings:', error);
      showToast(
        error.code === '42P01' || error.message?.includes('shop_settings')
          ? 'Saving settings needs the shop_settings table. Run supabase-admin-policies.sql in Supabase.'
          : 'Failed to save settings: ' + error.message,
        'error'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const changeAdminPassword = async () => {
    if (passwordForm.next.length < 6) {
      showToast('New password must be at least 6 characters.', 'error');
      return;
    }

    if (passwordForm.next !== passwordForm.confirm) {
      showToast('New passwords do not match.', 'error');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user?.email) {
        showToast('Demo admin session: no Supabase password is stored for this account.', 'error');
        return;
      }

      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: passwordForm.current
      });

      if (verifyError) {
        showToast('Current password is incorrect.', 'error');
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: passwordForm.next });
      if (error) throw error;

      setPasswordForm({ current: '', next: '', confirm: '' });
      showToast('Password updated.', 'success');
    } catch (error) {
      console.error('Error changing admin password:', error);
      showToast('Failed to change password: ' + error.message, 'error');
    }
  };

  // Login Screen
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Access</h1>
              <p className="text-gray-600">Sign in with your admin account</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  placeholder="Enter admin email"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  placeholder="Enter admin password"
                  required
                />
                {loginError && (
                  <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {loginError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3.5 rounded-xl font-bold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                Access Admin Panel
              </button>

              <div className="text-center">
                <Link href="/shop" className="text-sm text-gray-600 hover:text-blue-600 transition-colors">
                  ← Back to Shop
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Main Admin Dashboard with Sidebar
  return (
    <div className="flex h-screen bg-gray-50">
      {/* LEFT SIDEBAR */}
      <aside className="w-64 bg-gradient-to-b from-purple-700 to-purple-900 text-white flex flex-col shadow-xl">
        {/* Logo */}
        <div className="p-6 border-b border-purple-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-white">CONNECT-Daet</h1>
              <p className="text-xs text-blue-200">Admin Panel</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'dashboard'
                ? 'bg-purple-800 border-l-4 border-white font-semibold'
                : 'hover:bg-purple-800/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="font-medium">Dashboard</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'orders'
                ? 'bg-purple-800 border-l-4 border-white font-semibold'
                : 'hover:bg-purple-800/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            <span className="font-medium">Orders</span>
            {orders.length > 0 && (
              <span className="ml-auto px-2 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full">
                {orders.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('products')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'products'
                ? 'bg-purple-800 border-l-4 border-white font-semibold'
                : 'hover:bg-purple-800/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="font-medium">Products</span>
          </button>

          <button
            onClick={() => setActiveTab('sellers')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'sellers'
                ? 'bg-purple-800 border-l-4 border-white font-semibold'
                : 'hover:bg-purple-800/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <span className="font-medium">Sellers</span>
          </button>

          <button
            onClick={() => setActiveTab('customers')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'customers'
                ? 'bg-purple-800 border-l-4 border-white font-semibold'
                : 'hover:bg-purple-800/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <span className="font-medium">Customers</span>
          </button>

          <button
            onClick={() => setActiveTab('categories')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'categories'
                ? 'bg-purple-800 border-l-4 border-white font-semibold'
                : 'hover:bg-purple-800/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <span className="font-medium">Categories</span>
          </button>

          <button
            onClick={() => setActiveTab('transactions')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'transactions'
                ? 'bg-purple-800 border-l-4 border-white font-semibold'
                : 'hover:bg-purple-800/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            <span className="font-medium">Transactions</span>
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'reports'
                ? 'bg-purple-800 border-l-4 border-white font-semibold'
                : 'hover:bg-purple-800/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="font-medium">Reports</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
              activeTab === 'settings'
                ? 'bg-purple-800 border-l-4 border-white font-semibold'
                : 'hover:bg-purple-800/50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="font-medium">Settings</span>
          </button>
        </nav>

        {/* Logout Button */}
        <div className="p-4 border-t border-purple-800">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-left bg-purple-800 hover:bg-purple-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="font-medium">Log Out</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="bg-white border-b px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Welcome back, Admin! 👋</h1>
            <p className="text-sm text-gray-600">Here&apos;s what&apos;s happening with your e-commerce platform today.</p>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-gray-600 hover:text-gray-900">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <span className="text-purple-700 font-bold">A</span>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">{adminName}</p>
                <p className="text-xs text-gray-600">{adminEmail || 'Administrator'}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-8">
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
          {loading ? (
          <div className="flex justify-center items-center h-64 bg-white rounded-xl">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading...</p>
            </div>
          </div>
        ) : activeTab === 'dashboard' ? (
          <div>
            {/* Dashboard Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Orders</p>
                    <h3 className="text-3xl font-bold text-gray-900 mt-2">{stats.totalOrders}</h3>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Customers</p>
                    <h3 className="text-3xl font-bold text-gray-900 mt-2">{stats.totalCustomers}</h3>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Sellers</p>
                    <h3 className="text-3xl font-bold text-gray-900 mt-2">{stats.totalSellers}</h3>
                    {stats.pendingSellers > 0 && (
                      <p className="text-xs text-orange-600 mt-1">{stats.pendingSellers} pending approval</p>
                    )}
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Revenue</p>
                    <h3 className="text-3xl font-bold text-gray-900 mt-2">₱{stats.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                  </div>
                  <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6">
              <h3 className="text-lg font-bold mb-4">Quick Actions</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <button
                  onClick={() => setActiveTab('sellers')}
                  className="flex items-center justify-between p-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                    <span className="font-semibold text-gray-900">View Sellers</span>
                  </div>
                  {stats.pendingSellers > 0 && (
                    <span className="bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded-full">{stats.pendingSellers}</span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('products')}
                  className="flex items-center justify-between p-4 bg-green-50 hover:bg-green-100 rounded-lg transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                    <span className="font-semibold text-gray-900">Manage Products</span>
                  </div>
                </button>

                <button
                  onClick={() => setActiveTab('orders')}
                  className="flex items-center justify-between p-4 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                      </svg>
                    </div>
                    <span className="font-semibold text-gray-900">View Orders</span>
                  </div>
                </button>

                <button
                  onClick={() => setActiveTab('customers')}
                  className="flex items-center justify-between p-4 bg-yellow-50 hover:bg-yellow-100 rounded-lg transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-yellow-600 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <span className="font-semibold text-gray-900">View Customers</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Pending Approvals & Sales Overview Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              {/* Pending Approvals */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-lg font-bold mb-4">Pending Approvals</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">Seller Applications</p>
                        <p className="text-xs text-gray-600">New registrations</p>
                      </div>
                    </div>
                    <span className="bg-orange-500 text-white text-sm font-bold px-3 py-1 rounded-full">{stats.pendingSellers}</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">Orders to Fulfill</p>
                        <p className="text-xs text-gray-600">Pending, confirmed, processing</p>
                      </div>
                    </div>
                    <span className="bg-blue-500 text-white text-sm font-bold px-3 py-1 rounded-full">{stats.toFulfill}</span>
                  </div>
                </div>
              </div>

              {/* Sales Overview Chart Placeholder */}
              <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold">Sales Overview</h3>
                  <span className="text-xs text-gray-500">Last 7 days</span>
                </div>

                {salesDaily.every(day => day.total === 0) ? (
                  <div className="h-48 flex items-center justify-center bg-gray-50 rounded-lg">
                    <div className="text-center">
                      <p className="text-gray-600 font-medium">No sales in the last 7 days</p>
                      <p className="text-xs text-gray-500 mt-1">Revenue from new orders appears here</p>
                    </div>
                  </div>
                ) : (
                  <div className="h-48 flex items-end gap-2">
                    {salesDaily.map((day) => {
                      const peak = Math.max(...salesDaily.map(entry => entry.total), 1);
                      const height = Math.round((day.total / peak) * 100);

                      return (
                        <div key={day.key} className="flex-1 flex flex-col items-center justify-end h-full">
                          <span className="text-[10px] text-gray-600 mb-1">
                            {day.total > 0 ? `₱${day.total.toLocaleString()}` : ''}
                          </span>
                          <div
                            className="w-full bg-blue-500 rounded-t"
                            style={{ height: `${Math.max(height, 2)}%` }}
                          />
                          <span className="text-[10px] text-gray-500 mt-1">{day.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Orders */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">Recent Orders</h3>
                  <button
                    onClick={() => setActiveTab('orders')}
                    className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                  >
                    View All →
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Order ID</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Customer</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Products</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Total</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {orders.slice(0, 5).map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900">#{order.id.slice(0, 8)}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {order.customer_name || 'Customer'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {order.shop_order_items?.length || 0} items
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                          ₱{order.total_amount?.toLocaleString() || '0'}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                            order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                            order.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                            order.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {order.status?.charAt(0).toUpperCase() + order.status?.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {new Date(order.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan="6" className="px-6 py-8 text-center text-gray-500">
                          No orders yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : activeTab === 'sellers' ? (
          <div>
            <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Business Name</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Email</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Phone</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sellers.map((seller) => (
                    <tr key={seller.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-semibold text-gray-900">{seller.business_name}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{seller.contact_email}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{seller.contact_phone || '-'}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                          seller.is_rejected
                            ? 'bg-red-100 text-red-700'
                            : seller.is_approved && seller.is_active
                            ? 'bg-green-100 text-green-700'
                            : !seller.is_approved
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {seller.is_rejected
                            ? 'Rejected'
                            : seller.is_approved && seller.is_active
                            ? 'Active'
                            : !seller.is_approved
                            ? 'Pending Approval'
                            : 'Suspended'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          {!seller.is_approved ? (
                            <button
                              onClick={async () => {
                                try {
                                  const { error } = await supabase
                                    .from('shop_sellers')
                                    .update({ is_approved: true, is_active: true, updated_at: new Date().toISOString() })
                                    .eq('id', seller.id);
                                  
                                  if (error) {
                                    console.error('Error approving seller:', error);
                                    showToast('Failed to approve seller: ' + error.message, 'error');
                                    return;
                                  }
                                  
                                  showToast(`Seller "${seller.business_name}" approved successfully!`, 'success');
                                  fetchData();
                                } catch (err) {
                                  console.error('Error:', err);
                                  showToast('Failed to approve seller', 'error');
                                }
                              }}
                              className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors shadow-sm"
                            >
                              Approve
                            </button>
                          ) : (
                            <span className="px-4 py-2 text-sm font-medium text-gray-400 cursor-not-allowed">
                              Approved ✓
                            </span>
                          )}
                          {!seller.is_approved && !seller.is_rejected && (
                            <button
                              onClick={() => rejectSeller(seller)}
                              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors shadow-sm"
                            >
                              Reject
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              try {
                                const newStatus = !seller.is_active;
                                const action = newStatus ? 'activate' : 'suspend';
                                
                                if (!confirm(`Are you sure you want to ${action} "${seller.business_name}"?`)) {
                                  return;
                                }
                                
                                const { error } = await supabase
                                  .from('shop_sellers')
                                  .update({ is_active: newStatus, updated_at: new Date().toISOString() })
                                  .eq('id', seller.id);
                                
                                if (error) {
                                  console.error('Error updating seller status:', error);
                                  showToast('Failed to update status: ' + error.message, 'error');
                                  return;
                                }
                                
                                showToast(`Seller ${newStatus ? 'activated' : 'suspended'} successfully!`, 'success');
                                fetchData();
                              } catch (err) {
                                console.error('Error:', err);
                                showToast('Failed to update seller status', 'error');
                              }
                            }}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors shadow-sm ${
                              seller.is_active
                                ? 'bg-orange-600 text-white hover:bg-orange-700'
                                : 'bg-gray-600 text-white hover:bg-gray-700'
                            }`}
                          >
                            {seller.is_active ? 'Suspend' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'customers' ? (
          <div>
            <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Full Name</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Email</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Reward Points</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-semibold text-gray-900">{customer.full_name}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{customer.email}</td>
                      <td className="px-6 py-4 text-sm font-medium text-blue-600">{(customer.points ?? customer.reward_points) || 0} pts</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{new Date(customer.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'products' ? (
          <div>
            <div className="flex justify-between items-center mb-6">
              <div className="flex-1 max-w-md">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search products..."
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={() => setShowAddProduct(true)}
                className="ml-4 flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Product
              </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Product</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Category</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Price</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Stock</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {products
                    .filter(product => 
                      searchTerm === '' || 
                      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      product.artisan_name?.toLowerCase().includes(searchTerm.toLowerCase())
                    )
                    .map((product) => (
                    <tr key={product.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden">
                            {product.image_url ? (
                              <img
                                src={product.image_url}
                                alt={product.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{product.name}</div>
                            <div className="text-sm text-gray-600">{product.artisan_name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700 capitalize">
                          {product.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-semibold text-gray-900">₱{product.price}</td>
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
                            onClick={() => toggleProductAvailability(product.id, product.available)}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200"
                          >
                            {product.available ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => deleteProduct(product.id)}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'orders' ? (
          <div>
            <div className="space-y-4">
              {orders.map((order) => (
                <div key={order.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg">{order.customer_name}</h3>
                      <p className="text-sm text-gray-600">{order.customer_email}</p>
                      <p className="text-sm text-gray-600">{order.customer_phone}</p>
                      <p className="text-sm text-gray-600">{order.delivery_address}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-600">₱{order.total_amount}</div>
                      <div className="text-sm text-gray-500">{new Date(order.created_at).toLocaleDateString()}</div>
                    </div>
                  </div>

                  <div className="border-t pt-4 mb-4">
                    <h4 className="font-semibold mb-2">Items:</h4>
                    {order.shop_order_items?.map((item, idx) => (
                      <div key={idx} className="text-sm text-gray-600">
                        {item.product_name} x{item.quantity} - ₱{item.price * item.quantity}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-3 items-center">
                    <span className="text-sm font-medium">Status:</span>
                    <select
                      value={order.status}
                      onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                      className="px-4 py-2 border rounded-lg"
                    >
                      <option value="pending">Pending</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="processing">Processing</option>
                      <option value="shipped">Shipped</option>
                      <option value="delivered">Delivered</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <span className="text-sm text-gray-600">Payment: {order.payment_method?.toUpperCase()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : activeTab === 'categories' ? (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Manage Categories</h3>
              <button
                onClick={() => setShowAddCategory(true)}
                className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Category
              </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Icon</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Name</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Slug</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Description</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Order</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {categories.map((category) => (
                    <tr key={category.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-2xl">{category.icon}</td>
                      <td className="px-6 py-4 font-semibold">{category.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{category.slug}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{category.description || '-'}</td>
                      <td className="px-6 py-4 text-sm">{category.display_order}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                          category.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {category.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'transactions' ? (
          <div>
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-2">Transaction Monitoring</h3>
              <p className="text-gray-600 text-sm">Track all payment transactions and financial activities</p>
            </div>

            {/* Transaction Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-medium">Completed</p>
                    <p className="text-xl font-bold text-gray-900">₱{orderTotals.completed.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-medium">Pending</p>
                    <p className="text-xl font-bold text-gray-900">₱{orderTotals.pending.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-medium">Refunds / Cancelled</p>
                    <p className="text-xl font-bold text-gray-900">₱{orderTotals.refunded.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-medium">COD</p>
                    <p className="text-xl font-bold text-gray-900">
                      ₱{orderTotals.cod.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-medium">GCash</p>
                    <p className="text-xl font-bold text-gray-900">
                      ₱{orderTotals.gcash.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Transaction History */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-200">
                <h4 className="font-bold text-lg">Transaction History</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Transaction ID</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Order ID</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Customer</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Payment Method</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {orders.map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-mono text-gray-900">TXN-{order.id.slice(0, 8).toUpperCase()}</td>
                        <td className="px-6 py-4 text-sm font-semibold text-blue-600">#{order.id.slice(0, 8)}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{order.customer_name || 'Customer'}</td>
                        <td className="px-6 py-4 text-sm font-bold text-gray-900">₱{order.total_amount?.toLocaleString()}</td>
                        <td className="px-6 py-4">
                          <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 uppercase">
                            {order.payment_method}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                            order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                            order.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {order.status === 'delivered' ? 'Completed' : 'Processing'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {new Date(order.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan="7" className="px-6 py-8 text-center text-gray-500">
                          No transactions yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : activeTab === 'reports' ? (
          <div>
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-2">Reports & Analytics</h3>
              <p className="text-gray-600 text-sm">Generate reports and analyze business performance</p>
            </div>

            {/* Report Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">Sales Report</h4>
                    <p className="text-xs text-gray-600">Daily, weekly, monthly sales</p>
                  </div>
                </div>
                <button
                  onClick={() => generateReport('sales')}
                  disabled={reportLoading !== ''}
                  className="w-full py-2 px-4 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {reportLoading === 'sales' ? 'Generating...' : 'Generate Report'}
                </button>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">Product Report</h4>
                    <p className="text-xs text-gray-600">Top selling products</p>
                  </div>
                </div>
                <button
                  onClick={() => generateReport('products')}
                  disabled={reportLoading !== ''}
                  className="w-full py-2 px-4 bg-green-50 hover:bg-green-100 text-green-700 font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {reportLoading === 'products' ? 'Generating...' : 'Generate Report'}
                </button>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">Customer Report</h4>
                    <p className="text-xs text-gray-600">Customer insights & behavior</p>
                  </div>
                </div>
                <button
                  onClick={() => generateReport('customers')}
                  disabled={reportLoading !== ''}
                  className="w-full py-2 px-4 bg-purple-50 hover:bg-purple-100 text-purple-700 font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {reportLoading === 'customers' ? 'Generating...' : 'Generate Report'}
                </button>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">Seller Report</h4>
                    <p className="text-xs text-gray-600">Seller performance metrics</p>
                  </div>
                </div>
                <button
                  onClick={() => generateReport('sellers')}
                  disabled={reportLoading !== ''}
                  className="w-full py-2 px-4 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {reportLoading === 'sellers' ? 'Generating...' : 'Generate Report'}
                </button>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">Order Report</h4>
                    <p className="text-xs text-gray-600">Order tracking & status</p>
                  </div>
                </div>
                <button
                  onClick={() => generateReport('orders')}
                  disabled={reportLoading !== ''}
                  className="w-full py-2 px-4 bg-red-50 hover:bg-red-100 text-red-700 font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {reportLoading === 'orders' ? 'Generating...' : 'Generate Report'}
                </button>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">Revenue Report</h4>
                    <p className="text-xs text-gray-600">Revenue analysis & trends</p>
                  </div>
                </div>
                <button
                  onClick={() => generateReport('revenue')}
                  disabled={reportLoading !== ''}
                  className="w-full py-2 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {reportLoading === 'revenue' ? 'Generating...' : 'Generate Report'}
                </button>
              </div>
            </div>

            {/* Generated Report */}
            {report && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
                <div className="p-6 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-lg">{report.title}</h4>
                    <p className="text-xs text-gray-600">{report.subtitle} · Generated {report.generatedAt}</p>
                  </div>
                  <button
                    onClick={exportReportCsv}
                    className="px-4 py-2 bg-green-100 hover:bg-green-200 text-green-700 font-semibold rounded-lg transition-colors text-sm"
                  >
                    Download CSV
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {report.columns.map((column) => (
                          <th key={column.key} className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {report.rows.length === 0 && (
                        <tr>
                          <td colSpan={report.columns.length} className="px-6 py-8 text-center text-gray-500">
                            No data for this report yet. Place some orders first.
                          </td>
                        </tr>
                      )}
                      {report.rows.map((row, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          {report.columns.map((column) => (
                            <td key={column.key} className="px-6 py-3 text-sm text-gray-700">{row[column.key]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Export Options */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h4 className="font-bold text-lg mb-2">Export Data</h4>
              <p className="text-xs text-gray-600 mb-4">
                Generate a report above, then export it. CSV opens in Excel; Print → Save as PDF gives a PDF copy.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={exportReportCsv}
                  className="flex items-center gap-2 px-4 py-2 bg-green-100 hover:bg-green-200 text-green-700 font-semibold rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export as CSV
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 font-semibold rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Print / Save as PDF
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === 'settings' ? (
          <div>
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-2">Settings</h3>
              <p className="text-gray-600 text-sm">Manage website settings and admin account</p>
            </div>

            <div className="space-y-6">
              {/* Admin Account Settings */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 className="font-bold text-lg mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Admin Account
                </h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700">Email</label>
                    <input
                      type="email"
                      value={adminEmail || DEMO_ADMIN_EMAIL}
                      disabled
                      className="w-full px-4 py-3 border-2 rounded-lg bg-gray-50 text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700">Admin Name</label>
                    <input
                      type="text"
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <button
                    onClick={updateAdminProfile}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
                  >
                    Update Profile
                  </button>
                </div>
              </div>

              {/* Website Settings */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 className="font-bold text-lg mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                  Website Settings
                </h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700">Website Name</label>
                    <input
                      type="text"
                      value={websiteSettings.siteName}
                      onChange={(e) => setWebsiteSettings({ ...websiteSettings, siteName: e.target.value })}
                      className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700">Contact Email</label>
                    <input
                      type="email"
                      value={websiteSettings.contactEmail}
                      onChange={(e) => setWebsiteSettings({ ...websiteSettings, contactEmail: e.target.value })}
                      className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700">Contact Phone</label>
                    <input
                      type="tel"
                      value={websiteSettings.contactPhone}
                      onChange={(e) => setWebsiteSettings({ ...websiteSettings, contactPhone: e.target.value })}
                      className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    />
                  </div>
                  <button
                    onClick={saveWebsiteSettings}
                    disabled={savingSettings}
                    className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {savingSettings ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>

              {/* Security Settings */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h4 className="font-bold text-lg mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Security
                </h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700">Current Password</label>
                    <input
                      type="password"
                      value={passwordForm.current}
                      onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                      placeholder="Enter current password"
                      className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700">New Password</label>
                    <input
                      type="password"
                      value={passwordForm.next}
                      onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
                      placeholder="Enter new password"
                      className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700">Confirm New Password</label>
                    <input
                      type="password"
                      value={passwordForm.confirm}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                      placeholder="Confirm new password"
                      className="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                  <button
                    onClick={changeAdminPassword}
                    className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors"
                  >
                    Change Password
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        </main>
      </div>

      {/* Add Product Modal */}
      {showAddProduct && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Add New Product</h2>
                <button onClick={() => setShowAddProduct(false)} className="text-gray-400 hover:text-gray-600">
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
                  <label className="block text-sm font-semibold mb-2">Price (₱) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={newProduct.price}
                    onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                    className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2">Stock *</label>
                  <input
                    type="number"
                    min="0"
                    value={newProduct.stock}
                    onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                    className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Category *</label>
                <div className="flex gap-2">
                  <select
                    value={newProduct.category}
                    onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                    className="flex-1 px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    {categories.length > 0 ? (
                      categories.filter(c => c.slug !== 'all').map((cat) => (
                        <option key={cat.id} value={cat.slug}>
                          {cat.icon} {cat.name}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="handicrafts">🧺 Handicrafts</option>
                        <option value="food">🍽️ Food</option>
                        <option value="souvenirs">🎁 Souvenirs</option>
                        <option value="weavings">🧵 Weavings</option>
                        <option value="art">🎨 Art</option>
                      </>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddCategory(true)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
                    title="Add New Category"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
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

              <div>
                <label className="block text-sm font-semibold mb-2">Product Image</label>
                
                {/* Image Upload */}
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-blue-500 transition-colors">
                    <input
                      type="file"
                      id="imageUpload"
                      accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <label htmlFor="imageUpload" className="cursor-pointer">
                      {uploadingImage ? (
                        <div className="flex flex-col items-center">
                          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                          <p className="text-gray-600">Uploading image...</p>
                        </div>
                      ) : (
                        <div>
                          <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <p className="text-gray-600 font-medium mb-2">Click to upload or drag and drop</p>
                          <p className="text-sm text-gray-500">JPG, PNG, GIF, WebP (Max 5MB)</p>
                        </div>
                      )}
                    </label>
                  </div>

                  {/* OR Divider */}
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-300"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-2 bg-white text-gray-500">OR</span>
                    </div>
                  </div>

                  {/* Image URL Input */}
                  <input
                    type="url"
                    value={newProduct.image_url}
                    onChange={(e) => setNewProduct({ ...newProduct, image_url: e.target.value })}
                    placeholder="https://example.com/image.jpg"
                    className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                  />

                  {/* Image Preview */}
                  {(imagePreview || newProduct.image_url) && (
                    <div className="mt-4">
                      <p className="text-sm font-semibold mb-2">Preview:</p>
                      <img
                        src={imagePreview || newProduct.image_url}
                        alt="Preview"
                        className="w-full h-48 object-cover rounded-lg"
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddProduct(false)}
                  className="flex-1 px-6 py-3 border-2 rounded-xl font-semibold hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
                >
                  {loading ? 'Adding...' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Category Modal */}
      {showAddCategory && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Add New Category</h2>
                <button onClick={() => setShowAddCategory(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <form onSubmit={handleAddCategory} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Category Name *</label>
                <input
                  type="text"
                  value={newCategory.name}
                  onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                  className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Electronics"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Icon (Emoji) *</label>
                <input
                  type="text"
                  value={newCategory.icon}
                  onChange={(e) => setNewCategory({ ...newCategory, icon: e.target.value })}
                  className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 text-2xl"
                  placeholder="📦"
                  required
                  maxLength={2}
                />
                <p className="text-xs text-gray-500 mt-1">Choose any emoji (🎯 📱 👕 🍕 etc.)</p>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Description</label>
                <textarea
                  value={newCategory.description}
                  onChange={(e) => setNewCategory({ ...newCategory, description: e.target.value })}
                  rows="3"
                  className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional category description"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddCategory(false)}
                  className="flex-1 px-6 py-3 border-2 rounded-xl font-semibold hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
                >
                  {loading ? 'Adding...' : 'Add Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
