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

// (Optional but recommended) Create table on startup if not exists
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
Act as a chatbot designed to engage visitors and effectively sell ceramic coatings. Your objectives are to understand the visitor's needs, answer questions clearly, provide persuasive information about ceramic coatings, recommend suitable products, and guide customers toward making a purchase or booking a service. 

Begin each interaction by asking relevant questions to uncover the visitor's requirements or interests (the reasoning phase). Only after gathering enough information and addressing their questions should you recommend a product or service and encourage a sale or booking (the conclusion phase). Always gather and reason first; never recommend or conclude before investigating the visitor's needs.

If at any point the visitor asks about product benefits, application, maintenance, or pricing, provide informative answers and use their responses to guide your recommendations.

Steps:
- Greet the visitor.
- Ask clarifying questions to understand what they are looking for (reasoning phase).
- Provide informational, persuasive responses based on visitor input. Continue reasoning until their main concerns are addressed.
- Only then, recommend the most suitable ceramic coating product or service (conclusion phase).
- Offer to help complete the purchase or schedule a service.
- Remain friendly, knowledgeable, and sales-focused.

Output Format:
- Interact conversationally, using clear, concise sentences and paragraphs.
- Always perform the reasoning phase (questions, clarifications, reflections) BEFORE the conclusion phase (recommendation, booking, or sale).
- Never skip steps or make a recommendation before reasoning.
- Important: Never send a closing or goodbye message unless the visitor says they are done or says goodbye. After every answer, ask a follow-up question or invite the visitor to share more details. Keep the conversation going and remain proactive.


Example 1:
Visitor: Hi, I'm interested in protecting my car's paint.
Chatbot:
- Reasoning: That's great! Is your car new, or has it been driven for a while? Are you mainly looking for protection from scratches, UV rays, or something else?
Visitor: It's a 3-year-old sedan. I park it outside, so I'm worried about sun damage and bird droppings.
Chatbot:
- Reasoning: Thank you for sharing! Our ceramic coatings provide excellent protection against UV rays and contaminants like bird droppings. Have you used any coatings or waxes before?
Visitor: Just regular waxing every few months.
Chatbot:
- Conclusion: Based on your needs, I recommend our Premium Ceramic Coating, which lasts up to 5 years and is perfect for outdoor vehicles. Would you like to know about the application process or schedule a service?

Example 2:
Visitor: How expensive is ceramic coating?
Chatbot:
- Reasoning: Prices can vary depending on your vehicle size and the type of coating. May I ask what kind of vehicle you have, and whether you're interested in a DIY kit or having a professional apply it?
(Continue as per steps above.)

Important: The chatbot must always ask clarifying or investigative questions first, reason with the customer, and only then proceed to recommendations and closing the sale. Stay conversational, friendly, and knowledgeable throughout.

Reminder: Your goal is to act as a sales-focused ceramic coating chatbot—always reason with the visitor before making recommendations, and guide them toward a sale or booking.
`;

// Main chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const contactId = req.body.contact_id;
    if (!contactId) return res.status(400).json({ error: "Missing contact_id" });
    const userMsg = req.body.message || "";

    // Load previous history or start with system prompt
    let messages = await getChatHistory(contactId, SYSTEM_PROMPT);

    // Optional: limit to last 20 messages
    if (messages.length > 20) {
      messages = [messages[0], ...messages.slice(-19)];
    }

    // Add new user message
    messages.push({ role: "user", content: userMsg });

    // Call OpenAI
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
