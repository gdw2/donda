const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  app,
  formatMenuSpeech,
  joinItems,
  parseDateReference,
  getNextDayOfWeek,
  formatDateForApi,
  formatDateForMatch,
  SKILL_APP_ID
} = require('../server');

const TEST_PORT = 0;
let server;
let baseUrl;
const realFetch = globalThis.fetch;

function alexaRequest(userText) {
  return {
    context: {
      System: { application: { applicationId: SKILL_APP_ID } }
    },
    request: {
      type: 'IntentRequest',
      intent: {
        name: 'ChatIntent',
        slots: { userText: { name: 'userText', value: userText } }
      }
    }
  };
}

async function postLunchQuery(userText) {
  const res = await realFetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(alexaRequest(userText))
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  server = app.listen(TEST_PORT);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function buildMenuDay(dateStr, recipesByCategory) {
  const recipeCategories = Object.entries(recipesByCategory).map(([categoryName, recipeNames]) => ({
    CategoryName: categoryName,
    Recipes: recipeNames.map((name) => ({ RecipeName: name }))
  }));
  return {
    FamilyMenuSessions: [
      {
        ServingSession: 'Lunch',
        MenuPlans: [
          {
            MenuPlanName: 'Test Menu',
            Days: [
              {
                Date: dateStr,
                MenuMeals: [
                  {
                    MenuMealName: 'Week 1 - 1',
                    RecipeCategories: recipeCategories
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

test('joinItems joins one item', () => {
  assert.strictEqual(joinItems(['Pizza']), 'Pizza');
});

test('joinItems joins two items with "and"', () => {
  assert.strictEqual(joinItems(['Pizza', 'Burger']), 'Pizza, and Burger');
});

test('joinItems joins three items with commas and "and"', () => {
  assert.strictEqual(joinItems(['Pizza', 'Burger', 'Salad']), 'Pizza, Burger, and Salad');
});

test('formatMenuSpeech groups items by category and dedupes', () => {
  const context = {
    items: [
      { category: 'Main Entree', name: 'Pizza' },
      { category: 'Main Entree', name: 'Burger' },
      { category: 'Main Entree', name: 'Burger' },
      { category: 'Fruit', name: 'Apple' }
    ]
  };
  const speech = formatMenuSpeech(context, 'today');
  assert.match(speech, /^Here's today's school lunch\./);
  assert.match(speech, /Main Entree: Pizza, and Burger\./);
  assert.match(speech, /Fruit: Apple\./);
  assert.strictEqual((speech.match(/Burger/g) || []).length, 1);
});

test('formatMenuSpeech handles empty items', () => {
  const speech = formatMenuSpeech({ items: [] }, 'tomorrow');
  assert.strictEqual(speech, "I don't have lunch menu information for tomorrow.");
});

test('parseDateReference defaults to today', () => {
  const info = parseDateReference('what is for lunch');
  assert.strictEqual(info.description, 'today');
  assert.strictEqual(formatDateForMatch(info.targetDate), formatDateForMatch(new Date()));
});

test('parseDateReference parses tomorrow', () => {
  const info = parseDateReference('what is for lunch tomorrow');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  assert.strictEqual(info.description, 'tomorrow');
  assert.strictEqual(formatDateForMatch(info.targetDate), formatDateForMatch(tomorrow));
});

test('parseDateReference parses a weekday', () => {
  const info = parseDateReference('what is for lunch on monday');
  assert.strictEqual(info.description, 'Monday');
  assert.strictEqual(info.targetDate.getDay(), 1);
});

test('getNextDayOfWeek returns next occurrence for same day', () => {
  const date = new Date(2026, 2, 23);
  const nextMonday = getNextDayOfWeek(date, 1);
  assert.strictEqual(nextMonday.getDay(), 1);
});

test('formatDateForApi formats m-d-yyyy', () => {
  assert.strictEqual(formatDateForApi(new Date(2026, 2, 5)), '3-5-2026');
});

test('full HTTP flow returns formatted lunch menu for today', async () => {
  const info = parseDateReference('what is for lunch today');
  const dateStr = formatDateForMatch(info.targetDate);

  const fixture = buildMenuDay(dateStr, {
    'Main Entree': ['Pizza', 'Burger'],
    Fruit: ['Apple']
  });
  globalThis.fetch = async () => ({ ok: true, json: async () => fixture });

  const { body } = await postLunchQuery('what is for lunch today');
  assert.match(body.response.outputSpeech.text, /Here's today's school lunch\./);
  assert.match(body.response.outputSpeech.text, /Main Entree: Pizza, and Burger\./);
  assert.match(body.response.outputSpeech.text, /Fruit: Apple\./);
});

test('full HTTP flow returns formatted lunch menu for tomorrow', async () => {
  const info = parseDateReference('what is for lunch tomorrow');
  const dateStr = formatDateForMatch(info.targetDate);

  const fixture = buildMenuDay(dateStr, {
    'Main Entree': ['Tacos'],
    Fruit: ['Orange']
  });
  globalThis.fetch = async () => ({ ok: true, json: async () => fixture });

  const { body } = await postLunchQuery('what is for lunch tomorrow');
  assert.match(body.response.outputSpeech.text, /Here's the school lunch for tomorrow\./);
  assert.match(body.response.outputSpeech.text, /Main Entree: Tacos\./);
  assert.match(body.response.outputSpeech.text, /Fruit: Orange\./);
});

test('full HTTP flow returns no-menu message when date not found', async () => {
  const fixture = buildMenuDay('1/1/2099', { 'Main Entree': ['Pizza'] });
  globalThis.fetch = async () => ({ ok: true, json: async () => fixture });

  const { body } = await postLunchQuery('what is for lunch today');
  assert.match(body.response.outputSpeech.text, /I don't have lunch menu information/);
});

test('full HTTP flow returns graceful message when API fails', async () => {
  globalThis.fetch = async () => { throw new Error('network down'); };
  const { body } = await postLunchQuery('what is for lunch today');
  assert.match(body.response.outputSpeech.text, /Sorry, I had trouble looking up the lunch menu/);
});

test('full HTTP flow rejects wrong application ID', async () => {
  const wrong = alexaRequest('what is for lunch today');
  wrong.context.System.application.applicationId = 'amzn1.ask.skill.some-other-skill';
  const res = await realFetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wrong)
  });
  assert.strictEqual(res.status, 400);
});
