/**
 * signal-block.js — one shared parser for the InvestSkill output contract.
 *
 * Used by check-skill-contract.js (does a skill *define* the contract?),
 * eval-skills.js (did a model run *honour* it?), and available to
 * site-review.js or a future "paste your output" checker.
 *
 * The contract, in the order it appears in an analysis:
 *
 *   Data & Sources                      ← provenance header at the top
 *     As of:      2026-06-30
 *     Source:     …
 *     Retrieval:  pasted by user | web/tool retrieval | model memory
 *     Confidence: HIGH | MEDIUM | LOW
 *
 *   … analysis …
 *
 *   ## Thesis Invalidation              ← what would reverse the call
 *
 *   ╔══════════════════════════════════════════════╗
 *   ║              INVESTMENT SIGNAL               ║   ← the signal block
 *   ╠══════════════════════════════════════════════╣
 *   ║ Signal:      BULLISH / NEUTRAL / BEARISH     ║
 *   ║ Confidence:  HIGH / MEDIUM / LOW             ║
 *   ║ Horizon:     SHORT / MEDIUM / LONG-TERM      ║
 *   ║ Score:       X.X / 10                        ║
 *   ╠══════════════════════════════════════════════╣
 *   ║ Action:      BUY / HOLD / SELL               ║
 *   ║ Conviction:  STRONG / MODERATE / WEAK        ║
 *   ╚══════════════════════════════════════════════╝
 *
 *   **Disclaimer:** … Not financial advice.
 */

const SIGNAL_BLOCK_TOP = '╔══════════════════════════════════════════════╗';
const SIGNALS = ['BULLISH', 'NEUTRAL', 'BEARISH'];
const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'];
const ACTIONS = ['BUY', 'HOLD', 'SELL'];
const CONVICTIONS = ['STRONG', 'MODERATE', 'WEAK'];
const RETRIEVALS = ['pasted by user', 'web/tool retrieval', 'model memory'];

const DATA_SOURCES_FIELDS = ['As of', 'Source', 'Retrieval', 'Confidence'];

/** Score → the signal the Score Guide says it maps to. */
function expectedSignalForScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  if (score >= 6.0) return 'BULLISH';
  if (score >= 4.0) return 'NEUTRAL';
  return 'BEARISH';
}

/** Return every box-drawn block (╔ … ╚) in the text, raw. */
function extractBoxes(text) {
  const boxes = [];
  const re = /╔[═]+╗[\s\S]*?╚[═]+╝/g;
  let m;
  while ((m = re.exec(text)) !== null) boxes.push(m[0]);
  return boxes;
}

/**
 * Parse the *last* Investment Signal box in a text (the final synthesis).
 * Returns null when there is none. Field values are upper-cased and trimmed;
 * `score` is a number when parseable. Placeholders like "BULLISH / NEUTRAL /
 * BEARISH" (a template, not a filled value) are reported via `isTemplate`.
 */
function parseSignalBlock(text) {
  const boxes = extractBoxes(text || '').filter(b => /INVESTMENT SIGNAL/i.test(b));
  if (!boxes.length) return null;
  const box = boxes[boxes.length - 1];
  const fields = {};
  for (const line of box.split('\n')) {
    const m = line.match(/^║\s*([A-Za-z][A-Za-z ]*?):\s*(.*?)\s*║\s*$/);
    if (m) fields[m[1].trim().toLowerCase()] = m[2].trim();
  }
  const pick = k => (fields[k] || '').toUpperCase();
  const first = v => v.split(/[\/|]/)[0].trim();     // "BULLISH / NEUTRAL" → BULLISH
  const scoreRaw = fields['score'] || '';
  const scoreMatch = scoreRaw.match(/(-?\d+(?:\.\d+)?)\s*\/\s*10/);
  const isTemplate = /BULLISH\s*\/\s*NEUTRAL/i.test(fields['signal'] || '') || /X\.X/i.test(scoreRaw);

  return {
    raw: box,
    isTemplate,
    signal: first(pick('signal')) || null,
    confidence: first(pick('confidence')) || null,
    horizon: pick('horizon') || null,
    score: scoreMatch ? parseFloat(scoreMatch[1]) : null,
    action: first(pick('action')) || null,
    conviction: first(pick('conviction')) || null,
    fields,
  };
}

/**
 * Parse the Data & Sources header. Accepts the fenced or plain form; fields
 * are matched case-insensitively and may be separated by ":" with any spacing.
 */
function parseDataSources(text) {
  const idx = (text || '').search(/Data\s*&\s*Sources/i);
  if (idx < 0) return null;
  const window = text.slice(idx, idx + 1200);
  const get = label => {
    const m = window.match(new RegExp(`${label}\\s*:\\s*(.+)`, 'i'));
    return m ? m[1].trim().replace(/\s*[║|]\s*$/, '') : null;
  };
  const retrieval = get('Retrieval');
  const confidence = get('Confidence');
  return {
    asOf: get('As of'),
    source: get('Source'),
    retrieval,
    confidence: confidence ? confidence.toUpperCase().split(/[\s—-]/)[0] : null,
    retrievalKind: retrieval
      ? (RETRIEVALS.find(r => retrieval.toLowerCase().includes(r.split(' ')[0])) || 'other')
      : null,
  };
}

/** Does a text contain the Data & Sources header *template* with all four fields? */
function hasDataSourcesTemplate(text) {
  if (!/Data\s*&\s*Sources/i.test(text || '')) return false;
  return DATA_SOURCES_FIELDS.every(f => new RegExp(`${f}\\s*:`, 'i').test(text));
}

function hasSignalBlockTemplate(text) {
  return (text || '').includes(SIGNAL_BLOCK_TOP);
}

function hasThesisInvalidation(text) {
  return /Thesis Invalidation/i.test(text || '');
}

function hasDataVerification(text) {
  return /^#{2,3}\s.*Data Verification/im.test(text || '');
}

function hasDisclaimer(text) {
  return /not financial advice/i.test(text || '');
}

/**
 * Validate a *model output* (not a skill file) against the contract.
 * Returns { ok, issues[], warnings[], signal, dataSources }.
 */
function validateOutput(text, opts = {}) {
  const issues = [];
  const warnings = [];
  const signal = parseSignalBlock(text);
  const ds = parseDataSources(text);

  if (!signal) issues.push('missing Investment Signal block');
  else {
    if (signal.isTemplate) issues.push('signal block left as an unfilled template');
    if (signal.signal && !SIGNALS.includes(signal.signal)) issues.push(`Signal "${signal.signal}" not in ${SIGNALS.join('/')}`);
    if (signal.confidence && !CONFIDENCES.includes(signal.confidence)) issues.push(`Confidence "${signal.confidence}" not in ${CONFIDENCES.join('/')}`);
    if (signal.action && !ACTIONS.includes(signal.action)) issues.push(`Action "${signal.action}" not in ${ACTIONS.join('/')}`);
    if (signal.conviction && !CONVICTIONS.includes(signal.conviction)) issues.push(`Conviction "${signal.conviction}" not in ${CONVICTIONS.join('/')}`);
    if (signal.score === null) issues.push('Score missing or not "X.X / 10"');
    else if (signal.score < 0 || signal.score > 10) issues.push(`Score ${signal.score} outside 0–10`);
    else if (signal.signal && SIGNALS.includes(signal.signal)) {
      const expected = expectedSignalForScore(signal.score);
      if (expected !== signal.signal) issues.push(`Score ${signal.score} maps to ${expected} but Signal says ${signal.signal}`);
    }
  }

  if (!ds) issues.push('missing Data & Sources header');
  else {
    for (const [k, label] of [['asOf', 'As of'], ['source', 'Source'], ['retrieval', 'Retrieval'], ['confidence', 'Confidence']]) {
      if (!ds[k]) issues.push(`Data & Sources: "${label}" line missing`);
    }
    if (ds.retrievalKind === 'model memory' && ds.confidence !== 'LOW') {
      issues.push('Data & Sources: Retrieval is model memory but Confidence is not LOW');
    }
    if (opts.expectRetrieval && ds.retrievalKind && ds.retrievalKind !== opts.expectRetrieval) {
      warnings.push(`Data & Sources: expected Retrieval "${opts.expectRetrieval}", got "${ds.retrieval}"`);
    }
  }

  if (!hasThesisInvalidation(text)) warnings.push('no Thesis Invalidation section');
  if (!hasDisclaimer(text)) issues.push('missing "Not financial advice" disclaimer');

  return { ok: issues.length === 0, issues, warnings, signal, dataSources: ds };
}

module.exports = {
  SIGNAL_BLOCK_TOP, SIGNALS, CONFIDENCES, ACTIONS, CONVICTIONS, RETRIEVALS, DATA_SOURCES_FIELDS,
  expectedSignalForScore, extractBoxes, parseSignalBlock, parseDataSources,
  hasDataSourcesTemplate, hasSignalBlockTemplate, hasThesisInvalidation, hasDataVerification, hasDisclaimer,
  validateOutput,
};
