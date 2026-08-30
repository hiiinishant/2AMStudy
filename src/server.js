const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const compression = require('compression');
const path = require('path');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

// ─── Firebase Admin (Firestore for inventory + orders) ───────────────────────
// Initialises only if FIREBASE_SERVICE_ACCOUNT env var is set (JSON string) or
// GOOGLE_APPLICATION_CREDENTIALS points to a service account file.
// The app runs fine without it — inventory falls back to in-memory + storeInvoicesMap.
let firebaseAdmin = null;
let firestoreDb = null;
try {
  firebaseAdmin = require('firebase-admin');
  const getApps = () => (Array.isArray(firebaseAdmin.apps) ? firebaseAdmin.apps : (typeof firebaseAdmin.getApps === 'function' ? firebaseAdmin.getApps() : []));
  let existingApps = getApps();
  if (existingApps.length === 0) {
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountEnv) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(JSON.parse(serviceAccountEnv))
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.applicationDefault()
      });
    } else {
      console.warn('[Firebase Admin] No credentials found — Firestore inventory disabled. Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS to enable.');
    }
    existingApps = getApps();
    if (existingApps.length > 0) {
      firestoreDb = firebaseAdmin.firestore();
      console.log('[Firebase Admin] Firestore connected — atomic inventory enabled.');
    }
  } else {
    firestoreDb = firebaseAdmin.firestore();
  }
} catch (e) {
  console.warn('[Firebase Admin] Initialization warning:', e.message);
}

const { createFirebaseAuthMiddleware } = require('./middleware/firebaseAuth');
const { verifyFirebaseToken, requireAdmin, requireSelfOrAdmin } = createFirebaseAuthMiddleware(firebaseAdmin, firestoreDb);
// ─────────────────────────────────────────────────────────────────────────────

// Student Safety cases JSON persistence
const casesDataFilePath = path.join(__dirname, 'data', 'studentSafetyCases.json');
let studentSafetyCases = [];
try {
  if (fs.existsSync(casesDataFilePath)) {
    const rawData = fs.readFileSync(casesDataFilePath, 'utf8');
    studentSafetyCases = JSON.parse(rawData);
  }
} catch (e) {
  console.error("Could not load studentSafetyCases.json:", e);
}

// Exam Resource Center — static data
const resourcesDataFilePath = path.join(__dirname, 'data', 'resources.json');
let examResources = [];
try {
  if (fs.existsSync(resourcesDataFilePath)) {
    examResources = JSON.parse(fs.readFileSync(resourcesDataFilePath, 'utf8'));
  }
} catch (e) {
  console.error("Could not load resources.json:", e);
}

function saveExamResources() {
  try {
    fs.writeFileSync(resourcesDataFilePath, JSON.stringify(examResources, null, 2), 'utf8');
  } catch (e) {
    console.error("Could not save resources.json:", e);
  }
}

function saveStudentSafetyCases() {
  try {
    fs.writeFileSync(casesDataFilePath, JSON.stringify(studentSafetyCases, null, 2), 'utf8');
  } catch (e) {
    console.error("Could not save studentSafetyCases.json:", e);
  }
}

// Shopper Feedbacks JSON persistence
const shopperFeedbacksFilePath = path.join(__dirname, 'data', 'shopperFeedbacks.json');
let shopperFeedbacks = [];
try {
  if (fs.existsSync(shopperFeedbacksFilePath)) {
    shopperFeedbacks = JSON.parse(fs.readFileSync(shopperFeedbacksFilePath, 'utf8'));
  }
} catch (e) {
  console.error("Could not load shopperFeedbacks.json:", e);
}

function saveShopperFeedbacks() {
  try {
    fs.writeFileSync(shopperFeedbacksFilePath, JSON.stringify(shopperFeedbacks, null, 2), 'utf8');
  } catch (e) {
    console.error("Could not save shopperFeedbacks.json:", e);
  }
}

// Study Sessions JSON persistence
const studySessionsFilePath = path.join(__dirname, 'data', 'studySessions.json');
let studySessions = [];
try {
  if (fs.existsSync(studySessionsFilePath)) {
    studySessions = JSON.parse(fs.readFileSync(studySessionsFilePath, 'utf8'));
  }
} catch (e) {
  console.error('Could not load studySessions.json:', e);
}

function saveStudySessions() {
  try {
    fs.writeFileSync(studySessionsFilePath, JSON.stringify(studySessions, null, 2), 'utf8');
  } catch (e) {
    console.error('Could not save studySessions.json:', e);
  }
}

// College Life Videos JSON persistence
const collegeLifeVideosFilePath = path.join(__dirname, 'data', 'collegeLifeVideos.json');
let collegeLifeVideos = [];
try {
  if (fs.existsSync(collegeLifeVideosFilePath)) {
    collegeLifeVideos = JSON.parse(fs.readFileSync(collegeLifeVideosFilePath, 'utf8'));
  }
} catch (e) {
  console.error('Could not load collegeLifeVideos.json:', e);
}

function saveCollegeLifeVideos() {
  try {
    fs.writeFileSync(collegeLifeVideosFilePath, JSON.stringify(collegeLifeVideos, null, 2), 'utf8');
  } catch (e) {
    console.error('Could not save collegeLifeVideos.json:', e);
  }
}

function extractYoutubeVideoId(url) {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const validUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
    const u = new URL(validUrl);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0].split('?')[0];
    if (u.pathname.startsWith('/live/')) return u.pathname.split('/live/')[1].split('/')[0].split('?')[0];
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/shorts/')[1].split('/')[0].split('?')[0];
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/embed/')[1].split('/')[0].split('?')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
  } catch (_) {}
  return null;
}

// Multer memory storage for secure evidence uploads
const evidenceStorage = multer.memoryStorage();

const evidenceFileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

  if (allowedMimeTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file format. Only JPG, PNG, and PDF files are allowed.'), false);
  }
};

const uploadEvidence = multer({
  storage: evidenceStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit per file
  fileFilter: evidenceFileFilter
}).array('evidence', 5);

const app = express();
app.set('trust proxy', 1);

// Enable CORS for cross-origin requests (strict validation + Hiii Nishant integration + localhost for dev)
const ALLOWED_ORIGINS = [
  "https://2amstudy.com",
  "https://www.2amstudy.com",
  "https://2amstudy.online",
  "https://2amstudy.online",
  "https://2amstudy.vercel.app",
  "https://2amstudy-rokrnkxpj-nishant-4us-projects.vercel.app",
  "https://hiiinishant.com",
  "https://www.hiiinishant.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      ALLOWED_ORIGINS.includes(origin) ||
      origin.endsWith('.hiiinishant.com') ||
      origin.endsWith('.2amstudy.com') ||
      origin.endsWith('.2amstudy.online')
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true
}));

// Trust proxy for secure cookies on Render
app.set('trust proxy', 1);

const port = process.env.PORT || 3000;
let STORE_PRODUCTS = [
  {
    id: 101, cat: 'notebooks', emoji: '📓', badge: 'top', badgeLabel: '2 AM Edition', name: 'Notebook', desc: 'Signature everyday notebook from 2 AM Study with smooth ruled pages for focused class notes.', price: 199, orig: 299,
    images: ['/assets/images/products/notebook-1.jpg', '/assets/images/products/notebook-2.jpg', '/assets/images/products/notebook-3.jpg', '/assets/images/products/notebook-4.jpg'],
    stock: 18, rating: 4.3, ratingCount: 1247,
    features: ['Premium 80 GSM smooth ruled pages', '2 AM Study branded cover design', 'Lay-flat binding for comfortable writing', '200 pages — lasts full semester', 'Acid-free paper for long-lasting notes'],
    specs: { brand: '2 AM Study', type: 'Ruled Notebook', pages: '200', size: 'A5', cover: 'Soft Cover', paper: '80 GSM Acid-Free', binding: 'Perfect Binding' },
    reviews: [{ user: 'Priya M.', rating: 5, comment: 'Best notebook! Paper quality is amazing and ink doesn\'t bleed.', date: '2026-03-15' }, { user: 'Rahul K.', rating: 4, comment: 'Good quality pages. Wish it came in more colors.', date: '2026-03-10' }, { user: 'Ananya S.', rating: 5, comment: 'Perfect for class notes. Lay-flat binding is a game changer.', date: '2026-02-28' }]
  },
  {
    id: 102, cat: 'notebooks', emoji: '📔', badge: 'hot', badgeLabel: 'Hot', name: 'Diary', desc: 'Premium diary by 2 AM Study for journaling goals, daily reflection, and planning your productivity streak.', price: 249, orig: 399,
    images: ['/assets/images/products/diary-1.webp', '/assets/images/products/diary-1.webp', '/assets/images/products/diary-3.webp', '/assets/images/products/diary-1.webp'],
    stock: 12, rating: 4.5, ratingCount: 892,
    features: ['Hardbound premium diary', 'Daily reflection prompts included', 'Goal-setting templates', 'Bookmark ribbon included', 'Elastic band closure'],
    specs: { brand: '2 AM Study', type: 'Diary', pages: '180', size: 'A5', cover: 'Hardbound', paper: '90 GSM', closure: 'Elastic Band' },
    reviews: [{ user: 'Meera J.', rating: 5, comment: 'The reflection prompts are so helpful. I use it every night.', date: '2026-03-12' }, { user: 'Vikram T.', rating: 4, comment: 'Great quality diary. Prompts help me stay consistent.', date: '2026-03-05' }]
  },
  {
    id: 103, cat: 'notebooks', emoji: '🗒️', badge: 'new', badgeLabel: 'New', name: 'Spiral Notebook Set', desc: 'Spiral notebook combo pack for multiple subjects and long study sessions.', price: 399, orig: 599,
    images: ['/assets/images/products/spiral-book-1.webp', '/assets/images/products/spiral-book-2.webp', '/assets/images/products/spiral-book-3.webp'],
    stock: 8, rating: 4.2, ratingCount: 534,
    features: ['Pack of 3 subject notebooks', 'Spiral binding for easy page turning', 'Different color covers per subject', 'Perforated pages for clean tear-out', 'Micro-perforated sheets'],
    specs: { brand: '2 AM Study', type: 'Spiral Notebook Set', pages: '160 each', size: 'B5', cover: 'Spiral Bound', paper: '70 GSM', quantity: '3 Pack' },
    reviews: [{ user: 'Sneha R.', rating: 4, comment: 'Perfect for organizing different subjects. Good value.', date: '2026-03-08' }, { user: 'Arjun P.', rating: 5, comment: 'Perforated pages are so convenient. Love the color coding!', date: '2026-02-25' }]
  },
  {
    id: 201, cat: 'bottles', emoji: '💧', badge: 'top', badgeLabel: 'Best Seller', name: 'Insulated Water Bottle', desc: 'Double-wall insulated bottle to keep water cool and support all-day hydration.', price: 449, orig: 699,
    images: ['/assets/images/products/bottle-1.jpg', '/assets/images/products/bottle-2.jpg', '/assets/images/products/bottle-3.jpg', '/assets/images/products/bottle-4.jpg'],
    stock: 22, rating: 4.6, ratingCount: 2103,
    features: ['Double-wall vacuum insulation', 'Keeps water cool for 24 hours', 'BPA-free food-grade stainless steel', 'Leak-proof flip lid', '750ml capacity — perfect for campus'],
    specs: { brand: '2 AM Study', type: 'Insulated Bottle', capacity: '750ml', material: 'Stainless Steel 304', insulation: 'Double-wall Vacuum', lid: 'Flip Lid', weight: '350g' },
    reviews: [{ user: 'Kavitha N.', rating: 5, comment: 'Water stays cold all day even in summer. Best bottle I have owned!', date: '2026-03-14' }, { user: 'Deepak S.', rating: 5, comment: 'No leaks at all. I carry it everywhere.', date: '2026-03-02' }, { user: 'Ishita G.', rating: 4, comment: 'Great insulation. Slightly heavy but worth it.', date: '2026-02-20' }]
  },
  {
    id: 202, cat: 'bottles', emoji: '🍱', badge: 'new', badgeLabel: 'New', name: 'Insulated Lunch Box', desc: 'Compact insulated lunch box for students on campus and coaching days.', price: 549, orig: 799,
    images: ['/assets/images/products/lunch-1.webp', '/assets/images/products/lunch-2.webp', '/assets/images/products/lunch-3.webp'],
    stock: 15, rating: 4.4, ratingCount: 678,
    features: ['Double-wall insulation keeps food warm', '2-compartment design for meal separation', 'Leak-proof silicone seal', 'Compact size fits in backpack', 'Microwave-safe inner container'],
    specs: { brand: '2 AM Study', type: 'Insulated Lunch Box', capacity: '600ml', material: 'Stainless Steel Inner / BPA-Free Outer', compartments: '2', dimensions: '15x10x8 cm', weight: '400g' },
    reviews: [{ user: 'Nisha A.', rating: 5, comment: 'Food stays warm for 4-5 hours. Perfect for long college days.', date: '2026-03-11' }, { user: 'Rohan M.', rating: 4, comment: 'Good size for one person. The compartments are really useful.', date: '2026-02-28' }]
  },
  {
    id: 203, cat: 'bottles', emoji: '☕', badge: 'hot', badgeLabel: '2 AM Study', name: 'Coffee Mug', desc: 'Aesthetic mug for chai or coffee during late-night focus hours.', price: 299, orig: 449,
    images: ['https://images.unsplash.com/photo-1517142089942-ba376ce32a2e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 30, rating: 4.7, ratingCount: 1856,
    features: ['Ceramic construction retains heat', '2 AM Study motivational print', 'Comfortable grip handle', 'Microwave and dishwasher safe', '300ml capacity — ideal for chai/coffee'],
    specs: { brand: '2 AM Study', type: 'Coffee Mug', capacity: '300ml', material: 'Ceramic', print: 'Sublimation Print', microwaveSafe: 'Yes', dishwasherSafe: 'Yes' },
    reviews: [{ user: 'Aditya K.', rating: 5, comment: 'The motivational print gets me through late-night study sessions. Love it!', date: '2026-03-13' }, { user: 'Simran B.', rating: 5, comment: 'Perfect size for my morning chai. Print quality is excellent.', date: '2026-03-01' }, { user: 'Karan V.', rating: 4, comment: 'Great mug. Wish it was slightly bigger.', date: '2026-02-18' }]
  },
  {
    id: 301, cat: 'bags', emoji: '🎒', badge: 'top', badgeLabel: 'Top Pick', name: 'College Backpack', desc: 'Spacious and durable backpack for books, laptop, and daily student essentials.', price: 1299, orig: 1899,
    images: ['https://images.unsplash.com/photo-1553062407-98eeb64c6a62?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1575844444493-f1dcba61a33b?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 6, rating: 4.4, ratingCount: 967,
    features: ['Padded 15.6" laptop compartment', 'Water-resistant 900D polyester', 'Ergonomic padded shoulder straps', 'Multiple organizer pockets', 'USB charging port built-in'],
    specs: { brand: '2 AM Study', type: 'College Backpack', material: '900D Polyester', laptopFit: 'Up to 15.6 inches', capacity: '30L', waterResistant: 'Yes', dimensions: '45x30x15 cm', weight: '650g' },
    reviews: [{ user: 'Tanvi S.', rating: 5, comment: 'Fits my laptop, books, and lunch perfectly. The USB port is a lifesaver!', date: '2026-03-09' }, { user: 'Amit R.', rating: 4, comment: 'Very comfortable straps. Good quality material.', date: '2026-02-27' }]
  },
  {
    id: 302, cat: 'bags', emoji: '🧳', badge: 'sale', badgeLabel: 'Sale', name: 'Travel Backpack', desc: 'Multi-purpose travel backpack designed for short trips, classes, and weekend plans. Co-branded by 2 AM Study.', price: 1499, orig: 2299,
    images: ['https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1581605405669-fcdf81165afa?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 4, rating: 4.5, ratingCount: 412,
    features: ['Expandable 35L to 45L capacity', 'TSA-friendly laptop compartment', 'Hidden anti-theft pocket', 'Rain cover included', 'Shoe compartment at bottom'],
    specs: { brand: '2 AM Study', type: 'Travel Backpack', material: 'Ripstop Nylon', laptopFit: 'Up to 17 inches', capacity: '35-45L Expandable', waterResistant: 'Yes (Rain Cover)', dimensions: '50x32x20 cm', weight: '800g' },
    reviews: [{ user: 'Divya L.', rating: 5, comment: 'Used it for a 3-day trip. The shoe compartment is genius!', date: '2026-03-07' }, { user: 'Nikhil J.', rating: 4, comment: 'Great for weekend trips. The expandable feature is really useful.', date: '2026-02-22' }]
  },
  {
    id: 401, cat: 'essentials', emoji: '🖊️', badge: 'top', badgeLabel: 'Best Seller', name: 'Premium Pen Set', desc: 'Smooth-flow premium pens for clean handwriting and exam-ready notes.', price: 199, orig: 299,
    images: ['/assets/images/products/pen-1.webp', '/assets/images/products/pen-2.webp', '/assets/images/products/pen-3.webp', '/assets/images/products/pen-4.webp'],
    stock: 45, rating: 4.3, ratingCount: 1567,
    features: ['Set of 5 premium ball pens', '0.5mm fine tip for precise writing', 'Smooth ink flow — no skipping', 'Comfortable rubber grip', 'Quick-dry smudge-free ink'],
    specs: { brand: '2 AM Study', type: 'Ball Pen Set', tipSize: '0.5mm', inkColor: 'Blue', quantity: '5 Pens', grip: 'Rubber Grip', refillable: 'Yes' },
    reviews: [{ user: 'Pooja D.', rating: 5, comment: 'Smoothest pens I have used. No smudging at all during exams!', date: '2026-03-10' }, { user: 'Siddharth G.', rating: 4, comment: 'Great grip and ink flow. Good value for 5 pens.', date: '2026-02-26' }]
  },
  {
    id: 402, cat: 'essentials', emoji: '🖍️', badge: 'hot', badgeLabel: 'Hot', name: 'Highlighter Set', desc: 'Bright and pastel highlighters to mark key concepts quickly.', price: 179, orig: 279,
    images: ['https://images.unsplash.com/photo-1596401057633-5310da1d9ead?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1511116460269-ec582410a544?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 35, rating: 4.1, ratingCount: 923,
    features: ['Set of 6 vibrant highlighters', 'Chisel tip for broad and find lines', 'Quick-drying fluorescent ink', 'Comfortable barrel grip', 'Ideal for textbooks and notes'],
    specs: { brand: '2 AM Study', type: 'Highlighter Set', tipType: 'Chisel Tip', colors: '6 (Yellow, Green, Pink, Orange, Blue, Purple)', inkType: 'Fluorescent', quantity: '6 Pack', barrel: 'Comfort Grip' },
    reviews: [{ user: 'Ritu A.', rating: 4, comment: 'Nice colors and they don\'t bleed through thin pages.', date: '2026-03-06' }, { user: 'Manish K.', rating: 5, comment: 'Perfect for marking key points in my textbooks!', date: '2026-02-20' }]
  },
  {
    id: 403, cat: 'essentials', emoji: '📌', badge: null, badgeLabel: '', name: 'Sticky Notes Pack', desc: 'Sticky notes pack for reminders, formulas, and revision tags.', price: 149, orig: 229,
    images: ['/assets/images/products/Sticky-1.webp', '/assets/images/products/Sticky-2.webp', '/assets/images/products/Sticky-3.webp', '/assets/images/products/Sticky-4.webp'],
    stock: 50, rating: 4.0, ratingCount: 445,
    features: ['Pack of 8 pads (6 colors)', 'Strong adhesive that removes cleanly', 'Perfect for formulas and reminders', 'Compact size fits in pencil box', 'Recyclable paper material'],
    specs: { brand: '2 AM Study', type: 'Sticky Notes', sheetsPerPad: '100', totalSheets: '800', colors: '6 Assorted', size: '3x3 inches', adhesive: 'Repositionable' },
    reviews: [{ user: 'Neha V.', rating: 4, comment: 'Good adhesive quality. Stays put but removes cleanly.', date: '2026-03-04' }, { user: 'Saurabh T.', rating: 4, comment: 'Perfect for sticking formulas on my study wall.', date: '2026-02-15' }]
  },
  {
    id: 404, cat: 'essentials', emoji: '🗂️', badge: 'new', badgeLabel: 'New', name: 'Desk Organizer Kit', desc: 'Desk organizer kit to keep pens, notes, and supplies neatly arranged.', price: 499, orig: 749,
    images: ['https://images.unsplash.com/photo-1519337265831-281ec6cc8514?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1497032628192-86f99bcd76bc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 10, rating: 4.2, ratingCount: 312,
    features: ['5-compartment desktop organizer', 'Pen holder, phone stand, card slot', 'Non-slip rubber base', 'Durable ABS plastic build', 'Compact footprint for small desks'],
    specs: { brand: '2 AM Study', type: 'Desk Organizer', material: 'ABS Plastic', compartments: '5', dimensions: '22x12x10 cm', base: 'Non-slip Rubber', color: 'Matte Black' },
    reviews: [{ user: 'Aisha W.', rating: 5, comment: 'My desk looks so organized now. The phone stand is super handy!', date: '2026-03-02' }, { user: 'Varun P.', rating: 4, comment: 'Good quality. Fits perfectly on my hostel desk.', date: '2026-02-18' }]
  },
  {
    id: 405, cat: 'essentials', emoji: '💡', badge: 'top', badgeLabel: 'Top Pick', name: 'LED Study Lamp', desc: 'Adjustable LED lamp with eye-comfort lighting for long study routines.', price: 699, orig: 999,
    images: ['/assets/images/products/led-1.webp', '/assets/images/products/led-2.webp', '/assets/images/products/led-3.webp'],
    stock: 9, rating: 4.5, ratingCount: 1345,
    features: ['3 color temperatures (warm/cool/white)', '5 brightness levels', 'Flexible gooseneck arm', 'USB charging port on base', 'Eye-care flicker-free LED technology'],
    specs: { brand: '2 AM Study', type: 'LED Study Lamp', wattage: '10W', colorTemps: '3 (3000K/4500K/6000K)', brightnessLevels: '5', powerSource: 'USB-C', armType: 'Flexible Gooseneck', baseFeatures: 'USB Charging Port' },
    reviews: [{ user: 'Shreya M.', rating: 5, comment: 'The eye-care feature is real — no headaches even after 4 hours of study!', date: '2026-03-13' }, { user: 'Kunal B.', rating: 5, comment: 'USB port on the base charges my phone. So convenient!', date: '2026-03-01' }, { user: 'Tanya R.', rating: 4, comment: 'Great lamp. The gooseneck could be slightly longer.', date: '2026-02-14' }]
  },
  {
    id: 406, cat: 'essentials', emoji: '🔦', badge: 'new', badgeLabel: 'New', name: 'Compact Study Lamp', desc: 'Portable compact lamp for hostel desks and bedside study corners.', price: 549, orig: 799,
    images: ['https://images.unsplash.com/photo-1517520287167-4bbf64ac2f3e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 14, rating: 4.3, ratingCount: 567,
    features: ['Foldable compact design', 'Touch-sensitive dimmer switch', 'Rechargeable 1200mAh battery', '3 brightness levels', 'Portable — fits in backpack'],
    specs: { brand: '2 AM Study', type: 'Compact Study Lamp', wattage: '5W', battery: '1200mAh Rechargeable', brightnessLevels: '3', charging: 'USB-C', foldable: 'Yes', weight: '220g' },
    reviews: [{ user: 'Prachi S.', rating: 4, comment: 'Perfect for my hostel bedside. Battery lasts 6+ hours on medium.', date: '2026-03-09' }, { user: 'Arun J.', rating: 5, comment: 'Folds flat and fits in my bag. Great for library study too!', date: '2026-02-24' }]
  },
  {
    id: 407, cat: 'essentials', emoji: '⏰', badge: null, badgeLabel: '', name: 'Aesthetic Desk Clock', desc: 'Minimal desk clock to manage pomodoro cycles and class schedules.', price: 399, orig: 599,
    images: ['https://images.unsplash.com/photo-1509048191080-d2984bad6ad5?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1512036667332-28a3f9ef7aa4?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 20, rating: 4.1, ratingCount: 289,
    features: ['Minimalist aesthetic design', 'Pomodoro timer mode built-in', 'Large LED display', 'Alarm with snooze function', 'USB-C powered'],
    specs: { brand: '2 AM Study', type: 'Desk Clock', display: 'LED', features: 'Pomodoro Timer, Alarm, Snooze', power: 'USB-C', dimensions: '8x8x4 cm', weight: '150g' },
    reviews: [{ user: 'Meghna D.', rating: 4, comment: 'The pomodoro timer is a nice touch. Display is clear and readable.', date: '2026-03-07' }, { user: 'Raj K.', rating: 4, comment: 'Looks great on my desk. Simple and functional.', date: '2026-02-19' }]
  },
  {
    id: 408, cat: 'essentials', emoji: '👕', badge: 'hot', badgeLabel: '2 AM Edition', name: 'T-Shirt (Unisex)', desc: 'Soft, comfortable unisex T-shirt with 2 AM Study brand print.', price: 599, orig: 899,
    images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1562157873-840cf81a6773?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 25, rating: 4.6, ratingCount: 1678,
    features: ['100% premium combed cotton', '2 AM Study branded chest print', 'Bio-washed for extra softness', 'Regular unisex fit', 'Pre-shrunk fabric'],
    specs: { brand: '2 AM Study', type: 'T-Shirt', material: '100% Combed Cotton', fit: 'Regular Unisex', sizes: 'S, M, L, XL, XXL', colors: 'Black, Navy, White', print: 'Screen Print', care: 'Machine Wash Cold' },
    reviews: [{ user: 'Riya G.', rating: 5, comment: 'Super soft cotton! The print quality is amazing even after multiple washes.', date: '2026-03-14' }, { user: 'Harsh N.', rating: 5, comment: 'Fits perfectly. I ordered L and it\'s true to size. Love the design!', date: '2026-03-03' }, { user: 'Ankita P.', rating: 4, comment: 'Great quality t-shirt. Wish there were more color options.', date: '2026-02-16' }]
  },
  {
    id: 409, cat: 'essentials', emoji: '🧥', badge: 'sale', badgeLabel: 'Sale', name: 'Hoodie (Unisex)', desc: 'Warm and stylish hoodie perfect for winter classes and late-night study, by 2 AM Study.', price: 1199, orig: 1699,
    images: ['https://images.unsplash.com/photo-1556821840-3a63f95609a7?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1578587018872-d914bb7f0ea1?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 7, rating: 4.7, ratingCount: 934,
    features: ['Heavy 320 GSM fleece', '2 AM Study embroidered logo', 'Kangaroo pocket with hidden zip', 'Adjustable drawstring hood', 'Ribbed cuffs and hem'],
    specs: { brand: '2 AM Study', type: 'Hoodie', material: '320 GSM Fleece Blend', fit: 'Regular Unisex', sizes: 'S, M, L, XL, XXL', colors: 'Charcoal, Navy, Burgundy', print: 'Embroidered Logo', care: 'Machine Wash Cold' },
    reviews: [{ user: 'Vivek M.', rating: 5, comment: 'Warmest hoodie I own. The fleece quality is premium. Worth every rupee!', date: '2026-03-12' }, { user: 'Sonal R.', rating: 5, comment: 'The hidden zip pocket is so useful for keys and phone. Love it!', date: '2026-02-28' }, { user: 'Dev S.', rating: 4, comment: 'Great hoodie. Only 7 left when I bought — grab it fast!', date: '2026-02-10' }]
  },
  {
    id: 410, cat: 'essentials', emoji: '🎀', badge: null, badgeLabel: '', name: 'Hair Scrunchie Set', desc: 'Aesthetic scrunchie set with comfortable hold for daily use.', price: 149, orig: 249,
    images: ['https://images.unsplash.com/photo-1582234032230-08703770f3f2?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1534067783941-51c9c23eccfd?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 40, rating: 4.0, ratingCount: 567,
    features: ['Set of 5 aesthetic scrunchies', 'Silk-blend fabric — no hair damage', 'Elastic band for comfortable hold', 'Machine washable', 'Assorted pastel colors'],
    specs: { brand: '2 AM Study', type: 'Scrunchie Set', material: 'Silk Blend', quantity: '5 Pack', colors: 'Assorted Pastels', elastic: 'Premium Elastic Band', care: 'Machine Washable' },
    reviews: [{ user: 'Nidhi K.', rating: 4, comment: 'Soft on hair and doesn\'t leave creases. Nice colors!', date: '2026-03-05' }, { user: 'Preeti L.', rating: 5, comment: 'Love the pastel shades. Perfect for daily college wear.', date: '2026-02-17' }]
  },
  {
    id: 411, cat: 'essentials', emoji: '🚨', badge: 'new', badgeLabel: 'New', name: 'Safety Alarm Keychain', desc: 'Personal alarm keychain for added confidence during commute.', price: 299, orig: 449,
    images: ['/assets/images/products/safty-1.webp', '/assets/images/products/safty-2.webp'],
    stock: 30, rating: 4.4, ratingCount: 423,
    features: ['130dB loud personal alarm', 'LED flashlight built-in', 'Keychain attachment', 'Battery operated (included)', 'Compact and lightweight'],
    specs: { brand: '2 AM Study', type: 'Safety Alarm', volume: '130dB', features: 'Alarm + LED Flashlight', power: 'LR44 Battery (Included)', attachment: 'Keychain Ring', weight: '30g' },
    reviews: [{ user: 'Swati J.', rating: 5, comment: 'Loud enough to startle anyone. I feel safer carrying this on late commutes.', date: '2026-03-08' }, { user: 'Kriti A.', rating: 4, comment: 'Compact and easy to attach to my bag. The flashlight is a bonus!', date: '2026-02-21' }]
  },
  {
    id: 412, cat: 'essentials', emoji: '🔦', badge: null, badgeLabel: '', name: 'Night Safety Flashlight', desc: 'Compact flashlight for hostels, travel, and emergency use.', price: 249, orig: 379,
    images: ['https://images.unsplash.com/photo-1550418162-83b16d54832b?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1506450983270-d790d451a012?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 28, rating: 4.2, ratingCount: 345,
    features: ['200 lumen LED beam', '3 modes (high/low/strobe)', 'Rechargeable via USB-C', 'Water-resistant IPX4', 'Compact pen-light design'],
    specs: { brand: '2 AM Study', type: 'Flashlight', lumens: '200', modes: '3 (High/Low/Strobe)', battery: 'Rechargeable Li-ion', charging: 'USB-C', waterResistance: 'IPX4', weight: '60g' },
    reviews: [{ user: 'Geeta M.', rating: 4, comment: 'Bright enough for walking at night. USB-C charging is convenient.', date: '2026-03-06' }, { user: 'Rajesh H.', rating: 4, comment: 'Good build quality. The strobe mode is useful for emergencies.', date: '2026-02-13' }]
  },
  {
    id: 413, cat: 'essentials', emoji: '🎁', badge: 'hot', badgeLabel: 'Gift', name: 'Birthday Surprise Box', desc: 'Curated birthday gift box with 2 AM Study goodies and notes.', price: 999, orig: 1499,
    images: ['https://images.unsplash.com/photo-1549465220-1d8c9d9c4709?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1513201099705-a9746e1e201f?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 5, rating: 4.8, ratingCount: 678,
    features: ['Curated gift box with 5+ items', 'Includes notebook, pen, mug mini, stickers', 'Handwritten birthday card included', 'Premium gift wrapping', 'Personalized message option'],
    specs: { brand: '2 AM Study', type: 'Gift Box', items: '5+ Curated Items', wrapping: 'Premium Gift Wrap', card: 'Handwritten Birthday Card', personalization: 'Message on Card', box: 'Magnetic Closure Box' },
    reviews: [{ user: 'Aarti S.', rating: 5, comment: 'My friend loved it! The packaging was beautiful and the items are high quality.', date: '2026-03-11' }, { user: 'Rohan D.', rating: 5, comment: 'Best gift for a student. Everything inside is actually useful!', date: '2026-02-25' }, { user: 'Pallavi T.', rating: 4, comment: 'Great value. The handwritten card made it extra special.', date: '2026-02-08' }]
  },
  {
    id: 414, cat: 'essentials', emoji: '💝', badge: 'new', badgeLabel: '2 AM Study', name: 'Birthday Memory Kit', desc: 'Memory kit to preserve photos, messages, and celebration moments.', price: 799, orig: 1199,
    images: ['/assets/images/products/gift-1.webp', 'https://images.unsplash.com/photo-1544027993-37dbfe43562a?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
      stock: 8, rating: 4.5, ratingCount: 234,
      features: ['Photo album with 30 slip-in pockets', 'Message cards for friends to write', 'Decorative stickers and washi tape', 'Memory journal section', 'Keepsake box packaging'],
      specs: { brand: '2 AM Study', type: 'Memory Kit', photoPockets: '30', includes: 'Album, Message Cards, Stickers, Washi Tape, Journal', packaging: 'Keepsake Box', dimensions: '25x20x5 cm', weight: '450g' },
      reviews: [{ user: 'Divya K.', rating: 5, comment: 'Such a thoughtful gift idea. The message cards from friends made me emotional!', date: '2026-03-09' }, { user: 'Nikhil T.', rating: 4, comment: 'Good quality album and accessories. Fun to fill in.', date: '2026-02-22' }]
  },
  {
    id: 415, cat: 'essentials', emoji: '🖼️', badge: null, badgeLabel: '', name: 'Motivational Wall Poster', desc: 'Inspirational wall poster to keep your study space energetic.', price: 199, orig: 299,
    images: ['https://images.unsplash.com/photo-1554048612-b6a482bc67e5?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 35, rating: 4.0, ratingCount: 456,
    features: ['A2 size motivational poster', 'Matte finish — no glare', 'Premium 200 GSM paper', '2 AM Study exclusive design', 'Ready to frame'],
    specs: { brand: '2 AM Study', type: 'Wall Poster', size: 'A2 (42x59.4 cm)', paper: '200 GSM Matte', finish: 'Matte', frame: 'Not Included (Ready to Frame)', design: '2 AM Study Exclusive' },
    reviews: [{ user: 'Aman G.', rating: 4, comment: 'Looks great on my study wall. Good print quality for the price.', date: '2026-03-03' }, { user: 'Snehal P.', rating: 4, comment: 'Motivational quotes are well-designed. Matte finish is nice.', date: '2026-02-12' }]
  },
  {
    id: 416, cat: 'essentials', emoji: '🧰', badge: 'top', badgeLabel: 'Best Value', name: 'Compact Study Essentials Kit', desc: 'All-in-one compact essentials kit from 2 AM Study for school, college, and self-study.', price: 899, orig: 1299,
    images: ['https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80'],
    stock: 11, rating: 4.6, ratingCount: 789,
    features: ['10+ essential items in one kit', 'Includes pens, highlighters, sticky notes', 'Ruler, eraser, and pencil included', 'Compact carrying pouch', 'Perfect starter kit for students'],
    specs: { brand: '2 AM Study', type: 'Essentials Kit', items: '10+ (Pens, Highlighters, Sticky Notes, Ruler, Eraser, Pencil, Pouch)', pouch: 'Zippered Compact Pouch', totalItems: '12', idealFor: 'School, College, Self-Study', weight: '350g' },
  },
];

// Persistent Product Catalog & Stock Management
const storeProductsFilePath = path.join(__dirname, 'data', 'storeProducts.json');
const storeStockFilePath = path.join(__dirname, 'data', 'storeStock.json');

function loadPersistedProducts() {
  try {
    if (fs.existsSync(storeProductsFilePath)) {
      const productData = JSON.parse(fs.readFileSync(storeProductsFilePath, 'utf8'));
      if (Array.isArray(productData) && productData.length > 0) {
        STORE_PRODUCTS = productData;
        console.log(`[Store] Loaded ${STORE_PRODUCTS.length} products from storeProducts.json`);
        return;
      }
    }
    // If storeProducts.json doesn't exist, seed it with default STORE_PRODUCTS
    savePersistedProducts();
  } catch (e) {
    console.warn('[Store] Notice loading persisted products:', e.message);
  }
}

function savePersistedProducts() {
  try {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(storeProductsFilePath, JSON.stringify(STORE_PRODUCTS, null, 2), 'utf8');

    // Also sync stock file for backward compatibility
    const stockData = {};
    STORE_PRODUCTS.forEach(p => { stockData[p.id] = p.stock; });
    fs.writeFileSync(storeStockFilePath, JSON.stringify(stockData, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Store] Notice saving products:', e.message);
  }
}

function loadPersistedStock() {
  loadPersistedProducts();
}

function savePersistedStock() {
  savePersistedProducts();
}

loadPersistedProducts();

// Persistent Blog Management
const blogsFilePath = path.join(__dirname, 'data', 'blogs.json');
let BLOG_POSTS = [];

function loadPersistedBlogs() {
  try {
    if (fs.existsSync(blogsFilePath)) {
      const data = JSON.parse(fs.readFileSync(blogsFilePath, 'utf8'));
      if (Array.isArray(data)) {
        BLOG_POSTS = data;
        console.log(`[Blog] Loaded ${BLOG_POSTS.length} blog posts from disk.`);
        return;
      }
    }
  } catch (e) {
    console.warn('[Blog] Notice loading persisted blogs:', e.message);
  }
}

function savePersistedBlogs() {
  try {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(blogsFilePath, JSON.stringify(BLOG_POSTS, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Blog] Notice saving blogs:', e.message);
  }
}

loadPersistedBlogs();

// Persistent Store Orders Management
const storeOrdersFilePath = path.join(__dirname, 'data', 'storeOrders.json');
let PERSISTED_STORE_ORDERS = [];
let storeInvoicesMap = new Map();
let invoiceCounter = 1;

function loadPersistedStoreOrders() {
  try {
    if (fs.existsSync(storeOrdersFilePath)) {
      const data = JSON.parse(fs.readFileSync(storeOrdersFilePath, 'utf8'));
      if (Array.isArray(data)) {
        PERSISTED_STORE_ORDERS = data;
        PERSISTED_STORE_ORDERS.forEach(o => {
          if (o && o.orderId) storeInvoicesMap.set(o.orderId, o);
        });
        console.log(`[Store Orders] Loaded ${PERSISTED_STORE_ORDERS.length} past orders from disk.`);
        return;
      }
    }
  } catch (e) {
    console.warn('[Store Orders] Notice loading persisted orders:', e.message);
  }
}

function savePersistedStoreOrders() {
  try {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(storeOrdersFilePath, JSON.stringify(PERSISTED_STORE_ORDERS, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Store Orders] Notice saving orders:', e.message);
  }
}

loadPersistedStoreOrders();

const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ?
  new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  }) : null;

// Enable Compression for all responses
app.use(compression());

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Optimized Static Asset Caching (7 Days)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  etag: true,
  lastModified: true
}));



app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Session middleware for cart & auth
const isProduction = process.env.NODE_ENV === 'production';
app.use(session({
  secret: process.env.SESSION_SECRET || '2am-study-store-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: isProduction, // Only secure in production
    sameSite: 'lax'
  }
}));

// Global SEO & Canonical URL Middleware
app.use((req, res, next) => {
  const cleanPath = req.path.endsWith('/') && req.path.length > 1 ? req.path.slice(0, -1) : req.path;
  res.locals.currentPath = cleanPath;
  res.locals.canonicalUrl = 'https://2amstudy.com' + (cleanPath === '/' ? '' : cleanPath);
  res.locals.ogUrl = 'https://2amstudy.com' + (cleanPath === '/' ? '' : cleanPath);
  res.locals.siteDomain = 'https://2amstudy.com';
  next();
});
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'public/assets/images/store'));
  },
  filename: function (req, file, cb) {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: function (req, file, cb) {
    const allowed = /jpg|jpeg|png|webp|gif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype.split('/')[1]);
    if (ext && mime) cb(null, true);
    else cb(new Error('Only images (jpg, png, webp, gif) allowed'));
  }
});

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

app.get('/', (req, res) => {
  const liveSession = studySessions.find(s => s.status === 'LIVE') || null;
  const latestPastSession = studySessions
    .filter(s => s.status === 'COMPLETED')
    .sort((a, b) => new Date(b.endedAt || b.createdAt) - new Date(a.endedAt || a.createdAt))[0] || null;
  res.render('index', {
    pageTitle: '2AM Study - #1 Student Productivity Hub, Focus Timer & Study Tips',
    metaDescription: 'Boost your student productivity with 2AM Study. Use our Pomodoro focus timer, academic planner, and expert study tips for effective exam preparation and concentration.',
    shopperFeedbacks: shopperFeedbacks.length ? shopperFeedbacks : [],
    liveSession,
    latestPastSession,
    collegeVideos: collegeLifeVideos.slice(0, 3),
    storeProducts: STORE_PRODUCTS
  });
});

// ===== College Life Enjoy Routes =====
app.get('/college-life', (req, res) => {
  res.render('college-life', {
    pageTitle: 'College Life Enjoy & Campus Stories | 2AM Study',
    metaDescription: 'Watch college life videos, campus fests, hostel fun, and student vlogs on 2AM Study. Enjoy the best moments of student life.',
    videos: collegeLifeVideos
  });
});

app.get('/college-life/:id', (req, res) => {
  const video = collegeLifeVideos.find(v => v.id === req.params.id);
  if (!video) {
    return res.status(404).render('404', {
      pageTitle: 'Video Not Found | 2AM Study',
      metaDescription: 'The college life video you are looking for could not be found.'
    });
  }
  const relatedVideos = collegeLifeVideos.filter(v => v.id !== video.id).slice(0, 3);
  res.render('college-life-video', {
    pageTitle: `${video.title} | College Life | 2AM Study`,
    metaDescription: video.description || 'Watch college life and campus videos on 2AM Study.',
    video,
    relatedVideos
  });
});

// ===== College Life API (Admin CRUD) =====
function requireAdminForCollegeLife(req, res, next) {
  if (req.session && (req.session.isAdmin || req.session.isStoreAdmin || req.session.liveAdminAuthed)) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Admin authentication required.' });
}

// Add college life video
app.post('/api/college-life/videos', requireAdminForCollegeLife, (req, res) => {
  const { youtubeUrl, title, description, category, duration, thumbnail, isFeatured } = req.body;
  if (!youtubeUrl || !title) {
    return res.status(400).json({ success: false, error: 'YouTube URL and title are required.' });
  }
  const youtubeVideoId = extractYoutubeVideoId(youtubeUrl);
  if (!youtubeVideoId) {
    return res.status(400).json({ success: false, error: 'Invalid YouTube URL.' });
  }

  // Prevent duplicate submissions of the exact same video
  const duplicate = collegeLifeVideos.find(v => v.youtubeVideoId === youtubeVideoId);
  if (duplicate) {
    return res.status(409).json({ success: false, error: 'This YouTube video has already been added to College Life.' });
  }

  const newVideo = {
    id: 'cl-' + uuidv4().split('-')[0],
    title: title.trim(),
    description: (description || '').trim(),
    category: (category || 'College Life').trim(),
    duration: (duration || '').trim(),
    youtubeUrl: youtubeUrl.trim(),
    youtubeVideoId,
    thumbnail: (thumbnail && thumbnail.trim()) || `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`,
    isFeatured: Boolean(isFeatured),
    createdAt: new Date().toISOString()
  };

  // If featured, unset existing featured
  if (newVideo.isFeatured) {
    collegeLifeVideos.forEach(v => { v.isFeatured = false; });
  }

  collegeLifeVideos.unshift(newVideo);
  saveCollegeLifeVideos();
  res.json({ success: true, video: newVideo });
});

// Delete college life video
app.delete('/api/college-life/videos/:id', requireAdminForCollegeLife, (req, res) => {
  const idx = collegeLifeVideos.findIndex(v => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Video not found.' });
  collegeLifeVideos.splice(idx, 1);
  saveCollegeLifeVideos();
  res.json({ success: true });
});

// Set featured
app.patch('/api/college-life/videos/:id/feature', requireAdminForCollegeLife, (req, res) => {
  collegeLifeVideos.forEach(v => { v.isFeatured = false; });
  const video = collegeLifeVideos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ success: false, error: 'Video not found.' });
  video.isFeatured = true;
  saveCollegeLifeVideos();
  res.json({ success: true, video });
});



// ===== Exam Resources API (Admin CRUD) =====
// Add resource card
app.post('/api/resources', requireAdminForCollegeLife, (req, res) => {
  const { title, exam, category, officialUrl, description, latestYear } = req.body;
  if (!title || !exam || !officialUrl) {
    return res.status(400).json({ success: false, error: 'Title, exam name, and official URL are required.' });
  }

  const examSlug = exam.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const newResource = {
    id: 'res-' + uuidv4().split('-')[0],
    title: title.trim(),
    exam: exam.trim(),
    examSlug: examSlug || 'general',
    category: (category || 'PYQ').trim().toUpperCase(),
    officialUrl: officialUrl.trim(),
    description: (description || '').trim(),
    lastUpdated: new Date().toISOString().split('T')[0],
    latestYear: latestYear ? parseInt(latestYear, 10) : new Date().getFullYear(),
    active: true,
    createdAt: new Date().toISOString()
  };

  examResources.unshift(newResource);
  saveExamResources();
  res.json({ success: true, resource: newResource });
});

// Delete resource card
app.delete('/api/resources/:id', requireAdminForCollegeLife, (req, res) => {
  const idx = examResources.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Resource not found.' });
  examResources.splice(idx, 1);
  saveExamResources();
  res.json({ success: true });
});

// --- Authentication Routes & Session Sync ---
app.get('/login', (req, res) => {
  res.render('login', {
    pageTitle: 'Log In | 2AM Study & Student Safety Hub',
    metaDescription: 'Log in to your 2AM Study account to access personalized study tools, student safety reports, and order tracking.'
  });
});

app.get('/signup', (req, res) => {
  res.render('signup', {
    pageTitle: 'Sign Up | Join 2AM Study Student Community',
    metaDescription: 'Create your free 2AM Study account to track study streaks, access student safety shield, and get student store benefits.'
  });
});

app.get('/forgot-password', (req, res) => {
  // Bug 5 fix: Redirect with a flag so the login page can show a helpful prompt
  // instead of silently dropping the user on the login page with no context
  res.redirect('/login?resetprompt=1');
});

app.get('/profile', (req, res) => {
  res.render('profile', {
    pageTitle: 'My Profile | 2AM Study',
    metaDescription: 'Manage your student profile, trust score, saved reports, and preferences on 2AM Study.'
  });
});

app.post('/api/auth/session', (req, res) => {
  const { user } = req.body;
  if (user) {
    req.session.user = {
      uid: user.uid,
      email: user.email,
      name: user.displayName || user.name || user.email?.split('@')[0] || 'Student',
      photoURL: user.photoURL || null
    };
  } else {
    delete req.session.user;
  }
  res.json({ success: true, user: req.session.user || null });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  const user = req.session.user || null;
  res.json({ success: true, loggedIn: !!user, user });
});



app.get('/timer', (req, res) => {
  res.render('timer', {
    pageTitle: 'Best Pomodoro Focus Timer for Students | Study Better',
    metaDescription: 'Master focus techniques with our aesthetic Pomodoro timer. Customizable study intervals and distraction blocking to enhance your deep work sessions.'
  });
});

app.get('/tasks', (req, res) => {
  res.render('tasks', {
    pageTitle: 'Academic Planner & Student Task Manager | Stay Productive',
    metaDescription: 'Organize your study routine with our free academic planner. Track assignments and exam preparation goals to maintain high student productivity.'
  });
});

app.get('/flashcards', (req, res) => {
  res.render('flashcards', {
    pageTitle: 'AI Flashcard Maker - Convert PDF to Study Cards Instantly',
    metaDescription: 'Accelerate your exam preparation with our AI-powered flashcard maker. Transform lecture notes into interactive study tools using advanced extraction.'
  });
});

// Exam Resource Center — main hub (/notes keeps backward-compat)
const RESOURCE_HUB_META = {
  pageTitle: 'Exam Resource Center | Official PYQs, Syllabus & Notifications',
  metaDescription: 'Free access to official exam resources — Previous Year Papers, Syllabus, Notifications, Answer Keys, Cut-offs and more for GATE, UPSC, NEET, JEE, CAT, SSC and 9 other exams.',
  ogTitle: 'Official Exam Resource Center | 2AM Study',
  ogDescription: 'One-stop hub for official study resources across 13 major exams. Every link goes directly to the official source.'
};

app.get('/notes', (req, res) => {
  res.render('notes', { ...RESOURCE_HUB_META, resources: examResources });
});

app.get('/resources', (req, res) => {
  res.render('notes', { ...RESOURCE_HUB_META, resources: examResources });
});

app.get('/resources/:examSlug', (req, res) => {
  const slug = req.params.examSlug.toLowerCase().trim();
  const examData = examResources.filter(r => r.examSlug === slug && r.active !== false);
  if (!examData.length) {
    return res.redirect('/resources');
  }
  const examName = examData[0].exam;
  res.render('resources-exam', {
    pageTitle: `${examName} Resources — PYQs, Syllabus & More | 2AM Study`,
    metaDescription: `Official ${examName} resources: Previous Year Papers, Syllabus, Notifications, Answer Keys, Cut-offs and more. All links go directly to official sources.`,
    ogTitle: `${examName} Official Resources | 2AM Study`,
    ogDescription: `All official ${examName} study materials in one place — curated and updated regularly.`,
    examName,
    examSlug: slug,
    resources: examData,
    allSlugs: [...new Set(examResources.map(r => ({ slug: r.examSlug, name: r.exam })))]
  });
});

app.get('/chat', (req, res) => {
  res.render('chat', {
    pageTitle: 'Student Community Chat - Connect & Study Together',
    metaDescription: 'Join a vibrant community of students. Discuss study tips, share resources, and find study buddies in our moderated chat room.'
  });
});

app.get('/music', (req, res) => {
  res.render('music', {
    pageTitle: 'Lofi Study Music - Best Focus & Concentration Beats',
    metaDescription: 'Listen to curated focus music, lofi beats, and ambient sounds designed to help students concentrate and reach deep work states.',
    youtubeApiKey: process.env.YOUTUBE_API_KEY || ''
  });
});

app.get('/quotes', (req, res) => {
  res.render('quotes', {
    pageTitle: 'Motivational Study Quotes - Get Inspired Daily',
    metaDescription: 'Collection of aesthetic motivational quotes for students. Export to custom backgrounds to keep yourself inspired throughout the semester.'
  });
});

app.get('/game', (req, res) => {
  res.render('game', {
    pageTitle: 'Study Reward Games - Fun Challenges for Productive Students',
    metaDescription: 'Unlock fun, focus-enhancing games as a reward for completing your study sessions. The perfect way to recharge between tasks.'
  });
});

app.get('/calculator', (req, res) => {
  res.render('calculator', {
    pageTitle: 'Scientific Calculator Online - Fast & Free for Students',
    metaDescription: 'Simple and powerful online scientific calculator for solving math, physics, and engineering problems during your study sessions.'
  });
});

app.get('/clock', (req, res) => {
  res.render('clock', {
    pageTitle: 'Digital Study Clock - Full-Screen Time Management',
    metaDescription: 'Minimalist full-screen digital clock to keep you aware of time during focused study sessions. Aesthetic and distraction-free.'
  });
});

app.get('/streak', (req, res) => {
  res.render('streak', {
    pageTitle: 'Study Streak Tracker & Leaderboard - Gamify Your Grades',
    metaDescription: 'Track your daily study consistency and compete on the global leaderboard. Build powerful habits through study streaks.'
  });
});

app.get('/college-student', (req, res) => {
  res.render('college-student', {
    pageTitle: 'College Student Support - Mental Health & Academic Help',
    metaDescription: 'Resources and support for navigating college life. From emotional wellness to academic guidance, we’re here for you.'
  });
});

app.get('/student-safety', (req, res) => {
  res.render('student-safety', {
    pageTitle: '🛡️ Student Identity Shield - 2AM Study',
    metaDescription: 'Protect students from fake social media profiles. Report impersonation, help verify genuine cases, and support affected students.',
    activeTab: req.query.tab || 'overview'
  });
});

app.get('/student-safety/report', (req, res) => {
  res.render('report-fake-profile', {
    pageTitle: 'Report Fake Profile | Student Identity Shield',
    metaDescription: 'Report fake student social media profiles and impersonation accounts securely.',
    successMessage: null,
    errorMessage: null,
    caseId: null
  });
});

app.get('/student-safety/how-it-works', (req, res) => {
  res.render('how-it-works', {
    pageTitle: 'How Student Identity Shield Works | 2AM Study',
    metaDescription: 'Learn how Student Identity Shield protects students from fake social media profiles through community reports and admin verification.'
  });
});

app.get('/student-safety/admin', (req, res) => {
  res.redirect('/admin#tab-safety');
});

app.get('/admin-moderation', (req, res) => {
  res.redirect('/admin#tab-safety');
});

// ===== Student Safety helpers =====
function normalizeProfileUrl(urlStr) {
  if (!urlStr) return '';
  return urlStr.trim().toLowerCase().replace(/\/+$/, '');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function sanitizeCaseForOwner(caseObj) {
  const copy = { ...caseObj };
  if (copy.anonymous) {
    delete copy.reporterEmail;
  }
  return copy;
}

function sanitizeCaseForPublic(caseObj) {
  return {
    caseId: caseObj.caseId,
    platform: caseObj.platform,
    fakeUsername: caseObj.fakeUsername,
    fakeProfileUrl: caseObj.fakeProfileUrl,
    realProfileUrl: caseObj.realProfileUrl || '',
    reason: caseObj.reason,
    description: caseObj.description,
    college: caseObj.college || '',
    evidence: caseObj.evidence || [],
    anonymous: caseObj.anonymous,
    status: caseObj.status,
    supportCount: caseObj.supportCount || 0,
    createdAt: caseObj.createdAt,
    updatedAt: caseObj.updatedAt,
    moderatorNote: caseObj.moderatorNote || '',
    rejectionReason: caseObj.rejectionReason || ''
  };
}

function migrateSupportsOnMerge(sourceCaseId, targetCaseId) {
  let changed = false;
  studentSafetySupports.forEach(s => {
    if (s.caseId === sourceCaseId) {
      s.caseId = targetCaseId;
      s.mergedFrom = sourceCaseId;
      s.updatedAt = new Date().toISOString();
      changed = true;
    }
  });
  if (changed) saveStudentSafetySupports();
}

function notifyReporterForModerationAction(targetCase, action, note) {
  if (!targetCase?.userId) return;

  const caseId = targetCase.caseId;
  const notifTypeMap = {
    approve: 'success', reject: 'error', request_evidence: 'warning',
    resolve: 'success', reopen: 'info'
  };
  const notifTitleMap = {
    approve: '✅ Report Approved & Verified',
    reject: '❌ Report Rejected',
    request_evidence: '📩 More Evidence Needed',
    resolve: '🎉 Case Resolved',
    reopen: '🔄 Case Reopened'
  };
  const notificationMsgMap = {
    approve: `Your impersonation report (Case ${caseId}) has been approved & verified by our moderation team.`,
    reject: `Your impersonation report (Case ${caseId}) was reviewed and rejected. Reason: ${note || targetCase.rejectionReason || 'Insufficient evidence'}`,
    request_evidence: `Action required on Case ${caseId}: Our moderation team requested additional evidence. Note: ${note || targetCase.moderatorNote || ''}`,
    resolve: `Great news! Case ${caseId} has been officially marked as resolved. Thank you for keeping 2AM Study safe.`,
    reopen: `Case ${caseId} has been reopened for moderation review.`
  };

  const notif = {
    notificationId: 'NOTIF-' + uuidv4().substring(0, 8).toUpperCase(),
    userId: targetCase.userId,
    caseId,
    title: notifTitleMap[action] || 'Case Update',
    type: notifTypeMap[action] || 'info',
    message: notificationMsgMap[action] || `Case ${caseId} status updated.`,
    isRead: false,
    read: false,
    createdAt: new Date().toISOString()
  };
  studentSafetyNotifications.unshift(notif);
  saveNotifications();

  const emailTemplates = {
    approve: { subject: `[2AM Study] Case ${caseId} Verified ✅`, body: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;"><h2 style="color:#16a34a;">✅ Your report has been verified!</h2><p>Case <strong>${caseId}</strong> has been reviewed and approved by our moderation team. It is now publicly visible for community support.</p><a href="https://2amstudy.online/student-safety/cases/${caseId}" style="display:inline-block;background:#1e40af;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px;">View Your Case</a><p style="color:#64748b;font-size:13px;margin-top:24px;">Thank you for making 2AM Study safer.</p></div>` },
    reject: { subject: `[2AM Study] Case ${caseId} Update`, body: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;"><h2 style="color:#dc2626;">Case Review Update</h2><p>Case <strong>${caseId}</strong> could not be verified at this time.</p><p><strong>Reason:</strong> ${note || targetCase.rejectionReason || 'Insufficient evidence'}</p><p>If you believe this is an error, you may submit a new report with additional evidence.</p></div>` },
    request_evidence: { subject: `[2AM Study] Action Required — Case ${caseId}`, body: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;"><h2 style="color:#d97706;">📩 Additional Evidence Required</h2><p>Our team is reviewing Case <strong>${caseId}</strong> and needs more information to proceed.</p><p><strong>Moderator Note:</strong> ${note || targetCase.moderatorNote || 'Please provide additional proof or ID verification.'}</p></div>` },
    resolve: { subject: `[2AM Study] Case ${caseId} Resolved 🎉`, body: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;"><h2 style="color:#16a34a;">🎉 Case Resolved!</h2><p>Great news! Case <strong>${caseId}</strong> has been officially resolved. Thank you for helping keep 2AM Study safe.</p></div>` }
  };

  if (action === 'approve') {
    dispatchSmartNotification({
      userId: targetCase.userId,
      userEmail: targetCase.reporterEmail,
      caseId,
      title: `[2AM Study] Case ${caseId} Verified ✅`,
      message: `Your report for ${targetCase.fakeUsername || 'fake profile'} has been verified by our moderation team.`,
      targetUrl: `/student-safety#${caseId}`
    });
  } else if (emailTemplates[action]) {
    sendSafetyEmail(targetCase.reporterEmail || null, emailTemplates[action].subject, emailTemplates[action].body);
  }

  if (action === 'resolve' || action === 'reject') {
    const supporters = studentSafetySupports.filter(s => s.caseId === caseId);
    supporters.forEach(supporter => {
      if (supporter.userId === targetCase.userId) return;
      studentSafetyNotifications.unshift({
        notificationId: 'NOTIF-' + uuidv4().substring(0, 8).toUpperCase(),
        userId: supporter.userId,
        caseId,
        title: action === 'resolve' ? '🎉 Supported Case Resolved' : '❌ Supported Case Closed',
        type: action === 'resolve' ? 'success' : 'info',
        message: action === 'resolve'
          ? `A case you supported (${caseId}) has been officially resolved. Thank you for your community support!`
          : `A case you supported (${caseId}) has been reviewed and closed.`,
        isRead: false, read: false,
        createdAt: new Date().toISOString()
      });
    });
    saveNotifications();
  }
}

// ===== Step 5: Email Notification Helper (nodemailer) =====
async function sendSafetyEmail(to, subject, html) {
  if (!to || !process.env.SMTP_USER) return; // Silently skip if no email or SMTP config
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({
      from: `"2AM Study Safety" <${process.env.SMTP_USER}>`,
      to: to,
      subject: subject,
      html: html
    });
  } catch (e) {
    console.warn('Safety email send error (non-blocking):', e.message);
  }
}

// Cloudinary / Local Disk / Base64 DataURI Evidence Upload Helper (Resilient Multi-tier Fallback)
async function uploadToCloudinary(fileBuffer, mimetype, filename) {
  if (!fileBuffer || fileBuffer.length === 0) return null;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const isPdf = (mimetype && mimetype.includes('pdf')) || filename?.toLowerCase().endsWith('.pdf');
  const ext = isPdf ? 'pdf' : (path.extname(filename || '').replace('.', '') || 'png');
  const safeBaseName = `case_${Date.now()}_${uuidv4().substring(0, 8)}.${ext}`;
  const effectiveMime = mimetype || (isPdf ? 'application/pdf' : 'image/png');
  const dataUri = `data:${effectiveMime};base64,${fileBuffer.toString('base64')}`;

  // ── Tier 1: Cloudinary Upload (if credentials configured) ──
  if (cloudName && apiKey && apiSecret) {
    try {
      const publicId = `student-safety/case_${Date.now()}_${uuidv4().substring(0, 6)}`;
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureStr = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
      const signature = crypto.createHash('sha1').update(signatureStr).digest('hex');

      const formData = new URLSearchParams();
      formData.append('file', dataUri);
      formData.append('api_key', apiKey);
      formData.append('timestamp', timestamp.toString());
      formData.append('public_id', publicId);
      formData.append('signature', signature);

      const fetchRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
        method: 'POST',
        body: formData
      });

      if (fetchRes.ok) {
        const data = await fetchRes.json();
        if (data.secure_url) {
          return {
            url: data.secure_url,
            publicId: data.public_id || publicId,
            type: isPdf ? 'pdf' : 'image',
            uploadedAt: new Date().toISOString()
          };
        }
      }
    } catch (err) {
      console.warn("[Cloudinary] Upload failed, trying local disk fallback:", err.message || err);
    }
  }

  // ── Tier 2: Local Disk Storage ──
  try {
    const uploadDir = path.join(__dirname, 'public', 'assets', 'uploads', 'safety');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const filePath = path.join(uploadDir, safeBaseName);
    fs.writeFileSync(filePath, fileBuffer);

    return {
      url: `/assets/uploads/safety/${safeBaseName}`,
      publicId: `local_${safeBaseName}`,
      type: isPdf ? 'pdf' : 'image',
      uploadedAt: new Date().toISOString()
    };
  } catch (fsErr) {
    console.warn("[Local Evidence Upload] Local write failed (e.g. read-only serverless host), using Data URI fallback:", fsErr.message);
  }

  // ── Tier 3: Zero-Failure In-Memory Data URI Fallback ──
  // Ensures student reports NEVER fail even on serverless read-only platforms
  return {
    url: dataUri,
    publicId: `inline_${safeBaseName}`,
    type: isPdf ? 'pdf' : 'image',
    uploadedAt: new Date().toISOString()
  };
}

app.post('/student-safety/report', (req, res, next) => {
  uploadEvidence(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'File size exceeds maximum limit of 10 MB per file.' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ success: false, message: 'You can upload a maximum of 5 evidence files.' });
      }
      return res.status(400).json({ success: false, message: err.message });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, verifyFirebaseToken, async (req, res) => {
  try {
    const {
      platform,
      fakeUsername,
      fakeProfileUrl,
      realProfileUrl,
      reason,
      description,
      college,
      reporterName,
      reporterEmail: inputReporterEmail,
      anonymous,
      truthConfirmed
    } = req.body;

    if (!platform || !fakeUsername || !fakeProfileUrl || !reason || !description) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields (Platform, Username, Fake Profile Link, Reason, and Description).'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one evidence file (JPG, PNG, or PDF) is required.'
      });
    }

    if (truthConfirmed !== 'true' && truthConfirmed !== 'on' && truthConfirmed !== true) {
      return res.status(400).json({
        success: false,
        message: 'You must confirm that this report is truthful.'
      });
    }

    const reporterEmail = req.firebaseEmail || inputReporterEmail || null;
    const finalUserId = req.firebaseUid || (reporterEmail ? ('USER-' + Buffer.from(reporterEmail).toString('hex').substring(0, 10)) : ('USER-' + Date.now().toString(36)));

    // Rate Limiting Check (Maximum 3 reports per verified user per day)
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const userRecentReports = studentSafetyCases.filter(c => {
      if (c.userId !== finalUserId && (!reporterEmail || c.reporterEmail !== reporterEmail)) return false;
      const createdTime = new Date(c.createdAt).getTime();
      return (now - createdTime) < oneDayMs;
    });

    if (userRecentReports.length >= 3) {
      return res.status(429).json({
        success: false,
        isRateLimited: true,
        message: "You have reached today's report limit. Please try again tomorrow."
      });
    }

    const targetUrl = normalizeProfileUrl(fakeProfileUrl);
    const existingCase = studentSafetyCases.find(c => {
      if (normalizeProfileUrl(c.fakeProfileUrl) !== targetUrl) return false;
      return c.status !== 'Rejected';
    });

    if (existingCase) {
      const isPublic = existingCase.status === 'Verified' || existingCase.status === 'Resolved';
      return res.status(409).json({
        success: false,
        isDuplicate: true,
        existingCaseId: existingCase.caseId,
        existingCaseStatus: existingCase.status,
        existingCasePublic: isPublic,
        message: isPublic
          ? 'This profile has already been reported. Would you like to support the existing case instead?'
          : 'This profile has already been reported and is under review. Track it in My Reports.'
      });
    }

    let structuredEvidence = [];
    if (Array.isArray(req.files) && req.files.length > 0) {
      try {
        const uploaded = await Promise.all(
          req.files.map(f => uploadToCloudinary(f.buffer, f.mimetype, f.originalname))
        );
        structuredEvidence = uploaded.filter(Boolean);
      } catch (uploadErr) {
        console.warn("[Evidence Upload Notice]:", uploadErr.message);
        structuredEvidence = [];
      }
    }

    const generatedCaseId = 'CASE-' + uuidv4().substring(0, 8).toUpperCase();

    const newCase = {
      caseId: generatedCaseId,
      userId: finalUserId,
      reporterName: reporterName || '',
      reporterEmail: reporterEmail,
      platform: platform,
      fakeUsername: fakeUsername,
      fakeProfileUrl: fakeProfileUrl,
      realProfileUrl: realProfileUrl || '',
      reason: reason,
      description: description,
      college: college || '',
      evidence: structuredEvidence,
      anonymous: anonymous === 'true' || anonymous === 'on' || anonymous === true,
      status: 'Pending Review',
      supportCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    studentSafetyCases.unshift(newCase);
    saveStudentSafetyCases();

    const submitNotif = {
      notificationId: 'NOTIF-' + uuidv4().substring(0, 8).toUpperCase(),
      userId: finalUserId,
      caseId: generatedCaseId,
      title: 'Report Submitted',
      type: 'info',
      message: `Your fake profile report (Case ${generatedCaseId}) has been received. Our moderation team will review it within 24–48 hours.`,
      isRead: false,
      read: false,
      createdAt: new Date().toISOString()
    };
    studentSafetyNotifications.unshift(submitNotif);
    saveNotifications();

    sendSafetyEmail(
      reporterEmail,
      `[2AM Study] Report Submitted — Case ${generatedCaseId}`,
      `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;">
        <h2 style="color:#1e40af;">🛡️ Report Received</h2>
        <p>Hello,</p>
        <p>Your fake profile report has been successfully submitted to 2AM Study's Student Safety team.</p>
        <table style="width:100%;background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">
          <tr><td><strong>Case ID:</strong></td><td>${generatedCaseId}</td></tr>
          <tr><td><strong>Platform:</strong></td><td>${platform}</td></tr>
          <tr><td><strong>Status:</strong></td><td>Pending Review</td></tr>
        </table>
        <p>Our moderation team will review your report within 24–48 hours. You'll be notified when the status changes.</p>
        <p style="color:#64748b;font-size:13px;">This is an automated message from 2AM Study Student Safety. Please do not reply.</p>
      </div>`
    );

    // ── Admin Alert Email ── Send instant notification to admin on every new report
    sendSafetyEmail(
      'hiiinishant@gmail.com',
      `🚨 [Action Required] New Fake Profile Report — Case ${generatedCaseId}`,
      `<div style="font-family:Inter,sans-serif;max-width:640px;margin:auto;padding:0;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:28px 32px;border-radius:12px 12px 0 0;">
          <div style="color:#fecaca;font-size:13px;font-weight:600;letter-spacing:0.05em;margin-bottom:6px;">🛡️ STUDENT IDENTITY SHIELD — ADMIN ALERT</div>
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:800;">🚨 New Fake Profile Report</h1>
          <div style="color:#fca5a5;font-size:13px;margin-top:6px;">Submitted on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</div>
        </div>

        <!-- Case Details -->
        <div style="background:#ffffff;padding:28px 32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;width:38%;">Case ID</td>
              <td style="padding:10px 0;color:#0f172a;font-size:13px;font-weight:700;font-family:monospace;">${generatedCaseId}</td>
            </tr>
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Platform</td>
              <td style="padding:10px 0;color:#0f172a;font-size:13px;font-weight:700;">${platform}</td>
            </tr>
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Fake Username</td>
              <td style="padding:10px 0;color:#dc2626;font-size:13px;font-weight:700;">@${fakeUsername}</td>
            </tr>
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Fake Profile URL</td>
              <td style="padding:10px 0;font-size:13px;"><a href="${fakeProfileUrl}" style="color:#2563eb;word-break:break-all;">${fakeProfileUrl}</a></td>
            </tr>
            ${realProfileUrl ? `<tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Real Profile URL</td>
              <td style="padding:10px 0;font-size:13px;"><a href="${realProfileUrl}" style="color:#16a34a;word-break:break-all;">${realProfileUrl}</a></td>
            </tr>` : ''}
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Reason</td>
              <td style="padding:10px 0;color:#0f172a;font-size:13px;">${reason}</td>
            </tr>
            ${college ? `<tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">College</td>
              <td style="padding:10px 0;color:#0f172a;font-size:13px;">${college}</td>
            </tr>` : ''}
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Reporter Email</td>
              <td style="padding:10px 0;color:#0f172a;font-size:13px;">${reporterEmail || '<em style="color:#94a3b8;">Not provided</em>'}</td>
            </tr>
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Anonymous</td>
              <td style="padding:10px 0;color:#0f172a;font-size:13px;">${(anonymous === 'true' || anonymous === 'on' || anonymous === true) ? 'Yes' : 'No'}</td>
            </tr>
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;">Evidence Files</td>
              <td style="padding:10px 0;color:#0f172a;font-size:13px;">${(newCase.evidence || []).length} file(s) uploaded</td>
            </tr>
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;vertical-align:top;">Description</td>
              <td style="padding:10px 0;color:#334155;font-size:13px;line-height:1.6;">${(description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
            </tr>
          </table>
        </div>

        <!-- CTA Button -->
        <div style="background:#f8fafc;padding:24px 32px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
          <a href="https://2amstudy.online/admin#tab-safety" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#ffffff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;font-size:15px;">
            🔍 Review & Moderate Now
          </a>
        </div>

        <!-- Footer -->
        <div style="background:#1e293b;padding:16px 32px;border-radius:0 0 12px 12px;text-align:center;">
          <p style="color:#64748b;font-size:12px;margin:0;">2AM Study · Student Identity Shield · Admin Alert System<br>This is an automated admin notification. Do not reply to this email.</p>
        </div>
      </div>`
    );

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({
        success: true,
        caseId: generatedCaseId,
        userId: finalUserId,
        case: sanitizeCaseForOwner(newCase),
        message: '✅ Report Submitted Successfully\n\nOur moderation team will review your report within 24–48 hours.\n\nStatus: Pending Review'
      });
    }

    res.render('report-fake-profile', {
      pageTitle: 'Report Fake Profile | Student Identity Shield',
      metaDescription: 'Report fake student social media profiles and impersonation accounts securely.',
      successMessage: '✅ Report Submitted Successfully\nOur moderation team will review your report within 24–48 hours.',
      caseId: generatedCaseId,
      errorMessage: null
    });
  } catch (routeErr) {
    console.error("Error processing report:", routeErr);
    return res.status(500).json({
      success: false,
      message: 'Server error processing your report. Please try again.'
    });
  }
});

// Moderation Audit Logs JSON persistence
const modLogsFilePath = path.join(__dirname, 'data', 'studentSafetyModerationLogs.json');
let studentSafetyModerationLogs = [];
try {
  if (fs.existsSync(modLogsFilePath)) {
    studentSafetyModerationLogs = JSON.parse(fs.readFileSync(modLogsFilePath, 'utf8'));
  }
} catch (e) {
  console.error("Could not load studentSafetyModerationLogs.json:", e);
}

function saveModerationLogs() {
  try {
    fs.writeFileSync(modLogsFilePath, JSON.stringify(studentSafetyModerationLogs, null, 2), 'utf8');
  } catch (e) {
    console.error("Could not save studentSafetyModerationLogs.json:", e);
  }
}

// Student Safety Notifications JSON persistence
const notificationsFilePath = path.join(__dirname, 'data', 'studentSafetyNotifications.json');
let studentSafetyNotifications = [];
try {
  if (fs.existsSync(notificationsFilePath)) {
    studentSafetyNotifications = JSON.parse(fs.readFileSync(notificationsFilePath, 'utf8'));
  }
} catch (e) {
  console.error("Could not load studentSafetyNotifications.json:", e);
}

function saveNotifications() {
  try {
    fs.writeFileSync(notificationsFilePath, JSON.stringify(studentSafetyNotifications, null, 2), 'utf8');
  } catch (e) {
    console.error("Could not save studentSafetyNotifications.json:", e);
  }
}

// Student Safety Supports JSON persistence
const supportsFilePath = path.join(__dirname, 'data', 'studentSafetySupports.json');
let studentSafetySupports = [];
try {
  if (fs.existsSync(supportsFilePath)) {
    studentSafetySupports = JSON.parse(fs.readFileSync(supportsFilePath, 'utf8'));
  }
} catch (e) {
  console.error("Could not load studentSafetySupports.json:", e);
}

function saveStudentSafetySupports() {
  try {
    fs.writeFileSync(supportsFilePath, JSON.stringify(studentSafetySupports, null, 2), 'utf8');
  } catch (e) {
    console.error("Could not save studentSafetySupports.json:", e);
  }
}

// Student Safety Notification Logs JSON persistence
const notifLogsFilePath = path.join(__dirname, 'data', 'studentSafetyNotificationLogs.json');
let studentSafetyNotificationLogs = [];
try {
  if (fs.existsSync(notifLogsFilePath)) {
    studentSafetyNotificationLogs = JSON.parse(fs.readFileSync(notifLogsFilePath, 'utf8'));
  }
} catch (e) {
  console.error("Could not load studentSafetyNotificationLogs.json:", e);
}

function saveNotificationLogs() {
  try {
    fs.writeFileSync(notifLogsFilePath, JSON.stringify(studentSafetyNotificationLogs, null, 2), 'utf8');
  } catch (e) {
    console.error("Could not save studentSafetyNotificationLogs.json:", e);
  }
}

// User Push Subscriptions JSON persistence
const pushSubsFilePath = path.join(__dirname, 'data', 'userPushSubscriptions.json');
let userPushSubscriptions = {};
try {
  if (fs.existsSync(pushSubsFilePath)) {
    userPushSubscriptions = JSON.parse(fs.readFileSync(pushSubsFilePath, 'utf8'));
  }
} catch (e) {
  console.error("Could not load userPushSubscriptions.json:", e);
}

function savePushSubscriptions() {
  try {
    fs.writeFileSync(pushSubsFilePath, JSON.stringify(userPushSubscriptions, null, 2), 'utf8');
  } catch (e) {
    console.error("Could not save userPushSubscriptions.json:", e);
  }
}

// Web Push VAPID Keys Setup
// Keys are persisted to disk so push subscribers don't break on restart
const vapidKeysFilePath = path.join(__dirname, 'data', 'vapidKeys.json');
let webpush = null;
let vapidKeys = null;
try {
  webpush = require('web-push');

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    // Use env vars if set (production)
    vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else if (fs.existsSync(vapidKeysFilePath)) {
    // Load persisted keys so subscribers don't break on restart
    vapidKeys = JSON.parse(fs.readFileSync(vapidKeysFilePath, 'utf8'));
    console.log('[WebPush] Loaded persisted VAPID keys from disk.');
  } else {
    // Generate fresh keys and persist them
    vapidKeys = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(vapidKeysFilePath, JSON.stringify(vapidKeys, null, 2), 'utf8');
    console.log('[WebPush] Generated and persisted new VAPID keys to disk.');
  }

  webpush.setVapidDetails(
    'mailto:safety@2amstudy.online',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
  console.log('[WebPush] VAPID keys loaded and web-push initialized successfully.');
} catch (e) {
  console.warn('[WebPush] Initialization notice:', e.message);
}

/**
 * Smart Notification Dispatcher (Push First, Email Fallback)
 * Priority 1: Web Push (if granted, token exists & pushEnabled !== false) -> STOP
 * Priority 2: Email (if push unavailable/failed & emailEnabled !== false) -> STOP
 * Never sends both Push and Email for the same event!
 */
async function dispatchSmartNotification({ userId, userEmail, caseId, title, message, targetUrl }) {
  if (!userId && !userEmail) return null;

  // Prevent duplicate notification for same user and case
  const existingLog = studentSafetyNotificationLogs.find(l => (l.userId === userId || l.userEmail === userEmail) && l.caseId === caseId && l.status !== 'failed');
  if (existingLog) {
    console.log(`[SmartNotif] Skip duplicate notification for user ${userId || userEmail} on case ${caseId}`);
    return existingLog;
  }

  const logId = 'NLOG-' + uuidv4().substring(0, 8).toUpperCase();
  const subData = userPushSubscriptions[userId] || userPushSubscriptions[userEmail] || {};
  const pushSub = subData.pushSubscription;
  const isPushEnabled = subData.pushEnabled !== false;
  const isEmailEnabled = subData.emailNotifications !== false;
  const isSafetyEnabled = subData.safetyAlerts !== false;

  if (!isSafetyEnabled) {
    console.log(`[SmartNotif] Safety alerts disabled for user ${userId}`);
    return null;
  }

  // Priority 1: Push Notification
  if (isPushEnabled && pushSub && webpush) {
    try {
      const payload = JSON.stringify({
        title: title || '🛡️ 2AM Student Safety Alert',
        body: message,
        icon: '/favicon.ico',
        url: targetUrl || `/student-safety#${caseId}`,
        notificationId: logId,
        caseId: caseId
      });
      await webpush.sendNotification(pushSub, payload);
      
      const log = {
        logId,
        userId: userId || 'anonymous',
        userEmail: userEmail || null,
        caseId,
        deliveryMethod: 'push',
        status: 'sent',
        sentAt: new Date().toISOString(),
        openedAt: null
      };
      studentSafetyNotificationLogs.unshift(log);
      saveNotificationLogs();
      console.log(`[SmartNotif] ✅ Push sent successfully to ${userId || userEmail} for case ${caseId}`);
      return log;
    } catch (pushErr) {
      console.warn(`[SmartNotif] ⚠️ Push failed for ${userId || userEmail}, falling back to email:`, pushErr.message);
    }
  }

  // Priority 2: Email Fallback (Only if Push was unavailable, disabled, or failed)
  if (isEmailEnabled && userEmail) {
    try {
      const emailHtml = `
        <div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
          <div style="text-align:center;margin-bottom:24px;">
            <span style="background:#d1fae5;color:#065f46;padding:6px 16px;border-radius:99px;font-size:12px;font-weight:700;">🛡️ STUDENT IDENTITY SHIELD</span>
          </div>
          <h2 style="color:#0f172a;margin-bottom:12px;text-align:center;">${title || 'Case Status Update'}</h2>
          <p style="color:#334155;font-size:15px;line-height:1.6;">${message}</p>
          <div style="text-align:center;margin-top:28px;">
            <a href="https://2amstudy.com${targetUrl || `/student-safety#${caseId}`}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 28px;border-radius:99px;font-weight:700;text-decoration:none;font-size:14px;">View Verified Case</a>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:32px;">You received this fallback email because Push Notifications were unreached or disabled.</p>
        </div>
      `;
      await sendSafetyEmail(userEmail, title || `[2AM Study] Case ${caseId} Verified ✅`, emailHtml);
      
      const log = {
        logId,
        userId: userId || 'anonymous',
        userEmail,
        caseId,
        deliveryMethod: 'email',
        status: 'sent',
        sentAt: new Date().toISOString(),
        openedAt: null
      };
      studentSafetyNotificationLogs.unshift(log);
      saveNotificationLogs();
      console.log(`[SmartNotif] 📧 Fallback email sent successfully to ${userEmail} for case ${caseId}`);
      return log;
    } catch (emailErr) {
      console.error(`[SmartNotif] ❌ Email fallback failed for ${userEmail}:`, emailErr.message);
    }
  }

  // If both failed
  const failedLog = {
    logId,
    userId: userId || 'anonymous',
    userEmail: userEmail || null,
    caseId,
    deliveryMethod: pushSub ? 'push' : 'email',
    status: 'failed',
    sentAt: new Date().toISOString(),
    openedAt: null
  };
  studentSafetyNotificationLogs.unshift(failedLog);
  saveNotificationLogs();
  return failedLog;
}

// Admin Moderation Dashboard View — redirects to unified Master Admin
app.get('/student-safety/admin', (req, res) => {
  res.redirect('/admin#tab-safety');
});

// Admin Moderation Action Endpoint
app.post('/api/student-safety/admin/moderate', (req, res) => {
  const { caseId, action, note, moderatorUid, moderatorName } = req.body;

  // Check auth: requires authenticated admin session
  const isAuthed = isMasterAdminAuthenticated(req);
  if (!isAuthed) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin authentication required.' });
  }
  if (!caseId || !action) {
    return res.status(400).json({ success: false, message: 'caseId and action are required.' });
  }

  const caseIndex = studentSafetyCases.findIndex(c => c.caseId === caseId);
  if (caseIndex === -1) {
    return res.status(404).json({ success: false, message: `Case ${caseId} not found.` });
  }

  const targetCase = studentSafetyCases[caseIndex];
  const previousStatus = targetCase.status;
  const modUser = moderatorUid;
  const modName = moderatorName || 'Admin';
  let newStatus = targetCase.status;
  let notificationMsg = '';

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  if (action === 'approve') {
    newStatus = 'Verified';
    targetCase.status = newStatus;
    targetCase.verifiedBy = modUser;
    targetCase.verifiedByName = modName;
    targetCase.verifiedAt = new Date().toISOString();
    targetCase.updatedAt = new Date().toISOString();
    notificationMsg = `Your impersonation report (Case ${caseId}) has been approved & verified by our moderation team.`;
  } else if (action === 'reject') {
    if (!note || note.trim() === '') {
      return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }
    newStatus = 'Rejected';
    targetCase.status = newStatus;
    targetCase.rejectionReason = note.trim();
    targetCase.rejectedBy = modUser;
    targetCase.rejectedAt = new Date().toISOString();
    targetCase.updatedAt = new Date().toISOString();
    notificationMsg = `Your impersonation report (Case ${caseId}) was reviewed and rejected. Reason: ${targetCase.rejectionReason}`;
  } else if (action === 'request_evidence') {
    if (!note || note.trim() === '') {
      return res.status(400).json({ success: false, message: 'A moderator note describing required evidence is required.' });
    }
    newStatus = 'Needs Evidence';
    targetCase.status = newStatus;
    targetCase.moderatorNote = note.trim();
    targetCase.updatedAt = new Date().toISOString();
    notificationMsg = `Action required on Case ${caseId}: Our moderation team requested additional evidence. Note: ${targetCase.moderatorNote}`;
  } else if (action === 'resolve') {
    newStatus = 'Resolved';
    targetCase.status = newStatus;
    targetCase.resolvedBy = modUser;
    targetCase.resolvedAt = new Date().toISOString();
    targetCase.updatedAt = new Date().toISOString();
    notificationMsg = `Great news! Case ${caseId} has been officially marked as resolved. Thank you for keeping 2AM Study safe.`;
  } else if (action === 'reopen') {
    newStatus = 'Pending Review';
    targetCase.status = newStatus;
    targetCase.updatedAt = new Date().toISOString();
    notificationMsg = `Case ${caseId} has been reopened for moderation review.`;
  } else if (action === 'merge') {
    // Merge: sourceCaseId evidence + supportCount merged into this case
    const { sourceCaseId } = req.body;
    if (!sourceCaseId) return res.status(400).json({ success: false, message: 'sourceCaseId required for merge action.' });
    const sourceIdx = studentSafetyCases.findIndex(c => c.caseId === sourceCaseId);
    if (sourceIdx === -1) return res.status(404).json({ success: false, message: `Source case ${sourceCaseId} not found.` });
    const sourceCase = studentSafetyCases[sourceIdx];

    // Merge evidence arrays
    if (Array.isArray(sourceCase.evidence)) {
      targetCase.evidence = [...(targetCase.evidence || []), ...sourceCase.evidence];
    }
    // Add support counts
    targetCase.supportCount = (targetCase.supportCount || 0) + (sourceCase.supportCount || 0);
    targetCase.mergedFrom = [...(targetCase.mergedFrom || []), sourceCaseId];
    targetCase.updatedAt = new Date().toISOString();

    // Remove source case
    studentSafetyCases.splice(sourceIdx, 1);
    saveStudentSafetyCases();

    const mergeLog = {
      logId: 'LOG-' + uuidv4().substring(0, 8).toUpperCase(),
      caseId,
      sourceCaseId,
      moderatorUid: modUser,
      moderatorName: modName,
      action: 'merge',
      previousStatus,
      newStatus: targetCase.status,
      reason: note || `Merged case ${sourceCaseId} into ${caseId}`,
      ip,
      userAgent,
      createdAt: new Date().toISOString()
    };
    studentSafetyModerationLogs.unshift(mergeLog);
    saveModerationLogs();

    return res.json({ success: true, caseId, status: targetCase.status, case: targetCase, message: `Case ${sourceCaseId} merged into ${caseId}.` });
  } else if (action === 'delete') {
    studentSafetyCases.splice(caseIndex, 1);
    saveStudentSafetyCases();

    const modLog = {
      logId: 'LOG-' + uuidv4().substring(0, 8).toUpperCase(),
      caseId,
      moderatorUid: modUser,
      moderatorName: modName,
      action: 'delete',
      previousStatus,
      newStatus: 'Deleted',
      reason: note || 'Case deleted by admin',
      ip,
      userAgent,
      createdAt: new Date().toISOString()
    };
    studentSafetyModerationLogs.unshift(modLog);
    saveModerationLogs();

    return res.json({ success: true, caseId, status: 'Deleted', message: `Case ${caseId} has been permanently deleted.` });
  } else {
    return res.status(400).json({ success: false, message: 'Invalid moderation action.' });
  }

  saveStudentSafetyCases();

  // Full audit log
  const modLog = {
    logId: 'LOG-' + uuidv4().substring(0, 8).toUpperCase(),
    caseId,
    moderatorUid: modUser,
    moderatorName: modName,
    action,
    previousStatus,
    newStatus,
    reason: note || (action + ' action executed'),
    ip,
    userAgent,
    createdAt: new Date().toISOString()
  };
  studentSafetyModerationLogs.unshift(modLog);
  saveModerationLogs();

  // Reporter notifications
  const notifTypeMap = {
    approve: 'success', reject: 'error', request_evidence: 'warning',
    resolve: 'success', reopen: 'info'
  };
  const notifTitleMap = {
    approve: '✅ Report Approved & Verified',
    reject: '❌ Report Rejected',
    request_evidence: '📩 More Evidence Needed',
    resolve: '🎉 Case Resolved',
    reopen: '🔄 Case Reopened'
  };

  if (targetCase.userId) {
    const notif = {
      notificationId: 'NOTIF-' + uuidv4().substring(0, 8).toUpperCase(),
      userId: targetCase.userId,
      caseId,
      title: notifTitleMap[action] || 'Case Update',
      type: notifTypeMap[action] || 'info',
      message: notificationMsg,
      isRead: false,
      read: false,
      createdAt: new Date().toISOString()
    };
    studentSafetyNotifications.unshift(notif);
    saveNotifications();

    const emailTemplates = {
      approve: { subject: `[2AM Study] Case ${caseId} Verified ✅`, body: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;"><h2 style="color:#16a34a;">✅ Your report has been verified!</h2><p>Case <strong>${caseId}</strong> has been reviewed and approved by our moderation team. It is now publicly visible for community support.</p><a href="https://2amstudy.online/student-safety/cases/${caseId}" style="display:inline-block;background:#1e40af;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px;">View Your Case</a><p style="color:#64748b;font-size:13px;margin-top:24px;">Thank you for making 2AM Study safer.</p></div>` },
      reject: { subject: `[2AM Study] Case ${caseId} Update`, body: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;"><h2 style="color:#dc2626;">Case Review Update</h2><p>Case <strong>${caseId}</strong> could not be verified at this time.</p><p><strong>Reason:</strong> ${note || 'Insufficient evidence'}</p><p>If you believe this is an error, you may submit a new report with additional evidence.</p></div>` },
      request_evidence: { subject: `[2AM Study] Action Required — Case ${caseId}`, body: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;"><h2 style="color:#d97706;">📩 Additional Evidence Required</h2><p>Our team is reviewing Case <strong>${caseId}</strong> and needs more information to proceed.</p><p><strong>Moderator Note:</strong> ${note || 'Please provide additional proof or ID verification.'}</p></div>` },
      resolve: { subject: `[2AM Study] Case ${caseId} Resolved 🎉`, body: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;"><h2 style="color:#16a34a;">🎉 Case Resolved!</h2><p>Great news! Case <strong>${caseId}</strong> has been officially resolved. Thank you for helping keep 2AM Study safe.</p></div>` }
    };

    if (action === 'approve') {
      // 1. Notify the reporter — Smart Notification (Push First, Email Fallback)
      dispatchSmartNotification({
        userId: targetCase.userId,
        userEmail: targetCase.reporterEmail,
        caseId,
        title: `[2AM Study] Case ${caseId} Verified ✅`,
        message: `Your report for ${targetCase.fakeUsername || 'fake profile'} has been verified by our moderation team.`,
        targetUrl: `/student-safety/cases/${caseId}`
      });

      // 2. Notify all supporters — In-app notification + Email
      const approveSupport = studentSafetySupports.filter(s => s.caseId === caseId);
      approveSupport.forEach(supporter => {
        // Skip if supporter is the reporter themselves
        if (supporter.userId === targetCase.userId) return;

        // In-app notification
        studentSafetyNotifications.unshift({
          notificationId: 'NOTIF-' + uuidv4().substring(0, 8).toUpperCase(),
          userId: supporter.userId,
          caseId,
          title: '✅ Case You Supported is Now Verified!',
          type: 'success',
          message: `Great news! A case you supported (${caseId}) about a fake ${targetCase.platform || 'social media'} account (@${targetCase.fakeUsername || 'unknown'}) has been officially verified by our moderation team. Visit the case page to help spread awareness!`,
          isRead: false,
          read: false,
          createdAt: new Date().toISOString()
        });

        // Email notification to supporter
        if (supporter.userEmail) {
          sendSafetyEmail(
            supporter.userEmail,
            `✅ Case You Supported is Verified — Help Spread the Word! | 2AM Study`,
            `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:0;">
              <!-- Header -->
              <div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:28px 32px;border-radius:12px 12px 0 0;">
                <div style="color:#bbf7d0;font-size:13px;font-weight:600;letter-spacing:0.05em;margin-bottom:6px;">🛡️ STUDENT IDENTITY SHIELD — CASE UPDATE</div>
                <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:800;">✅ Case Verified — Action Needed!</h1>
                <div style="color:#86efac;font-size:13px;margin-top:6px;">A case you supported has been officially verified</div>
              </div>

              <!-- Body -->
              <div style="background:#ffffff;padding:28px 32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
                <p style="color:#334155;font-size:15px;line-height:1.7;margin-top:0;">Hi there 👋</p>
                <p style="color:#334155;font-size:15px;line-height:1.7;">A fake profile report you supported on <strong>2AM Study Student Safety</strong> has just been <strong style="color:#16a34a;">officially verified</strong> by our moderation team!</p>

                <!-- Case Summary Card -->
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:20px 0;">
                  <table style="width:100%;border-collapse:collapse;">
                    <tr style="border-bottom:1px solid #dcfce7;"><td style="padding:8px 0;color:#64748b;font-size:13px;font-weight:600;width:40%;">Case ID</td><td style="padding:8px 0;color:#0f172a;font-size:13px;font-weight:700;font-family:monospace;">${caseId}</td></tr>
                    <tr style="border-bottom:1px solid #dcfce7;"><td style="padding:8px 0;color:#64748b;font-size:13px;font-weight:600;">Platform</td><td style="padding:8px 0;color:#0f172a;font-size:13px;font-weight:700;">${targetCase.platform || 'Social Media'}</td></tr>
                    <tr style="border-bottom:1px solid #dcfce7;"><td style="padding:8px 0;color:#64748b;font-size:13px;font-weight:600;">Fake Account</td><td style="padding:8px 0;color:#dc2626;font-size:13px;font-weight:700;">@${targetCase.fakeUsername || 'unknown'}</td></tr>
                    <tr style="border-bottom:1px solid #dcfce7;"><td style="padding:8px 0;color:#64748b;font-size:13px;font-weight:600;">Fake Profile Link</td><td style="padding:8px 0;"><a href="${targetCase.fakeProfileUrl}" target="_blank" style="color:#dc2626;word-break:break-all;font-weight:700;font-size:13px;">${targetCase.fakeProfileUrl}</a></td></tr>
                    <tr><td style="padding:8px 0;color:#64748b;font-size:13px;font-weight:600;">Status</td><td style="padding:8px 0;"><span style="background:#16a34a;color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">✅ Verified</span></td></tr>
                  </table>
                </div>

                <!-- How to Help Section -->
                <div style="background:#fffbeb;border:1px solid #fef08a;border-radius:12px;padding:20px;margin:20px 0;">
                  <div style="font-weight:800;color:#92400e;font-size:14px;margin-bottom:12px;">🚀 Quick Action — Take Down the Fake Profile</div>
                  <ul style="margin:0;padding-left:20px;color:#78350f;font-size:13px;line-height:2;">
                    <li><strong>Step 1:</strong> Click the red button below to open the fake profile directly on <strong>${targetCase.platform || 'the platform'}</strong> and report it.</li>
                    <li><strong>Step 2:</strong> Click <strong>View Case on 2AM Study</strong> to see verified evidence and boost its community support count.</li>
                    <li><strong>Step 3:</strong> Share the case link with friends to help take down the impersonator quickly.</li>
                  </ul>
                </div>

                <p style="color:#64748b;font-size:13px;line-height:1.6;">Every report submitted on ${targetCase.platform || 'the social platform'} brings the victim one step closer to getting the fake account deleted. Thank you for protecting fellow students! 🛡️</p>
              </div>

              <!-- CTA Buttons -->
              <div style="background:#f8fafc;padding:24px 20px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
                <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:10px;">
                  <a href="${targetCase.fakeProfileUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#ffffff;padding:14px 24px;border-radius:50px;text-decoration:none;font-weight:700;font-size:14px;">
                    🚨 Open & Report on ${targetCase.platform || 'Platform'} →
                  </a>
                  <a href="https://2amstudy.online/student-safety/cases/${caseId}" style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;padding:14px 24px;border-radius:50px;text-decoration:none;font-weight:700;font-size:14px;">
                    🔍 View Case on 2AM Study
                  </a>
                </div>
                <div style="margin-top:14px;">
                  <a href="https://2amstudy.online/student-safety/cases" style="color:#2563eb;font-size:13px;text-decoration:none;">Browse All Active Cases →</a>
                </div>
              </div>

              <!-- Footer -->
              <div style="background:#1e293b;padding:16px 32px;border-radius:0 0 12px 12px;text-align:center;">
                <p style="color:#64748b;font-size:12px;margin:0;">2AM Study · Student Identity Shield · Community Notifications<br>You received this because you supported this case. <a href="https://2amstudy.online/settings" style="color:#475569;">Manage notification preferences</a></p>
              </div>
            </div>`
          );
        }
      });
      saveNotifications();

    } else if (emailTemplates[action]) {
      sendSafetyEmail(targetCase.reporterEmail || null, emailTemplates[action].subject, emailTemplates[action].body);
    }

    if (action === 'resolve' || action === 'reject') {
      const supporters = studentSafetySupports.filter(s => s.caseId === caseId);
      supporters.forEach(supporter => {
        if (supporter.userId === targetCase.userId) return;
        studentSafetyNotifications.unshift({
          notificationId: 'NOTIF-' + uuidv4().substring(0, 8).toUpperCase(),
          userId: supporter.userId,
          caseId,
          title: action === 'resolve' ? '🎉 Supported Case Resolved' : '❌ Supported Case Closed',
          type: action === 'resolve' ? 'success' : 'info',
          message: action === 'resolve'
            ? `A case you supported (${caseId}) has been officially resolved. Thank you for your community support!`
            : `A case you supported (${caseId}) has been reviewed and closed.`,
          isRead: false, read: false,
          createdAt: new Date().toISOString()
        });
      });
      saveNotifications();
    }
  }

  return res.json({
    success: true,
    caseId: targetCase.caseId,
    status: targetCase.status,
    case: targetCase,
    message: `Case ${caseId} successfully updated to status "${targetCase.status}".`
  });
});

// VAPID Public Key API
app.get('/api/student-safety/vapid-public-key', (req, res) => {
  res.json({ success: true, publicKey: vapidKeys ? vapidKeys.publicKey : null });
});

// Save Push Subscription & Preferences API
app.post('/api/student-safety/save-push-token', (req, res) => {
  const { userId, userEmail, pushSubscription, pushEnabled, emailNotifications, safetyAlerts } = req.body;
  const key = userId || userEmail;
  if (!key) return res.status(400).json({ success: false, message: 'userId or userEmail required.' });

  userPushSubscriptions[key] = {
    userId: userId || null,
    userEmail: userEmail || null,
    pushSubscription: pushSubscription || (userPushSubscriptions[key] ? userPushSubscriptions[key].pushSubscription : null),
    pushEnabled: pushEnabled !== undefined ? pushEnabled : true,
    emailNotifications: emailNotifications !== undefined ? emailNotifications : true,
    safetyAlerts: safetyAlerts !== undefined ? safetyAlerts : true,
    updatedAt: new Date().toISOString()
  };
  savePushSubscriptions();
  res.json({ success: true, message: 'Notification preferences & push token saved cleanly.' });
});

// Test Push Notification API
app.post('/api/student-safety/test-push', async (req, res) => {
  const { pushSubscription, userId, userEmail } = req.body;
  if (!pushSubscription || !pushSubscription.endpoint) {
    return res.status(400).json({ success: false, message: 'Valid push subscription object required.' });
  }
  if (!webpush) {
    return res.status(500).json({ success: false, message: 'Web push module is not initialized on server.' });
  }

  try {
    const payload = JSON.stringify({
      title: '🧪 2AM Study Push Test',
      body: 'Success! Web Push notifications (Priority 1) are active on this device.',
      icon: '/favicon.ico',
      url: '/settings',
      notificationId: 'TEST-' + Date.now()
    });
    await webpush.sendNotification(pushSubscription, payload);
    res.json({ success: true, message: 'Test push notification sent successfully!' });
  } catch (err) {
    console.error('Test push send error:', err);
    res.status(500).json({ success: false, message: 'Failed to send test push: ' + err.message });
  }
});

// Notification Click/Open Tracking API
app.post('/api/student-safety/notifications/:id/open', (req, res) => {
  const { id } = req.params;
  const log = studentSafetyNotificationLogs.find(l => l.logId === id || l.notificationId === id);
  if (log) {
    log.status = 'opened';
    log.openedAt = new Date().toISOString();
    saveNotificationLogs();
  }
  res.json({ success: true, message: 'Notification click recorded.' });
});

// Admin Notification System Analytics API
app.get('/api/student-safety/admin/notification-analytics', (req, res) => {
  const total = studentSafetyNotificationLogs.length;
  const pushSent = studentSafetyNotificationLogs.filter(l => l.deliveryMethod === 'push' && (l.status === 'sent' || l.status === 'opened')).length;
  const emailSent = studentSafetyNotificationLogs.filter(l => l.deliveryMethod === 'email' && (l.status === 'sent' || l.status === 'opened')).length;
  const failed = studentSafetyNotificationLogs.filter(l => l.status === 'failed').length;
  const opened = studentSafetyNotificationLogs.filter(l => l.status === 'opened').length;
  const sentTotal = pushSent + emailSent;
  const openRate = sentTotal > 0 ? Math.round((opened / sentTotal) * 100) : 0;

  res.json({
    success: true,
    total,
    pushSent,
    emailSent,
    failed,
    opened,
    openRate: `${openRate}%`,
    logs: studentSafetyNotificationLogs.slice(0, 50)
  });
});

// Bulk Moderation Endpoint
app.post('/api/student-safety/admin/moderate/bulk', (req, res) => {
  const { caseIds, action, note, moderatorUid, moderatorName } = req.body;
  if (!moderatorUid || moderatorUid.trim() === '' || moderatorUid === 'ADMIN-MODERATOR') {
    return res.status(401).json({ success: false, message: 'Unauthorized. Valid moderator UID required.' });
  }
  if (!Array.isArray(caseIds) || caseIds.length === 0 || !action) {
    return res.status(400).json({ success: false, message: 'caseIds (array) and action are required.' });
  }
  if ((action === 'reject') && (!note || note.trim() === '')) {
    return res.status(400).json({ success: false, message: 'Rejection reason is required for bulk reject.' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const results = [];

  const statusMap = {
    approve: 'Verified', reject: 'Rejected',
    request_evidence: 'Needs Evidence', resolve: 'Resolved',
    reopen: 'Pending Review'
  };

  caseIds.forEach(caseId => {
    const idx = studentSafetyCases.findIndex(c => c.caseId === caseId);
    if (idx === -1) { results.push({ caseId, success: false, message: 'Not found' }); return; }

    if (action === 'delete') {
      const prevStatus = studentSafetyCases[idx].status;
      studentSafetyCases.splice(idx, 1);
      studentSafetyModerationLogs.unshift({
        logId: 'LOG-' + uuidv4().substring(0, 8).toUpperCase(),
        caseId, moderatorUid, moderatorName: moderatorName || 'Admin',
        action: 'delete', previousStatus: prevStatus, newStatus: 'Deleted',
        reason: note || 'Bulk delete by admin', ip, userAgent,
        createdAt: new Date().toISOString()
      });
      results.push({ caseId, success: true, status: 'Deleted' });
    } else {
      const tc = studentSafetyCases[idx];
      const prevStatus = tc.status;
      const newStatus = statusMap[action] || tc.status;
      tc.status = newStatus;
      tc.updatedAt = new Date().toISOString();
      if (action === 'reject') tc.rejectionReason = note;
      if (action === 'request_evidence') tc.moderatorNote = note || '';
      studentSafetyModerationLogs.unshift({
        logId: 'LOG-' + uuidv4().substring(0, 8).toUpperCase(),
        caseId, moderatorUid, moderatorName: moderatorName || 'Admin',
        action, previousStatus: prevStatus, newStatus,
        reason: note || (action + ' bulk action'), ip, userAgent,
        createdAt: new Date().toISOString()
      });
      results.push({ caseId, success: true, status: newStatus });
    }
  });

  saveStudentSafetyCases();
  saveModerationLogs();

  return res.json({ success: true, processed: results.length, results, message: `Bulk ${action} completed on ${results.length} cases.` });
});

// Admin Stats Endpoint
app.get('/api/student-safety/admin/stats', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const todayCount = studentSafetyCases.filter(c => c.createdAt && c.createdAt.startsWith(today)).length;
  res.json({
    success: true,
    total: studentSafetyCases.length,
    pending: studentSafetyCases.filter(c => c.status === 'Pending Review').length,
    needsEvidence: studentSafetyCases.filter(c => c.status === 'Needs Evidence').length,
    verified: studentSafetyCases.filter(c => c.status === 'Verified').length,
    rejected: studentSafetyCases.filter(c => c.status === 'Rejected').length,
    resolved: studentSafetyCases.filter(c => c.status === 'Resolved').length,
    today: todayCount
  });
});

// Admin CSV Export Endpoint
app.get('/api/student-safety/admin/export-csv', (req, res) => {
  const headers = ['caseId','platform','fakeUsername','fakeProfileUrl','realProfileUrl','reason','description','college','status','anonymous','supportCount','createdAt','updatedAt','rejectionReason','moderatorNote'];
  const rows = studentSafetyCases.map(c =>
    headers.map(h => {
      const val = c[h] !== undefined ? String(c[h]).replace(/"/g, '""') : '';
      return `"${val}"`;
    }).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="student-safety-cases-${new Date().toISOString().split('T')[0]}.csv"`);
  res.send(csv);
});

app.get('/api/student-safety/moderation-logs', (req, res) => {
  res.json({ success: true, logs: studentSafetyModerationLogs });
});

// Secure Authenticated Endpoint: My Reports (Cross-device, UID-first)
app.get('/api/student-safety/my-reports', verifyFirebaseToken, (req, res) => {
  const authUid = req.firebaseUid;
  const authEmail = (req.firebaseEmail || '').toLowerCase().trim();

  if (!authUid && !authEmail) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please log in to view your reports.'
    });
  }

  // Filter cases belonging strictly to the authenticated Firebase user
  const userCases = studentSafetyCases
    .filter(c => {
      const uidMatch = c.userId && authUid && c.userId === authUid;
      const emailMatch = authEmail && c.reporterEmail && c.reporterEmail.toLowerCase().trim() === authEmail;
      return uidMatch || emailMatch;
    })
    .map(c => sanitizeCaseForOwner(c))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({
    success: true,
    count: userCases.length,
    cases: userCases
  });
});

// Admin: ALL cases (every status) — used by admin dashboard
app.get('/api/student-safety/cases', (req, res) => {
  const cases = studentSafetyCases
    .slice() // copy
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, cases });
});


app.get('/api/student-safety/notifications/:userId', (req, res) => {
  const userNotifs = studentSafetyNotifications
    .filter(n => n.userId === req.params.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const unreadCount = userNotifs.filter(n => !(n.isRead || n.read)).length;
  res.json({ success: true, notifications: userNotifs, unreadCount });
});

// Step 5: Mark single notification as read
app.post('/student-safety/notifications/:notifId/read', (req, res) => {
  const { notifId } = req.params;
  const { userId } = req.body;
  const notif = studentSafetyNotifications.find(n => n.notificationId === notifId && n.userId === userId);
  if (!notif) return res.status(404).json({ success: false, message: 'Notification not found.' });
  notif.isRead = true;
  notif.read = true;
  saveNotifications();
  res.json({ success: true, message: 'Notification marked as read.' });
});

// Step 5: Mark all notifications as read for a user
app.post('/student-safety/notifications/read-all', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ success: false, message: 'userId is required.' });
  let count = 0;
  studentSafetyNotifications.forEach(n => {
    if (n.userId === userId && !(n.isRead || n.read)) {
      n.isRead = true;
      n.read = true;
      count++;
    }
  });
  saveNotifications();
  res.json({ success: true, markedCount: count, message: `${count} notifications marked as read.` });
});

// Step 5: Notifications Page Route
app.get('/student-safety/notifications', (req, res) => {
  res.render('notifications', {
    pageTitle: '🔔 Notifications | Student Identity Shield',
    metaDescription: 'View your Student Safety notifications — case updates, verifications, and status changes.'
  });
});

// Step 5: Trust Score + Badges API
app.get('/api/student-safety/trust-score/:userId', (req, res) => {
  const { userId } = req.params;
  const userCases = studentSafetyCases.filter(c => c.userId === userId);
  const verifiedCases = userCases.filter(c => c.status === 'Verified' || c.status === 'Resolved');
  const supportsGiven = studentSafetySupports.filter(s => s.userId === userId).length;
  const totalReports = userCases.length;

  const score = Math.min(100,
    10 + // base
    (verifiedCases.length * 20) +
    (supportsGiven * 2) +
    (totalReports * 5)
  );

  const badges = [];
  if (totalReports >= 1) badges.push({ id: 'student_protector', label: 'Student Protector', icon: '🎖️', desc: 'Submitted at least 1 report' });
  if (verifiedCases.length >= 1) badges.push({ id: 'cyber_guardian', label: 'Cyber Guardian', icon: '🛡️', desc: 'Has at least 1 verified report' });
  if (supportsGiven >= 5) badges.push({ id: 'top_contributor', label: 'Top Contributor', icon: '⭐', desc: 'Supported 5+ community cases' });
  if (score >= 75) badges.push({ id: 'trusted_reporter', label: 'Trusted Reporter', icon: '🏆', desc: 'Trust score of 75 or above' });

  res.json({
    success: true,
    userId,
    trustScore: score,
    totalReports,
    verifiedReports: verifiedCases.length,
    supportsGiven,
    badges
  });
});

// Step 5: Leaderboard API (top 10 contributors)
app.get('/api/student-safety/leaderboard', (req, res) => {
  // Aggregate per userId
  const map = new Map();

  studentSafetyCases.forEach(c => {
    const uid = c.userId;
    if (!uid) return;
    if (!map.has(uid)) map.set(uid, { userId: uid, totalReports: 0, verifiedReports: 0, supportsGiven: 0 });
    const entry = map.get(uid);
    entry.totalReports++;
    if (c.status === 'Verified' || c.status === 'Resolved') entry.verifiedReports++;
  });

  studentSafetySupports.forEach(s => {
    const uid = s.userId;
    if (!uid) return;
    if (!map.has(uid)) map.set(uid, { userId: uid, totalReports: 0, verifiedReports: 0, supportsGiven: 0 });
    map.get(uid).supportsGiven++;
  });

  const leaderboard = Array.from(map.values())
    .map(entry => ({
      ...entry,
      score: Math.min(100, 10 + (entry.verifiedReports * 20) + (entry.supportsGiven * 2) + (entry.totalReports * 5)),
      displayId: 'Student ' + entry.userId.substring(entry.userId.length - 4).toUpperCase()
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  res.json({ success: true, leaderboard });
});

// Community Cases Page (Verified Only - Step 4)
app.get('/student-safety/cases', (req, res) => {
  res.render('active-cases', {
    pageTitle: '🛡️ Active Community Cases | Student Identity Shield',
    metaDescription: 'Browse admin-verified student impersonation cases. Support affected students and help eliminate fake social media profiles.'
  });
});

// Individual Case Detail Page (Verified Only - Step 4)
app.get('/student-safety/cases/:caseId', (req, res) => {
  const { caseId } = req.params;
  const foundCase = studentSafetyCases.find(c => c.caseId === caseId && (c.status === 'Verified' || c.status === 'Resolved'));

  if (!foundCase) {
    return res.status(404).render('student-safety', {
      pageTitle: 'Case Not Found | Student Identity Shield',
      metaDescription: 'This case was not found or is not publicly available.',
      activeTab: 'overview'
    });
  }

  // Never expose reporter identity — just pass anonymous flag
  const publicCase = {
    caseId: foundCase.caseId,
    platform: foundCase.platform,
    fakeUsername: foundCase.fakeUsername,
    fakeProfileUrl: foundCase.fakeProfileUrl,
    realProfileUrl: foundCase.realProfileUrl || '',
    reason: foundCase.reason,
    description: foundCase.description,
    college: foundCase.college || '',
    evidence: foundCase.evidence || [],
    anonymous: foundCase.anonymous,
    status: foundCase.status,
    supportCount: foundCase.supportCount || 0,
    createdAt: foundCase.createdAt,
    updatedAt: foundCase.updatedAt
    // NOTE: userId, email, name intentionally omitted for privacy
  };

  res.render('case-detail', {
    pageTitle: `Case ${foundCase.caseId} | Student Identity Shield`,
    metaDescription: `Admin-verified impersonation case on ${foundCase.platform} for a ${foundCase.college || 'verified student'}. Support this case to help eliminate fake profiles.`,
    caseData: publicCase
  });
});

// Support a Case (Logged-in users only, one support per user per case - Step 4)
app.post('/student-safety/cases/:caseId/support', async (req, res) => {
  const { caseId } = req.params;
  const { userId, userEmail } = req.body;

  if (!userId) {
    return res.status(401).json({ success: false, message: 'You must be logged in to support a case.' });
  }

  const caseIndex = studentSafetyCases.findIndex(c => c.caseId === caseId && (c.status === 'Verified' || c.status === 'Resolved'));
  if (caseIndex === -1) {
    return res.status(404).json({ success: false, message: 'Case not found or not publicly available.' });
  }

  // Duplicate support check
  const alreadySupported = studentSafetySupports.find(s => s.caseId === caseId && s.userId === userId);
  if (alreadySupported) {
    return res.status(409).json({
      success: false,
      isDuplicate: true,
      message: 'You have already supported this case.',
      supportCount: studentSafetyCases[caseIndex].supportCount || 0
    });
  }

  // Create support record — also save userEmail so we can notify on case updates
  const supportRecord = {
    supportId: 'SUPPORT-' + uuidv4().substring(0, 8).toUpperCase(),
    caseId: caseId,
    userId: userId,
    userEmail: userEmail || null,
    createdAt: new Date().toISOString()
  };

  studentSafetySupports.push(supportRecord);
  saveStudentSafetySupports();

  // Increment supportCount on case document
  studentSafetyCases[caseIndex].supportCount = (studentSafetyCases[caseIndex].supportCount || 0) + 1;
  studentSafetyCases[caseIndex].updatedAt = new Date().toISOString();
  saveStudentSafetyCases();

  // ── Trust Score Boost ──
  // Each support action gives +2 trust score (capped at 100)
  // Also checks if a new badge has been unlocked
  const TRUST_BOOST = 2;
  let newTrustScore = null;
  let newBadge = null;

  try {
    if (firestoreDb) {
      const userRef = firestoreDb.collection('users').doc(userId);
      const userSnap = await userRef.get();

      // Recalculate score dynamically from all activity
      const userCases = studentSafetyCases.filter(c => c.userId === userId);
      const verifiedCases = userCases.filter(c => c.status === 'Verified' || c.status === 'Resolved');
      const allSupports = studentSafetySupports.filter(s => s.userId === userId).length; // includes the one just added
      const totalReports = userCases.length;

      const oldScore = userSnap.exists() ? (userSnap.data().trustScore || 0) : 0;
      newTrustScore = Math.min(100,
        10 +
        (verifiedCases.length * 20) +
        (allSupports * TRUST_BOOST) +
        (totalReports * 5)
      );

      // Check if a new badge was just unlocked
      const oldSupports = allSupports - 1; // before this support
      if (oldSupports < 5 && allSupports >= 5) {
        newBadge = { id: 'top_contributor', label: 'Top Contributor', icon: '⭐', desc: 'Supported 5+ community cases' };
      }
      if (oldScore < 75 && newTrustScore >= 75) {
        newBadge = { id: 'trusted_reporter', label: 'Trusted Reporter', icon: '🏆', desc: 'Trust score of 75 or above' };
      }

      // Update Firestore
      await userRef.set({ trustScore: newTrustScore }, { merge: true });
    }
  } catch (tsErr) {
    console.warn('[TrustScore] Could not update trust score for user', userId, tsErr.message);
  }

  // ── In-app notification for trust score increase ──
  const trustNotifMsg = newBadge
    ? `🎉 Your trust score increased to ${newTrustScore}/100! You also unlocked a new badge: ${newBadge.icon} ${newBadge.label}!`
    : `⬆️ Your trust score increased by +${TRUST_BOOST} points for supporting a verified case! New score: ${newTrustScore || '?'}/100.`;

  studentSafetyNotifications.unshift({
    notificationId: 'NOTIF-' + uuidv4().substring(0, 8).toUpperCase(),
    userId,
    caseId,
    title: newBadge ? `🏅 New Badge + Trust Score Up!` : `⬆️ Trust Score Increased!`,
    type: 'success',
    message: trustNotifMsg,
    isRead: false,
    read: false,
    createdAt: new Date().toISOString()
  });
  saveNotifications();

  return res.json({
    success: true,
    supportCount: studentSafetyCases[caseIndex].supportCount,
    trustScore: newTrustScore,
    newBadge: newBadge || null,
    message: `✅ Thank you! You supported this case.${newTrustScore ? ` Your trust score is now ${newTrustScore}/100.` : ''}`
  });
});

// Public Cases API (Verified & Resolved cases only, with search & sort - Step 4)
app.get('/api/student-safety/public-cases', (req, res) => {
  const { platform, college, sortBy, query } = req.query;

  let publicCases = studentSafetyCases
    .filter(c => c.status === 'Verified' || c.status === 'Resolved')
    .map(c => ({
      caseId: c.caseId,
      platform: c.platform,
      fakeUsername: c.fakeUsername,
      fakeProfileUrl: c.fakeProfileUrl,
      realProfileUrl: c.realProfileUrl || '',
      reason: c.reason,
      description: c.description,
      college: c.college || '',
      anonymous: c.anonymous,
      status: c.status,
      supportCount: c.supportCount || 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
      // userId/email omitted for privacy
    }));

  if (platform && platform !== 'ALL') {
    publicCases = publicCases.filter(c => c.platform === platform);
  }

  if (college && college !== 'ALL') {
    publicCases = publicCases.filter(c => c.college === college);
  }

  if (query) {
    const q = query.toLowerCase();
    publicCases = publicCases.filter(c =>
      (c.fakeUsername || '').toLowerCase().includes(q) ||
      (c.college || '').toLowerCase().includes(q) ||
      (c.caseId || '').toLowerCase().includes(q)
    );
  }

  if (sortBy === 'most_supported') {
    publicCases.sort((a, b) => (b.supportCount || 0) - (a.supportCount || 0));
  } else if (sortBy === 'newest') {
    publicCases.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else if (sortBy === 'recently_verified') {
    publicCases.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  } else {
    // Default: most supported
    publicCases.sort((a, b) => (b.supportCount || 0) - (a.supportCount || 0));
  }

  res.json({ success: true, cases: publicCases, total: publicCases.length });
});

// Internal admin cases API (all cases including non-verified)
app.get('/api/student-safety/cases', (req, res) => {
  res.json({ success: true, cases: studentSafetyCases });
});

// Step 5: My Reports Dashboard
app.get('/student-safety/my-reports', (req, res) => {
  res.render('my-reports', {
    pageTitle: '📄 My Reports | Student Identity Shield',
    metaDescription: 'Track your submitted fake profile reports, view case timelines, trust score, badges, and community support received.'
  });
});

// How It Works Page
app.get('/student-safety/how-it-works', (req, res) => {
  res.render('how-it-works', {
    pageTitle: 'ℹ️ How It Works | Student Identity Shield',
    metaDescription: 'Learn how Student Identity Shield protects students from fake social media profiles through human-verified reporting and community support.'
  });
});

app.get('/settings', (req, res) => {
  res.render('settings', {
    pageTitle: '⚙️ Settings | 2AM Study Account',
    metaDescription: 'Manage your profile settings, display name, and institution preferences.'
  });
});

app.get('/reminder', (req, res) => {
  res.render('reminder', {
    pageTitle: 'Smart Study Reminders - Never Forget a Session',
    metaDescription: 'Set persistent time-based alerts and notifications to keep your study routine on track. Manage your time effectively.'
  });
});

app.get('/distraction', (req, res) => {
  res.render('distraction', {
    pageTitle: 'Distraction Blocker - Stay Focused on Your Page',
    metaDescription: 'Prevent accidental tab-surfing and social media distractions with our built-in blocker. Maintain deep focus for longer.'
  });
});

// --- Core Pages ---
app.get('/privacy-policy', (req, res) => {
  res.render('privacy-policy', {
    pageTitle: 'Privacy Policy | 2AM Study Data Protection',
    metaDescription: 'Read our privacy policy to understand how we protect your student productivity data and maintain your privacy on our platform.'
  });
});
app.get('/terms', (req, res) => {
  res.render('terms', {
    pageTitle: 'Terms & Conditions | Student Usage Guidelines',
    metaDescription: 'Understand the terms of service for using 2AM Study productivity tools, focus techniques, and community resources.'
  });
});
app.get('/about', (req, res) => {
  res.render('about', {
    pageTitle: 'About 2AM Study - Empowering Students with Focus Techniques',
    metaDescription: 'Learn about our mission to improve student productivity through smart work, effective study tips, and free academic tools.'
  });
});
app.get('/contact', (req, res) => {
  res.render('contact', {
    pageTitle: 'Contact Us | Support for Student Productivity Tools',
    metaDescription: 'Need help with our study tools or focus techniques? Contact the 2AM Study support team for academic guidance and assistance.'
  });
});

app.get('/faqs', (req, res) => {
  res.render('faqs', {
    pageTitle: 'How I Can Help You – Q&A | FAQs & Student-First Support - 2AM Study',
    metaDescription: 'From classrooms to life goals — here’s how we make it happen. Frequently asked questions on study strategies, 2 AM Study tools, store essentials, and student safety.',
    ogTitle: 'How I Can Help You – Q&A | 2AM Study FAQs',
    ogDescription: 'From classrooms to life goals — here’s how we make it happen. Clear answers to your study routines, focus techniques, store essentials, and student safety questions.'
  });
});

app.get('/faq', (req, res) => {
  res.redirect('/faqs');
});

app.get('/store', (req, res) => {
  res.render('store', {
    pageTitle: '2AM Study Store - Student Essentials, Digital Tools & Accessories',
    metaDescription: 'Shop curated study accessories, durable college bags, premium notebooks, and essentials built for productivity and late-night focus.',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    hideBot: true,
    storeProducts: STORE_PRODUCTS
  });
});

app.get('/store/product/:id', (req, res) => {
  const productId = Number(req.params.id);
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
    "brand": {
      "@type": "Brand",
      "name": "2AM Study"
    },
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

app.get('/store/cart', (req, res) => {
  const initialCart = req.session.cart || [];
  res.render('store-cart', {
    pageTitle: 'My Cart | 2AM Study Store',
    metaDescription: 'View and manage your selected items in the Student Store cart before proceeding to checkout.',
    hideBot: true,
    hideCartBubble: false,
    storeProducts: STORE_PRODUCTS,
    initialCart
  });
});

app.get('/store/order-summary', (req, res) => {
  res.render('store-order-summary', {
    pageTitle: 'Order Summary | 2AM Study Store',
    metaDescription: 'Review your cart items, total amount, and proceed to checkout securely.',
    hideBot: true,
    hideCartBubble: false
  });
});

app.get(['/store/my-orders', '/my-orders'], (req, res) => {
  res.render('store-orders', {
    pageTitle: 'My Orders | 2AM Study Store',
    metaDescription: 'Track, manage, and view invoices for all your past purchases from the 2AM Study Store.',
    hideBot: true
  });
});

app.get('/store/invoice/:orderId', (req, res) => {
  const { orderId } = req.params;
  const sessionOrder = req.session?.lastOrder || null;
  const isMatch = sessionOrder && sessionOrder.orderId === orderId;

  // Generate or retrieve permanent sequential invoice number
  if (!storeInvoicesMap.has(orderId)) {
    const seqStr = String(invoiceCounter++).padStart(5, '0');
    storeInvoicesMap.set(orderId, `INV-2026${seqStr}`);
  }
  const invoiceNo = storeInvoicesMap.get(orderId);

  const mockItems = [
    { productId: 101, name: '2 AM Notebook (Ruled A5)', price: 199, origPrice: 249, qty: 2, variant: 'A5 Ruled / 200 Pages', image: '/assets/images/products/notebook-1.jpg' },
    { productId: 201, name: 'Insulated Water Bottle 750ml', price: 449, origPrice: 599, qty: 1, variant: 'Stainless Steel / Matte Black', image: '/assets/images/products/bottle-1.jpg' }
  ];

  const rawItems = isMatch && sessionOrder.items ? sessionOrder.items : mockItems;
  const items = rawItems.map(item => {
    const unitPrice = Number(item.price);
    const origPrice = Number(item.origPrice || item.orig || Math.round(unitPrice * 1.25));
    const qty = Number(item.qty || 1);
    const discountPerUnit = Math.max(0, origPrice - unitPrice);
    const lineTotal = unitPrice * qty;
    return {
      ...item,
      qty,
      unitPrice,
      origPrice,
      discountPerUnit,
      lineTotal
    };
  });

  const subtotal = items.reduce((sum, i) => sum + (i.origPrice * i.qty), 0);
  const totalItemDiscount = items.reduce((sum, i) => sum + (i.discountPerUnit * i.qty), 0);
  const couponDiscount = sessionOrder?.couponDiscount || 0;
  const grandTotal = subtotal - totalItemDiscount - couponDiscount;

  const orderData = {
    invoiceNo: invoiceNo,
    orderId: orderId,
    invoiceDate: sessionOrder?.createdAt ? new Date(sessionOrder.createdAt).toLocaleString('en-IN') : new Date().toLocaleString('en-IN'),
    paymentId: sessionOrder?.paymentId || ('pay_' + crypto.randomBytes(8).toString('hex')),
    paymentMethod: sessionOrder?.paymentMethod || 'Razorpay Online (UPI/Cards/Netbanking)',
    customerName: sessionOrder?.customer?.name || req.session?.user?.name || 'Nishant Kumar',
    customerEmail: sessionOrder?.customer?.email || req.session?.user?.email || 'student@2amstudy.online',
    customerPhone: sessionOrder?.customer?.phone || '+91 9876543210',
    shippingAddress: sessionOrder?.customer?.address || '123 College Hostel Road, Room 402',
    city: sessionOrder?.customer?.city || 'Patna',
    state: 'Bihar',
    pincode: sessionOrder?.customer?.pincode || '800001',
    items: items,
    subtotal: subtotal,
    totalItemDiscount: totalItemDiscount,
    couponDiscount: couponDiscount,
    couponCode: sessionOrder?.couponCode || '',
    grandTotal: grandTotal > 0 ? grandTotal : (sessionOrder?.amount || 847),
    amountPaid: grandTotal > 0 ? grandTotal : (sessionOrder?.amount || 847),
    securityHash: crypto.createHash('md5').update(orderId + '2AM-STUDY-SECRET').digest('hex').substring(0, 10).toUpperCase()
  };

  res.render('store-invoice', {
    pageTitle: `Tax Invoice - ${orderData.invoiceNo} | 2AM Study Store`,
    metaDescription: `Download tax invoice for order ${orderId} on 2AM Study Store.`,
    order: orderData
  });
});

// Invoice API Data Route — also used as rating fallback in payment-success page
app.get('/api/store/invoice/:orderId', (req, res) => {
  const { orderId } = req.params;
  const cached = storeInvoicesMap.get(orderId);
  // Return rich order object if cached (set during verify-payment), else fallback
  const invoiceNo = cached ? (cached.invoiceNo || 'INV-202600001') : 'INV-202600001';
  const order = cached && typeof cached === 'object' && cached.items ? cached : (req.session?.lastOrder || null);
  res.json({
    success: true,
    orderId,
    invoiceNo,
    order
  });
});

// Orders API — server-first order fetch for payment-success rating flow
// Always fetches from Firestore (if available), then falls back to in-memory map, then session
app.get('/api/store/orders/:orderId', async (req, res) => {
  const { orderId } = req.params;
  try {
    // 1. Try Firestore first
    if (firestoreDb) {
      const snap = await firestoreDb.collection('storeOrders').doc(orderId).get();
      if (snap.exists) {
        return res.json({ success: true, order: snap.data() });
      }
    }
    // 2. Fall back to in-memory map (same server process, e.g. just purchased)
    const cached = storeInvoicesMap.get(orderId);
    if (cached) return res.json({ success: true, order: cached });
    // 3. Fall back to session
    if (req.session?.lastOrder?.orderId === orderId) {
      return res.json({ success: true, order: req.session.lastOrder });
    }
    return res.status(404).json({ success: false, error: 'Order not found.' });
  } catch (e) {
    console.error('[GET /api/store/orders]', e.message);
    return res.status(500).json({ success: false, error: 'Could not fetch order.' });
  }
});

// My Orders API — fetch past orders by student email or UID
app.get('/api/store/my-orders', async (req, res) => {
  const email = (req.query.email || req.session?.checkoutCustomer?.email || '').toLowerCase().trim();
  const uid = req.query.uid || req.session?.user?.uid || '';

  let ordersList = [];

  // 1. Check Firestore
  if (firestoreDb && (email || uid)) {
    try {
      if (email) {
        const snap = await firestoreDb.collection('storeOrders')
          .where('customer.email', '==', email)
          .get();
        snap.forEach(doc => ordersList.push({ id: doc.id, ...doc.data() }));
      }
      if (uid && ordersList.length === 0) {
        const snapUid = await firestoreDb.collection('storeOrders')
          .where('userId', '==', uid)
          .get();
        snapUid.forEach(doc => ordersList.push({ id: doc.id, ...doc.data() }));
      }
    } catch (err) {
      console.warn('[My Orders Firestore Error]:', err.message);
    }
  }

  // 2. Check Persisted Disk Orders / storeInvoicesMap
  if (Array.isArray(PERSISTED_STORE_ORDERS) && PERSISTED_STORE_ORDERS.length > 0) {
    PERSISTED_STORE_ORDERS.forEach(order => {
      const orderEmail = (order.customer?.email || order.email || '').toLowerCase().trim();
      const orderUid = order.userId || '';
      if ((email && orderEmail === email) || (uid && orderUid === uid)) {
        if (!ordersList.some(o => (o.orderId || o.id) === (order.orderId || order.id))) {
          ordersList.push(order);
        }
      }
    });
  }

  // 3. Fallback: if session has lastOrder, include it
  if (req.session?.lastOrder && !ordersList.some(o => (o.orderId || o.id) === req.session.lastOrder.orderId)) {
    const sessionEmail = (req.session.lastOrder.customer?.email || '').toLowerCase().trim();
    if (!email || sessionEmail === email) {
      ordersList.push(req.session.lastOrder);
    }
  }

  // Sort by newest first
  ordersList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  res.json({
    success: true,
    count: ordersList.length,
    orders: ordersList
  });
});

// ─── Public Read-Only Product API (for Hiii Nishant & public previews) ───────────

// Lightweight in-memory rate limiter for public APIs (120 requests / min per IP)
const publicRateLimitMap = new Map();
const PUBLIC_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PUBLIC_RATE_LIMIT_MAX = 120;

function publicApiRateLimiter(req, res, next) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (forwarded ? String(forwarded).split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
  const now = Date.now();
  
  let entry = publicRateLimitMap.get(ip);
  if (!entry || (now - entry.startTime) > PUBLIC_RATE_LIMIT_WINDOW_MS) {
    entry = { count: 1, startTime: now };
    publicRateLimitMap.set(ip, entry);
  } else {
    entry.count += 1;
    if (entry.count > PUBLIC_RATE_LIMIT_MAX) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Rate limit exceeded. Please try again in a minute.'
      });
    }
  }
  
  // Explicit CORS for public read-only endpoints
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
}

// Cleanup stale rate limit map entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of publicRateLimitMap.entries()) {
    if (now - entry.startTime > PUBLIC_RATE_LIMIT_WINDOW_MS) {
      publicRateLimitMap.delete(ip);
    }
  }
}, 10 * 60 * 1000);

// Extract product ID from URL or numeric ID string
function extractProductIdFromInput(input) {
  if (!input) return null;
  const str = String(input).trim();
  
  // 1. Direct number e.g. "101"
  if (/^\d+$/.test(str)) {
    return Number(str);
  }

  // 2. URL or path format e.g. "https://2amstudy.com/store/product/101"
  const urlMatch = str.match(/(?:store\/product|products?|id=|\/product\/)\/?(\d+)/i) || str.match(/\/(\d+)(?:[?#\/]|$)/);
  if (urlMatch && urlMatch[1]) {
    return Number(urlMatch[1]);
  }

  return null;
}

// Format public product preview (strictly public data only)
function formatPublicProductPreview(product, req) {
  if (!product) return null;

  // Determine base URL
  let baseUrl = process.env.PUBLIC_APP_URL || process.env.BASE_URL;
  if (!baseUrl) {
    const host = req ? req.get('host') : null;
    if (host && (host.includes('localhost') || host.includes('127.0.0.1'))) {
      baseUrl = `${req.protocol || 'http'}://${host}`;
    } else {
      baseUrl = 'https://2amstudy.com';
    }
  }
  baseUrl = baseUrl.replace(/\/+$/, '');

  const resolveImageUrl = (img) => {
    if (!img) return `${baseUrl}/assets/images/store/placeholder.jpg`;
    if (img.startsWith('http://') || img.startsWith('https://')) return img;
    return `${baseUrl}${img.startsWith('/') ? '' : '/'}${img}`;
  };

  const images = (Array.isArray(product.images) && product.images.length > 0)
    ? product.images.map(resolveImageUrl)
    : [resolveImageUrl(null)];

  const primaryImage = images[0];
  const stock = typeof product.stock === 'number' ? product.stock : 0;
  const inStock = stock > 0;
  
  let stockStatus = 'out_of_stock';
  let stockStatusLabel = 'Out of Stock';
  if (stock > 5) {
    stockStatus = 'in_stock';
    stockStatusLabel = 'In Stock';
  } else if (stock > 0) {
    stockStatus = 'low_stock';
    stockStatusLabel = `Only ${stock} left in stock`;
  }

  const regularPrice = typeof product.orig === 'number' ? product.orig : (product.price || 0);
  const salePrice = typeof product.price === 'number' ? product.price : regularPrice;
  const discountPercent = (regularPrice > salePrice && regularPrice > 0)
    ? Math.round(((regularPrice - salePrice) / regularPrice) * 100)
    : 0;

  return {
    id: product.id,
    name: product.name,
    description: product.desc || '',
    category: product.cat || null,
    image: primaryImage,
    images: images,
    price: regularPrice,
    salePrice: salePrice,
    regularPrice: regularPrice,
    currency: 'INR',
    currencySymbol: '₹',
    discountPercent: discountPercent,
    inStock: inStock,
    stock: stock,
    stockStatus: stockStatus,
    stockStatusLabel: stockStatusLabel,
    badge: product.badgeLabel || product.badge || null,
    rating: product.rating || null,
    ratingCount: product.ratingCount || 0,
    canonicalUrl: `${baseUrl}/store/product/${product.id}`
  };
}

// 1. Public Product Preview API (by URL or ID query param)
app.get(['/api/public/products/preview', '/store/api/public/products/preview'], publicApiRateLimiter, (req, res) => {
  const queryInput = req.query.url || req.query.id || req.query.productUrl || req.query.q;
  if (!queryInput) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a product URL or ID (e.g. ?url=https://2amstudy.com/store/product/101)'
    });
  }

  const productId = extractProductIdFromInput(queryInput);
  if (!productId) {
    return res.status(400).json({
      success: false,
      error: 'Invalid product URL or ID format. Expected format like: https://2amstudy.com/store/product/101'
    });
  }

  const product = STORE_PRODUCTS.find(p => p.id === productId);
  if (!product) {
    return res.status(404).json({
      success: false,
      error: `Product with ID ${productId} not found.`
    });
  }

  const publicData = formatPublicProductPreview(product, req);
  res.json({
    success: true,
    product: publicData
  });
});

// 2. Public Product by ID API
app.get(['/api/public/products/:id', '/store/api/public/products/:id'], publicApiRateLimiter, (req, res) => {
  const productId = Number(req.params.id);
  if (isNaN(productId)) {
    return res.status(400).json({ success: false, error: 'Invalid product ID' });
  }

  const product = STORE_PRODUCTS.find(p => p.id === productId);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }

  const publicData = formatPublicProductPreview(product, req);
  res.json({
    success: true,
    product: publicData
  });
});

// 3. Public Product Catalog API (Read-only listing)
app.get(['/api/public/products', '/store/api/public/products'], publicApiRateLimiter, (req, res) => {
  const { category, search } = req.query;
  let products = [...STORE_PRODUCTS];

  if (category && category !== 'all') {
    products = products.filter(p => p.cat === category.toLowerCase());
  }

  if (search) {
    const term = search.toLowerCase();
    products = products.filter(p =>
      p.name.toLowerCase().includes(term) || (p.desc && p.desc.toLowerCase().includes(term))
    );
  }

  const formatted = products.map(p => formatPublicProductPreview(p, req));
  res.json({
    success: true,
    count: formatted.length,
    products: formatted
  });
});

// ─── Unified Master Admin Authentication & Management System ───────────────

function checkMasterPassword(pass) {
  if (!pass) return false;
  const input = String(pass).trim();

  // 1. Always explicitly allow master password 'nishant2am'
  if (input === 'nishant2am' || input.toLowerCase() === 'nishant2am') {
    return true;
  }

  // 2. Also check any environment-configured passwords (trimming and stripping quotes)
  const envPasswords = [
    process.env.ADMIN_PASSWORD,
    process.env.ADMIN_PASSCODE,
    process.env.STORE_ADMIN_PASSWORD,
    process.env.LIVE_ADMIN_PASSWORD
  ]
    .filter(Boolean)
    .map(p => String(p).trim().replace(/^["']|["']$/g, ''));

  return envPasswords.some(p => p === input || p.toLowerCase() === input.toLowerCase());
}

// Simple IP-based Rate Limiter for Admin Login Protection
const adminLoginAttempts = new Map();

function checkAdminRateLimit(ip) {
  const now = Date.now();
  const record = adminLoginAttempts.get(ip);
  if (record && record.lockedUntil && record.lockedUntil > now) {
    const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
    return `Too many failed login attempts. Please wait ${remainingSec} seconds before trying again.`;
  }
  return null;
}

function recordAdminLoginFailure(ip) {
  const now = Date.now();
  const record = adminLoginAttempts.get(ip) || { count: 0, lockedUntil: null };
  record.count += 1;
  if (record.count >= 6) {
    record.lockedUntil = now + (60 * 1000); // 1 minute cooldown after 6 failed attempts
    record.count = 0;
  }
  adminLoginAttempts.set(ip, record);
}

function recordAdminLoginSuccess(ip) {
  adminLoginAttempts.delete(ip);
}

function isMasterAdminAuthenticated(req) {
  if (req.session && (req.session.isAdmin || req.session.isStoreAdmin || req.session.liveAdminAuthed)) {
    return true;
  }
  if (req.cookies && (req.cookies.admin_session === 'authenticated' || req.cookies.is_admin === 'true')) {
    return true;
  }
  return false;
}

function requireStoreAdmin(req, res, next) {
  if (isMasterAdminAuthenticated(req)) {
    return next();
  }
  
  if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Admin authentication required.' });
  }

  return res.redirect('/admin?redirect=' + encodeURIComponent(req.originalUrl || '/admin'));
}

// 1. Single Master Admin Dashboard Route View
app.get('/admin', async (req, res) => {
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
  } catch(e) {}
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
    products: STORE_PRODUCTS,
    orders: ordersList,
    blogs: BLOG_POSTS,
    safetyCases: studentSafetyCases,
    feedbacks: shopperFeedbacks,
    collegeVideos: collegeLifeVideos,
    resources: examResources
  });
});

// Legacy Admin URL Redirects to Unified Dashboard
app.get('/store/admin', (req, res) => res.redirect('/admin#tab-products'));
app.get('/store/admin/login', (req, res) => res.redirect('/admin'));

// 2. Master Admin Login Action
app.post('/api/admin/login', (req, res) => {
  const clientIp = getClientIp(req);
  const rateLimitErr = checkAdminRateLimit(clientIp);
  if (rateLimitErr) {
    return res.status(429).json({ success: false, error: rateLimitErr });
  }

  const password = (req.body?.password || req.body?.passcode || req.body?.pass || '').toString().trim();
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required.' });
  }

  if (checkMasterPassword(password)) {
    recordAdminLoginSuccess(clientIp);
    if (req.session) {
      req.session.isAdmin = true;
      req.session.isStoreAdmin = true;
      req.session.liveAdminAuthed = true;
      req.session.adminLoggedInAt = new Date().toISOString();
    }

    res.cookie('admin_session', 'authenticated', {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      path: '/'
    });
    res.cookie('is_admin', 'true', {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      path: '/'
    });

    if (req.session && typeof req.session.save === 'function') {
      return req.session.save(() => {
        return res.json({ success: true, message: 'Logged in successfully.', redirect: '/admin' });
      });
    }
    return res.json({ success: true, message: 'Logged in successfully.', redirect: '/admin' });
  }

  recordAdminLoginFailure(clientIp);
  return res.status(401).json({ success: false, error: 'Incorrect passcode. Please try again.' });
});

// Also support legacy store login endpoint
app.post('/api/store/admin/login', (req, res) => {
  const clientIp = getClientIp(req);
  const rateLimitErr = checkAdminRateLimit(clientIp);
  if (rateLimitErr) {
    return res.status(429).json({ success: false, error: rateLimitErr });
  }

  const password = (req.body?.password || req.body?.passcode || req.body?.pass || '').toString().trim();
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required.' });
  }

  if (checkMasterPassword(password)) {
    recordAdminLoginSuccess(clientIp);
    if (req.session) {
      req.session.isAdmin = true;
      req.session.isStoreAdmin = true;
      req.session.liveAdminAuthed = true;
      req.session.adminLoggedInAt = new Date().toISOString();
    }

    res.cookie('admin_session', 'authenticated', {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      path: '/'
    });
    res.cookie('is_admin', 'true', {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      path: '/'
    });

    if (req.session && typeof req.session.save === 'function') {
      return req.session.save(() => {
        return res.json({ success: true, message: 'Logged in successfully.', redirect: '/admin' });
      });
    }
    return res.json({ success: true, message: 'Logged in successfully.', redirect: '/admin' });
  }

  recordAdminLoginFailure(clientIp);
  return res.status(401).json({ success: false, error: 'Incorrect passcode. Please try again.' });
});

// 3. Admin Logout Actions
app.post('/api/admin/logout', (req, res) => {
  if (req.session) {
    delete req.session.isAdmin;
    delete req.session.isStoreAdmin;
    delete req.session.liveAdminAuthed;
    delete req.session.adminLoggedInAt;
    req.session.destroy(() => {});
  }
  res.clearCookie('admin_session', { path: '/' });
  res.clearCookie('is_admin', { path: '/' });
  res.json({ success: true, redirect: '/admin' });
});

app.get('/admin/logout', (req, res) => {
  if (req.session) {
    delete req.session.isAdmin;
    delete req.session.isStoreAdmin;
    delete req.session.liveAdminAuthed;
    delete req.session.adminLoggedInAt;
    req.session.destroy(() => {});
  }
  res.clearCookie('admin_session', { path: '/' });
  res.clearCookie('is_admin', { path: '/' });
  res.redirect('/admin');
});

app.post('/api/store/admin/logout', (req, res) => {
  if (req.session) {
    delete req.session.isAdmin;
    delete req.session.isStoreAdmin;
    delete req.session.liveAdminAuthed;
    delete req.session.adminLoggedInAt;
  }
  res.json({ success: true, redirect: '/admin' });
});

app.get('/store/admin/logout', (req, res) => {
  if (req.session) {
    delete req.session.isAdmin;
    delete req.session.isStoreAdmin;
    delete req.session.liveAdminAuthed;
    delete req.session.adminLoggedInAt;
  }
  res.redirect('/admin');
});

// 4. Check Current Admin Session Status
app.get('/api/store/admin/me', (req, res) => {
  res.json({
    success: true,
    authenticated: isMasterAdminAuthenticated(req),
    loggedInAt: req.session?.adminLoggedInAt || null
  });
});

// Delete Shopper Feedback Action
app.delete('/api/admin/feedbacks/:id', requireStoreAdmin, (req, res) => {
  const { id } = req.params;
  shopperFeedbacks = shopperFeedbacks.filter(f => f.id !== id);
  saveShopperFeedbacks();
  res.json({ success: true });
});

// 6. Admin Analytics Stats API
app.get('/api/store/admin/stats', requireStoreAdmin, (req, res) => {
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

// 7. Get All Products (Admin)
app.get('/api/store/admin/products', requireStoreAdmin, (req, res) => {
  res.json({
    success: true,
    count: STORE_PRODUCTS.length,
    products: STORE_PRODUCTS
  });
});

// 8. Create New Product (Admin)
app.post('/api/store/admin/products', requireStoreAdmin, (req, res) => {
  const { id, name, cat, desc, price, orig, stock, badge, badgeLabel, images, features, specs } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ success: false, error: 'Product name and price are required.' });
  }

  // Determine or validate ID
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
  savePersistedProducts();

  res.json({
    success: true,
    message: 'Product created successfully',
    product: newProduct
  });
});

// 9. Update Existing Product (Admin)
app.put('/api/store/admin/products/:id', requireStoreAdmin, (req, res) => {
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

  savePersistedProducts();

  res.json({
    success: true,
    message: 'Product updated successfully',
    product: STORE_PRODUCTS[index]
  });
});

// 10. Quick Stock Adjustment (Admin)
app.patch('/api/store/admin/products/:id/stock', requireStoreAdmin, (req, res) => {
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

  savePersistedProducts();

  res.json({
    success: true,
    id: product.id,
    stock: product.stock
  });
});

// 11. Delete Product (Admin)
app.delete('/api/store/admin/products/:id', requireStoreAdmin, (req, res) => {
  const productId = Number(req.params.id);
  const index = STORE_PRODUCTS.findIndex(p => p.id === productId);
  if (index === -1) {
    return res.status(404).json({ success: false, error: `Product #${productId} not found.` });
  }

  const deleted = STORE_PRODUCTS.splice(index, 1)[0];
  savePersistedProducts();

  res.json({
    success: true,
    message: `Product #${productId} (${deleted.name}) deleted successfully.`
  });
});

// 12. View Store Orders (Admin)
app.get('/api/store/admin/orders', requireStoreAdmin, async (req, res) => {
  try {
    let ordersList = [];
    if (firestoreDb) {
      const snap = await firestoreDb.collection('storeOrders').orderBy('createdAt', 'desc').limit(50).get();
      if (!snap.empty) {
        ordersList = snap.docs.map(doc => doc.data());
      }
    }
    
    // Supplement from storeInvoicesMap if any
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

// ─── Blog Admin & Public APIs ──────────────────────────────────────────────────

// 13. Get All Blogs (Admin)
app.get('/api/store/admin/blogs', requireStoreAdmin, (req, res) => {
  res.json({
    success: true,
    count: BLOG_POSTS.length,
    blogs: BLOG_POSTS
  });
});

// 13b. Upload Blog Image (Cover image or in-body Image Box)
app.post('/api/store/admin/blogs/upload-image', requireStoreAdmin, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No image file provided.' });
  }
  const imageUrl = '/assets/images/store/' + req.file.filename;
  res.json({ success: true, url: imageUrl });
});

// 13c. Get Single Blog Post by ID (Admin)
app.get('/api/store/admin/blogs/:id', requireStoreAdmin, (req, res) => {
  const post = BLOG_POSTS.find(b => b.id === req.params.id || b.slug === req.params.id);
  if (!post) return res.status(404).json({ success: false, error: 'Blog post not found' });
  res.json({ success: true, post });
});

// 14. Create New Blog Post (Admin)
app.post('/api/store/admin/blogs', requireStoreAdmin, (req, res) => {
  const { title, slug, category, author, readTime, image, coverImage, excerpt, content, status, tags } = req.body;
  if (!title || !content) {
    return res.status(400).json({ success: false, error: 'Title and article content are required.' });
  }

  let postSlug = slug ? String(slug).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
  if (!postSlug) {
    postSlug = String(title).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  if (BLOG_POSTS.some(b => b.slug === postSlug)) {
    postSlug = `${postSlug}-${Date.now().toString().slice(-4)}`;
  }

  const finalImage = coverImage || image || 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=1200&q=80';

  const newPost = {
    id: 'blog-' + Date.now(),
    slug: postSlug,
    title: String(title).trim(),
    category: category || 'Study Tips',
    author: author || '2 AM Study',
    date: new Date().toISOString().split('T')[0],
    readTime: readTime || '5 min read',
    image: finalImage,
    coverImage: finalImage,
    excerpt: excerpt ? String(excerpt).trim() : String(content).replace(/<[^>]*>/g, '').slice(0, 160) + '...',
    content: content,
    status: status === 'draft' ? 'draft' : 'published',
    tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []),
    views: 0
  };

  BLOG_POSTS.unshift(newPost);
  savePersistedBlogs();

  res.json({
    success: true,
    message: 'Blog post published successfully!',
    post: newPost
  });
});

// 15. Update Blog Post (Admin)
app.put('/api/store/admin/blogs/:id', requireStoreAdmin, (req, res) => {
  const { id } = req.params;
  const index = BLOG_POSTS.findIndex(b => b.id === id || b.slug === id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Blog post not found.' });
  }

  const existing = BLOG_POSTS[index];
  const { title, slug, category, author, readTime, image, coverImage, excerpt, content, status, tags } = req.body;

  let postSlug = existing.slug;
  if (slug && slug !== existing.slug) {
    postSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  const finalImage = coverImage !== undefined ? coverImage : (image !== undefined ? image : existing.image);

  BLOG_POSTS[index] = {
    ...existing,
    slug: postSlug,
    title: title !== undefined ? String(title).trim() : existing.title,
    category: category !== undefined ? category : existing.category,
    author: author !== undefined ? author : existing.author,
    readTime: readTime !== undefined ? readTime : existing.readTime,
    image: finalImage,
    coverImage: finalImage,
    excerpt: excerpt !== undefined ? excerpt : existing.excerpt,
    content: content !== undefined ? content : existing.content,
    status: status !== undefined ? status : existing.status,
    tags: Array.isArray(tags) ? tags : (tags !== undefined ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : existing.tags),
    updatedAt: new Date().toISOString()
  };

  savePersistedBlogs();

  res.json({
    success: true,
    message: 'Blog post updated successfully!',
    post: BLOG_POSTS[index]
  });
});

// 16. Delete Blog Post (Admin)
app.delete('/api/store/admin/blogs/:id', requireStoreAdmin, (req, res) => {
  const { id } = req.params;
  const index = BLOG_POSTS.findIndex(b => b.id === id || b.slug === id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Blog post not found.' });
  }

  const deleted = BLOG_POSTS.splice(index, 1)[0];
  savePersistedBlogs();

  res.json({
    success: true,
    message: `Blog post "${deleted.title}" deleted.`
  });
});

// Public read blogs API
app.get('/api/public/blogs', (req, res) => {
  const published = BLOG_POSTS.filter(b => b.status === 'published');
  res.json({ success: true, count: published.length, blogs: published });
});

app.get('/api/public/blogs/:slug', (req, res) => {
  const post = BLOG_POSTS.find(b => b.slug === req.params.slug && b.status === 'published');
  if (!post) return res.status(404).json({ success: false, error: 'Blog post not found' });
  res.json({ success: true, post });
});

// --- Store API Endpoints ---

// Get all products (API)
app.get('/store/api/store/products', (req, res) => {
  const { category, sort, search } = req.query;
  let products = [...STORE_PRODUCTS];

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

// Get single product (API)
app.get('/store/api/store/products/:id', (req, res) => {
  const product = STORE_PRODUCTS.find(p => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  res.json({ success: true, product });
});

// Get related products (API)
app.get('/store/api/store/products/:id/related', (req, res) => {
  const product = STORE_PRODUCTS.find(p => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  const related = STORE_PRODUCTS.filter(p => p.cat === product.cat && p.id !== product.id).slice(0, 4);
  res.json({ success: true, count: related.length, products: related });
});

// Delivery check by pincode (API)
app.post('/store/api/store/check-delivery', (req, res) => {
  const { pincode, productId } = req.body;
  if (!pincode || !/^\d{6}$/.test(pincode)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid 6-digit pincode' });
  }
  const product = STORE_PRODUCTS.find(p => p.id === Number(productId));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

  // Simulated delivery logic based on pincode ranges
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

// Cart management (session-based)
app.get('/store/api/store/cart', (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  res.json({ success: true, items: cart, total, itemCount: cart.reduce((s, i) => s + i.qty, 0) });
});

app.post('/store/api/store/cart/add', (req, res) => {
  const { productId, qty } = req.body;
  const product = STORE_PRODUCTS.find(p => p.id === Number(productId));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

  // Stock validation
  if (product.stock <= 0) {
    return res.status(400).json({ success: false, error: `${product.name} is out of stock.` });
  }

  if (!req.session.cart) req.session.cart = [];
  const existing = req.session.cart.find(i => i.productId === product.id);
  const delta = Number(qty) || 1; // can be positive or negative
  const currentQty = existing ? existing.qty : 0;

  if (existing) {
    const newQty = existing.qty + delta;
    if (newQty <= 0) {
      // If qty drops to 0 or below, remove item
      req.session.cart = req.session.cart.filter(i => i.productId !== product.id);
    } else if (newQty > product.stock) {
      return res.status(400).json({ success: false, error: `Only ${product.stock} unit(s) of "${product.name}" available.` });
    } else {
      existing.qty = newQty;
    }
  } else {
    // Adding new item
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


app.post('/store/api/store/cart/remove', (req, res) => {
  const { productId } = req.body;
  if (!req.session.cart) return res.json({ success: true, items: [], total: 0, itemCount: 0 });
  req.session.cart = req.session.cart.filter(i => i.productId !== Number(productId));
  const cart = req.session.cart;
  res.json({ success: true, items: cart, total: cart.reduce((s, i) => s + i.price * i.qty, 0), itemCount: cart.reduce((s, i) => s + i.qty, 0) });
});

app.post('/store/api/store/cart/buynow', (req, res) => {
  const { productId } = req.body;
  const product = STORE_PRODUCTS.find(p => p.id === Number(productId));
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

// Product reviews (API)
app.get('/store/api/store/products/:id/reviews', (req, res) => {
  const product = STORE_PRODUCTS.find(p => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  const reviews = product.reviews || [];
  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : product.rating;
  const ratingBreakdown = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: reviews.filter(r => r.rating === star).length,
    percent: reviews.length > 0 ? Math.round((reviews.filter(r => r.rating === star).length / reviews.length) * 100) : 0
  }));
  res.json({ success: true, avgRating, totalReviews: reviews.length, ratingBreakdown, reviews });
});

app.post('/store/api/store/products/:id/reviews', (req, res) => {
  const { user, rating, comment, orderId } = req.body;
  if (!user || !rating || !comment) return res.status(400).json({ success: false, error: 'All fields required' });
  if (rating < 1 || rating > 5) return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' });
  const productId = Number(req.params.id);
  const product = STORE_PRODUCTS.find(p => p.id === productId);
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

  // — Security: verify purchaser —
  // orderId must be provided and must correspond to a completed order containing this product
  if (!orderId) return res.status(403).json({ success: false, error: 'Order ID required to submit a review.' });
  const cachedOrder = storeInvoicesMap.get(orderId);
  if (!cachedOrder) return res.status(403).json({ success: false, error: 'Could not verify purchase. Please ensure your order has been completed.' });
  const orderedProduct = (cachedOrder.items || []).find(item => Number(item.productId) === productId);
  if (!orderedProduct) return res.status(403).json({ success: false, error: 'You can only review products you have purchased.' });

  // — Sanitize review text: strip HTML tags, limit to 500 chars —
  const sanitize = (str) => String(str || '').replace(/<[^>]*>/g, '').trim().slice(0, 500);
  const safeComment = sanitize(comment);
  const safeUser = sanitize(user).slice(0, 80);
  if (!safeComment) return res.status(400).json({ success: false, error: 'Review text cannot be empty.' });

  if (!product.reviews) product.reviews = [];

  // — Idempotency: one review per product per order (upsert) —
  const existingIdx = product.reviews.findIndex(r => r.orderId === orderId);
  const reviewRecord = {
    user: safeUser,
    rating: Number(rating),
    comment: safeComment,
    orderId,
    date: new Date().toISOString().split('T')[0]
  };

  if (existingIdx !== -1) {
    // Update existing review for this order
    product.reviews[existingIdx] = reviewRecord;
  } else {
    product.reviews.unshift(reviewRecord);
    product.ratingCount = (product.ratingCount || 0) + 1;
  }

  product.rating = Number((product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length).toFixed(1));

  // Push to global shopper feedbacks list
  const avatarList = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&q=80&fm=webp',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&q=80&fm=webp',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&q=80&fm=webp',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=100&h=100&q=80&fm=webp'
  ];
  const fbIdx = shopperFeedbacks.findIndex(f => f.orderId === orderId && f.productId === productId);
  const feedbackRecord = {
    id: fbIdx !== -1 ? shopperFeedbacks[fbIdx].id : 'fb-' + Date.now(),
    name: safeUser,
    avatar: avatarList[Math.floor(Math.random() * avatarList.length)],
    rating: Number(rating),
    comment: safeComment,
    product: product.name,
    productId,
    orderId,
    verified: true,
    date: reviewRecord.date
  };
  if (fbIdx !== -1) {
    shopperFeedbacks[fbIdx] = feedbackRecord;
  } else {
    shopperFeedbacks.unshift(feedbackRecord);
  }
  saveShopperFeedbacks();

  res.json({ success: true, message: existingIdx !== -1 ? 'Review updated successfully' : 'Review added successfully', review: reviewRecord });
});

// Global Shopper Feedback APIs
app.get('/store/api/store/feedbacks', (req, res) => {
  res.json({ success: true, feedbacks: shopperFeedbacks });
});

app.post('/store/api/store/feedback', (req, res) => {
  const { name, comment, rating, product } = req.body;
  if (!name || !comment) {
    return res.status(400).json({ success: false, error: 'Name and feedback comment are required.' });
  }

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

  shopperFeedbacks.unshift(newFb);
  saveShopperFeedbacks();

  res.json({ success: true, message: 'Feedback added successfully!', feedback: newFb, feedbacks: shopperFeedbacks });
});

// Product image upload (admin use)
app.post('/store/api/store/products/:id/images', requireStoreAdmin, upload.array('images', 5), (req, res) => {
  const product = STORE_PRODUCTS.find(p => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, error: 'No images uploaded' });

  const newImages = req.files.map(f => `/assets/images/store/${f.filename}`);
  if (!product.images) product.images = [];
  product.images.push(...newImages);
  res.json({ success: true, message: `${newImages.length} image(s) uploaded`, images: product.images });
});

// --- Price Calculation (server-authoritative) ---
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

// --- Unified Checkout State API ---

// GET /api/store/checkout — Returns cart + customer + coupon + server-computed price summary
app.get('/store/api/store/checkout', (req, res) => {
  const cart = req.session.cart || [];
  const customer = req.session.checkoutCustomer || null;
  const coupon = req.session.checkoutCoupon || null;
  const summary = computeCheckoutSummary(cart, coupon);
  res.json({ success: true, cart, customer, coupon, summary });
});

// POST /api/store/checkout/address — Save delivery address to session
app.post('/store/api/store/checkout/address', (req, res) => {
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

// POST /api/store/checkout/coupon — Validate and apply coupon
app.post('/store/api/store/checkout/coupon', (req, res) => {
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

// DELETE /api/store/checkout/coupon — Remove applied coupon
app.delete('/store/api/store/checkout/coupon', (req, res) => {
  req.session.checkoutCoupon = null;
  res.json({ success: true, message: 'Coupon removed' });
});

// POST /api/store/checkout/clear — Clear session after successful payment
app.post('/store/api/store/checkout/clear', (req, res) => {
  req.session.hasOrderedBefore = true; // Mark for WELCOME coupon restriction
  req.session.cart = [];
  req.session.checkoutCustomer = null;
  req.session.checkoutCoupon = null;
  res.json({ success: true, message: 'Order session cleared' });
});

app.get('/store/payment', (req, res) => {
  res.render('store-payment', {
    pageTitle: 'Complete Payment | 2AM Study Store',
    metaDescription: 'Complete secure Razorpay payment for your 2AM Study Store order.',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    hideBot: true,
    hideCartBubble: true
  });
});

app.get('/store/payment-success', (req, res) => {
  res.render('store-payment-success', {
    pageTitle: 'Payment Successful | 2AM Study Store',
    metaDescription: 'Your payment is successful. Thank you for shopping with 2AM Study Store.',
    paymentId: req.query.payment_id || '',
    orderId: req.query.order_id || '',
    hideBot: true
  });
});



// --- Blog Section ---
app.get('/blog', (req, res) => {
  res.render('blog/index', {
    pageTitle: '2AM Study Blog - Best Study Tips & Student Productivity Guides',
    metaDescription: 'Expert study tips for exam preparation, focus techniques for concentration, and productivity hacks to help students excel academically.',
    dynamicBlogs: BLOG_POSTS.filter(b => b.status === 'published')
  });
});

app.get('/blog/:slug', (req, res) => {
  const slug = req.params.slug.toLowerCase().trim();

  // 1. Check dynamic blog posts first
  const dynamicPost = BLOG_POSTS.find(b => b.slug === slug);
  if (dynamicPost) {
    if (dynamicPost.status === 'published' || req.session?.isStoreAdmin) {
      dynamicPost.views = (dynamicPost.views || 0) + 1;
      const blogCover = dynamicPost.coverImage
        ? (dynamicPost.coverImage.startsWith('http') ? dynamicPost.coverImage : `https://2amstudy.com${dynamicPost.coverImage}`)
        : 'https://2amstudy.com/assets/images/smart_study_banner.png';

      const blogSchema = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": dynamicPost.title,
        "description": dynamicPost.excerpt || 'Read this article on 2AM Study Blog.',
        "image": blogCover,
        "author": {
          "@type": "Person",
          "name": dynamicPost.author || "Nishant Kumar"
        },
        "publisher": {
          "@type": "Organization",
          "name": "2AM Study",
          "logo": {
            "@type": "ImageObject",
            "url": "https://2amstudy.com/assets/images/logo.jpg"
          }
        },
        "datePublished": dynamicPost.createdAt || new Date().toISOString()
      };

      return res.render('blog/post', {
        pageTitle: `${dynamicPost.title} | 2AM Study Blog`,
        metaDescription: dynamicPost.excerpt || 'Read this article on 2AM Study Blog.',
        ogTitle: `${dynamicPost.title} | 2AM Study Blog`,
        ogDescription: dynamicPost.excerpt || 'Read this article on 2AM Study Blog.',
        ogImage: blogCover,
        structuredData: blogSchema,
        post: dynamicPost
      });
    }
  }

  // 2. Fallback to existing static EJS views if file exists
  const staticFilePath = path.join(__dirname, 'views', 'blog', `${slug}.ejs`);
  if (fs.existsSync(staticFilePath)) {
    const formattedTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return res.render(`blog/${slug}`, {
      pageTitle: `${formattedTitle} | 2AM Study Blog`,
      metaDescription: `Read ${formattedTitle} - Expert study tips, focus routines, and academic productivity guide on 2AM Study.`,
      ogTitle: `${formattedTitle} | 2AM Study Blog`,
      ogDescription: `Read ${formattedTitle} on 2AM Study Blog.`
    });
  }

  return res.status(404).redirect('/blog');
});

// --- Study Tools ---
app.get('/study-tools', (req, res) => {
  res.render('tools/index', {
    pageTitle: 'Student Productivity Tools Hub | Complete Academic Toolkit',
    metaDescription: 'Discover a comprehensive suite of student productivity tools. From syllabus trackers to timetable generators, we provide everything you need to succeed.'
  });
});

app.get('/notes', (req, res) => {
  res.render('notes', {
    pageTitle: 'Download Study Notes | Free Academic Resources',
    metaDescription: 'Access free hand-written UPSC, GATE, and NEET study notes, mind maps, and past year question papers.'
  });
});

app.get('/exam-countdown', (req, res) => {
  res.render('tools/exam-countdown', {
    pageTitle: 'Online Exam Countdown Timer | Track Your Study Deadlines',
    metaDescription: 'Never miss an exam date again. Set multiple countdown timers for your finals and stay on top of your academic preparation.'
  });
});
app.get('/syllabus-tracker', (req, res) => {
  res.render('tools/syllabus-tracker', {
    pageTitle: 'Free Syllabus Tracker Online | Track Subject Progress',
    metaDescription: 'Visualize your course completion with our interactive syllabus tracker. Stay motivated by checking off chapters as you study.'
  });
});
app.get('/timetable-generator', (req, res) => {
  res.render('tools/timetable-generator', {
    pageTitle: 'Student Study Timetable Generator | PDF Export',
    metaDescription: 'Create a professional and personalized study schedule in seconds. Optimize your study routine and export your timetable as a PDF.'
  });
});

// --- Calculators ---
app.get('/calculators', (req, res) => {
  res.render('calculators/index', {
    pageTitle: 'Student Calculator Hub: GPA, Age & Percentage Tools',
    metaDescription: 'Access free online calculators for students. Calculate GPA/CGPA, score percentages, and precise age with our easy-to-use tools.'
  });
});
app.get('/calculators/cgpa', (req, res) => {
  res.render('calculators/cgpa', {
    pageTitle: 'Online CGPA Calculator for Students | Academic Success',
    metaDescription: 'Calculate your semester and cumulative GPA easily. Enter your grades and credits to track your academic performance.'
  });
});
app.get('/calculators/percentage', (req, res) => {
  res.render('calculators/percentage', {
    pageTitle: 'Free Percentage Calculator Online | Score & Grade Tool',
    metaDescription: 'Calculate marks percentage, academic scores, and fractional increases instantly with our free student tool.'
  });
});
app.get('/calculators/age', (req, res) => {
  res.render('calculators/age', {
    pageTitle: 'Online Age Calculator | Precise Years, Months & Days',
    metaDescription: 'Find your exact age in seconds. Perfect for filling out student applications and administrative forms.'
  });
});

// --- Utilities ---
app.get('/utilities', (req, res) => {
  res.render('utilities/index', {
    pageTitle: 'Student Utility Hub - Free AQI, Grammar & Word Tools',
    metaDescription: 'Collection of essential digital utilities for students: Air Quality indexes, Grammar checkers, Word counters, and more.'
  });
});

app.get('/weather', (req, res) => {
  res.render('utilities/weather', {
    pageTitle: 'Local Weather Tracker - Plan Your Campus Commute',
    metaDescription: 'Get real-time weather updates and 7-day forecasts. Essential for students planning their daily campus travels.'
  });
});

app.get('/compass', (req, res) => {
  res.render('utilities/compass', {
    pageTitle: 'Digital Compass Online - Easy Direction Finder',
    metaDescription: 'Reliable in-browser digital compass. Useful for student orientation and outdoor academic trips.'
  });
});

app.get('/word-counter', (req, res) => {
  res.render('utilities/word-counter', {
    pageTitle: 'Free Word & Character Counter - Writing Tool for Essays',
    metaDescription: 'Accurately count words, characters, and sentences. Ideal for meeting essay word counts and document formatting.'
  });
});

app.get('/grammar-checker', (req, res) => {
  res.render('utilities/grammar-checker', {
    pageTitle: 'Free AI Grammar Checker - Polish Your Student Essays',
    metaDescription: 'Instantly find and fix grammar, spelling, and punctuation errors. Ensure your academic work is professional and error-free.'
  });
});

app.get('/air-quality', (req, res) => {
  res.render('utilities/air-quality', {
    pageTitle: 'Real-time Air Quality & AQI Checker for Students',
    metaDescription: 'Monitor local air pollution levels. Health-focused insights for students and commuters based on real-time sensor data.'
  });
});

// --- PDF Tools ---

app.get('/pdf-tools/maker', (req, res) => {
  res.render('pdf-tools/maker', {
    pageTitle: 'Online PDF Maker - Convert Images & Text to PDF',
    metaDescription: 'Create high-quality PDF documents from images or text. Fast, secure, and perfect for organizing study notes.'
  });
});

app.get('/pdf-tools/merger', (req, res) => {
  res.render('pdf-tools/merger', {
    pageTitle: 'Merge PDF Online - Combine Multiple PDFs Fast',
    metaDescription: 'Join several PDF files into one neatly organized document. Perfect for combining multiple assignment parts or research papers.'
  });
});

app.get('/pdf-tools/splitter', (req, res) => {
  res.render('pdf-tools/splitter', {
    pageTitle: 'Split PDF Online - Extract Pages from Any PDF',
    metaDescription: 'Extract specific pages or separate one large PDF into individual files. Ideal for managing massive academic textbooks.'
  });
});

app.get('/pdf-tools/editor', (req, res) => {
  res.render('pdf-tools/editor', {
    pageTitle: 'Free PDF Editor - Annotate & Draw on PDFs Online',
    metaDescription: 'Highlight text, add annotations, and draw directly on your PDFs. The essential tool for digital note-taking.'
  });
});

app.get('/pdf-tools/compressor', (req, res) => {
  res.render('pdf-tools/compressor', {
    pageTitle: 'PDF Compressor - Reduce File Size for Easy Sharing',
    metaDescription: 'Shrink your large PDF documents without losing quality. Perfect for emailing assignments or uploading to portals with size limits.'
  });
});

app.get('/pdf-tools/converter', (req, res) => {
  res.render('pdf-tools/converter', {
    pageTitle: 'PDF Converter - Change Formats Quickly & Easily',
    metaDescription: 'Convert common document formats to and from PDF. Flexible file management for all your student projects.'
  });
});

app.post('/send-email', async (req, res) => {
  const { formName } = req.body;

  // Build key-value list from body
  let bodyContent = '';
  let htmlContent = `<p><strong>Form:</strong> ${formName || 'Contact Form'}</p>`;

  for (const [key, value] of Object.entries(req.body)) {
    if (key !== 'formName') {
      const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
      bodyContent += `${capitalizedKey}: ${value}\n`;
      htmlContent += `<p><strong>${capitalizedKey}:</strong> ${value}</p>`;
    }
  }

  const mailOptions = {
    from: `Website Contact <${process.env.SMTP_USER}>`,
    to: process.env.RECEIVER_EMAIL || process.env.SMTP_USER,
    subject: `New form submission: ${formName || 'Contact Form'}`,
    text: bodyContent,
    html: htmlContent,
  };

  try {
    await transporter.sendMail(mailOptions);
    return res.json({ message: '🎉 Thanks for registering! We’re excited to have you with us.' });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ error: 'Failed to send email. Please try again later.' });
  }
});

app.post('/store/api/store/create-order', async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(500).json({ error: 'Razorpay is not configured on server.' });
    }

    // SECURITY: Compute the authoritative amount from the session — ignore any client-supplied amount.
    const cart = req.session.cart || [];
    const coupon = req.session.checkoutCoupon || null;
    const customer = req.session.checkoutCustomer || null;

    if (!cart.length) {
      return res.status(400).json({ error: 'Cart is empty. Cannot create an order.' });
    }
    if (!customer) {
      return res.status(400).json({ error: 'Delivery address is required before payment.' });
    }

    // Cross-check cart prices against the STORE_PRODUCTS source of truth
    for (const item of cart) {
      const product = STORE_PRODUCTS.find(p => p.id === item.productId);
      if (!product) return res.status(400).json({ error: `Product ${item.productId} not found.` });
      if (product.stock < item.qty) {
        return res.status(400).json({ error: `Insufficient stock for "${product.name}". Only ${product.stock} left.` });
      }
      // Ensure cart price hasn't been tampered with
      item.price = product.price;
      item.orig = product.orig;
    }

    const summary = computeCheckoutSummary(cart, coupon);
    const safe = (val, max = 120) => String(val || '').trim().slice(0, max);

    const options = {
      amount: Math.round(summary.finalTotal * 100), // Server-computed — never from client
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
    // Store the server-computed summary in session so the frontend can display it after order creation
    req.session.pendingOrderSummary = { ...summary, orderId: order.id };
    return res.json({ ...order, serverSummary: summary });
  } catch (error) {
    console.error('Razorpay create order error:', error);
    return res.status(500).json({ error: 'Unable to create payment order.' });
  }
});

app.post('/store/api/store/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ verified: false, error: 'Missing payment verification fields.' });
    }

    // ── 1. Verify HMAC signature ──────────────────────────────────────────────
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '');
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest('hex');
    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ verified: false, error: 'Payment verification failed.' });
    }

    const cart = req.session.cart || [];

    // ── 2. Idempotency: reject duplicate webhook/retry for same order ─────────
    if (storeInvoicesMap.has(razorpay_order_id)) {
      console.warn(`[verify-payment] Duplicate call for order ${razorpay_order_id} — ignoring.`);
      return res.json({ verified: true, duplicate: true });
    }

    // ── 3. Deduct inventory (Firestore atomic OR in-memory fallback) ──────────
    if (firestoreDb) {
      // Firestore path: run one transaction per product (atomically decrement stock)
      for (const item of cart) {
        const productId = String(item.productId);
        const qty = item.qty || 1;
        const docRef = firestoreDb.collection('storeProducts').doc(productId);
        try {
          await firestoreDb.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            const now = new Date();
            if (!snap.exists) {
              // Seed from STORE_PRODUCTS if not in Firestore yet
              const localProduct = STORE_PRODUCTS.find(p => p.id === item.productId);
              tx.set(docRef, {
                name: localProduct?.name || 'Unknown',
                price: localProduct?.price || 0,
                stock: Math.max(0, (localProduct?.stock || 0) - qty),
                sold: qty,
                updatedAt: now,
                lastPurchasedAt: now
              });
            } else {
              const currentStock = snap.data().stock || 0;
              if (currentStock < qty) {
                throw new Error(`Insufficient stock for product ${productId}`);
              }
              tx.update(docRef, {
                stock: currentStock - qty,
                sold: (snap.data().sold || 0) + qty,
                updatedAt: now,
                lastPurchasedAt: now
              });
            }
          });
          // Keep in-memory in sync
          const localProduct = STORE_PRODUCTS.find(p => p.id === item.productId);
          if (localProduct) localProduct.stock = Math.max(0, (localProduct.stock || 0) - qty);
        } catch (txErr) {
          console.error(`[Firestore] Stock transaction failed for product ${productId}:`, txErr.message);
          if (txErr.message.includes('Insufficient stock')) {
            return res.status(409).json({ verified: false, error: `Product "${item.name || productId}" is out of stock.` });
          }
          // Non-stock error: log but continue (don't block payment success)
        }
      }
    } else {
      // In-memory fallback (no Firestore configured)
      for (const item of cart) {
        const product = STORE_PRODUCTS.find(p => p.id === item.productId);
        if (product) {
          const qty = item.qty || 1;
          if ((product.stock || 0) < qty) {
            return res.status(409).json({ verified: false, error: `Product "${product.name}" is out of stock.` });
          }
          product.stock = Math.max(0, product.stock - qty);
          product.sold = (product.sold || 0) + qty;
        }
      }
      savePersistedStock();
    }

    // ── 4. Persist completed order (for rating + invoice fallback) ─────────────
    const seqStr = String(invoiceCounter++).padStart(5, '0');
    const invoiceNo = `INV-2026${seqStr}`;
    const now = new Date();
    const completedOrder = {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      invoiceNo,
      customerName: req.session.checkoutCustomer?.name || 'Student Customer',
      customer: req.session.checkoutCustomer,
      items: cart.length ? [...cart] : [],
      createdAt: now.toISOString()
    };

    // Save to Firestore if available
    if (firestoreDb) {
      try {
        await firestoreDb.collection('storeOrders').doc(razorpay_order_id).set(completedOrder);
      } catch (e) {
        console.error('[Firestore] Failed to save order:', e.message);
      }
    }

    // Save to disk persistence
    PERSISTED_STORE_ORDERS.unshift(completedOrder);
    savePersistedStoreOrders();

    storeInvoicesMap.set(razorpay_order_id, completedOrder);
    req.session.lastOrder = completedOrder;

    return res.json({ verified: true });
  } catch (error) {
    console.error('Razorpay verify error:', error);
    return res.status(500).json({ verified: false, error: 'Verification service unavailable.' });
  }
});

// Help Bot Doubt Solver (AI Proxy)
const doubtHandler = require('../api/doubt');
app.post('/api/doubt', doubtHandler);

// ─── Live Study Sessions ──────────────────────────────────────────────────────
// (studySessions and extractYoutubeVideoId defined at top)

// GET — Public live study page
app.get('/live-study', (req, res) => {
  const liveSession = studySessions.find(s => s.status === 'LIVE') || null;
  const pastSessions = studySessions
    .filter(s => s.status === 'COMPLETED')
    .sort((a, b) => new Date(b.endedAt || b.createdAt) - new Date(a.endedAt || a.createdAt));
  res.render('live-study', {
    pageTitle: 'Live Study Sessions | 2AM Study',
    metaDescription: 'Join our live study sessions on 2AM Study. Watch the admin YouTube Live stream and browse past recorded study challenges.',
    liveSession,
    pastSessions
  });
});

// GET — Individual session detail page
app.get('/live-study/:id', (req, res) => {
  const session = studySessions.find(s => s.id === req.params.id);
  if (!session) {
    return res.status(404).render('live-study-session', {
      pageTitle: 'Session Not Found | 2AM Study',
      metaDescription: 'This study session could not be found.',
      session: null
    });
  }
  res.render('live-study-session', {
    pageTitle: `${session.title} | 2AM Study`,
    metaDescription: session.description || `Watch the ${session.title} recording on 2AM Study.`,
    session
  });
});

// GET — Admin panel page (redirects to unified Master Admin)
app.get('/live-admin', (req, res) => {
  res.redirect('/admin#tab-live');
});

// GET — Public status API (used by header and pages)
app.get('/api/live-study/status', (req, res) => {
  const liveSession = studySessions.find(s => s.status === 'LIVE') || null;
  res.json({ isLive: !!liveSession, session: liveSession });
});

// GET — All sessions list (admin only — requires auth session)
app.get('/api/live-study/all', (req, res) => {
  if (!isMasterAdminAuthenticated(req)) return res.status(403).json({ success: false, message: 'Not authorised.' });
  const sorted = [...studySessions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, sessions: sorted });
});

// POST — Verify admin password
app.post('/api/live-study/auth', (req, res) => {
  const clientIp = getClientIp(req);
  const rateLimitErr = checkAdminRateLimit(clientIp);
  if (rateLimitErr) {
    return res.status(429).json({ success: false, message: rateLimitErr });
  }

  const { password } = req.body;
  if (checkMasterPassword(password)) {
    recordAdminLoginSuccess(clientIp);
    req.session.isAdmin = true;
    req.session.isStoreAdmin = true;
    req.session.liveAdminAuthed = true;
    req.session.adminLoggedInAt = new Date().toISOString();
    return res.json({ success: true });
  }

  recordAdminLoginFailure(clientIp);
  return res.status(401).json({ success: false, message: 'Incorrect password.' });
});

// Helper to format elapsed session duration nicely
function formatElapsedDuration(startIso, endIso) {
  if (!startIso || !endIso) return '1 Hour';
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const diffMs = Math.max(0, end - start);
  const diffMin = Math.round(diffMs / (1000 * 60));
  if (diffMin < 1) return '1 Min';
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours > 0 && mins > 0) return `${hours} Hr ${mins} Min`;
  if (hours > 0) return `${hours} ${hours === 1 ? 'Hour' : 'Hours'}`;
  return `${mins} Min`;
}

// POST — Activate a live session
app.post('/api/live-study/activate', (req, res) => {
  if (!isMasterAdminAuthenticated(req)) return res.status(403).json({ success: false, message: 'Not authorised.' });
  const { youtubeUrl, title, description, duration } = req.body;
  if (!youtubeUrl || !title) return res.status(400).json({ success: false, message: 'URL and title are required.' });

  const videoId = extractYoutubeVideoId(youtubeUrl);
  if (!videoId) return res.status(400).json({ success: false, message: 'Could not extract YouTube video ID from that URL.' });

  // Reject if a LIVE session already exists
  const existingLive = studySessions.find(s => s.status === 'LIVE');
  if (existingLive) {
    return res.status(409).json({ success: false, message: 'A live session is already active. End it first before starting a new one.', existingSession: existingLive });
  }

  const now = new Date().toISOString();
  const session = {
    id: uuidv4(),
    title: title.trim(),
    description: (description || '').trim(),
    youtubeUrl: youtubeUrl.trim(),
    youtubeVideoId: videoId,
    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    duration: (duration || '').trim(),
    status: 'LIVE',
    scheduledAt: null,
    startedAt: now,
    endedAt: null,
    createdAt: now
  };
  studySessions.unshift(session);
  saveStudySessions();
  res.json({ success: true, session });
});

// POST — End the current live session
app.post('/api/live-study/end', (req, res) => {
  if (!isMasterAdminAuthenticated(req)) return res.status(403).json({ success: false, message: 'Not authorised.' });
  let ended = false;
  const now = new Date().toISOString();
  studySessions.forEach(s => {
    if (s.status === 'LIVE') {
      s.status = 'COMPLETED';
      s.endedAt = now;
      if (!s.duration || s.duration.trim() === '') {
        s.duration = formatElapsedDuration(s.startedAt, s.endedAt);
      }
      ended = true;
    }
  });
  saveStudySessions();
  if (ended) return res.json({ success: true });
  res.json({ success: false, message: 'No active live session found.' });
});

// POST — Manually add a past session
app.post('/api/live-study/add-past', (req, res) => {
  if (!isMasterAdminAuthenticated(req)) return res.status(403).json({ success: false, message: 'Not authorised.' });
  const { youtubeUrl, title, description, duration, sessionDate, thumbnail } = req.body;
  if (!youtubeUrl || !title) return res.status(400).json({ success: false, message: 'URL and title are required.' });

  const videoId = extractYoutubeVideoId(youtubeUrl);
  if (!videoId) return res.status(400).json({ success: false, message: 'Could not extract YouTube video ID.' });

  // Prevent duplicate past session submissions
  const duplicate = studySessions.find(s => s.youtubeVideoId === videoId);
  if (duplicate) {
    return res.status(409).json({ success: false, message: 'This YouTube recording has already been added.' });
  }

  const session = {
    id: uuidv4(),
    title: title.trim(),
    description: (description || '').trim(),
    youtubeUrl: youtubeUrl.trim(),
    youtubeVideoId: videoId,
    thumbnail: thumbnail && thumbnail.trim() ? thumbnail.trim() : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    duration: (duration || '').trim(),
    status: 'COMPLETED',
    scheduledAt: null,
    startedAt: sessionDate ? new Date(sessionDate).toISOString() : new Date().toISOString(),
    endedAt: sessionDate ? new Date(sessionDate).toISOString() : new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  studySessions.unshift(session);
  saveStudySessions();
  res.json({ success: true, session });
});

// DELETE — Remove a session (cannot delete active LIVE session)
app.delete('/api/live-study/delete/:id', (req, res) => {
  if (!isMasterAdminAuthenticated(req)) return res.status(403).json({ success: false, message: 'Not authorised.' });
  const { id } = req.params;
  const target = studySessions.find(s => s.id === id);
  if (!target) return res.status(404).json({ success: false, message: 'Session not found.' });
  if (target.status === 'LIVE') return res.status(400).json({ success: false, message: 'Cannot delete an active LIVE session. End it first.' });
  studySessions = studySessions.filter(s => s.id !== id);
  saveStudySessions();
  res.json({ success: true });
});
// ─────────────────────────────────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
