/**
 * 2AM Study - Focus Bot Module
 * Handles motivational chat, progress tracking, and AI-powered doubt solving
 */

// Global state
window.FocusBot = {
  chatHistory: [],
  isOpen: false,
  isThinking: false
};

const botResponses = {
  motivate: [
    "Arre, tension mat lo! Consistency hi success ki chabi hai. Bas start karo, baaki sab ho jayega! 🚀",
    "Thoda aur zor lagao! Aapka future self aapko thank you bolega. You can do it! 💪",
    "Expert banne se pehle sab beginner hi hote hain. Study hard, results pakka aayenge! 📚",
    "Chote chote steps se hi badi success milti hai. Har din thoda padho, consistency is key! ✨",
    "Aapki limit sirf aap khud ho. Break your barriers and shine! 🌟"
  ],
  music: "Music is the best therapy! Main aapko Focus Music Studio le chalta hoon... Let's vibe and study! 🎶"
};


/**
 * Toggle the bot window display
 */
function toggleBot() {
  const botWindow = document.getElementById('bot-window');
  if (!botWindow) return;
  FocusBot.isOpen = !FocusBot.isOpen;
  botWindow.style.display = FocusBot.isOpen ? 'flex' : 'none';
}

/**
 * Reset the bot to its initial state
 */
function resetBot() {
  const botInitialOptions = document.getElementById('bot-initial-options');
  const botDoubtSolver = document.getElementById('bot-doubt-solver');
  const botProgressDashboard = document.getElementById('bot-progress-dashboard');
  const chatMessages = document.getElementById('bot-chat-messages');

  if (botInitialOptions) botInitialOptions.classList.remove('d-none');
  if (botDoubtSolver) botDoubtSolver.classList.add('d-none');
  if (botProgressDashboard) botProgressDashboard.classList.add('d-none');
  
  // Clear chat history and UI for a fresh start
  FocusBot.chatHistory = [];
  if (chatMessages) {
    // Keep only the first welcome message
    const firstMsg = chatMessages.firstElementChild;
    chatMessages.innerHTML = '';
    if (firstMsg) chatMessages.appendChild(firstMsg);
  }
}

/**
 * Handle initial menu actions
 */
async function handleBotAction(type) {
  const botInitialOptions = document.getElementById('bot-initial-options');
  const botProgressDashboard = document.getElementById('bot-progress-dashboard');
  const botProgressContent = document.getElementById('bot-progress-content');
  const botDoubtSolver = document.getElementById('bot-doubt-solver');
  const botChatBody = document.getElementById('bot-chat-body');

  if (type === 'progress') {
    const log = JSON.parse(localStorage.getItem('studyTimeLog') || '{}');
    const totalMinutes = Object.values(log).reduce((acc, val) => acc + (Number(val) || 0), 0);
    const totalHours = (totalMinutes / 60).toFixed(1);
    const streak = localStorage.getItem('studyStreakCount') || '0';
    const tasksList = JSON.parse(localStorage.getItem('studyTasks') || '[]');
    const completedTasks = tasksList.filter(t => t.completed).length;

    botInitialOptions.classList.add('d-none');
    botProgressDashboard.classList.remove('d-none');
    botProgressContent.innerHTML = `
      <strong>Your Progress:</strong><br>
      ⏱️ Total Study: ${totalHours} hours<br>
      🔥 Current Streak: ${streak} days<br>
      ✅ Tasks Done: ${completedTasks}
    `;
    return;
  }

  if (type === 'doubt') {
    botInitialOptions.classList.add('d-none');
    botDoubtSolver.classList.remove('d-none');
    // Scroll to bottom
    const messages = document.getElementById('bot-chat-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    return;
  }

  // Handle static responses (motivate, music)
  const typing = appendChatMessage('model', '<span class="opacity-50">...</span>');
  
  setTimeout(() => {
    let response = botResponses[type];
    if (Array.isArray(response)) {
      response = response[Math.floor(Math.random() * response.length)];
    }
    typing.textContent = response;
    
    if (type === 'music') {
      setTimeout(() => { window.location.href = '/music'; }, 1500);
    }
  }, 600);
}

/**
 * Append a message to the chat UI and history
 */
function appendChatMessage(role, text, isRaw = false) {
  const chatMessages = document.getElementById('bot-chat-messages');
  if (!chatMessages) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = role === 'user' 
    ? 'bot-msg text-end bg-primary text-white border-0 ms-auto' 
    : 'bot-msg';
  
  if (isRaw) {
    msgDiv.innerHTML = text;
  } else {
    msgDiv.textContent = text;
  }
  
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Add to internal history (excluding UI fragments or temporary messages)
  if (text !== '<span class="opacity-50">...</span>' && text !== '<span class="opacity-50">2 AM Study Assistant thinking...</span>') {
    FocusBot.chatHistory.push({ role, text });
  }

  return msgDiv;
}

/**
 * Submit a doubt for AI solving (Continuous Chat)
 */
async function submitDoubt() {
  const input = document.getElementById('bot-doubt-input');
  if (!input || FocusBot.isThinking) return;

  const doubt = input.value.trim();
  if (!doubt) return;

  input.value = '';
  FocusBot.isThinking = true;

  // 1. Show User Message
  appendChatMessage('user', doubt);

  // 2. Show Typing Indicator
  const typing = appendChatMessage('model', '<span class="opacity-50">2 AM Study Assistant thinking...</span>', true);

  try {
    const response = await fetch('/api/doubt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt: doubt,
        history: FocusBot.chatHistory.slice(-10) // Send last 10 messages for context
      })
    });
    
    const data = await response.json();
    
    if (data.answer) {
      typing.innerHTML = data.answer.replace(/\n/g, '<br>');
      // Update history with the actual answer
      FocusBot.chatHistory.push({ role: 'model', text: data.answer });
    } else {
      typing.innerHTML = "Sorry! I'm a little busy with Nishant right now. Please try again in about a minute. 😊";
    }
  } catch (error) {
    typing.innerHTML = "Sorry! I'm a little busy with Nishant right now. Please try again in about a minute. 😊";
  } finally {
    FocusBot.isThinking = false;
    const messages = document.getElementById('bot-chat-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
  }
}

// Initialize Bot logic
document.addEventListener('DOMContentLoaded', () => {
  // Auto-open after 1.5 seconds (Home page only)
  if (window.location.pathname === '/') {
    setTimeout(() => {
      const botWindow = document.getElementById('bot-window');
      if (botWindow && botWindow.style.display !== 'flex') {
        toggleBot();
      }
    }, 1500);
  }

  // Handle Enter key for doubt input
  const input = document.getElementById('bot-doubt-input');
  if (input) {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitDoubt();
      }
    });
  }
});
