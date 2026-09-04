#!/usr/bin/env node
const { IntentMatcher } = require('./intent-matcher');
const { INTENT_DEFINITIONS } = require('./intents');

const TEST_UTTERANCES = [
  "what's for lunch",
  "what's for lunch today",
  "what's on the school lunch menu",
  "what's for school lunch tomorrow",
  "what's tomorrow's lunch menu",
  "what are they serving tomorrow",
  "what are we eating tomorrow",
  "can I get a hamburger next tuesday",
  "play some music",
  "when does school start"
];

async function main() {
  const matcher = await new IntentMatcher({
    definitions: INTENT_DEFINITIONS,
    threshold: 0.75,
    cacheDir: 'intent/.cache'
  }).init();

  console.log('\n=== Intent matching demo ===\n');
  for (const utterance of TEST_UTTERANCES) {
    const start = process.hrtime.bigint();
    const result = await matcher.match(utterance);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    const matched = result.intent ? result.intent : '(no match / below threshold)';
    console.log(`utterance: "${utterance}"`);
    console.log(`  intent:    ${matched}`);
    console.log(`  confidence: ${result.confidence.toFixed(3)}`);
    console.log(`  matched sample: ${result.sample ?? '-'}`);
    console.log(`  latency:   ${elapsedMs.toFixed(1)} ms\n`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
