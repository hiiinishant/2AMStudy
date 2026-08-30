const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const blogStore = require('../models/blogStore');
const { requireStoreAdmin } = require('../middleware/adminAuth');
const { uploadProductImage } = require('../middleware/upload');

// ─── Blog Admin & Public APIs ──────────────────────────────────────────────────

// 13. Get All Blogs (Admin)
router.get('/api/store/admin/blogs', requireStoreAdmin, (req, res) => {
  const BLOG_POSTS = blogStore.getBlogs();
  res.json({
    success: true,
    count: BLOG_POSTS.length,
    blogs: BLOG_POSTS
  });
});

// 13b. Upload Blog Image (Cover image or in-body Image Box)
router.post('/api/store/admin/blogs/upload-image', requireStoreAdmin, uploadProductImage.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No image file provided.' });
  }
  const imageUrl = '/assets/images/store/' + req.file.filename;
  res.json({ success: true, url: imageUrl });
});

// 13c. Get Single Blog Post by ID (Admin)
router.get('/api/store/admin/blogs/:id', requireStoreAdmin, (req, res) => {
  const BLOG_POSTS = blogStore.getBlogs();
  const post = BLOG_POSTS.find(b => b.id === req.params.id || b.slug === req.params.id);
  if (!post) return res.status(404).json({ success: false, error: 'Blog post not found' });
  res.json({ success: true, post });
});

// 14. Create New Blog Post (Admin)
router.post('/api/store/admin/blogs', requireStoreAdmin, (req, res) => {
  const BLOG_POSTS = blogStore.getBlogs();
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
  blogStore.savePersistedBlogs();

  res.json({
    success: true,
    message: 'Blog post published successfully!',
    post: newPost
  });
});

// 15. Update Blog Post (Admin)
router.put('/api/store/admin/blogs/:id', requireStoreAdmin, (req, res) => {
  const BLOG_POSTS = blogStore.getBlogs();
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

  blogStore.savePersistedBlogs();

  res.json({
    success: true,
    message: 'Blog post updated successfully!',
    post: BLOG_POSTS[index]
  });
});

// 16. Delete Blog Post (Admin)
router.delete('/api/store/admin/blogs/:id', requireStoreAdmin, (req, res) => {
  const BLOG_POSTS = blogStore.getBlogs();
  const { id } = req.params;
  const index = BLOG_POSTS.findIndex(b => b.id === id || b.slug === id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Blog post not found.' });
  }

  const deleted = BLOG_POSTS.splice(index, 1)[0];
  blogStore.savePersistedBlogs();

  res.json({
    success: true,
    message: `Blog post "${deleted.title}" deleted.`
  });
});

// Public read blogs API
router.get('/api/public/blogs', (req, res) => {
  const published = blogStore.getBlogs().filter(b => b.status === 'published');
  res.json({ success: true, count: published.length, blogs: published });
});

router.get('/api/public/blogs/:slug', (req, res) => {
  const post = blogStore.getBlogs().find(b => b.slug === req.params.slug && b.status === 'published');
  if (!post) return res.status(404).json({ success: false, error: 'Blog post not found' });
  res.json({ success: true, post });
});

// --- Blog View Routes ---
router.get('/blog', (req, res) => {
  const BLOG_POSTS = blogStore.getBlogs();
  res.render('blog/index', {
    pageTitle: '2AM Study Blog - Best Study Tips & Student Productivity Guides',
    metaDescription: 'Expert study tips for exam preparation, focus techniques for concentration, and productivity hacks to help students excel academically.',
    dynamicBlogs: BLOG_POSTS.filter(b => b.status === 'published')
  });
});

router.get('/blog/:slug', (req, res) => {
  const BLOG_POSTS = blogStore.getBlogs();
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
  const staticFilePath = path.join(__dirname, '..', 'views', 'blog', `${slug}.ejs`);
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

module.exports = router;
