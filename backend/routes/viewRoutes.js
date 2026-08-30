const express = require('express');
const router = express.Router();

const productStore = require('../models/productStore');
const sessionStore = require('../models/sessionStore');
const feedbackStore = require('../models/feedbackStore');
const collegeLifeStore = require('../models/collegeLifeStore');
const resourceStore = require('../models/resourceStore');
const transporter = require('../config/mail');

// Home Page
router.get('/', (req, res) => {
  const studySessions = sessionStore.getSessions();
  const liveSession = studySessions.find(s => s.status === 'LIVE') || null;
  const latestPastSession = studySessions
    .filter(s => s.status === 'COMPLETED')
    .sort((a, b) => new Date(b.endedAt || b.createdAt) - new Date(a.endedAt || a.createdAt))[0] || null;

  res.render('index', {
    pageTitle: '2AM Study - #1 Student Productivity Hub, Focus Timer & Study Tips',
    metaDescription: 'Boost your student productivity with 2AM Study. Use our Pomodoro focus timer, academic planner, and expert study tips for effective exam preparation and concentration.',
    shopperFeedbacks: feedbackStore.getFeedbacks(),
    liveSession,
    latestPastSession,
    collegeVideos: collegeLifeStore.getVideos().slice(0, 3),
    storeProducts: productStore.getProducts()
  });
});

// Authentication Pages
router.get('/login', (req, res) => {
  res.render('login', {
    pageTitle: 'Log In | 2AM Study & Student Safety Hub',
    metaDescription: 'Log in to your 2AM Study account to access personalized study tools, student safety reports, and order tracking.'
  });
});

router.get('/signup', (req, res) => {
  res.render('signup', {
    pageTitle: 'Sign Up | Join 2AM Study Student Community',
    metaDescription: 'Create your free 2AM Study account to track study streaks, access student safety shield, and get student store benefits.'
  });
});

router.get('/forgot-password', (req, res) => {
  res.redirect('/login?resetprompt=1');
});

router.get('/profile', (req, res) => {
  res.render('profile', {
    pageTitle: 'My Profile | 2AM Study',
    metaDescription: 'Manage your student profile, trust score, saved reports, and preferences on 2AM Study.'
  });
});

// Student Tools
router.get('/timer', (req, res) => {
  res.render('timer', {
    pageTitle: 'Best Pomodoro Focus Timer for Students | Study Better',
    metaDescription: 'Master focus techniques with our aesthetic Pomodoro timer. Customizable study intervals and distraction blocking to enhance your deep work sessions.'
  });
});

router.get('/tasks', (req, res) => {
  res.render('tasks', {
    pageTitle: 'Academic Planner & Student Task Manager | Stay Productive',
    metaDescription: 'Organize your study routine with our free academic planner. Track assignments and exam preparation goals to maintain high student productivity.'
  });
});

router.get('/flashcards', (req, res) => {
  res.render('flashcards', {
    pageTitle: 'AI Flashcard Maker - Convert PDF to Study Cards Instantly',
    metaDescription: 'Accelerate your exam preparation with our AI-powered flashcard maker. Transform lecture notes into interactive study tools using advanced extraction.'
  });
});

// Exam Resource Center
const RESOURCE_HUB_META = {
  pageTitle: 'Exam Resource Center | Official PYQs, Syllabus & Notifications',
  metaDescription: 'Free access to official exam resources — Previous Year Papers, Syllabus, Notifications, Answer Keys, Cut-offs and more for GATE, UPSC, NEET, JEE, CAT, SSC and 9 other exams.',
  ogTitle: 'Official Exam Resource Center | 2AM Study',
  ogDescription: 'One-stop hub for official study resources across 13 major exams. Every link goes directly to the official source.'
};

router.get('/notes', (req, res) => {
  res.render('notes', { ...RESOURCE_HUB_META, resources: resourceStore.getResources() });
});

router.get('/resources', (req, res) => {
  res.render('notes', { ...RESOURCE_HUB_META, resources: resourceStore.getResources() });
});

router.get('/resources/:examSlug', (req, res) => {
  const slug = req.params.examSlug.toLowerCase().trim();
  const examResources = resourceStore.getResources();
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

// Community & Study Environment Pages

router.get('/music', (req, res) => {
  res.render('music', {
    pageTitle: 'Lofi Study Music - Best Focus & Concentration Beats',
    metaDescription: 'Listen to curated focus music, lofi beats, and ambient sounds designed to help students concentrate and reach deep work states.',
    youtubeApiKey: process.env.YOUTUBE_API_KEY || ''
  });
});

router.get('/quotes', (req, res) => {
  res.render('quotes', {
    pageTitle: 'Motivational Study Quotes - Get Inspired Daily',
    metaDescription: 'Collection of aesthetic motivational quotes for students. Export to custom backgrounds to keep yourself inspired throughout the semester.'
  });
});

router.get('/game', (req, res) => {
  res.render('game', {
    pageTitle: 'Study Reward Games - Fun Challenges for Productive Students',
    metaDescription: 'Unlock fun, focus-enhancing games as a reward for completing your study sessions. The perfect way to recharge between tasks.'
  });
});

router.get('/calculator', (req, res) => {
  res.render('calculator', {
    pageTitle: 'Scientific Calculator Online - Fast & Free for Students',
    metaDescription: 'Simple and powerful online scientific calculator for solving math, physics, and engineering problems during your study sessions.'
  });
});

router.get('/clock', (req, res) => {
  res.render('clock', {
    pageTitle: 'Digital Study Clock - Full-Screen Time Management',
    metaDescription: 'Minimalist full-screen digital clock to keep you aware of time during focused study sessions. Aesthetic and distraction-free.'
  });
});

router.get('/streak', (req, res) => {
  res.render('streak', {
    pageTitle: 'Study Streak Tracker & Leaderboard - Gamify Your Grades',
    metaDescription: 'Track your daily study consistency and compete on the global leaderboard. Build powerful habits through study streaks.'
  });
});

router.get('/college-student', (req, res) => {
  res.render('college-student', {
    pageTitle: 'College Student Support - Mental Health & Academic Help',
    metaDescription: 'Resources and support for navigating college life. From emotional wellness to academic guidance, we’re here for you.'
  });
});

router.get('/settings', (req, res) => {
  res.render('settings', {
    pageTitle: '⚙️ Settings | 2AM Study Account',
    metaDescription: 'Manage your profile settings, display name, and institution preferences.'
  });
});

router.get('/reminder', (req, res) => {
  res.render('reminder', {
    pageTitle: 'Smart Study Reminders - Never Forget a Session',
    metaDescription: 'Set persistent time-based alerts and notifications to keep your study routine on track. Manage your time effectively.'
  });
});

router.get('/distraction', (req, res) => {
  res.render('distraction', {
    pageTitle: 'Distraction Blocker - Stay Focused on Your Page',
    metaDescription: 'Prevent accidental tab-surfing and social media distractions with our built-in blocker. Maintain deep focus for longer.'
  });
});

// Study Tools Hub & Special Tools
router.get('/study-tools', (req, res) => {
  res.render('tools/index', {
    pageTitle: 'Student Productivity Tools Hub | Complete Academic Toolkit',
    metaDescription: 'Discover a comprehensive suite of student productivity tools. From syllabus trackers to timetable generators, we provide everything you need to succeed.'
  });
});

router.get('/exam-countdown', (req, res) => {
  res.render('tools/exam-countdown', {
    pageTitle: 'Online Exam Countdown Timer | Track Your Study Deadlines',
    metaDescription: 'Never miss an exam date again. Set multiple countdown timers for your finals and stay on top of your academic preparation.'
  });
});

router.get('/syllabus-tracker', (req, res) => {
  res.render('tools/syllabus-tracker', {
    pageTitle: 'Free Syllabus Tracker Online | Track Subject Progress',
    metaDescription: 'Visualize your course completion with our interactive syllabus tracker. Stay motivated by checking off chapters as you study.'
  });
});

router.get('/timetable-generator', (req, res) => {
  res.render('tools/timetable-generator', {
    pageTitle: 'Student Study Timetable Generator | PDF Export',
    metaDescription: 'Create a professional and personalized study schedule in seconds. Optimize your study routine and export your timetable as a PDF.'
  });
});

// Calculators
router.get('/calculators', (req, res) => {
  res.render('calculators/index', {
    pageTitle: 'Student Calculator Hub: GPA, Age & Percentage Tools',
    metaDescription: 'Access free online calculators for students. Calculate GPA/CGPA, score percentages, and precise age with our easy-to-use tools.'
  });
});

router.get('/calculators/cgpa', (req, res) => {
  res.render('calculators/cgpa', {
    pageTitle: 'Online CGPA Calculator for Students | Academic Success',
    metaDescription: 'Calculate your semester and cumulative GPA easily. Enter your grades and credits to track your academic performance.'
  });
});

router.get('/calculators/percentage', (req, res) => {
  res.render('calculators/percentage', {
    pageTitle: 'Free Percentage Calculator Online | Score & Grade Tool',
    metaDescription: 'Calculate marks percentage, academic scores, and fractional increases instantly with our free student tool.'
  });
});

router.get('/calculators/age', (req, res) => {
  res.render('calculators/age', {
    pageTitle: 'Online Age Calculator | Precise Years, Months & Days',
    metaDescription: 'Find your exact age in seconds. Perfect for filling out student applications and administrative forms.'
  });
});

// Utilities
router.get('/utilities', (req, res) => {
  res.render('utilities/index', {
    pageTitle: 'Student Utility Hub - Free AQI, Grammar & Word Tools',
    metaDescription: 'Collection of essential digital utilities for students: Air Quality indexes, Grammar checkers, Word counters, and more.'
  });
});

router.get('/weather', (req, res) => {
  res.render('utilities/weather', {
    pageTitle: 'Local Weather Tracker - Plan Your Campus Commute',
    metaDescription: 'Get real-time weather updates and 7-day forecasts. Essential for students planning their daily campus travels.'
  });
});

router.get('/compass', (req, res) => {
  res.render('utilities/compass', {
    pageTitle: 'Digital Compass Online - Easy Direction Finder',
    metaDescription: 'Reliable in-browser digital compass. Useful for student orientation and outdoor academic trips.'
  });
});

router.get('/word-counter', (req, res) => {
  res.render('utilities/word-counter', {
    pageTitle: 'Free Word & Character Counter - Writing Tool for Essays',
    metaDescription: 'Accurately count words, characters, and sentences. Ideal for meeting essay word counts and document formatting.'
  });
});

router.get('/grammar-checker', (req, res) => {
  res.render('utilities/grammar-checker', {
    pageTitle: 'Free AI Grammar Checker - Polish Your Student Essays',
    metaDescription: 'Instantly find and fix grammar, spelling, and punctuation errors. Ensure your academic work is professional and error-free.'
  });
});

router.get('/air-quality', (req, res) => {
  res.render('utilities/air-quality', {
    pageTitle: 'Real-time Air Quality & AQI Checker for Students',
    metaDescription: 'Monitor local air pollution levels. Health-focused insights for students and commuters based on real-time sensor data.'
  });
});

// PDF Tools
router.get('/pdf-tools/maker', (req, res) => {
  res.render('pdf-tools/maker', {
    pageTitle: 'Online PDF Maker - Convert Images & Text to PDF',
    metaDescription: 'Create high-quality PDF documents from images or text. Fast, secure, and perfect for organizing study notes.'
  });
});

router.get('/pdf-tools/merger', (req, res) => {
  res.render('pdf-tools/merger', {
    pageTitle: 'Merge PDF Online - Combine Multiple PDFs Fast',
    metaDescription: 'Join several PDF files into one neatly organized document. Perfect for combining multiple assignment parts or research papers.'
  });
});

router.get('/pdf-tools/splitter', (req, res) => {
  res.render('pdf-tools/splitter', {
    pageTitle: 'Split PDF Online - Extract Pages from Any PDF',
    metaDescription: 'Extract specific pages or separate one large PDF into individual files. Ideal for managing massive academic textbooks.'
  });
});

router.get('/pdf-tools/editor', (req, res) => {
  res.render('pdf-tools/editor', {
    pageTitle: 'Free PDF Editor - Annotate & Draw on PDFs Online',
    metaDescription: 'Highlight text, add annotations, and draw directly on your PDFs. The essential tool for digital note-taking.'
  });
});

router.get('/pdf-tools/compressor', (req, res) => {
  res.render('pdf-tools/compressor', {
    pageTitle: 'PDF Compressor - Reduce File Size for Easy Sharing',
    metaDescription: 'Shrink your large PDF documents without losing quality. Perfect for emailing assignments or uploading to portals with size limits.'
  });
});

router.get('/pdf-tools/converter', (req, res) => {
  res.render('pdf-tools/converter', {
    pageTitle: 'PDF Converter - Change Formats Quickly & Easily',
    metaDescription: 'Convert common document formats to and from PDF. Flexible file management for all your student projects.'
  });
});

// Legal & Info Pages
router.get('/privacy-policy', (req, res) => {
  res.render('privacy-policy', {
    pageTitle: 'Privacy Policy | 2AM Study Data Protection',
    metaDescription: 'Read our privacy policy to understand how we protect your student productivity data and maintain your privacy on our platform.'
  });
});

router.get('/terms', (req, res) => {
  res.render('terms', {
    pageTitle: 'Terms & Conditions | Student Usage Guidelines',
    metaDescription: 'Understand the terms of service for using 2AM Study productivity tools, focus techniques, and community resources.'
  });
});

router.get('/about', (req, res) => {
  res.render('about', {
    pageTitle: 'About 2AM Study - Empowering Students with Focus Techniques',
    metaDescription: 'Learn about our mission to improve student productivity through smart work, effective study tips, and free academic tools.'
  });
});

router.get('/contact', (req, res) => {
  res.render('contact', {
    pageTitle: 'Contact Us | Support for Student Productivity Tools',
    metaDescription: 'Need help with our study tools or focus techniques? Contact the 2AM Study support team for academic guidance and assistance.'
  });
});

router.get('/faqs', (req, res) => {
  res.render('faqs', {
    pageTitle: 'How I Can Help You – Q&A | FAQs & Student-First Support - 2AM Study',
    metaDescription: 'From classrooms to life goals — here’s how we make it happen. Frequently asked questions on study strategies, 2 AM Study tools, store essentials, and student safety.',
    ogTitle: 'How I Can Help You – Q&A | 2AM Study FAQs',
    ogDescription: 'From classrooms to life goals — here’s how we make it happen. Clear answers to your study routines, focus techniques, store essentials, and student safety questions.'
  });
});

router.get('/faq', (req, res) => {
  res.redirect('/faqs');
});

// Contact / Registration form submission
router.post('/send-email', async (req, res) => {
  const { formName } = req.body;
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

module.exports = router;
