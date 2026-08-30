const fs = require('fs');
const path = require('path');

const blogsFilePath = path.join(__dirname, '..', 'data', 'blogs.json');
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
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.writeFileSync(blogsFilePath, JSON.stringify(BLOG_POSTS, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Blog] Notice saving blogs:', e.message);
  }
}

loadPersistedBlogs();

module.exports = {
  getBlogs: () => BLOG_POSTS,
  setBlogs: (b) => { BLOG_POSTS = b; },
  savePersistedBlogs,
  loadPersistedBlogs
};
