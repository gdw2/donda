const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert');

const server = require('../server');
const realFetch = globalThis.fetch;

let httpServer;
let baseUrl;

function alexaRequest(userText) {
  return {
    context: {
      System: { application: { applicationId: server.SKILL_APP_ID } }
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

async function postUtterance(userText) {
  const res = await realFetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(alexaRequest(userText))
  });
  return res.json();
}

function fakeMatcherReturning(intent) {
  server._setMatcherProviderOverride(() => ({
    match: async () => ({ intent, confidence: intent ? 0.99 : 0.4, sample: null })
  }));
}

function defaultMenuFixture() {
  return {
    FamilyMenuSessions: [
      {
        ServingSession: 'Lunch',
        MenuPlans: [
          {
            Days: [
              {
                Date: new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }),
                MenuMeals: [
                  {
                    RecipeCategories: [
                      { CategoryName: 'Main Entree', Recipes: [{ RecipeName: 'Pizza' }] }
                    ]
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

before(async () => {
  httpServer = server.app.listen(0);
  await new Promise((resolve) => httpServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

after(() => {
  httpServer.close();
  globalThis.fetch = realFetch;
  server._setMatcherProviderOverride(null);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  server._setMatcherProviderOverride(null);
});

test('routes get_lunch_tomorrow to tomorrow menu', async () => {
  fakeMatcherReturning('get_lunch_tomorrow');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const fixture = defaultMenuFixture();
  fixture.FamilyMenuSessions[0].MenuPlans[0].Days[0].Date =
    tomorrow.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  globalThis.fetch = async () => ({ ok: true, json: async () => fixture });

  const body = await postUtterance('what are we eating tomorrow');
  assert.match(body.response.outputSpeech.text, /Here's the school lunch for tomorrow\./);
});

test('routes get_lunch_today to today menu', async () => {
  fakeMatcherReturning('get_lunch_today');
  globalThis.fetch = async () => ({ ok: true, json: async () => defaultMenuFixture() });
  const body = await postUtterance('what is on the lunch menu');
  assert.match(body.response.outputSpeech.text, /Here's today's school lunch\./);
});

test('routes help intent to help text', async () => {
  fakeMatcherReturning('help');
  const body = await postUtterance('what can you do');
  assert.match(body.response.outputSpeech.text, /tell me what is for lunch today/);
});

test('routes exit intent to goodbye', async () => {
  fakeMatcherReturning('exit');
  const body = await postUtterance('never mind');
  assert.match(body.response.outputSpeech.text, /Goodbye!/);
});

test('routes below-threshold unknown intent to fallback', async () => {
  fakeMatcherReturning(null);
  const body = await postUtterance('play some music');
  assert.match(body.response.outputSpeech.text, /Sorry, I didn't catch that/);
});

test('weekday keyword still resolves even when matcher returns unknown', async () => {
  fakeMatcherReturning(null);

  const d = new Date();
  const weekday = d.getDay();
  const diff = (5 + 7 - weekday) % 7;
  const daysAhead = diff === 0 ? 7 : diff;
  const nextFriday = new Date(d);
  nextFriday.setDate(nextFriday.getDate() + daysAhead);
  const dateStr = nextFriday.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });

  const fixture = defaultMenuFixture();
  fixture.FamilyMenuSessions[0].MenuPlans[0].Days[0].Date = dateStr;
  globalThis.fetch = async () => ({ ok: true, json: async () => fixture });

  const body = await postUtterance('what is for lunch on friday');
  assert.match(body.response.outputSpeech.text, /Here's the school lunch for Friday\./);
});
