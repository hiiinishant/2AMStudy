const fs = require('fs');
const path = require('path');

const shopperFeedbacksFilePath = path.join(__dirname, '..', 'data', 'shopperFeedbacks.json');
let shopperFeedbacks = [];

try {
  if (fs.existsSync(shopperFeedbacksFilePath)) {
    shopperFeedbacks = JSON.parse(fs.readFileSync(shopperFeedbacksFilePath, 'utf8'));
  }
} catch (e) {
  console.error('[FeedbackStore] Could not load shopperFeedbacks.json:', e.message);
}

function saveShopperFeedbacks() {
  try {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.writeFileSync(shopperFeedbacksFilePath, JSON.stringify(shopperFeedbacks, null, 2), 'utf8');
  } catch (e) {
    console.error('[FeedbackStore] Could not save shopperFeedbacks.json:', e.message);
  }
}

module.exports = {
  getFeedbacks: () => shopperFeedbacks,
  setFeedbacks: (f) => { shopperFeedbacks = f; },
  saveShopperFeedbacks
};
