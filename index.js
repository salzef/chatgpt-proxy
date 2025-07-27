const express = require("express");
const { Pool } = require("pg");
const OpenAI = require("openai");
const app = express();
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Connect to PostgreSQL (Railway sets DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create table on startup (optional safety)
pool.query(`
  CREATE TABLE IF NOT EXISTS chat_memory (
    contact_id VARCHAR(128) PRIMARY KEY,
    messages JSONB NOT NULL DEFAULT '[]'
  )
`).then(() => console.log('✅ chat_memory table ready!'));

// Helpers to get and save chat history
async function getChatHistory(contactId, systemPrompt) {
  const result = await pool.query(
    "SELECT messages FROM chat_memory WHERE contact_id = $1",
    [contactId]
  );
  if (result.rows.length > 0) {
    return result.rows[0].messages;
  }
  // If new user, start with system prompt
  return [{ role: "system", content: systemPrompt }];
}

async function saveChatHistory(contactId, messages) {
  await pool.query(
    `INSERT INTO chat_memory (contact_id, messages)
     VALUES ($1, $2)
     ON CONFLICT (contact_id) DO UPDATE SET messages = $2`,
    [contactId, JSON.stringify(messages)]
  );
}

// Your chatbot's instructions:
const SYSTEM_PROMPT = `
You are a friendly, sales-focused chatbot for Detailers Growth in Dallas, TX.
Your goals:
- Engage visitors about ceramic coatings and related services.
- Ask clarifying questions to understand their needs before making recommendations.
- Provide helpful, accurate, and persuasive info about ceramic coatings, interior detailing, and aftercare.
- Guide visitors toward booking a service or making a purchase, but never skip the "reasoning" phase.
- Always refer to company details, e.g., 5-year warranty, $599 sedan/$799 SUV pricing, 2-step paint correction.
`;

// Main chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const contactId = req.body.contact_id;
    if (!contactId) return res.status(400).json({ error: "Missing contact_id" });
    const userMsg = req.body.message || "";

    // 1. Get previous history or start with system prompt
    let messages = await getChatHistory(contactId, SYSTEM_PROMPT);

    // Optional: limit to last 20 messages to stay within OpenAI token limits
    if (messages.length > 20) {
      messages = [messages[0], ...messages.slice(-19)];
    }

    // 2. Add the new user message
    messages.push({ role: "user", content: userMsg });

    // 3. Call OpenAI
    const chatRes = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      max_tokens: 1024,
      temperature: 1,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      response_format: { type: "text" }
    });

    const reply = chatRes.choices?.[0]?.message?.content || "No reply generated.";

    // 4. Add the AI reply to memory
    messages.push({ role: "assistant", content: reply });

    // 5. Save updated memory
    await saveChatHistory(contactId, messages);

    res.json({ reply });
  } catch (err) {
    console.error("Error:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message || "Unknown error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));
