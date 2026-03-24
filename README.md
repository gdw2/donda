# Donda Alexa Skill

Custom Alexa skill that forwards requests to a local LLM service.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Update Cloudflare URL
Edit `skill.json` and replace the placeholder URL with your actual Cloudflare tunnel URL.

### 3. Deploy skill to Alexa
```bash
npm install -g ask-cli
ask init
ask deploy
```

### 4. Start server and tunnel

Terminal 1 - Start the server:
```bash
npm start
```

Terminal 2 - Create Cloudflare tunnel:
```bash
cloudflared tunnel --url http://localhost:8080
```

### 5. Update URL after tunnel creation
After getting your Cloudflare URL, update it in:
- `skill.json` (endpoint.uri)
- Run `ask deploy` again

## Usage
- Invocation: "Alexa, ask Donda to [your question]"
- Example: "Alexa, ask Donda to tell me a joke"

## Server Endpoints
- The server expects POST requests at `/` (root)
- It handles Alexa's JSON request format
- Responses must follow Alexa's response format

## LLM Integration
Edit `server.js` and replace the LLM integration placeholder with your actual LLM call.
