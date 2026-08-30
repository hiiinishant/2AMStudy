const express = require('express');
const router = express.Router();

const productStore = require('../models/productStore');
const sessionStore = require('../models/sessionStore');
const blogStore = require('../models/blogStore');
const safetyStore = require('../models/safetyStore');
const feedbackStore = require('../models/feedbackStore');
const collegeLifeStore = require('../models/collegeLifeStore');
const resourceStore = require('../models/resourceStore');
const { firestoreDb } = require('../config/firebase');
const { isMasterAdminAuthenticated, requireStoreAdmin } = require('../middleware/adminAuth');

// 1. Single Master Admin Dashboard Route View
router.get('/admin', async (req, res) => {
  const isAuthed = isMasterAdminAuthenticated(req);
  if (!isAuthed) {
    return res.render('admin', {
      pageTitle: 'Master Admin Dashboard | 2AM Study',
      metaDescription: 'Single master admin dashboard for managing Live Streams, Products, Orders, Blog, and Student Safety.',
      isAuthed: false,
      liveSession: null,
      allStudySessions: [],
      products: [],
      orders: [],
      blogs: [],
      safetyCases: [],
      feedbacks: [],
      collegeVideos: [],
      resources: []
    });
  }

  const studySessions = sessionStore.getSessions();
  const liveSession = studySessions.find(s => s.status === 'LIVE') || null;
  const allStudySessions = [...studySessions].sort((a, b) => new Date(b.createdAt || b.startedAt) - new Date(a.createdAt || a.startedAt));

  let ordersList = [];
  try {
    if (firestoreDb) {
      const snap = await firestoreDb.collection('storeOrders').orderBy('createdAt', 'desc').limit(50).get();
      if (!snap.empty) {
        ordersList = snap.docs.map(doc => doc.data());
      }
    }
  } catch (e) {}

  const storeInvoicesMap = productStore.storeInvoicesMap;
  if (ordersList.length === 0 && storeInvoicesMap.size > 0) {
    for (const [orderId, data] of storeInvoicesMap.entries()) {
      if (typeof data === 'object' && data !== null) {
        ordersList.push({ orderId, ...data });
      } else {
        ordersList.push({ orderId, invoiceNo: data });
      }
    }
  }

  res.render('admin', {
    pageTitle: 'Master Admin Dashboard | 2AM Study',
    metaDescription: 'Single master admin dashboard for managing Live Streams, Products, Orders, Blog, and Student Safety.',
    isAuthed: true,
    liveSession,
    allStudySessions,
    products: productStore.getProducts(),
    orders: ordersList,
    blogs: blogStore.getBlogs(),
    safetyCases: safetyStore.getCases(),
    feedbacks: feedbackStore.getFeedbacks(),
    collegeVideos: collegeLifeStore.getVideos(),
    resources: resourceStore.getResources()
  });
});

// Legacy Admin URL Redirects to Unified Dashboard
router.get('/store/admin', (req, res) => res.redirect('/admin#tab-products'));
router.get('/store/admin/login', (req, res) => res.redirect('/admin'));

// Check Current Admin Session Status
router.get('/api/store/admin/me', (req, res) => {
  res.json({
    success: true,
    authenticated: isMasterAdminAuthenticated(req),
    loggedInAt: req.session?.adminLoggedInAt || null
  });
});

// Delete Shopper Feedback Action
router.delete('/api/admin/feedbacks/:id', requireStoreAdmin, (req, res) => {
  const { id } = req.params;
  const feedbacks = feedbackStore.getFeedbacks().filter(f => f.id !== id);
  feedbackStore.setFeedbacks(feedbacks);
  feedbackStore.saveShopperFeedbacks();
  res.json({ success: true });
});

// Admin Analytics Stats API
router.get('/api/store/admin/stats', requireStoreAdmin, (req, res) => {
  const STORE_PRODUCTS = productStore.getProducts();
  const totalProducts = STORE_PRODUCTS.length;
  const inStockProducts = STORE_PRODUCTS.filter(p => p.stock > 5).length;
  const lowStockProducts = STORE_PRODUCTS.filter(p => p.stock > 0 && p.stock <= 5).length;
  const outOfStockProducts = STORE_PRODUCTS.filter(p => p.stock === 0).length;
  const totalStockUnits = STORE_PRODUCTS.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
  const totalValuation = STORE_PRODUCTS.reduce((sum, p) => sum + ((Number(p.price) || 0) * (Number(p.stock) || 0)), 0);

  res.json({
    success: true,
    stats: {
      totalProducts,
      inStockProducts,
      lowStockProducts,
      outOfStockProducts,
      totalStockUnits,
      totalValuation
    }
  });
});

// Get All Products (Admin)
router.get('/api/store/admin/products', requireStoreAdmin, (req, res) => {
  const STORE_PRODUCTS = productStore.getProducts();
  res.json({
    success: true,
    count: STORE_PRODUCTS.length,
    products: STORE_PRODUCTS
  });
});

// Create New Product (Admin)
router.post('/api/store/admin/products', requireStoreAdmin, (req, res) => {
  const STORE_PRODUCTS = productStore.getProducts();
  const { id, name, cat, desc, price, orig, stock, badge, badgeLabel, images, features, specs } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ success: false, error: 'Product name and price are required.' });
  }

  let newId = Number(id);
  if (!newId || isNaN(newId)) {
    newId = STORE_PRODUCTS.reduce((max, p) => Math.max(max, p.id || 0), 100) + 1;
  }

  if (STORE_PRODUCTS.some(p => p.id === newId)) {
    return res.status(400).json({ success: false, error: `Product ID ${newId} already exists.` });
  }

  const newProduct = {
    id: newId,
    cat: (cat || 'notebooks').toLowerCase(),
    emoji: req.body.emoji || '✨',
    badge: badge || 'top',
    badgeLabel: badgeLabel || '',
    name: String(name).trim(),
    desc: String(desc || '').trim(),
    price: Number(price),
    orig: Number(orig) || Number(price),
    images: Array.isArray(images) && images.length > 0 ? images : ['/assets/images/store/placeholder.jpg'],
    stock: Number(stock) >= 0 ? Number(stock) : 10,
    rating: 4.5,
    ratingCount: 0,
    features: Array.isArray(features) ? features : [],
    specs: typeof specs === 'object' && specs !== null ? specs : { brand: '2 AM Study' },
    reviews: []
  };

  STORE_PRODUCTS.push(newProduct);
  productStore.savePersistedProducts();

  res.json({
    success: true,
    message: 'Product created successfully',
    product: newProduct
  });
});

// Update Existing Product (Admin)
router.put('/api/store/admin/products/:id', requireStoreAdmin, (req, res) => {
  const STORE_PRODUCTS = productStore.getProducts();
  const productId = Number(req.params.id);
  const index = STORE_PRODUCTS.findIndex(p => p.id === productId);
  if (index === -1) {
    return res.status(404).json({ success: false, error: `Product #${productId} not found.` });
  }

  const existing = STORE_PRODUCTS[index];
  const { name, cat, desc, price, orig, stock, badge, badgeLabel, images, features, specs, rating, ratingCount } = req.body;

  STORE_PRODUCTS[index] = {
    ...existing,
    name: name !== undefined ? String(name).trim() : existing.name,
    cat: cat !== undefined ? String(cat).toLowerCase() : existing.cat,
    desc: desc !== undefined ? String(desc).trim() : existing.desc,
    price: price !== undefined ? Number(price) : existing.price,
    orig: orig !== undefined ? Number(orig) : existing.orig,
    stock: stock !== undefined ? Number(stock) : existing.stock,
    badge: badge !== undefined ? badge : existing.badge,
    badgeLabel: badgeLabel !== undefined ? badgeLabel : existing.badgeLabel,
    images: Array.isArray(images) && images.length > 0 ? images : existing.images,
    features: Array.isArray(features) ? features : existing.features,
    specs: typeof specs === 'object' && specs !== null ? specs : existing.specs,
    rating: rating !== undefined ? Number(rating) : existing.rating,
    ratingCount: ratingCount !== undefined ? Number(ratingCount) : existing.ratingCount
  };

  productStore.savePersistedProducts();

  res.json({
    success: true,
    message: 'Product updated successfully',
    product: STORE_PRODUCTS[index]
  });
});

// Quick Stock Adjustment (Admin)
router.patch('/api/store/admin/products/:id/stock', requireStoreAdmin, (req, res) => {
  const STORE_PRODUCTS = productStore.getProducts();
  const productId = Number(req.params.id);
  const { stock, delta } = req.body;
  const product = STORE_PRODUCTS.find(p => p.id === productId);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found.' });
  }

  if (stock !== undefined) {
    product.stock = Math.max(0, Number(stock) || 0);
  } else if (delta !== undefined) {
    product.stock = Math.max(0, (product.stock || 0) + Number(delta));
  }

  productStore.savePersistedProducts();

  res.json({
    success: true,
    id: product.id,
    stock: product.stock
  });
});

// Delete Product (Admin)
router.delete('/api/store/admin/products/:id', requireStoreAdmin, (req, res) => {
  const STORE_PRODUCTS = productStore.getProducts();
  const productId = Number(req.params.id);
  const index = STORE_PRODUCTS.findIndex(p => p.id === productId);
  if (index === -1) {
    return res.status(404).json({ success: false, error: `Product #${productId} not found.` });
  }

  const deleted = STORE_PRODUCTS.splice(index, 1)[0];
  productStore.savePersistedProducts();

  res.json({
    success: true,
    message: `Product #${productId} (${deleted.name}) deleted successfully.`
  });
});

// View Store Orders (Admin)
router.get('/api/store/admin/orders', requireStoreAdmin, async (req, res) => {
  try {
    let ordersList = [];
    if (firestoreDb) {
      const snap = await firestoreDb.collection('storeOrders').orderBy('createdAt', 'desc').limit(50).get();
      if (!snap.empty) {
        ordersList = snap.docs.map(doc => doc.data());
      }
    }

    const storeInvoicesMap = productStore.storeInvoicesMap;
    if (ordersList.length === 0 && storeInvoicesMap.size > 0) {
      for (const [orderId, data] of storeInvoicesMap.entries()) {
        if (typeof data === 'object' && data !== null) {
          ordersList.push({ orderId, ...data });
        } else {
          ordersList.push({ orderId, invoiceNo: data });
        }
      }
    }

    res.json({
      success: true,
      count: ordersList.length,
      orders: ordersList
    });
  } catch (err) {
    console.error('[Admin Orders Error]:', err.message);
    res.status(500).json({ success: false, error: 'Could not load orders.' });
  }
});

module.exports = router;
