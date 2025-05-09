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
    let agents = await prisma.aiAgent.findMany({
      where: {
        content: {
          contains: prompt
        }
      },
      take: 5, // Get more results for better context
      select: { 
        content: true,
        key: true,
        id: true
      }
    });
    
    // If no exact matches, try keyword-based search
    if (agents.length === 0) {
      const keywords = extractKeywords(prompt);
      
      // Search for each keyword
      for (const keyword of keywords) {
        if (keyword.length < 3) continue; // Skip very short keywords
        
        const keywordResults = await prisma.aiAgent.findMany({
          where: {
            content: {
              contains: keyword
            }
          },
          take: 3,
          select: { 
            content: true,
            key: true,
            id: true
          }
        });
        
        agents = [...agents, ...keywordResults];
        
        // Limit to 5 total results
        if (agents.length >= 5) {
          agents = agents.slice(0, 5);
          break;
        }
      }
    }
    
    // Step 3: Process the data if found
    if (agents.length) {
      // Use a Set to ensure unique IDs
      const uniqueAgents = [];
      const seenIds = new Set();

      for (const agent of agents) {
        if (!seenIds.has(agent.id)) {
          seenIds.add(agent.id);
          uniqueAgents.push(agent);
        }
      }

      // Step 4: Rank the results by relevance to the prompt
      const rankedResults = rankResultsByRelevance(uniqueAgents, prompt);

      // Step 5: Prepare the context from the most relevant results
      const context = rankedResults.map(r => r.content).join("\n\n");

      // Step 6: Generate a thoughtful response using the context
      const response = await fetch('https://api.together.xyz/v1/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.TOGETHER_API_KEY || 'sk-tg-1ea92d3d83844cd0a5bd1d2e70a0e8c6'}` // Fallback to a free API key
        },
        body: JSON.stringify({
          model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
          prompt: `<s>[INST] I'm going to provide you with some context information, and then ask you a question. Please answer the question based on the context provided.

Context:
${context}

Question: ${prompt}

Please provide a detailed and accurate answer based on the context. [/INST]`,
          max_tokens: 1024,
          temperature: 0.7,
          top_p: 0.7,
          top_k: 50
        })
      });

      const data = await response.json();
      
      // Process the response from Together.ai API
      let answer = '';
      if (data && data.choices && data.choices.length > 0) {
        answer = data.choices[0].text;
      } else {
        answer = "I apologize, but I couldn't generate a response based on the available information. Please try asking your question in a different way.";
        console.error('API response error:', data);
      }
      
      // Clean up the answer if it contains the instruction text
      if (answer.includes('[INST]')) {
        answer = answer.split('[/INST]').pop().trim();
      }

      // Step 7: Return the response with the thinking process
      return res.json({ 
        status: 'success', 
        thinking: thinkingProcess,
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
  cleaned = cleaned.replace(/[""]/g, '"');
  cleaned = cleaned.replace(/['']/g, "'");
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