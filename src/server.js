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
require('dotenv').config();

const app = express();

// Enable CORS for cross-origin requests (strict validation)
app.use(cors({
  origin: [
    "https://2amstudy.vercel.app",
    "https://2amstudy.online",
    "https://2amstudy-rokrnkxpj-nishant-4us-projects.vercel.app"
  ],
  credentials: true
}));

// Trust proxy for secure cookies on Render
app.set('trust proxy', 1);

const port = process.env.PORT || 3000;
const STORE_PRODUCTS = [
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
    reviews: [{ user: 'Kavya R.', rating: 5, comment: 'Everything I need in one pouch! No more searching for supplies. Best value!', date: '2026-03-13' }, { user: 'Ishaan M.', rating: 5, comment: 'Perfect starter kit. The pouch quality is great too.', date: '2026-02-27' }, { user: 'Pranjal S.', rating: 4, comment: 'Good variety of items. The pouch keeps everything organized.', date: '2026-02-09' }]
  },
];
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
    sameSite: isProduction ? 'none' : 'lax'
  }
}));

// Multer config for product image uploads
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
  res.render('index', {
    pageTitle: '2AM Study - #1 Student Productivity Hub, Focus Timer & Study Tips',
    metaDescription: 'Boost your student productivity with 2AM Study. Use our Pomodoro focus timer, academic planner, and expert study tips for effective exam preparation and concentration.',
  });
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

app.get('/notes', (req, res) => {
  res.render('notes', {
    pageTitle: 'Free Study Notes & Academic PDF Guides for Students',
    metaDescription: 'Download free student notes and exam preparation guides. Access high-quality academic materials to improve your study routine.'
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
app.get('/behind-2am-study', (req, res) => {
  res.render('behind-2am-study', {
    pageTitle: 'Behind 2 AM Study - Our Story, Mission & Vision',
    metaDescription: 'Discover the story behind 2AM Study. Learn about our mission to empower students with the best focus tools and study techniques for late-night success.',
    ogTitle: 'Behind 2 AM Study: The Story of a Student Productivity Revolution',
    ogDescription: 'From late-night study sessions to a global platform. Learn how we built the ultimate hub for students to master focus and achieve academic excellence.',
    ogImage: 'https://2amstudy.com/assets/images/smart_study_banner.png',
    ogUrl: 'https://2amstudy.com/behind-2am-study'
  });
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
  return res.render('store-product', {
    pageTitle: `${product.name} | 2AM Study Store`,
    metaDescription: product.desc,
    product,
    storeProducts: STORE_PRODUCTS,
    hideBot: true
  });
});

app.get('/store/cart', (req, res) => {
  res.render('store-cart', {
    pageTitle: 'My Cart | 2AM Study Store',
    metaDescription: 'View and manage your selected items in the Student Store cart before proceeding to checkout.',
    hideBot: true,
    hideCartBubble: false,
    storeProducts: STORE_PRODUCTS
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
  const { user, rating, comment } = req.body;
  if (!user || !rating || !comment) return res.status(400).json({ success: false, error: 'All fields required' });
  if (rating < 1 || rating > 5) return res.status(400).json({ success: false, error: 'Rating must be 1-5' });
  const product = STORE_PRODUCTS.find(p => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

  const newReview = { user, rating: Number(rating), comment, date: new Date().toISOString().split('T')[0] };
  if (!product.reviews) product.reviews = [];
  product.reviews.unshift(newReview);
  product.ratingCount = (product.ratingCount || 0) + 1;
  product.rating = Number((product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length).toFixed(1));

  res.json({ success: true, message: 'Review added successfully', review: newReview });
});

// Product image upload (admin use)
app.post('/store/api/store/products/:id/images', upload.array('images', 5), (req, res) => {
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
  const couponLimitReached = cart.length > 2 || cart.some(i => i.qty > 1);

  const COUPONS = {
    'HAPPY BIRTHDAY NISHU': { type: 'full_no_delivery' },
    'HAPPY BIRTHDAY BHAIYA': { type: 'full_no_delivery' },
    'HAPPY BIRTHDAY NISHI': { type: 'full_no_delivery' },
    'HAPPY BIRTHDAY APP KO': { type: 'full_no_delivery' },
    'WELCOME': { type: 'flat_first_time', value: 100 },
    'STUDY10': { type: 'flat', value: 50 }
  };

  const upper = code.trim().toUpperCase();
  const cfg = COUPONS[upper];
  if (!cfg) return res.status(400).json({ success: false, error: 'Invalid coupon code' });

  let discount = 0;
  let freeDelivery = false;
  let message = '';

  const BIRTHDAY_COUPONS = ['HAPPY BIRTHDAY NISHU', 'HAPPY BIRTHDAY BHAIYA', 'HAPPY BIRTHDAY NISHI', 'HAPPY BIRTHDAY APP KO'];
  if (BIRTHDAY_COUPONS.includes(upper) && couponLimitReached) {
    return res.status(400).json({ success: false, error: 'Coupon not applicable: cart limit exceeded (max 2 items, qty 1 each)' });
  }

  switch (cfg.type) {
    case 'full_no_delivery':
      discount = subtotal;
      message = '🎉 Full item cost waived!';
      break;
    case 'full_with_delivery_free':
      discount = subtotal;
      freeDelivery = true;
      message = '🎉 Full item cost + free delivery!';
      break;
    case 'flat_first_time':
      if (hasOrderedBefore) return res.status(400).json({ success: false, error: 'WELCOME coupon is only for first-time orders' });
      discount = Math.min(cfg.value, subtotal);
      message = `✅ ₹${discount} off applied!`;
      break;
    case 'flat':
      discount = Math.min(cfg.value, subtotal);
      message = `✅ ₹${discount} off applied!`;
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
    metaDescription: 'Expert study tips for exam preparation, focus techniques for concentration, and productivity hacks to help students excel academically.'
  });
});
app.get('/blog/how-to-stay-focused', (req, res) => {
  res.render('blog/how-to-stay-focused', {
    pageTitle: 'How to Stay Focused While Studying | Concentration Techniques',
    metaDescription: 'Struggling with distractions? Learn expert concentration techniques and study tips to maintain deep focus for longer periods.'
  });
});
app.get('/blog/best-study-techniques', (req, res) => {
  res.render('blog/best-study-techniques', {
    pageTitle: '7 Best Study Techniques for Students | Exam Preparation',
    metaDescription: 'Master your exams with science-backed study techniques like Pomodoro, Active Recall, and Spaced Repetition for better student success.'
  });
});
app.get('/blog/avoid-distraction', (req, res) => {
  res.render('blog/avoid-distraction', {
    pageTitle: 'How to Avoid Distractions While Studying | Student Productivity',
    metaDescription: 'Transform your study environment and block digital distractions. Practical focus techniques to help students stay productive.'
  });
});
app.get('/blog/daily-study-routine', (req, res) => {
  res.render('blog/daily-study-routine', {
    pageTitle: 'Perfect Daily Study Routine for Academic Success',
    metaDescription: 'Build a consistent study schedule with our daily routine guide. Tips for balancing lectures, rest, and deep work sessions.'
  });
});
app.get('/blog/build-consistency', (req, res) => {
  res.render('blog/build-consistency', {
    pageTitle: 'How to Build Consistency in Your Study Habits',
    metaDescription: 'Motivation is the start, but consistency is the key. Learn how to maintain a long-term study routine and achieve your academic goals.'
  });
});
app.get('/blog/no-motivation-2am-study', (req, res) => {
  res.render('blog/no-motivation-2am-study', {
    pageTitle: 'No Motivation? Start 2AM Study With Me',
    metaDescription: 'Learn how to overcome a lack of study motivation with our actionable 2AM strategy and focus tools.'
  });
});

app.get('/blog/mistakes-before-exams', (req, res) => {
  res.render('blog/mistakes-before-exams', {
    pageTitle: '20 Common Mistakes Students Make 7 Days Before Exams | 2AM Study',
    metaDescription: 'Avoid these 20 common exam mistakes and last-minute preparation errors. Get the best study tips for 7 days before exams to improve your academic performance with 2AM Study.'
  });
});



app.get('/blog/focus-tips', (req, res) => {
  res.render('blog/focus-tips', {
    pageTitle: 'Focus Tips - How to Stay Focused While Studying',
    metaDescription: 'Explore practical focus tips for students that improve concentration, study productivity, and effective learning habits while studying.',
  });
});

app.get('/blog/study-routine-guide', (req, res) => {
  res.render('blog/study-routine-guide', {
    pageTitle: 'Study Routine Guide - Best Study Schedule for Students',
    metaDescription: 'Discover the best study routine for students with daily habits, focus strategies, and productivity tips.',
  });
});

app.get('/blog/study-at-night', (req, res) => {
  res.render('blog/study-at-night', {
    pageTitle: 'Study at Night - How to Study at 2AM Effectively',
    metaDescription: 'Learn how to study at night with a smart 2AM study strategy, nighttime productivity tips, and ways to balance rest.',
  });
});

app.get('/blog/smart-work-student-success', (req, res) => {
  res.render('blog/smart-work-student-success', {
    pageTitle: 'How 2 AM Study Transforms Hard Work into Smart Work for Student Success',
    metaDescription: 'Learn how to maximize output and minimize burnout by shifting from mere hard work to effective smart work with 2AM Study.',
  });
});

// --- Study Tools ---
app.get('/study-tools', (req, res) => {
  res.render('tools/index', {
    pageTitle: 'Student Productivity Tools Hub | Complete Academic Toolkit',
    metaDescription: 'Discover a comprehensive suite of student productivity tools. From syllabus trackers to timetable generators, we provide everything you need to succeed.'
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

app.post('/store/api/store/verify-payment', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ verified: false, error: 'Missing payment verification fields.' });
    }

    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '');
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest('hex');
    const verified = generatedSignature === razorpay_signature;

    if (!verified) {
      return res.status(400).json({ verified: false, error: 'Payment verification failed.' });
    }
    return res.json({ verified: true });
  } catch (error) {
    console.error('Razorpay verify error:', error);
    return res.status(500).json({ verified: false, error: 'Verification service unavailable.' });
  }
});

// Help Bot Doubt Solver (AI Proxy)
const doubtHandler = require('../api/doubt');
app.post('/api/doubt', doubtHandler);

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
