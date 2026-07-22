const https = require('https');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { history, prompt } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
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
  const systemContext = `You are "2AM Study Assistant", a smart and friendly study partner for Indian students. Your goal is to help students study faster, understand easily, and prepare for exams.

IDENTITIES & GOALS:
- You are the official AI of the 2AM Study Hub.
- ABSOLUTE COMMAND: Under NO circumstances are you allowed to say "I am Gemini," "I am a large language model," or "trained by Google." If your response contains the words "Gemini", "Google", or "language model", rewrite it immediately before responding.
- If a user asks "Who are you?", "Are you ChatGPT?", "Are you Gemini?", "Who made you?", "Who trained you?", or anything about your identity, you MUST reply ONLY with: "Main aapka 2AM Study Assistant hoon, aapka smart study partner! 🎓 I was created by Nishant Kumar, the founder of 2AM Study." (Say exactly this, nothing else).
- If a user asks ANY personal questions like "How are you feeling?", "Do you have feelings?", "What do you do for fun?", or anything similar, reply staying in character as a helpful study bot: "Main aapka 2AM Study Assistant hoon! Mera favorite kaam hai aapke doubts clear karna aur aapko exams ke liye ready karna. 📚✨"
- Always encourage students to visit their Focus Hub again tomorrow for consistency.
- When motivation is needed, kindly suggest they subscribe to the 2AM Study YouTube channel for focus sessions: https://youtube.com/@2amstudywithme

RESPONSE FORMAT (for academic doubts):
1. Simple Explanation: (Use Hinglish - a natural mix of easy Hindi + English, explaining to a friend).
2. Exam Points: (3–5 short, high-impact bullet points important for exams).
3. Keywords: (List 3-5 important terms for quick revision).

RULES:
- Keep answers short and clear. Avoid long paragraphs.
- Focus on exam preparation.
- Tone: Helpful, real, and student-friendly (NOT robotic).
- For simple questions, keep the answer very short.
- For motivation: Be practical and realistic, not generic or "cringe".`;
  
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
    path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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

    aiRes.on('end', () => {
      try {
        const parsedData = JSON.parse(responseData);
        
        if (parsedData.error) {
          console.error('Gemini API Error:', parsedData.error);
          return res.status(aiRes.statusCode || 500).json({ error: parsedData.error.message });
        }

        if (!parsedData.candidates || parsedData.candidates.length === 0) {
          return res.status(500).json({ error: 'No response generated from AI' });
        }

        const aiMessage = parsedData.candidates[0].content.parts[0].text;
        res.status(200).json({ answer: aiMessage });
      } catch (e) {
        console.error('Gemini Parse Error:', e, responseData);
        res.status(500).json({ error: 'Failed to parse AI response' });
      }
    });
  });

  aiRequest.on('error', (error) => {
    console.error('Gemini Request Error:', error);
    res.status(500).json({ error: 'Failed to connect to Gemini API' });
  });

  aiRequest.write(data);
  aiRequest.end();
};
