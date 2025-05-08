// Enhanced promptControllerV2: DB lookups with thinking process and cleaned responses
require('dotenv').config();
const prisma = require('../prismaClient');
const fetch = require('node-fetch').default;
const stringSimilarity = require('string-similarity');

exports.handlePrompt = async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ status: 'error', message: 'Prompt is required.' });
  }
  
  try {
    // Step 1: Thinking - Analyze the prompt to determine what information we need
    const thinkingProcess = analyzePrompt(prompt);
    
    // Step 2: Search for relevant data in the database
    // First try exact matching with contains
    let pages = await prisma.pages.findMany({
      where: {
        custom_section_data: {
          contains: prompt
        }
      },
      take: 5, // Get more results for better context
      select: { 
        custom_section_data: true,
        name: true,
        id: true
      }
    });
    
    // If no exact matches, try keyword-based search
    if (pages.length === 0) {
      const keywords = extractKeywords(prompt);
      
      // Search for each keyword
      for (const keyword of keywords) {
        if (keyword.length < 3) continue; // Skip very short keywords
        
        const keywordResults = await prisma.pages.findMany({
          where: {
            custom_section_data: {
              contains: keyword
            }
          },
          take: 3,
          select: { 
            custom_section_data: true,
            name: true,
            id: true
          }
        });
        
        pages = [...pages, ...keywordResults];
        
        // Limit to 5 total results
        if (pages.length >= 5) {
          pages = pages.slice(0, 5);
          break;
        }
      }
    }
    
    // Step 3: Process the data if found
    if (pages.length) {
      // Use a Set to ensure unique IDs
      const uniquePages = [];
      const seenIds = new Set();

      for (const page of pages) {
        if (!seenIds.has(page.id)) {
          seenIds.add(page.id);
          uniquePages.push(page);
        }
      }

      // Clean HTML and prepare context
      const cleaned = uniquePages.map(p => ({
        id: p.id,
        page_name: p.name,
        content: cleanContent(p.custom_section_data).substring(0, 600) // Limit content to 300 characters
      }));

      // Step 4: Rank the results by relevance to the prompt
      const rankedResults = rankResultsByRelevance(cleaned, prompt);

      // Step 5: Prepare the context from the most relevant results
      const context = rankedResults.map(r => r.content).join("\n\n");

      // Step 6: Generate a thoughtful response using the context
      const response = await fetch('https://api-inference.huggingface.co/models/google/flan-t5-large', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.HF_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          inputs: `Context: ${context}\n\nQuestion: ${prompt}\n\nPlease provide a detailed and accurate answer based on the context.`
        })
      });

      const data = await response.json();

      // HF returns { generated_text } or array
      const answer = cleanContent(Array.isArray(data) ? data[0].generated_text : data.generated_text);

      // Step 7: Return the response with the thinking process
      return res.json({ 
        status: 'success', 
        thinking: thinkingProcess,
        sources: rankedResults.map(r => ({ 
          id: r.id, 
          page_name: r.page_name, 
          content: r.content 
        })),
        answer: answer
      });
    }
    
    // If no data found, return a helpful message
    return res.status(404).json({ 
      status: 'not_found', 
      thinking: thinkingProcess,
      message: 'I searched our database but couldn\'t find information related to your question. Could you please rephrase or ask about something else?' 
    });
    
  } catch (error) {
    console.error('DB search error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * Cleans content by removing HTML tags, fixing whitespace, and normalizing special characters
 * @param {string} content - The content to clean
 * @returns {string} - The cleaned content
 */
function cleanContent(content) {
  if (!content) return '';
  
  // Remove HTML tags
  let cleaned = content.replace(/<[^>]+>/g, '');
  
  // Replace HTML entities
  cleaned = cleaned.replace(/&nbsp;/g, ' ');
  cleaned = cleaned.replace(/&amp;/g, '&');
  cleaned = cleaned.replace(/&lt;/g, '<');
  cleaned = cleaned.replace(/&gt;/g, '>');
  cleaned = cleaned.replace(/&quot;/g, '"');
  cleaned = cleaned.replace(/&apos;/g, "'");
  
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ');
  
  // Fix special quotes and dashes
  cleaned = cleaned.replace(/[“”]/g, '"');
  cleaned = cleaned.replace(/[‘’]/g, "'");
  cleaned = cleaned.replace(/–/g, '-');
  cleaned = cleaned.replace(/—/g, '--');
  
  // Trim and return
  return cleaned.trim();
}

/**
 * Analyzes the prompt to determine what information is needed
 * @param {string} prompt - The user's prompt
 * @returns {string} - The thinking process
 */
function analyzePrompt(prompt) {
  // Extract question type (who, what, when, where, why, how)
  let questionType = 'informational';
  const lowercasePrompt = prompt.toLowerCase();
  
  if (lowercasePrompt.startsWith('who')) {
    questionType = 'entity identification';
  } else if (lowercasePrompt.startsWith('what')) {
    questionType = 'definition or explanation';
  } else if (lowercasePrompt.startsWith('when')) {
    questionType = 'temporal information';
  } else if (lowercasePrompt.startsWith('where')) {
    questionType = 'location information';
  } else if (lowercasePrompt.startsWith('why')) {
    questionType = 'reasoning or cause';
  } else if (lowercasePrompt.startsWith('how')) {
    questionType = 'process or method';
  }
  
  // Identify key entities or concepts in the prompt
  const keywords = extractKeywords(prompt);
  
  // Formulate the thinking process
  return `I need to find information about "${prompt}". This appears to be a ${questionType} question. 
Key concepts to search for: ${keywords.join(', ')}. 
I'll search the database for relevant content and provide the most accurate answer based on available information.`;
}

/**
 * Extracts keywords from the prompt
 * @param {string} prompt - The user's prompt
 * @returns {string[]} - Array of keywords
 */
function extractKeywords(prompt) {
  // Remove common stop words and punctuation
  const stopWords = ['a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 
                    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
                    'to', 'from', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
                    'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
                    'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'some',
                    'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
                    'too', 'very', 'can', 'will', 'just', 'should', 'now'];
  
  // Clean and tokenize the prompt
  const cleanPrompt = prompt.toLowerCase().replace(/[^\w\s]/g, '');
  const words = cleanPrompt.split(/\s+/);
  
  // Filter out stop words and short words
  return words.filter(word => !stopWords.includes(word) && word.length > 2);
}

/**
 * Ranks the results by relevance to the prompt
 * @param {Array} results - The database results
 * @param {string} prompt - The user's prompt
 * @returns {Array} - Ranked results
 */
function rankResultsByRelevance(results, prompt) {
  // Calculate similarity scores
  const scoredResults = results.map(result => {
    // Use string similarity to calculate relevance
    const similarity = stringSimilarity.compareTwoStrings(
      prompt.toLowerCase(), 
      result.content.toLowerCase().substring(0, 1000) // Limit to first 1000 chars for performance
    );
    
    return {
      ...result,
      relevanceScore: similarity
    };
  });
  
  // Sort by relevance score (highest first)
  return scoredResults
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map(({ relevanceScore, ...rest }) => rest); // Remove the score from the final results
}