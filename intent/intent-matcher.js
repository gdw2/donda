const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { env, pipeline } = require('@huggingface/transformers');

const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_THRESHOLD = 0.75;

function l2Normalize(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * IntentMatcher routes raw user utterances to intents using sentence embeddings.
 *
 * Reference sample utterances for every intent are embedded once at startup
 * (and cached to disk when `cacheDir` is set), so at request time only the
 * incoming utterance is embedded. Matching is cosine similarity against the
 * reference matrix, with a configurable confidence threshold for fallback.
 *
 * CPU is capped to a small number of ONNX/WASM threads to avoid thrashing.
 */
class IntentMatcher {
  constructor({ definitions, threshold = DEFAULT_THRESHOLD, modelId = DEFAULT_MODEL_ID, cacheDir = null, numThreads = 2, quantized = true, embedder = null } = {}) {
    if (!Array.isArray(definitions) || definitions.length === 0) {
      throw new Error('IntentMatcher requires a non-empty definitions array');
    }
    this.definitions = definitions;
    this.threshold = threshold;
    this.modelId = modelId;
    this.cacheDir = cacheDir;
    this.numThreads = numThreads;
    this.quantized = quantized;
    this._embedderFn = embedder;

    this._extractor = null;
    this._refRows = null; // [{ intent, sample, vector }]
    this._hash = null;
  }

  _fingerprint() {
    const canonical = this.definitions
      .map((d) => `${d.key}:${(d.samples || []).join('|')}`)
      .join('::');
    return crypto.createHash('sha256').update(`${this.modelId}:${canonical}`).digest('hex').slice(0, 16);
  }

  _cacheFile() {
    return path.join(this.cacheDir, `intent-embeddings-${this._fingerprint()}.json`);
  }

  async _loadEmbedder() {
    if (this._extractor) return this._extractor;
    // Limit CPU threads to avoid thread thrashing under concurrent requests.
    env.backends.onnx.wasm.numThreads = this.numThreads;
    if (process.env.OMP_NUM_THREADS === undefined) process.env.OMP_NUM_THREADS = String(this.numThreads);
    if (process.env.MKL_NUM_THREADS === undefined) process.env.MKL_NUM_THREADS = String(this.numThreads);
    this._extractor = await pipeline('feature-extraction', this.modelId, { quantized: this.quantized });
    return this._extractor;
  }

  async _embed(texts) {
    if (this._embedderFn) {
      const vectors = await this._embedderFn(texts);
      return vectors.map((v) => l2Normalize(v));
    }
    const extractor = await this._loadEmbedder();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }

  async _tryLoadCache() {
    if (!this.cacheDir) return false;
    const file = this._cacheFile();
    if (!fs.existsSync(file)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.fingerprint !== this._fingerprint() || !Array.isArray(data.rows)) return false;
      this._refRows = data.rows;
      console.log(`IntentMatcher: loaded ${this._refRows.length} cached reference embeddings from ${file}`);
      return true;
    } catch (err) {
      console.warn(`IntentMatcher: failed to load cache ${file}: ${err.message}`);
      return false;
    }
  }

  async _saveCache() {
    if (!this.cacheDir || !this._refRows) return;
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(this._cacheFile(), JSON.stringify({
        fingerprint: this._fingerprint(),
        modelId: this.modelId,
        rows: this._refRows
      }));
      console.log(`IntentMatcher: cached ${this._refRows.length} reference embeddings to ${this._cacheFile()}`);
    } catch (err) {
      console.warn(`IntentMatcher: failed to write cache: ${err.message}`);
    }
  }

  /**
   * Builds the reference matrix: one embedded sample row per intent definition.
   * Must be called once before match(). Uses disk cache when available so the
   * embedder is only loaded when a cache miss occurs.
   */
  async init() {
    if (await this._tryLoadCache()) return this;

    const texts = [];
    const meta = [];
    for (const def of this.definitions) {
      const samples = def.samples && def.samples.length ? def.samples : [''];
      for (const sample of samples) {
        meta.push({ intent: def.key, sample });
        texts.push(sample);
      }
    }

    const vectors = await this._embed(texts);
    this._refRows = meta.map((m, i) => ({
      intent: m.intent,
      sample: m.sample,
      vector: l2Normalize(vectors[i])
    }));

    await this._saveCache();
    console.log(`IntentMatcher: embedded ${this._refRows.length} reference samples across ${this.definitions.length} intents`);
    return this;
  }

  /**
   * Returns the best matching intent for the utterance, or null below threshold.
   * @param {string} utterance
   * @returns {Promise<{intent: string|null, confidence: number, sample: string|null}>}
   */
  async match(utterance) {
    const [vector] = await this._embed([utterance.trim()]);
    const norm = l2Normalize(vector);

    let best = null;
    let bestScore = -Infinity;
    for (const row of this._refRows) {
      const score = cosineSimilarity(norm, row.vector);
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }

    if (!best || bestScore < this.threshold) {
      return { intent: null, confidence: bestScore, sample: null };
    }
    return { intent: best.intent, confidence: bestScore, sample: best.sample };
  }
}

module.exports = { IntentMatcher, cosineSimilarity, l2Normalize };
