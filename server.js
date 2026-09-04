const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8080;

const SKILL_APP_ID = process.env.SKILL_APP_ID || 'amzn1.ask.skill.4af90b07-5af7-4d90-aba1-3018762d2114';

const LUNCH_API_URL = 'https://api.linqconnect.com/api/FamilyMenu?buildingId=85af1af6-c2ab-ed11-8e6a-8a240c066ba8&districtId=a83d5cd9-a7a8-ed11-8e69-da0395d724bd';

const HELP_TEXT = 'I can tell you the school lunch menu. Just say something like, tell me what is for lunch today, or ask about tomorrow\'s menu. What would you like to know?';
const FALLBACK_TEXT = 'Sorry, I didn\'t catch that. Try saying, tell me what is for lunch today. What can I help you with?';

let matcherPromise = null;
let matcherProviderOverride = null;

function getIntentMatcher() {
  if (matcherProviderOverride) {
    return Promise.resolve(matcherProviderOverride());
  }
  if (process.env.DISABLE_INTENT_MATCHER === '1') {
    return Promise.resolve(null);
  }
  if (!matcherPromise) {
    const { IntentMatcher } = require('./intent/intent-matcher');
    const { INTENT_DEFINITIONS } = require('./intent/intents');
    matcherPromise = new IntentMatcher({
      definitions: INTENT_DEFINITIONS,
      threshold: 0.75,
      cacheDir: path.join(__dirname, 'intent', '.cache')
    }).init().catch((err) => {
      console.error('IntentMatcher init failed, disabling matcher:', err);
      return null;
    });
  }
  return matcherPromise;
}

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
    const welcome =
      'Hello, I am Ding Dong. You can ask me about school lunch. For example, say tell me what is for lunch today. What can I help you with?';
    return res.json(buildResponse(welcome, false));
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
      return res.json(buildResponse(HELP_TEXT, false));
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
    const matcher = await getIntentMatcher();

    let matchedIntent = null;
    let confidence = 0;
    if (matcher) {
      const match = await matcher.match(userText);
      matchedIntent = match.intent;
      confidence = match.confidence;
      console.log(`IntentMatcher: intent=${matchedIntent} confidence=${confidence.toFixed(3)}`);
    }

    // Route non-lunch intents (help / exit) that arrive via ChatIntent.
    if (matchedIntent === 'help') {
      return res.json(buildResponse(HELP_TEXT, false));
    }
    if (matchedIntent === 'exit') {
      return res.json(buildResponse('Goodbye!'));
    }

    const matcherSaysLunch =
      matchedIntent === 'get_lunch_today' || matchedIntent === 'get_lunch_tomorrow';
    const keywordInfo = parseDateReference(userText);
    const keywordNamesADay = keywordInfo.description !== 'today';

    // With the generic interaction model, ChatIntent's {userText} slot holds the
    // free-form phrase (e.g. "tell me what is for lunch today" -> the query after
    // the carrier) or a bare day token; an empty slot may occur for in-session
    // utterances. Treat empty/day-token as lunch requests resolved by keywords.
    const trimmed = (userText || '').trim();
    const isDayToken = trimmed === '' ||
      /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(trimmed);

    // Determine whether this is a lunch request:
    // - matcher classified it as lunch, OR
    // - the text names a specific weekday/tomorrow, OR
    // - the matcher is disabled/unavailable (keyword parsing only), OR
    // - the slot holds a bare day token / is empty (free-form in-session speech).
    const isLunchRequest = matcherSaysLunch || !matcher || keywordNamesADay || isDayToken;

    if (!isLunchRequest) {
      return res.json(buildResponse(FALLBACK_TEXT, false));
    }

    const dateInfo = matcherSaysLunch ? resolveDateInfo(userText, matchedIntent) : keywordInfo;
    console.log('Resolved date info:', dateInfo);

    const menuData = await fetchLunchMenu(dateInfo.startDate, dateInfo.endDate);

    if (!menuData || !menuData.FamilyMenuSessions || menuData.FamilyMenuSessions.length === 0) {
      return res.json(buildResponse('Sorry, I couldn\'t find any lunch menu information right now.', false));
    }

    const menuContext = buildMenuContext(menuData, dateInfo.targetDate);

    if (!menuContext) {
      return res.json(buildResponse(`I don't have lunch menu information for ${dateInfo.description}.`, false));
    }

    const response = formatMenuSpeech(menuContext, dateInfo.description);
    console.log('Formatted response:', response);
    // Keep the session open so the user can ask a follow-up (e.g. "and tomorrow?")
    // without repeating a carrier phrase.
    return res.json(buildResponse(response, false));

  } catch (error) {
    console.error('Error in handleChatIntent:', error);
    return res.json(buildResponse('Sorry, I had trouble looking up the lunch menu. Please try again.', false));
  }
}

function resolveDateInfo(userText, matchedIntent) {
  const keywordInfo = parseDateReference(userText);

  // Keyword parsing wins when the user named a specific weekday.
  if (keywordInfo.description !== 'today') {
    return keywordInfo;
  }

  // Otherwise use the matcher's today/tomorrow classification.
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const targetDate = new Date(base);
  let description = 'today';

  if (matchedIntent === 'get_lunch_tomorrow' || /(^|\s)tomorrow'?s?/.test(userText.toLowerCase())) {
    targetDate.setDate(targetDate.getDate() + 1);
    description = 'tomorrow';
  }

  const startDate = new Date(targetDate);
  startDate.setDate(startDate.getDate() - 3);
  const endDate = new Date(targetDate);
  endDate.setDate(endDate.getDate() + 3);

  return { targetDate, startDate, endDate, description };
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

function formatMenuSpeech(menuContext, description) {
  if (!menuContext.items.length) {
    return `I don't have lunch menu information for ${description}.`;
  }

  const byCategory = {};
  for (const item of menuContext.items) {
    if (!byCategory[item.category]) {
      byCategory[item.category] = [];
    }
    if (!byCategory[item.category].includes(item.name)) {
      byCategory[item.category].push(item.name);
    }
  }

  const parts = [];
  for (const [category, items] of Object.entries(byCategory)) {
    if (items.length === 0) continue;
    parts.push(`${category}: ${joinItems(items)}.`);
  }

  const intro = description === 'today' ? "Here's today's school lunch." : `Here's the school lunch for ${description}.`;
  return `${intro} ${parts.join(' ')}`;
}

function joinItems(items) {
  if (items.length === 1) return items[0];
  const copy = [...items];
  const last = copy.pop();
  return `${copy.join(', ')}, and ${last}`;
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Ding Dong Alexa skill server running on port ${PORT}`);
  });
}

module.exports = {
  app,
  buildResponse,
  formatMenuSpeech,
  joinItems,
  parseDateReference,
  resolveDateInfo,
  getNextDayOfWeek,
  formatDateForApi,
  formatDateForMatch,
  fetchLunchMenu,
  buildMenuContext,
  handleChatIntent,
  getIntentMatcher,
  _setMatcherProviderOverride(fn) {
    matcherProviderOverride = fn;
  },
  LUNCH_API_URL,
  SKILL_APP_ID,
  PORT,
  HELP_TEXT,
  FALLBACK_TEXT
};
