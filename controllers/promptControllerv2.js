// Simplified promptControllerv2: only DB lookups
const prisma = require('../prismaClient');

exports.handlePrompt = async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ status: 'error', message: 'Prompt is required.' });
  }
  try {
    const pages = await prisma.pages.findMany({
      where: { custom_section_data: { contains: prompt, mode: 'insensitive' } }
    });
    if (pages.length) {
      return res.json({ status: 'success', pages });
    }
    return res.status(404).json({ status: 'not_found', message: 'No matching data found.' });
  } catch (error) {
    console.error('DB search error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
