# Alexa Skill "Donda" - Development Notes

## Overview
Custom Alexa skill that forwards requests to a local LLM service via Cloudflare Tunnel.

## Architecture
- **Alexa Skill** → **Cloudflare Tunnel** → **Local Node.js server** → **Local LLM**

## Key Files
- `skill-package/skill.json` - Skill manifest (endpoint, SSL cert type)
- `skill-package/interactionModels/custom/en-US.json` - Interaction model (intents, utterances)
- `server.js` - Express server handling Alexa requests
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
  --input-content "ask dawn duh to tell me a joke" \
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
            skillAppId = "amzn1.ask.skill.17d7aad1-666b-4607-9c7d-3d4113668484";
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

## Current State (as of March 2026)
- Invocation: "dawn duh"
- Skill ID: amzn1.ask.skill.17d7aad1-666b-4607-9c7d-3d4113668484
- Endpoint: https://stylish-beijing-independent-makers.trycloudflare.com
- Note: CLI simulation fails but real device may work

## Testing
The CLI simulation sometimes fails with "unexpected error" even when the skill is configured correctly. Testing on actual Echo devices or the web-based developer console simulator may work when CLI fails.
