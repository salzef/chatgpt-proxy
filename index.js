const express = require("express");
const { Pool } = require("pg");
const OpenAI = require("openai");
const app = express();
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Connect to PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Defensive FAQ lookup in "Business Info" table
async function findBusinessInfoAnswer(userMsg) {
  const result = await pool.query('SELECT * FROM "Business Info"');
  // Defensive matching: check for existence and type
  const found = result.rows.find(row =>
    typeof row.common_questions === 'string' &&
    row.common_questions.length > 0 &&
    userMsg.toLowerCase().includes(row.common_questions.toLowerCase())
  );
  return found ? found.answers : null;
}

// Ensure chat_memory table exists
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

// Chatbot instructions
const SYSTEM_PROMPT = `
Style Guide:
- ALWAYS keep every reply brief: 1-2 short sentences max.
- NEVER send more than one paragraph at a time.
- Use a friendly, upbeat, and conversational tone – but concise.
- Always use simple words and explain things like you would to a fifth grader—no jargon, no big words.
- Be concise and clear.
- Use contractions.
- Never use em dashes.
- End each reply with a short, open-ended question to keep the chat going.
- If you break any of these rules, you will not fulfill your purpose as a chatbot.
- Do NOT provide pricing, recommendations, or details about packages until you have asked and gotten answers to at least three qualifying questions from the list below.
Qualifying Questions Guide:
- ALWAYS ask only one qualifying question at a time.
- Do NOT provide pricing, recommendations, or details about packages until you have asked and gotten answers to at least three qualifying questions from the list below.
- Choose the most relevant question based on what the customer says; don't ask all at once.
- Qualifying questions:
    - What type of vehicle do you have?
    - Is your car mostly parked outside or inside?
    - Are you more concerned about protecting the paint, keeping it shiny, or both?
    - How long do you plan on keeping your car?
    - Have you used ceramic coatings or any paint protection before?
    - Are you interested in DIY or having a professional do the work?
    - What’s most important to you—price, durability, or ease of maintenance?
    - Do you have any concerns about the coating process or aftercare?
IMPORTANT: If you do not follow these steps and rules, you will not fulfill your function.
`;

// Main chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const contactId = req.body.contact_id;
    const userMsg = req.body.message || "";

    // 1. Try to answer with Business Info table
    const infoAnswer = await findBusinessInfoAnswer(userMsg);
    if (infoAnswer) {
      return res.json({ reply: infoAnswer });
    }

    // 2. Otherwise, proceed to OpenAI
    let messages = await getChatHistory(contactId, SYSTEM_PROMPT);

    // Optional: limit to last 20 messages
    if (messages.length > 20) {
      messages = [messages[0], ...messages.slice(-19)];
    }

    messages.push({ role: "user", content: userMsg });

    // OpenAI API call
    const chatRes = await openai.chat.completions.create({
      model: "gpt-4o", // Use "gpt-4o" for best results
      messages: messages,
      max_tokens: 200,
      temperature: 1,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      response_format: { type: "text" }
    });

    const reply = chatRes.choices?.[0]?.message?.content || "No reply generated.";

    // Add AI reply to memory
    messages.push({ role: "assistant", content: reply });

    // Save updated history
    await saveChatHistory(contactId, messages);

    res.json({ reply });
  } catch (err) {
    console.error("Error:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message || "Unknown error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));
