const express = require('express');
const OpenAI = require('openai');
const app = express();
const PORT = process.env.PORT || 8080;

const SKILL_APP_ID = process.env.SKILL_APP_ID || 'amzn1.ask.skill.4af90b07-5af7-4d90-aba1-3018762d2114';
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
const LLM_MODEL = 'Qwen/Qwen2.5-7B-Instruct';

const LUNCH_API_URL = 'https://api.linqconnect.com/api/FamilyMenu?buildingId=85af1af6-c2ab-ed11-8e6a-8a240c066ba8&districtId=a83d5cd9-a7a8-ed11-8e69-da0395d724bd';

const openai = SILICONFLOW_API_KEY ? new OpenAI({
  apiKey: SILICONFLOW_API_KEY,
  baseURL: 'https://api.siliconflow.com/v1'
}) : null;

app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('OK');
});

app.all('/', (req, res) => {
  console.log('--- INCOMING REQUEST ---');
  console.log('Method:', req.method);
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const request = req.body;

  if (!request) {
    console.log('ERROR: No request body');
    return res.status(400).json({ error: 'No request body' });
  }

  const appId = request.context?.System?.application?.applicationId;
  if (appId && appId !== SKILL_APP_ID) {
    console.log('ERROR: Invalid app ID:', appId);
    return res.status(400).json({ error: 'Invalid application ID' });
  }

  if (!request.request || !request.request.type) {
    console.log('ERROR: Missing request type');
    return res.status(400).json({ error: 'Invalid request' });
  }

  const requestType = request.request.type;
  console.log('Request type:', requestType);

  if (requestType === 'LaunchRequest') {
    console.log('Handling LaunchRequest');
    return res.json(buildResponse('Hello! Ask me about school lunch. Try saying what\'s for lunch today.'));
  }

  if (requestType === 'IntentRequest') {
    const intent = request.request.intent;
    const intentName = intent?.name;
    const slots = intent?.slots || {};
    
    console.log('Intent name:', intentName);
    console.log('Slots:', JSON.stringify(slots));

    if (intentName === 'ChatIntent') {
      const userText = Object.values(slots).map(s => s.value).join(' ').trim();
      console.log('User said:', userText);
      return handleChatIntent(userText, res);
    }

    if (intentName === 'AMAZON.HelpIntent') {
      return res.json(buildResponse('You can ask me about school lunch. Try saying what\'s for lunch today or what\'s for lunch tomorrow.'));
    }

    if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') {
      return res.json(buildResponse('Goodbye!'));
    }
    
    return res.json(buildResponse(`I heard: ${intentName}`));
  }

  if (requestType === 'SessionEndedRequest') {
    console.log('Session ended');
    return res.json(buildResponse(''));
  }

  console.log('Unknown request type:', requestType);
  return res.json(buildResponse('I didn\'t understand that.'));
});

async function handleChatIntent(userText, res) {
  try {
    if (!openai) {
      return res.json(buildResponse('Sorry, I\'m not configured with an API key. Please set the Siliconflow API key.'));
    }

    const dateInfo = parseDateReference(userText);
    console.log('Parsed date info:', dateInfo);

    const menuData = await fetchLunchMenu(dateInfo.startDate, dateInfo.endDate);
    
    if (!menuData || !menuData.FamilyMenuSessions || menuData.FamilyMenuSessions.length === 0) {
      return res.json(buildResponse('Sorry, I couldn\'t find any lunch menu information right now.'));
    }

    const menuContext = buildMenuContext(menuData, dateInfo.targetDate);
    
    if (!menuContext) {
      return res.json(buildResponse(`I don't have lunch menu information for ${dateInfo.description}.`));
    }

    const response = await callLLM(userText, menuContext);
    return res.json(buildResponse(response));

  } catch (error) {
    console.error('Error in handleChatIntent:', error);
    return res.json(buildResponse('Sorry, I had trouble looking up the lunch menu. Please try again.'));
  }
}

function parseDateReference(text) {
  const lowerText = text.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let targetDate = new Date(today);
  let description = 'today';

  if (lowerText.includes('tomorrow')) {
    targetDate.setDate(targetDate.getDate() + 1);
    description = 'tomorrow';
  } else if (lowerText.includes('monday')) {
    targetDate = getNextDayOfWeek(targetDate, 1);
    description = 'Monday';
  } else if (lowerText.includes('tuesday')) {
    targetDate = getNextDayOfWeek(targetDate, 2);
    description = 'Tuesday';
  } else if (lowerText.includes('wednesday')) {
    targetDate = getNextDayOfWeek(targetDate, 3);
    description = 'Wednesday';
  } else if (lowerText.includes('thursday')) {
    targetDate = getNextDayOfWeek(targetDate, 4);
    description = 'Thursday';
  } else if (lowerText.includes('friday')) {
    targetDate = getNextDayOfWeek(targetDate, 5);
    description = 'Friday';
  }

  const startDate = new Date(targetDate);
  startDate.setDate(startDate.getDate() - 3);
  const endDate = new Date(targetDate);
  endDate.setDate(endDate.getDate() + 3);

  return {
    targetDate,
    startDate,
    endDate,
    description
  };
}

function getNextDayOfWeek(date, dayOfWeek) {
  const result = new Date(date);
  const currentDay = result.getDay();
  const diff = (dayOfWeek + 7 - currentDay) % 7;
  result.setDate(result.getDate() + (diff === 0 ? 7 : diff));
  return result;
}

function formatDateForApi(date) {
  return `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;
}

function formatDateForMatch(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

async function fetchLunchMenu(startDate, endDate) {
  const url = `${LUNCH_API_URL}&startDate=${formatDateForApi(startDate)}&endDate=${formatDateForApi(endDate)}`;
  console.log('Fetching lunch menu from:', url);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://linqconnect.com/'
    }
  });
  if (!response.ok) {
    throw new Error(`Lunch API error: ${response.status}`);
  }

  return await response.json();
}

function buildMenuContext(menuData, targetDate) {
  const targetDateStr = formatDateForMatch(targetDate);
  console.log('Looking for date:', targetDateStr);

  for (const session of menuData.FamilyMenuSessions || []) {
    for (const plan of session.MenuPlans || []) {
      for (const day of plan.Days || []) {
        if (day.Date === targetDateStr) {
          const items = [];
          for (const meal of day.MenuMeals || []) {
            for (const category of meal.RecipeCategories || []) {
              for (const recipe of category.Recipes || []) {
                items.push({
                  name: recipe.RecipeName,
                  category: category.CategoryName
                });
              }
            }
          }
          return {
            date: day.Date,
            items: items
          };
        }
      }
    }
  }

  return null;
}

async function callLLM(userQuestion, menuContext) {
  const systemPrompt = `You are a helpful assistant for a school lunch menu. Answer questions about school lunch in a friendly, conversational way. Keep responses brief and natural for voice output (under 100 words). Don't use special characters or formatting - just speak naturally.

When given lunch menu data, summarize the main options clearly. Group similar items and skip minor sides unless asked.`;

  const menuText = menuContext.items.length > 0
    ? menuContext.items.map(i => `${i.category}: ${i.name}`).join(', ')
    : 'No menu items found';

  const userPrompt = `The user asked: "${userQuestion}"

Here's the lunch menu for ${menuContext.date}:
${menuText}

Please answer their question naturally.`;

  const completion = await openai.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 200,
    temperature: 0.7
  });

  return completion.choices[0].message.content.trim();
}

function buildResponse(outputText, shouldEndSession = true) {
  return {
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'PlainText',
        text: outputText
      },
      shouldEndSession: shouldEndSession
    }
  };
}

app.listen(PORT, () => {
  console.log(`Ding Dong Alexa skill server running on port ${PORT}`);
  if (!SILICONFLOW_API_KEY) {
    console.warn('WARNING: SILICONFLOW_API_KEY not set. LLM features will not work.');
  }
});
