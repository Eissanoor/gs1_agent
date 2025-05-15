// Enhanced promptControllerV2: DB lookups with thinking process and cleaned responses
require('dotenv').config();
const prisma = require('../prismaClient');
const stringSimilarity = require('string-similarity');

// Use dynamic import for node-fetch
let fetch;
(async () => {
  fetch = (await import('node-fetch')).default;
})();

exports.handlePrompt = async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ status: 'error', message: 'Prompt is required.' });
  }
  
  try {
    // Detect if the prompt is in Arabic
    const isArabicPrompt = isArabic(prompt);
    
    // Step 1: Thinking - Analyze the prompt with language awareness
    const thinkingProcess = analyzePrompt(prompt, isArabicPrompt);
    
    // Step 2: Search for relevant data in the database based on language
    // First try exact matching with contains
    let agents = await prisma.aiAgent.findMany({
      where: {
        [isArabicPrompt ? 'contentAr' : 'content']: {
          contains: prompt
        }
      },
      take: 5, // Get more results for better context
      select: { 
        content: true,
        contentAr: true,
        key: true,
        id: true,
        questions: true,
        questionsAr: true
      }
    });
    
    // If no exact matches, try keyword-based search
    if (agents.length === 0) {
      const keywords = extractKeywords(prompt, isArabicPrompt);
      
      // Search for each keyword
      for (const keyword of keywords) {
        if ((isArabicPrompt && keyword.length < 2) || (!isArabicPrompt && keyword.length < 3)) continue;
        
        // Try to search in questions first, as they might be more relevant
        const questionResults = await prisma.aiAgent.findMany({
          where: {
            [isArabicPrompt ? 'questionsAr' : 'questions']: {
              contains: keyword
            }
          },
          take: 2,
          select: { 
            content: true,
            contentAr: true,
            key: true,
            id: true,
            questions: true,
            questionsAr: true
          }
        });
        
        // Then search in content
        const contentResults = await prisma.aiAgent.findMany({
          where: {
            [isArabicPrompt ? 'contentAr' : 'content']: {
              contains: keyword
            }
          },
          take: 2,
          select: { 
            content: true,
            contentAr: true,
            key: true,
            id: true,
            questions: true,
            questionsAr: true
          }
        });
        
        // Combine results with preference for question matches
        agents = [...agents, ...questionResults, ...contentResults];
        
        // Limit to 8 total results
        if (agents.length >= 8) {
          agents = agents.slice(0, 8);
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
      const rankedResults = rankResultsByRelevance(uniqueAgents, prompt, isArabicPrompt);

      // Step 5: Prepare the context from the most relevant results
      const context = rankedResults.map(r => {
        // For Arabic prompts
        if (isArabicPrompt) {
          // Use contentAr if available, otherwise fall back to content
          return r.contentAr || r.content;
        }
        
        // For English prompts, always use the English content
        return r.content; 
      }).join("\n\n");

      // Step 6: Generate a thoughtful response using the context
      const prompt_template = isArabicPrompt 
        ? `<s>[INST] سأقدم لك بعض معلومات السياق، ثم أطرح عليك سؤالًا. يرجى الإجابة على السؤال بناءً على السياق المقدم فقط.

السياق:
${context}

السؤال: ${prompt}

يرجى تقديم إجابة مفصلة ودقيقة بناءً على السياق المذكور أعلاه فقط. الرجاء الإجابة باللغة العربية. [/INST]`
        : `<s>[INST] I'm going to provide you with some context information, and then ask you a question. Please answer the question based ONLY on the context provided.

Context:
${context}

Question: ${prompt}

Please provide a detailed and accurate answer based ONLY on the context above. [/INST]`;

      const response = await fetch('https://api.together.xyz/v1/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.TOGETHER_API_KEY || 'sk-tg-1ea92d3d83844cd0a5bd1d2e70a0e8c6'}` // Fallback to a free API key
        },
        body: JSON.stringify({
          model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
          prompt: prompt_template,
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
        // Detailed error handling
        let errorMessage = isArabicPrompt 
          ? "أعتذر، لكنني لم أتمكن من إنشاء استجابة بناءً على المعلومات المتاحة. يرجى محاولة طرح سؤالك بطريقة مختلفة."
          : "I apologize, but I couldn't generate a response based on the available information. Please try asking your question in a different way.";
        
        if (data && data.error) {
          console.error('API error details:', data.error);
          // If it's a rate limit error, provide a more specific message
          if (data.error.code === 'rate_limit_exceeded') {
            errorMessage = isArabicPrompt 
              ? "عذرًا، لقد تجاوزنا حد الاستخدام لواجهة برمجة التطبيقات. يرجى المحاولة مرة أخرى بعد قليل."
              : "Sorry, we've exceeded the API usage limit. Please try again in a moment.";
          }
        } else {
          console.error('API response error:', data);
        }
        
        answer = errorMessage;
      }
      
      // More robust answer cleaning
      answer = cleanAnswer(answer);
      
      // Step 7: Return the response with the thinking process
      return res.json({ 
        status: 'success', 
        thinking: thinkingProcess,
        language: isArabicPrompt ? 'arabic' : 'english',
        answer: answer
      });
    }
    
    // If no data found, return a helpful message
    return res.status(404).json({ 
      status: 'not_found', 
      thinking: thinkingProcess,
      message: isArabicPrompt 
        ? 'لقد بحثت في قاعدة البيانات الخاصة بنا ولكن لم أتمكن من العثور على معلومات متعلقة بسؤالك. هل يمكنك إعادة صياغة السؤال أو السؤال عن شيء آخر؟'
        : 'I searched our database but couldn\'t find information related to your question. Could you please rephrase or ask about something else?' 
    });
    
  } catch (error) {
    console.error('DB search error:', error);
    const errorMessage = error.message || 'An unknown error occurred';
    return res.status(500).json({ 
      status: 'error', 
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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
 * @param {boolean} isArabic - Whether the prompt is in Arabic
 * @returns {string} - The thinking process
 */
function analyzePrompt(prompt, isArabic = false) {
  // Extract question type with language awareness
  let questionType = 'informational';
  const lowercasePrompt = prompt.toLowerCase();
  
  if (isArabic) {
    // Arabic question types
    if (lowercasePrompt.startsWith('من') || lowercasePrompt.includes('من هو')) {
      questionType = 'entity identification';
    } else if (lowercasePrompt.startsWith('ما') || lowercasePrompt.startsWith('ماذا') || lowercasePrompt.includes('ما هو')) {
      questionType = 'definition or explanation';
    } else if (lowercasePrompt.startsWith('متى')) {
      questionType = 'temporal information';
    } else if (lowercasePrompt.startsWith('أين')) {
      questionType = 'location information';
    } else if (lowercasePrompt.startsWith('لماذا')) {
      questionType = 'reasoning or cause';
    } else if (lowercasePrompt.startsWith('كيف')) {
      questionType = 'process or method';
    }
  } else {
    // English question types (existing)
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
  }
  
  // Extract keywords with language awareness
  const keywords = extractKeywords(prompt, isArabic);
  
  // Formulate the thinking process in the appropriate language
  if (isArabic) {
    return `أحتاج إلى العثور على معلومات حول "${prompt}". يبدو أن هذا ${getArabicQuestionType(questionType)} سؤال.
المفاهيم الرئيسية للبحث عنها: ${keywords.join('، ')}.
سأبحث في قاعدة البيانات عن المحتوى ذي الصلة وأقدم الإجابة الأكثر دقة بناءً على المعلومات المتاحة.`;
  } else {
    return `I need to find information about "${prompt}". This appears to be a ${questionType} question.
Key concepts to search for: ${keywords.join(', ')}.
I'll search the database for relevant content and provide the most accurate answer based on available information.`;
  }
}

/**
 * Extracts keywords from the prompt
 * @param {string} prompt - The user's prompt
 * @param {boolean} isArabic - Whether the prompt is in Arabic
 * @returns {string[]} - Array of keywords
 */
function extractKeywords(prompt, isArabic = false) {
  // Arabic stop words
  const arabicStopWords = ['من', 'إلى', 'عن', 'على', 'في', 'مع', 'هذا', 'هذه', 'تلك', 'ذلك', 
                         'الذي', 'التي', 'الذين', 'هو', 'هي', 'هم', 'أنا', 'أنت', 'نحن', 'كان', 
                         'كانت', 'يكون', 'تكون', 'أو', 'و', 'ثم', 'لكن', 'لأن', 'إذا', 'كيف', 
                         'متى', 'أين', 'لماذا', 'ماذا', 'كم', 'أي', 'نعم', 'لا', 'كل', 'بعض'];
  
  // English stop words (existing)
  const englishStopWords = ['a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 
                           'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
                           'to', 'from', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
                           'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
                           'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'some',
                           'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
                           'too', 'very', 'can', 'will', 'just', 'should', 'now'];
  
  // Select the appropriate stop words based on language
  const stopWords = isArabic ? arabicStopWords : englishStopWords;
  
  // Clean and tokenize the prompt - with language awareness
  const cleanPrompt = prompt.toLowerCase().replace(/[^\w\s\u0600-\u06FF]/g, '');
  const words = cleanPrompt.split(/\s+/);
  
  // Filter out stop words and short words - with length appropriate for language
  // Arabic words can be meaningful with just 2 characters
  const minLength = isArabic ? 2 : 3;
  return words.filter(word => !stopWords.includes(word) && word.length >= minLength);
}

/**
 * Ranks the results by relevance to the prompt
 * @param {Array} results - The database results
 * @param {string} prompt - The user's prompt
 * @param {boolean} isArabic - Whether the prompt is in Arabic
 * @returns {Array} - Ranked results
 */
function rankResultsByRelevance(results, prompt, isArabic = false) {
  // Calculate similarity scores
  const scoredResults = results.map(result => {
    // Use string similarity to calculate relevance
    const contentField = isArabic ? (result.contentAr || result.content) : result.content;
    const similarity = stringSimilarity.compareTwoStrings(
      prompt.toLowerCase(), 
      contentField.toLowerCase().substring(0, 1000) // Limit to first 1000 chars for performance
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

/**
 * Detects if the text is primarily Arabic
 * @param {string} text - The text to check
 * @returns {boolean} - True if the text is primarily Arabic
 */
function isArabic(text) {
  if (!text) return false;
  
  // Arabic Unicode range
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  
  // Count Arabic characters
  let arabicCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (arabicPattern.test(text[i])) {
      arabicCount++;
    }
  }
  
  // If more than 30% of characters are Arabic, consider it Arabic
  // This is more conservative than the previous 40% threshold
  return arabicCount / text.length > 0.3;
}

// Helper function to get Arabic question type
function getArabicQuestionType(englishType) {
  const typeMap = {
    'entity identification': 'تحديد الكيان',
    'definition or explanation': 'تعريف أو شرح',
    'temporal information': 'معلومات زمنية',
    'location information': 'معلومات مكانية',
    'reasoning or cause': 'سبب أو تفسير',
    'process or method': 'عملية أو طريقة',
    'informational': 'معلوماتي'
  };
  
  return typeMap[englishType] || 'معلوماتي';
}

// Helper function for more robust answer cleaning
function cleanAnswer(answer) {
  if (!answer) return '';
  
  // Handle various model response format markers
  if (answer.includes('[/INST]')) {
    answer = answer.split('[/INST]').pop().trim();
  }
  if (answer.includes('</s>')) {
    answer = answer.split('</s>')[0].trim();
  }
  if (answer.includes('<s>')) {
    answer = answer.replace('<s>', '').trim();
  }
  
  // Remove any model artifacts or unwanted formatting
  answer = answer.replace(/\[INST\]/g, '').replace(/\[\/INST\]/g, '');
  
  return answer.trim();
}