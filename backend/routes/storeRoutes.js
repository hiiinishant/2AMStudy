const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const productStore = require('../models/productStore');
const feedbackStore = require('../models/feedbackStore');
const razorpay = require('../config/razorpay');
const { firestoreDb } = require('../config/firebase');
const { requireStoreAdmin } = require('../middleware/adminAuth');
const { uploadProductImage } = require('../middleware/upload');

// Price Calculation (server-authoritative)
function computeCheckoutSummary(cart, coupon) {
  const spSubtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const mrpSubtotal = cart.reduce((s, i) => s + ((i.orig || Math.round(i.price * 1.4)) * i.qty), 0);
  const baseStoreDiscount = mrpSubtotal - spSubtotal;
  const couponDiscount = coupon ? (coupon.discount || 0) : 0;
  const freeDelivery = coupon ? (coupon.freeDelivery || false) : false;
  const baseDelivery = spSubtotal > 0 && spSubtotal < 499 ? 50 : 0;
  const delivery = freeDelivery ? 0 : baseDelivery;
  const platformFee = 1;
  const finalTotal = Math.max(1, spSubtotal - couponDiscount + delivery + platformFee);
  const totalSaved = baseStoreDiscount + couponDiscount;
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);
  return { spSubtotal, mrpSubtotal, baseStoreDiscount, couponDiscount, freeDelivery, delivery, platformFee, finalTotal, totalSaved, itemCount };
}

// ─── Store View Routes ────────────────────────────────────────────────────────

router.get('/store', (req, res) => {
  res.render('store', {
    pageTitle: '2AM Study Store - Student Essentials, Digital Tools & Accessories',
    metaDescription: 'Shop curated study accessories, durable college bags, premium notebooks, and essentials built for productivity and late-night focus.',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    hideBot: true,
    storeProducts: productStore.getProducts()
  });
});

router.get('/store/product/:id', (req, res) => {
  const productId = Number(req.params.id);
  const STORE_PRODUCTS = productStore.getProducts();
  const product = STORE_PRODUCTS.find(p => p.id === productId) || null;
  if (!product) {
    return res.status(404).render('store-product', {
      pageTitle: 'Product Not Found | 2AM Study Store',
      metaDescription: 'The requested product is not available.',
      product: null,
      storeProducts: STORE_PRODUCTS,
      hideBot: true
    });
  }
  const productImages = (product.images && product.images.length)
    ? product.images.map(img => img.startsWith('http') ? img : `https://2amstudy.com${img}`)
    : (product.image ? [product.image.startsWith('http') ? product.image : `https://2amstudy.com${product.image}`] : ['https://2amstudy.com/assets/images/smart_study_banner.png']);

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.name,
    "image": productImages,
    "description": product.desc || `${product.name} on 2AM Study Store.`,
    "sku": `2AM-PROD-${product.id}`,
    "brand": { "@type": "Brand", "name": "2AM Study" },
    "offers": {
      "@type": "Offer",
      "url": `https://2amstudy.com/store/product/${product.id}`,
      "priceCurrency": "INR",
      "price": product.price,
      "availability": (product.stock > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "itemCondition": "https://schema.org/NewCondition"
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": product.rating || "4.8",
      "reviewCount": product.reviewsCount || 120
    }
  };

  return res.render('store-product', {
    pageTitle: `${product.name} | 2AM Study Store`,
    metaDescription: product.desc || `Buy ${product.name} at best student discount prices on 2AM Study Store.`,
    ogTitle: `${product.name} | 2AM Study Store`,
    ogDescription: product.desc || `Buy ${product.name} on 2AM Study Store.`,
    ogImage: productImages[0],
    structuredData: productSchema,
    product,
    storeProducts: STORE_PRODUCTS,
    hideBot: true
  });
});

router.get('/store/cart', (req, res) => {
  const initialCart = req.session.cart || [];
  res.render('store-cart', {
    pageTitle: 'My Cart | 2AM Study Store',
    metaDescription: 'View and manage your selected items in the Student Store cart before proceeding to checkout.',
    hideBot: true,
    hideCartBubble: false,
    storeProducts: productStore.getProducts(),
    initialCart
  });
});

router.get('/store/order-summary', (req, res) => {
  res.render('store-order-summary', {
    pageTitle: 'Order Summary | 2AM Study Store',
    metaDescription: 'Review your cart items, total amount, and proceed to checkout securely.',
    hideBot: true,
    hideCartBubble: false
  });
});

router.get(['/store/my-orders', '/my-orders'], (req, res) => {
  res.render('store-orders', {
    pageTitle: 'My Orders | 2AM Study Store',
    metaDescription: 'Track, manage, and view invoices for all your past purchases from the 2AM Study Store.',
    hideBot: true
  });
});

router.get('/store/invoice/:orderId', (req, res) => {
  const { orderId } = req.params;

  // Resolve the stored order from map, in-memory orders, or session
  let storedOrder = null;
  const mapEntry = productStore.storeInvoicesMap.get(orderId);
  if (mapEntry && typeof mapEntry === 'object' && mapEntry.orderId) {
    storedOrder = mapEntry;
  } else {
    storedOrder = productStore.getOrders().find(o => o.orderId === orderId) || null;
  }
  if (!storedOrder && req.session?.lastOrder?.orderId === orderId) {
    storedOrder = req.session.lastOrder;
  }

  // Ensure invoice number is registered
  if (!productStore.storeInvoicesMap.has(orderId)) {
    const seqStr = String(productStore.incrementInvoiceCounter()).padStart(5, '0');
    productStore.storeInvoicesMap.set(orderId, storedOrder || `INV-2026${seqStr}`);
  }
  const mapVal = productStore.storeInvoicesMap.get(orderId);
  const invoiceNo = storedOrder?.invoiceNo ||
    (typeof mapVal === 'string' ? mapVal : mapVal?.invoiceNo) ||
    `INV-2026-${orderId.slice(-5)}`;

  const customer = storedOrder?.customer || {
    name: 'Student Customer',
    email: 'student@example.com',
    phone: '+91 98765 43210',
    address: 'Hostel Block B, Room 204, Campus Road',
    city: 'New Delhi',
    pincode: '110001'
  };

  const rawItems = (storedOrder?.items && storedOrder.items.length) ? storedOrder.items : [];
  const items = rawItems.map(item => {
    const unitPrice = Number(item.price);
    const origPrice = Number(item.origPrice || item.orig || Math.round(unitPrice * 1.25));
    const qty = Number(item.qty || 1);
    const discountPerUnit = Math.max(0, origPrice - unitPrice);
    const lineTotal = unitPrice * qty;
    return { ...item, qty, unitPrice, origPrice, discountPerUnit, lineTotal };
  });

  const subtotal = storedOrder?.subtotal ?? items.reduce((sum, item) => sum + item.lineTotal, 0);
  const totalDiscount = storedOrder?.totalSaved ?? items.reduce((sum, item) => sum + (item.discountPerUnit * item.qty), 0);
  const delivery = storedOrder?.delivery ?? 0;
  const platformFee = storedOrder?.platformFee ?? (items.length ? 1 : 0);
  const couponDiscount = storedOrder?.couponDiscount ?? 0;
  const grandTotal = storedOrder?.finalTotal ?? storedOrder?.grandTotal ?? (subtotal - couponDiscount + delivery + platformFee);
  const amountPaid = storedOrder?.amountPaid ?? grandTotal;

  const orderObj = {
    orderId,
    invoiceNo,
    invoiceDate: storedOrder?.createdAt
      ? new Date(storedOrder.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
      : new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }),
    customerName: customer.name || 'Student Customer',
    customerEmail: customer.email || 'student@example.com',
    customerPhone: customer.phone || '+91 98765 43210',
    shippingAddress: `${customer.address || ''}, ${customer.city || ''} - ${customer.pincode || ''}`,
    city: customer.city || '',
    pincode: customer.pincode || '',
    items,
    subtotal,
    totalDiscount,
    couponDiscount,
    delivery,
    platformFee,
    grandTotal,
    amountPaid,
    totalSaved: totalDiscount,
    paymentId: storedOrder?.paymentId || '',
    paymentMethod: storedOrder?.paymentMethod || 'Razorpay (Card/UPI/NetBanking)'
  };

  res.render('store-invoice', {
    pageTitle: `Invoice ${orderObj.invoiceNo} | 2AM Study Store`,
    metaDescription: `Tax invoice for order ${orderId} from 2AM Study Store.`,
    order: orderObj,
    orderId,
    invoiceNo: orderObj.invoiceNo,
    orderDate: orderObj.invoiceDate,
    customer,
    items,
    subtotal,
    totalDiscount,
    grandTotal,
    hideBot: true
  });
});

router.get('/store/payment', (req, res) => {
  res.render('store-payment', {
    pageTitle: 'Complete Payment | 2AM Study Store',
    metaDescription: 'Complete secure Razorpay payment for your 2AM Study Store order.',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    hideBot: true,
    hideCartBubble: true
  });
});

router.get('/store/payment-success', (req, res) => {
  res.render('store-payment-success', {
    pageTitle: 'Payment Successful | 2AM Study Store',
    metaDescription: 'Your payment is successful. Thank you for shopping with 2AM Study Store.',
    paymentId: req.query.payment_id || '',
    orderId: req.query.order_id || '',
    hideBot: true
  });
});

// ─── Store APIs ──────────────────────────────────────────────────────────────

router.get('/store/api/store/products', (req, res) => {
  const { category, sort, search } = req.query;
  let products = [...productStore.getProducts()];

  if (category && category !== 'all') {
    products = products.filter(p => p.cat === category);
  }
  if (search) {
    const term = search.toLowerCase();
    products = products.filter(p =>
      p.name.toLowerCase().includes(term) || p.desc.toLowerCase().includes(term)
    );
  }
  if (sort) {
    switch (sort) {
      case 'price-low': products.sort((a, b) => a.price - b.price); break;
      case 'price-high': products.sort((a, b) => b.price - a.price); break;
      case 'rating': products.sort((a, b) => b.rating - a.rating); break;
      case 'discount': products.sort((a, b) => ((b.orig - b.price) / b.orig) - ((a.orig - a.price) / a.orig)); break;
      case 'newest': products.reverse(); break;
    }
  }

  res.json({ success: true, count: products.length, products });
});

router.get('/store/api/store/products/:id', (req, res) => {
  const product = productStore.getProducts().find(p => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  res.json({ success: true, product });
});

router.get('/store/api/store/products/:id/related', (req, res) => {
  const STORE_PRODUCTS = productStore.getProducts();
  const product = STORE_PRODUCTS.find(p => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  const related = STORE_PRODUCTS.filter(p => p.cat === product.cat && p.id !== product.id).slice(0, 4);
  res.json({ success: true, count: related.length, products: related });
});

router.post('/store/api/store/check-delivery', (req, res) => {
  const { pincode, productId } = req.body;
  if (!pincode || !/^\d{6}$/.test(pincode)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid 6-digit pincode' });
  }
  const product = productStore.getProducts().find(p => p.id === Number(productId));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

  const pin = parseInt(pincode);
  const isMetro = [1100, 4000, 5600, 6000, 7000, 3800, 5000, 30].some(prefix => pin >= prefix * 100 && pin < (prefix + 10) * 100);
  const isTier2 = [122, 201, 302, 411, 462, 500, 781, 800, 841].some(prefix => String(pin).startsWith(String(prefix)));

  let deliveryDate, deliveryCharge, estimatedDays;
  if (isMetro) {
    estimatedDays = 2;
    deliveryCharge = 0;
    deliveryDate = new Date(Date.now() + estimatedDays * 86400000).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
  } else if (isTier2) {
    estimatedDays = 4;
    deliveryCharge = 49;
    deliveryDate = new Date(Date.now() + estimatedDays * 86400000).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
  } else {
    estimatedDays = 6;
    deliveryCharge = 79;
    deliveryDate = new Date(Date.now() + estimatedDays * 86400000).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  res.json({
    success: true,
    pincode,
    deliverable: true,
    deliveryDate,
    estimatedDays,
    deliveryCharge,
    freeDeliveryAbove: 499,
    codAvailable: false
  });
});

router.get('/store/api/store/cart', (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  res.json({ success: true, items: cart, total, itemCount: cart.reduce((s, i) => s + i.qty, 0) });
});

router.post('/store/api/store/cart/add', (req, res) => {
  const { productId, qty } = req.body;
  const product = productStore.getProducts().find(p => p.id === Number(productId));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

  if (product.stock <= 0) {
    return res.status(400).json({ success: false, error: `${product.name} is out of stock.` });
  }

  if (!req.session.cart) req.session.cart = [];
  const existing = req.session.cart.find(i => i.productId === product.id);
  const delta = Number(qty) || 1;

  if (existing) {
    const newQty = existing.qty + delta;
    if (newQty <= 0) {
      req.session.cart = req.session.cart.filter(i => i.productId !== product.id);
    } else if (newQty > product.stock) {
      return res.status(400).json({ success: false, error: `Only ${product.stock} unit(s) of "${product.name}" available.` });
    } else {
      existing.qty = newQty;
    }
  } else {
    const addQty = Math.max(1, delta);
    if (addQty > product.stock) {
      return res.status(400).json({ success: false, error: `Only ${product.stock} unit(s) of "${product.name}" available.` });
    }
    req.session.cart.push({
      productId: product.id,
      name: product.name,
      image: product.images[0],
      price: product.price,
      orig: product.orig,
      qty: addQty
    });
  }
  const cart = req.session.cart;
  res.json({ success: true, items: cart, total: cart.reduce((s, i) => s + i.price * i.qty, 0), itemCount: cart.reduce((s, i) => s + i.qty, 0) });
});

router.post('/store/api/store/cart/remove', (req, res) => {
  const { productId } = req.body;
  if (!req.session.cart) return res.json({ success: true, items: [], total: 0, itemCount: 0 });
  req.session.cart = req.session.cart.filter(i => i.productId !== Number(productId));
  const cart = req.session.cart;
  res.json({ success: true, items: cart, total: cart.reduce((s, i) => s + i.price * i.qty, 0), itemCount: cart.reduce((s, i) => s + i.qty, 0) });
});

router.post('/store/api/store/cart/buynow', (req, res) => {
  const { productId } = req.body;
  const product = productStore.getProducts().find(p => p.id === Number(productId));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  if (product.stock <= 0) return res.status(400).json({ success: false, error: 'Out of stock' });

  req.session.cart = [{
    productId: product.id,
    name: product.name,
    image: product.images[0],
    price: product.price,
    orig: product.orig,
    qty: 1
  }];
  res.json({ success: true });
});

router.get('/store/api/store/checkout', (req, res) => {
  const cart = req.session.cart || [];
  const customer = req.session.checkoutCustomer || null;
  const coupon = req.session.checkoutCoupon || null;
  const summary = computeCheckoutSummary(cart, coupon);
  res.json({ success: true, cart, customer, coupon, summary });
});

router.post('/store/api/store/checkout/address', (req, res) => {
  const { name, email, phone, pincode, address, city } = req.body;
  if (!name || !email || !phone || !pincode || !address || !city) {
    return res.status(400).json({ success: false, error: 'All address fields are required' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
  }
  if (!/^\d{6}$/.test(pincode)) {
    return res.status(400).json({ success: false, error: 'Pincode must be exactly 6 digits' });
  }
  if (phone.replace(/\D/g, '').length < 10) {
    return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit phone number' });
  }
  req.session.checkoutCustomer = { name, email, phone, pincode, address, city };
  res.json({ success: true, customer: req.session.checkoutCustomer });
});

router.post('/store/api/store/checkout/coupon', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ success: false, error: 'Coupon code is required' });

  const cart = req.session.cart || [];
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const hasOrderedBefore = req.session.hasOrderedBefore === true;

  const COUPONS = {
    'WELCOME': { type: 'flat_first_time', value: 100, message: '₹100 Welcome discount applied!' },
    'WELCOME100': { type: 'flat_first_time', value: 100, message: '₹100 Welcome discount applied!' },
    'WELCOME50': { type: 'flat_first_time', value: 50, message: '₹50 Welcome discount applied!' },
    'STUDY10': { type: 'flat', value: 50, message: '₹50 discount applied!' },
    'STUDY20': { type: 'percent', percent: 20, message: '20% discount applied!' },
    'STUDY50': { type: 'flat', value: 50, message: '₹50 discount applied!' },
    '2AMSTUDY': { type: 'flat', value: 75, message: '₹75 2AM Study discount applied!' },
    '2AM': { type: 'flat', value: 50, message: '₹50 discount applied!' },
    'SAVE10': { type: 'percent', percent: 10, message: '10% discount applied!' },
    'SAVE20': { type: 'percent', percent: 20, message: '20% discount applied!' },
    'SAVE50': { type: 'flat', value: 50, message: '₹50 discount applied!' },
    'DISCOUNT10': { type: 'percent', percent: 10, message: '10% discount applied!' },
    'FLAT50': { type: 'flat', value: 50, message: '₹50 discount applied!' },
    'FREESHIP': { type: 'free_delivery', message: 'Free Delivery applied!' },
    'FREEDELIVERY': { type: 'free_delivery', message: 'Free Delivery applied!' }
  };

  const upper = code.trim().toUpperCase().replace(/[\s\-_]+/g, '');
  const cfg = COUPONS[upper];

  if (!cfg) {
    req.session.checkoutCoupon = null;
    return res.status(400).json({ success: false, error: 'Invalid coupon code. Please check and try again.' });
  }

  let discount = 0;
  let freeDelivery = false;
  let message = cfg.message || 'Coupon applied successfully!';

  switch (cfg.type) {
    case 'free_delivery':
      freeDelivery = true;
      discount = 0;
      break;
    case 'flat_first_time':
      if (hasOrderedBefore) {
        req.session.checkoutCoupon = null;
        return res.status(400).json({ success: false, error: 'WELCOME coupon is only valid on first-time orders.' });
      }
      discount = Math.min(cfg.value, subtotal);
      break;
    case 'flat':
      discount = Math.min(cfg.value, subtotal);
      break;
    case 'percent':
      discount = Math.round(subtotal * (cfg.percent / 100));
      break;
  }

  req.session.checkoutCoupon = { code: upper, discount, freeDelivery, message };
  res.json({ success: true, code: upper, discount, freeDelivery, message });
});

router.delete('/store/api/store/checkout/coupon', (req, res) => {
  req.session.checkoutCoupon = null;
  res.json({ success: true, message: 'Coupon removed' });
});

router.post('/store/api/store/checkout/clear', (req, res) => {
  req.session.hasOrderedBefore = true;
  req.session.cart = [];
  req.session.checkoutCustomer = null;
  req.session.checkoutCoupon = null;
  res.json({ success: true, message: 'Order session cleared' });
});

// Create Order (Razorpay)
router.post('/store/api/store/create-order', async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(500).json({ error: 'Razorpay is not configured on server.' });
    }

    const cart = req.session.cart || [];
    const coupon = req.session.checkoutCoupon || null;
    const customer = req.session.checkoutCustomer || null;

    if (!cart.length) return res.status(400).json({ error: 'Cart is empty. Cannot create an order.' });
    if (!customer) return res.status(400).json({ error: 'Delivery address is required before payment.' });

    const STORE_PRODUCTS = productStore.getProducts();
    for (const item of cart) {
      const product = STORE_PRODUCTS.find(p => p.id === item.productId);
      if (!product) return res.status(400).json({ error: `Product ${item.productId} not found.` });
      if (product.stock < item.qty) {
        return res.status(400).json({ error: `Insufficient stock for "${product.name}". Only ${product.stock} left.` });
      }
      item.price = product.price;
      item.orig = product.orig;
    }

    const summary = computeCheckoutSummary(cart, coupon);
    const safe = (val, max = 120) => String(val || '').trim().slice(0, max);

    const options = {
      amount: Math.round(summary.finalTotal * 100),
      currency: 'INR',
      receipt: `2am_${uuidv4().slice(0, 8)}`,
      notes: {
        source: 'student_store',
        coupon: safe(coupon?.code || 'none', 40),
        itemCount: String(summary.itemCount),
        customerName: safe(customer.name, 80),
        customerPhone: safe(customer.phone, 20),
        customerEmail: safe(customer.email, 80),
        customerCity: safe(customer.city, 60),
        customerPincode: safe(customer.pincode, 20),
        customerAddress: safe(customer.address, 200),
        products: cart.map(c => `${c.name} x${c.qty}`).slice(0, 10).join(', ').slice(0, 200)
      }
    };

    const order = await razorpay.orders.create(options);
    req.session.pendingOrderSummary = { ...summary, orderId: order.id };
    return res.json({ ...order, serverSummary: summary });
  } catch (error) {
    console.error('Razorpay create order error:', error);
    return res.status(500).json({ error: 'Unable to create payment order.' });
  }
});

// Verify Payment (Razorpay)
router.post('/store/api/store/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ verified: false, error: 'Missing payment verification fields.' });
    }

    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '');
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest('hex');
    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ verified: false, error: 'Payment verification failed.' });
    }

    const cart = req.session.cart || [];
    const storeInvoicesMap = productStore.storeInvoicesMap;
    const STORE_PRODUCTS = productStore.getProducts();

    if (storeInvoicesMap.has(razorpay_order_id)) {
      return res.json({ verified: true, duplicate: true });
    }

    // Deduct inventory
    for (const item of cart) {
      const product = STORE_PRODUCTS.find(p => p.id === item.productId);
      if (product) {
        const qty = item.qty || 1;
        product.stock = Math.max(0, product.stock - qty);
        product.sold = (product.sold || 0) + qty;
      }
    }
    productStore.savePersistedProducts();

    const invoiceNo = `INV-2026${String(productStore.incrementInvoiceCounter()).padStart(5, '0')}`;
    const now = new Date();
    const coupon = req.session.checkoutCoupon || null;
    const summary = req.session.pendingOrderSummary || computeCheckoutSummary(cart, coupon);
    const completedOrder = {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      paymentMethod: 'Razorpay (Card/UPI/NetBanking)',
      invoiceNo,
      customerName: req.session.checkoutCustomer?.name || 'Student Customer',
      customer: req.session.checkoutCustomer,
      items: cart.length ? [...cart] : [],
      // Financial details (fixes ₹0 in admin dashboard and my-orders)
      amount: summary.finalTotal,
      finalTotal: summary.finalTotal,
      subtotal: summary.spSubtotal,
      mrpSubtotal: summary.mrpSubtotal,
      couponDiscount: summary.couponDiscount,
      totalSaved: summary.totalSaved,
      delivery: summary.delivery,
      platformFee: summary.platformFee,
      amountPaid: summary.finalTotal,
      coupon: coupon?.code || 'none',
      createdAt: now.toISOString()
    };

    if (firestoreDb) {
      try {
        await firestoreDb.collection('storeOrders').doc(razorpay_order_id).set(completedOrder);
      } catch (e) {
        console.error('[Firestore] Failed to save order:', e.message);
      }
    }

    const orders = productStore.getOrders();
    orders.unshift(completedOrder);
    productStore.savePersistedStoreOrders();
    storeInvoicesMap.set(razorpay_order_id, completedOrder);
    req.session.lastOrder = completedOrder;

    return res.json({ verified: true });
  } catch (error) {
    console.error('Razorpay verify error:', error);
    return res.status(500).json({ verified: false, error: 'Verification service unavailable.' });
  }
});

// ─── Order APIs ──────────────────────────────────────────────────────────────

// GET /api/store/orders/:orderId — fetch a single order by ID
router.get('/api/store/orders/:orderId', async (req, res) => {
  const { orderId } = req.params;

  // 1. Check storeInvoicesMap (in-memory, populated on verify-payment)
  const mapEntry = productStore.storeInvoicesMap.get(orderId);
  if (mapEntry && typeof mapEntry === 'object' && mapEntry.orderId) {
    return res.json({ success: true, order: mapEntry });
  }

  // 2. Check persisted in-memory orders array
  const memOrder = productStore.getOrders().find(o => o.orderId === orderId);
  if (memOrder) return res.json({ success: true, order: memOrder });

  // 3. Check session last order
  if (req.session?.lastOrder?.orderId === orderId) {
    return res.json({ success: true, order: req.session.lastOrder });
  }

  // 4. Try Firestore
  if (firestoreDb) {
    try {
      const doc = await firestoreDb.collection('storeOrders').doc(orderId).get();
      if (doc.exists) return res.json({ success: true, order: doc.data() });
    } catch (e) {
      console.error('[Firestore] order lookup error:', e.message);
    }
  }

  return res.status(404).json({ success: false, error: 'Order not found' });
});

// GET /api/store/my-orders — fetch all orders for current user by email/uid
router.get('/api/store/my-orders', async (req, res) => {
  const email = (req.session?.user?.email || req.session?.checkoutCustomer?.email || '').toLowerCase();
  const uid = req.session?.user?.uid || null;

  let ordersList = [];

  // Collect from persisted in-memory orders
  const allOrders = productStore.getOrders();
  for (const o of allOrders) {
    const oEmail = (o?.customer?.email || o?.customerEmail || '').toLowerCase();
    if ((email && oEmail === email) || (uid && o.uid === uid)) {
      ordersList.push(o);
    }
  }

  // Also check Firestore for any orders not yet in memory
  if (firestoreDb && email) {
    try {
      const snapshot = await firestoreDb.collection('storeOrders')
        .where('customer.email', '==', email)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      const fsOrderIds = new Set(ordersList.map(o => o.orderId));
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!fsOrderIds.has(data.orderId)) ordersList.push(data);
      });
    } catch (e) {
      console.error('[Firestore] my-orders lookup error:', e.message);
    }
  }

  // Include session last order if it belongs to this user and is not already listed
  const lastOrder = req.session?.lastOrder;
  if (lastOrder) {
    const loEmail = (lastOrder?.customer?.email || '').toLowerCase();
    const alreadyIn = ordersList.some(o => o.orderId === lastOrder.orderId);
    if (!alreadyIn && (!email || loEmail === email)) {
      ordersList.unshift(lastOrder);
    }
  }

  // Sort newest first
  ordersList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return res.json({ success: true, orders: ordersList });
});

// ─── Product Reviews ──────────────────────────────────────────────────────────

// GET /store/api/store/products/:id/reviews
router.get('/store/api/store/products/:id/reviews', (req, res) => {
  const product = productStore.getProducts().find(p => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

  const reviews = product.reviews || [];
  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length)
    : (product.rating || 0);

  // Build breakdown counts 1-5
  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach(r => { const s = Math.round(r.rating); if (s >= 1 && s <= 5) breakdown[s]++; });

  res.json({
    success: true,
    productId: product.id,
    averageRating: Math.round(avgRating * 10) / 10,
    totalReviews: reviews.length,
    ratingCount: product.ratingCount || reviews.length,
    breakdown,
    reviews
  });
});

// POST /store/api/store/products/:id/reviews
router.post('/store/api/store/products/:id/reviews', (req, res) => {
  const products = productStore.getProducts();
  const product = products.find(p => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

  const { user, rating, comment } = req.body;
  if (!user || !rating || !comment) {
    return res.status(400).json({ success: false, error: 'user, rating, and comment are required.' });
  }
  const ratingNum = Math.min(5, Math.max(1, Number(rating)));
  if (isNaN(ratingNum)) return res.status(400).json({ success: false, error: 'rating must be a number between 1 and 5.' });

  const sanitize = str => String(str).trim().replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 500);

  if (!product.reviews) product.reviews = [];

  // Upsert: one review per user
  const existingIdx = product.reviews.findIndex(r => r.user && r.user.toLowerCase() === String(user).trim().toLowerCase());
  const newReview = {
    user: sanitize(user),
    rating: ratingNum,
    comment: sanitize(comment),
    date: new Date().toISOString().split('T')[0]
  };

  if (existingIdx >= 0) {
    product.reviews[existingIdx] = newReview;
  } else {
    product.reviews.unshift(newReview);
  }

  // Recalculate average rating
  const allRatings = product.reviews.map(r => r.rating);
  product.rating = Math.round((allRatings.reduce((s, r) => s + r, 0) / allRatings.length) * 10) / 10;
  product.ratingCount = (product.ratingCount || 0) + (existingIdx >= 0 ? 0 : 1);

  // Sync to global shopperFeedbacks
  try {
    const feedbacks = feedbackStore.getFeedbacks();
    feedbacks.unshift({
      id: 'fb-' + Date.now(),
      name: newReview.user,
      avatar: '',
      rating: ratingNum,
      comment: newReview.comment,
      product: product.name,
      verified: true,
      date: newReview.date
    });
    feedbackStore.saveShopperFeedbacks();
  } catch (e) {
    console.warn('[Store] Could not sync review to feedbackStore:', e.message);
  }

  productStore.savePersistedProducts();

  res.json({ success: true, message: 'Review submitted successfully!', review: newReview, product });
});

// Reviews and feedback
router.get('/store/api/store/feedbacks', (req, res) => {
  res.json({ success: true, feedbacks: feedbackStore.getFeedbacks() });
});

router.post('/store/api/store/feedback', (req, res) => {
  const { name, comment, rating, product } = req.body;
  if (!name || !comment) return res.status(400).json({ success: false, error: 'Name and feedback comment are required.' });

  const feedbacks = feedbackStore.getFeedbacks();
  const avatarList = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&q=80&fm=webp',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&q=80&fm=webp',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&q=80&fm=webp',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=100&h=100&q=80&fm=webp'
  ];
  const newFb = {
    id: 'fb-' + Date.now(),
    name: name.trim(),
    avatar: avatarList[Math.floor(Math.random() * avatarList.length)],
    rating: Number(rating) || 5,
    comment: comment.trim(),
    product: (product && product.trim()) ? product.trim() : '2 AM Study Essentials',
    verified: true,
    date: new Date().toISOString().split('T')[0]
  };

  feedbacks.unshift(newFb);
  feedbackStore.saveShopperFeedbacks();
  res.json({ success: true, message: 'Feedback added successfully!', feedback: newFb, feedbacks });
});

module.exports = router;
