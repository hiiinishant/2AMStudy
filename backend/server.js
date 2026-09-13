const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Configs & Services
require('./config/firebase');

// App Initialization
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// View Engine & Static Assets (from frontend/)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'frontend', 'views'));

app.use(compression());
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public'), {
  maxAge: '1d',
  etag: true
}));

// CORS Configuration
const ALLOWED_ORIGINS = [
  "https://2amstudy.com",
  "https://www.2amstudy.com",
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
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true
}));

// Body & Cookie Parsers
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Session Middleware
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || (isProduction ? null : '2am-study-store-secret');
if (!sessionSecret) {
  throw new Error('SESSION_SECRET must be configured in production.');
}
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: isProduction,
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

// Help Bot Doubt Solver (AI Proxy)
try {
  const doubtHandler = require('../api/doubt');
  app.post('/api/doubt', doubtHandler);
} catch (e) {
  console.warn('[Doubt Solver] Notice:', e.message);
}

// ─── Mount Modular Routers ───────────────────────────────────────────────────
app.use(require('./routes/authRoutes'));
app.use(require('./routes/adminRoutes'));
app.use(require('./routes/storeRoutes'));
app.use(require('./routes/liveStudyRoutes'));
app.use(require('./routes/collegeLifeRoutes'));
app.use(require('./routes/resourceRoutes'));
app.use(require('./routes/blogRoutes'));
app.use(require('./routes/safetyRoutes'));
app.use(require('./routes/viewRoutes'));

// 404 Handler
app.use((req, res) => {
  res.status(404).render('404', {
    pageTitle: 'Page Not Found | 2AM Study',
    metaDescription: 'The page you are looking for does not exist on 2AM Study.'
  });
});

// Start Server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
