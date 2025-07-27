app.post("/chat", async (req, res) => {
  try {
    const contactId = req.body.contact_id;
    const userMsg = req.body.message || "";

    // Try FAQ/database first
    const infoAnswer = await findBusinessInfoAnswer(userMsg);
    if (infoAnswer) {
      return res.json({ reply: infoAnswer });
    }

    // No FAQ match? Continue as normal:
    let messages = await getChatHistory(contactId, SYSTEM_PROMPT);

    if (messages.length > 20) {
      messages = [messages[0], ...messages.slice(-19)];
    }

    messages.push({ role: "user", content: userMsg });

    const chatRes = await openai.chat.completions.create({
      model: "gpt-4o", // Use "gpt-4o" for best results, or your preferred model
      messages: messages,
      max_tokens: 200,
      temperature: 1,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      response_format: { type: "text" }
    });

    const reply = chatRes.choices?.[0]?.message?.content || "No reply generated.";

    messages.push({ role: "assistant", content: reply });
    await saveChatHistory(contactId, messages);

    res.json({ reply });
  } catch (err) {
    console.error("Error:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message || "Unknown error" });
  }
});
