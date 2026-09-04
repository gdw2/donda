const { test } = require('node:test');
const assert = require('node:assert');
const { IntentMatcher, cosineSimilarity, l2Normalize } = require('../intent/intent-matcher');

const DEFS = [
  {
    key: 'get_lunch_today',
    samples: ["what's for lunch today", "what's on the school lunch menu"]
  },
  {
    key: 'get_lunch_tomorrow',
    samples: ["what's for school lunch tomorrow", "what's tomorrow's lunch menu"]
  }
];

// Deterministic fake embedder: bag-of-words vectors, no model download needed.
function makeVocab(definitions) {
  const vocab = new Map();
  for (const def of definitions) {
    for (const sample of def.samples) {
      for (const word of sample.toLowerCase().split(/[^a-z]+/)) {
        if (word && !vocab.has(word)) vocab.set(word, vocab.size);
      }
    }
  }
  return vocab;
}

const vocab = makeVocab(DEFS);

function fakeEmbedder(texts) {
  return texts.map((text) => {
    const vec = new Array(vocab.size).fill(0);
    for (const word of text.toLowerCase().split(/[^a-z]+/)) {
      if (vocab.has(word)) vec[vocab.get(word)] += 1;
    }
    return vec;
  });
}

async function makeMatcher({ threshold } = {}) {
  return new IntentMatcher({
    definitions: DEFS,
    threshold,
    cacheDir: null,
    embedder: fakeEmbedder
  }).init();
}

test('init builds one reference row per sample', async () => {
  const matcher = await makeMatcher();
  assert.strictEqual(matcher._refRows.length, 4);
  assert.deepStrictEqual(matcher._refRows.map((r) => r.intent), [
    'get_lunch_today',
    'get_lunch_today',
    'get_lunch_tomorrow',
    'get_lunch_tomorrow'
  ]);
});

test('matches a verbatim sample with confidence ~1', async () => {
  const matcher = await makeMatcher();
  const result = await matcher.match("what's for lunch today");
  assert.strictEqual(result.intent, 'get_lunch_today');
  assert.ok(Math.abs(result.confidence - 1) < 1e-9);
});

test('matches tomorrow samples to get_lunch_tomorrow', async () => {
  const matcher = await makeMatcher();
  const result = await matcher.match("what's for school lunch tomorrow");
  assert.strictEqual(result.intent, 'get_lunch_tomorrow');
});

test('nearby paraphrase routes to correct intent above threshold', async () => {
  const matcher = await makeMatcher({ threshold: 0.5 });
  const result = await matcher.match("what is for lunch today please");
  assert.strictEqual(result.intent, 'get_lunch_today');
  assert.ok(result.confidence >= 0.5);
});

test('unrecognized utterance returns null below default threshold', async () => {
  const matcher = await makeMatcher();
  const result = await matcher.match('play some loud music now');
  assert.strictEqual(result.intent, null);
  assert.ok(result.confidence < 0.75);
});

test('higher threshold rejects weak matches', async () => {
  const matcher = await makeMatcher({ threshold: 0.9 });
  const result = await matcher.match("what is for lunch today please");
  assert.strictEqual(result.intent, null);
});

test('constructor rejects empty definitions', () => {
  assert.throws(() => new IntentMatcher({ definitions: [] }), /non-empty/);
});

test('cosineSimilarity returns 1 for identical normalized vectors', () => {
  const a = l2Normalize([1, 2, 3]);
  assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-9);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  const a = l2Normalize([1, 0]);
  const b = l2Normalize([0, 1]);
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-9);
});
