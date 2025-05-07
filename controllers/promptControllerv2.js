// Simplified promptControllerv2: only DB lookups
require('dotenv').config();
const prisma = require('../prismaClient');
const fetch = require('node-fetch').default;

exports.handlePrompt = async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ status: 'error', message: 'Prompt is required.' });
  }
  try {
    //i want only top two data fatching data
    const pages = await prisma.pages.findMany({
      where: {
        custom_section_data: {
          contains: prompt
        }
      },
      take: 2,
      select: { custom_section_data: true }
    });
    if (pages.length) {
      // Clean HTML
      const cleaned = pages.map(p => p.custom_section_data.replace(/<[^>]+>/g, ''));
      const context = cleaned.join("\n\n");
      // Query Hugging Face Inference API (free)
      const response = await fetch('https://api-inference.huggingface.co/models/gpt2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HF_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: `Context: ${context}\nQuestion: ${prompt}`,
          parameters: { max_new_tokens: 150 }
        })
      });
      const data = await response.json();
      const answer = Array.isArray(data) ? data[0].generated_text : data.generated_text;
      return res.json({ status: 'success', answer });
    }
    return res.status(404).json({ status: 'not_found', message: 'No matching data found.' });
  } catch (error) {
    console.error('DB search error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
