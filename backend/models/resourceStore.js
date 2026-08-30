const fs = require('fs');
const path = require('path');

const resourcesDataFilePath = path.join(__dirname, '..', 'data', 'resources.json');
let examResources = [];

try {
  if (fs.existsSync(resourcesDataFilePath)) {
    examResources = JSON.parse(fs.readFileSync(resourcesDataFilePath, 'utf8'));
  }
} catch (e) {
  console.error('[ResourceStore] Could not load resources.json:', e.message);
}

function saveExamResources() {
  try {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.writeFileSync(resourcesDataFilePath, JSON.stringify(examResources, null, 2), 'utf8');
  } catch (e) {
    console.error('[ResourceStore] Could not save resources.json:', e.message);
  }
}

module.exports = {
  getResources: () => examResources,
  setResources: (res) => { examResources = res; },
  saveExamResources
};
