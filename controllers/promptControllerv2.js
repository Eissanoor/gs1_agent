// Simplified promptControllerv2: only DB lookups
const prisma = require('../prismaClient');

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
      const cleaned = pages.map(p => ({ custom_section_data: p.custom_section_data.replace(/<[^>]+>/g, '') }));
      return res.json({ status: 'success', pages: cleaned });
    }
    return res.status(404).json({ status: 'not_found', message: 'No matching data found.' });
  } catch (error) {
    console.error('DB search error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
