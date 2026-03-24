const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

const SKILL_APP_ID = 'amzn1.ask.skill.17d7aad1-666b-4607-9c7d-3d4113668484';

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
    return res.json(buildResponse('Hello! I am Donda. Ask me anything.'));
  }

  if (requestType === 'IntentRequest') {
    const intent = request.request.intent;
    const intentName = intent?.name;
    const slots = intent?.slots || {};
    
    console.log('Intent name:', intentName);
    console.log('Slots:', JSON.stringify(slots));

    if (intentName === 'ChatIntent') {
      const slotValues = Object.values(slots).map(s => s.value).join(' ') || 'nothing';
      console.log('User said:', slotValues);
      return res.json(buildResponse(`You said: ${slotValues}. (LLM integration pending)`));
    }

    if (intentName === 'AMAZON.HelpIntent') {
      return res.json(buildResponse('You can ask me anything. Try saying ask dawn duh followed by your question.'));
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
  console.log(`Donda Alexa skill server running on port ${PORT}`);
});
