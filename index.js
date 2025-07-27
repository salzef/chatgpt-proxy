const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post('/chat', async (req, res) => {
  try {
    const userMsg = req.body.message || '';
    const promptId = req.body.prompt_id; // Grab prompt_id from the request

    // Build the payload for OpenAI API
    const payload = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: userMsg }
      ]
    };

    // If promptId is provided, include it as per OpenAI docs
    if (promptId) {
      payload.prompt = { id: promptId };
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      payload,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (
      response.data &&
      response.data.choices &&
      response.data.choices[0] &&
      response.data.choices[0].message &&
      response.data.choices[0].message.content
    ) {
      const reply = response.data.choices[0].message.content;
      res.json({ reply });
    } else {
      res.status(500).json({ error: response.data });
    }
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));
