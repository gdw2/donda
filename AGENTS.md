# Alexa Skill "Donda" - Development Notes

## Overview
Custom Alexa skill for looking up the school lunch menu via Cloudflare Tunnel.

## Architecture
- **Alexa Skill** → **Cloudflare Tunnel** → **Local Node.js server** → **LinqConnect school lunch API**

## Key Files
- `skill-package/skill.json` - Skill manifest (endpoint, SSL cert type)
- `skill-package/interactionModels/custom/en-US.json` - Interaction model (intents, utterances)
- `server.js` - Express server handling Alexa requests
- `intent/intent-matcher.js` - Reusable IntentMatcher class (sentence-embedding intent routing)
- `intent/intents.js` - Intent definitions (key + sample utterances)
- `intent/example.js` - IntentMatcher demo runner (`npm run intent-demo`)
- `ask-resources.json` - ASK CLI configuration
- `flake.nix` - Nix flake for reproducible builds and NixOS deployment

## SSL Certificate Configuration
For trycloudflare.com URLs, use `sslCertificateType: "Trusted"`.

```json
{
  "endpoint": {
    "uri": "https://your-tunnel.trycloudflare.com",
    "sslCertificateType": "Trusted"
  }
}
```

## Common Issues

### "I am unable to reach the requested skill"
- Check skill ID matches between console and deployed skill
- Verify endpoint URL is correct in skill manifest
- Ensure server is running and tunnel is active
- Try deleting old skill IDs (multiple skills can cause confusion)

### "Skill is not ready for enablement"
- Ensure interaction model is deployed with `skill-metadata`
- Check skill has valid invocation name (2+ words if single word)

### Model Build Failures
- `AMAZON.LITERAL` slot type is deprecated/not valid
- Slot references in samples must match defined slots exactly
- Use simple sample utterances without complex slot patterns

## Deployment Commands
```bash
# Start local server and tunnel
devbox run -- node server.js
/tmp/cloudflared tunnel --url http://localhost:8080

# Deploy to Alexa (infrastructure as code)
npx --yes ask-cli@2.30.7 deploy

# Test via CLI simulation
npx --yes ask-cli@2.30.7 smapi simulate-skill \
  -s <skill-id> \
  -g development \
  --input-content "ask ding dong what is for lunch today" \
  --device-locale en-US
```

## Nix/NixOS Deployment

The `flake.nix` provides reproducible builds and NixOS systemd service integration.

### Development Commands

```bash
# Enter development shell with Node.js 20 and cloudflared
nix develop

# Build the package
nix build

# Run the server directly
nix run
```

### NixOS Module Usage

Import the flake in your NixOS configuration:

```nix
{
  inputs.alexa-skill.url = "github:yourusername/alexa-skill"; # or path:/local/path
  
  outputs = { self, nixpkgs, alexa-skill, ... }: {
    nixosConfigurations.myserver = nixpkgs.lib.nixosSystem {
      modules = [
        alexa-skill.nixosModules.default
        {
          services.alexa-skill-donda = {
            enable = true;
            port = 8080;
            skillAppId = "amzn1.ask.skill.4af90b07-5af7-4d90-aba1-3018762d2114";
            openFirewall = true;  # Open port in firewall
          };
        }
      ];
    };
  };
}
```

### NixOS Module Options

- `services.alexa-skill-donda.enable` - Enable the systemd service
- `services.alexa-skill-donda.port` - Port to listen on (default: 8080)
- `services.alexa-skill-donda.skillAppId` - Alexa Skill Application ID
- `services.alexa-skill-donda.user` - Service user (default: "alexa-skill-donda")
- `services.alexa-skill-donda.group` - Service group (default: "alexa-skill-donda")
- `services.alexa-skill-donda.openFirewall` - Automatically open firewall port (default: false)

The service includes automatic restarts, security hardening, and runs as an unprivileged user.

## Current State
- Invocation: "ding dong"
- Skill ID: amzn1.ask.skill.4af90b07-5af7-4d90-aba1-3018762d2114
- Endpoint: https://donda.gdw2.com (Cloudflare tunnel → localhost:8080)
- Menu data from: LinqConnect FamilyMenu API (building/district hardcoded in server.js)
- Response generation: rule-based formatting of menu JSON (no LLM); LLM may be re-added later
- Alexa interaction model is intentionally domain-agnostic (set once, never edited for new
  capabilities). It only exposes a single ChatIntent with an AMAZON.SearchQuery slot and
  generic carrier samples ("do/run/ask/about/tell me {userText}") plus the standard
  built-in intents. DO NOT add lunch-specific sample utterances to the model.
- Intent routing: all ChatIntent text is classified server-side by
  `intent/intent-matcher.js` (sentence embeddings) into
  get_lunch_today / get_lunch_tomorrow / help / exit. Weekday keywords in the text
  override matcher date. Set `DISABLE_INTENT_MATCHER=1` to skip embedding routing
  (used by tests). Reference embeddings cached in `intent/.cache/`.
- Multi-turn: LaunchRequest ("open ding dong") responds with shouldEndSession=false and
  invites free-form follow-ups; ChatIntent answers also keep the session open so users
  can ask follow-ups without repeating a carrier. exit/stop/cancel end the session.

## Alexa Carrier Phrasing
Because the interaction model only has generic carriers, users invoke the skill in the
simulator/device via a carrier verb, e.g.:
- "ask ding dong to tell me what is for lunch today"
- "ask ding dong to tell me what is for lunch tomorrow"
Or they open a multi-turn session first:
- "open ding dong" → then "what's for lunch today" (free speech inside the session)

## Testing
The CLI simulation can be flaky and, for a domain-agnostic model, the utterance MUST include
a carrier verb to route: e.g. "ask ding dong to tell me what is for lunch today" (not
"ask ding dong what is for lunch today"). Launch simulation ("open ding dong") is more
reliable and enables free-form follow-up testing. Testing on actual Echo devices or the
web-based developer console simulator also works.

For local integration tests, run `npm test` (requires the server to be running, or sets up its own instance).
