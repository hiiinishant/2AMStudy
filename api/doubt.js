const https = require('https');

const requestCounts = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const record = requestCounts.get(ip);
  if (!record || now - record.startedAt >= WINDOW_MS) {
    requestCounts.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  record.count += 1;
  return record.count > MAX_REQUESTS_PER_WINDOW;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isRateLimited(getClientIp(req))) {
    return res.status(429).json({ error: 'Too many requests. Please try again in a minute.' });
  }

  const { history, prompt } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI service is not configured.' });
  }
  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > 4000) {
    return res.status(400).json({ error: 'A prompt between 1 and 4000 characters is required.' });
  }
  if (history && (!Array.isArray(history) || history.length > 30)) {
    return res.status(400).json({ error: 'Conversation history is invalid or too long.' });
  }

  // Build the contents array for Gemini multi-turn chat
  // If 'history' is provided, it should be an array of { role: 'user'|'model', text: '' }
  let contents = [];
  
  if (history && Array.isArray(history)) {
    contents = history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));
  }

  // System instructions for the persona and format
  const systemContext = `You are "2 AM Study Assistant", a smart, friendly, and concise study partner for Indian students created by Nishant Kumar (founder of 2AM Study).

IDENTITIES & RULES:
- You are the official AI of 2AM Study Hub.
- ABSOLUTE COMMAND: Under NO circumstances are you allowed to say "I am Gemini," "I am a large language model," or "trained by Google."
- If asked "Who are you?", "Who made you?", etc., reply ONLY: "Main aapka 2 AM Study Assistant hoon, aapka smart study partner! 🎓 I was created by Nishant Kumar, founder of 2AM Study."
- YouTube Channel link: https://youtube.com/@2amstudy?si=scn2pH77qJ3FpHAL

MANDATORY RESPONSE LENGTH CONSTRAINTS:
- ALWAYS give your entire answer in EXACTLY 2 TO 3 LINES ONLY.
- NEVER write more than 3 lines. NEVER write a long essay or multi-paragraph answer.
- Explain clearly using simple Hinglish/English in 2 to 3 crisp lines.`;
  
  if (prompt) {
    // Check if the latest message in history is already this prompt (avoid duplication)
    const lastMsg = contents[contents.length - 1];
    if (!lastMsg || lastMsg.parts[0].text !== prompt) {
      const finalPrompt = contents.length === 0 ? `${systemContext}\n\nStudent Question: ${prompt}` : prompt;
      contents.push({
        role: 'user',
        parts: [{ text: finalPrompt }]
      });
    }
  }

  const data = JSON.stringify({
    contents: contents,
    generationConfig: {
      maxOutputTokens: 1000,
      temperature: 0.7
    }
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    port: 443,
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  const aiRequest = https.request(options, (aiRes) => {
    let responseData = '';
    aiRes.on('data', (chunk) => {
      responseData += chunk;
    });

    const friendlyErrorMessage = "Sorry! I'm a little busy with Nishant right now. Please try again in about a minute. 😊";

    aiRes.on('end', () => {
      try {
        const parsedData = JSON.parse(responseData);
        
        if (parsedData.error) {
          console.error('Gemini API Error:', parsedData.error);
          return res.status(200).json({ answer: friendlyErrorMessage });
        }

        if (!parsedData.candidates || parsedData.candidates.length === 0) {
          return res.status(200).json({ answer: friendlyErrorMessage });
        }

        const aiMessage = parsedData.candidates[0].content.parts[0].text;
        res.status(200).json({ answer: aiMessage });
      } catch (e) {
        console.error('Gemini Parse Error:', e, responseData);
        res.status(200).json({ answer: friendlyErrorMessage });
      }
    });
  });

  aiRequest.on('error', (error) => {
    console.error('Gemini Request Error:', error);
    res.status(200).json({ answer: "Sorry! I'm a little busy with Nishant right now. Please try again in about a minute. 😊" });
  });

  aiRequest.write(data);
  aiRequest.end();
};
