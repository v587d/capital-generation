#!/usr/bin/env node
/**
 * eval-skills.js — opt-in *behavioural* evaluation of the skills.
 *
 * Everything else in `npm test` checks structure: does a skill file define the
 * contract? This script checks behaviour: when a model actually runs a skill on
 * a fixed data pack, does the output honour the contract and get the arithmetic
 * right?
 *
 * It is opt-in because it needs a model. Set EVAL_CMD to any command that reads
 * a prompt on stdin and writes the completion to stdout, e.g.
 *
 *   EVAL_CMD='claude -p'                       node scripts/eval-skills.js
 *   EVAL_CMD='ollama run llama3.1'             node scripts/eval-skills.js --skills stock-eval
 *   EVAL_CMD='gemini -p -'                     node scripts/eval-skills.js --all
 *
 * Without EVAL_CMD it prints how to enable itself and exits 0, so it is safe to
 * wire into any script. `--dry-run` writes the assembled prompts to
 * qa/eval-output/<date>/prompts/ so you can run them by hand (or with
 * `claude plugin eval`) and paste the outputs back with `--from-dir <dir>`.
 *
 * Fixtures live in data/fixtures/<TICKER>.md: a YAML front block with the raw
 * figures and an `expect:` list of arithmetic checks, followed by the data pack
 * the model sees. See data/fixtures/ZEPH.md (fictional company, so the numbers
 * never go stale and the model cannot "remember" them).
 *
 * Per skill run, the checks are:
 *   hard  — parsed by scripts/lib/signal-block.js: Investment Signal block present and
 *           filled, enum values valid, Score in 0–10 and consistent with Signal,
 *           Data & Sources header with all four fields, Retrieval honest
 *           ("pasted by user" for a fixture), disclaimer present
 *   soft  — each `expect` item: a number close to the expected value must appear
 *           near the named term (FCF, P/E, …). Soft failures are WARN, not FAIL:
 *           formatting varies and a skill may legitimately not report a figure.
 *
 * Output: qa/eval_YYYYMMDD.md (summary table + per-skill detail) and the raw
 * completions in qa/eval-output/<date>/ (git-ignored). Exit 1 if any hard check
 * failed.
 *
 * Options:
 *   --skills a,b,c   skills to run (default: stock-eval,bear-case,stock-valuation,dividend-analysis)
 *   --all            every analysis framework the fixture can feed (single-ticker skills)
 *   --fixture ZEPH   fixture ticker (default: ZEPH)
 *   --timeout 600    seconds per run (default 600)
 *   --dry-run        write prompts, run nothing
 *   --from-dir DIR   score completions saved as DIR/<skill>.md instead of running EVAL_CMD
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const reg = require('./lib/skill-registry');
const sb = require('./lib/signal-block');

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const has = k => argv.includes(`--${k}`);

const DEFAULT_SKILLS = ['stock-eval', 'bear-case', 'stock-valuation', 'dividend-analysis'];
// Multi-ticker / portfolio / document skills need a different fixture shape; --all skips them.
const NOT_SINGLE_TICKER = ['portfolio-review', 'stock-screener', 'sector-analysis', 'economics-analysis',
  'industry-map', '10k-digest', 'financial-report-analyst', 'earnings-call-analysis', 'chart-master',
  'full-report', 'thesis-tracker', 'catalyst-calendar', 'options-analysis', 'short-interest',
  'insider-trading', 'institutional-ownership', 'technical-analysis'];

const EVAL_CMD = process.env.EVAL_CMD;
const fixtureName = flag('fixture', 'ZEPH');
const timeoutSec = parseInt(flag('timeout', '600'), 10);
const dryRun = has('dry-run');
const fromDir = flag('from-dir');
const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const outDir = path.join(reg.ROOT, 'qa', 'eval-output', date);

const skills = has('all')
  ? reg.listSkillDirs().filter(n => reg.isFramework(n) && !reg.META_SKILLS.includes(n) && !NOT_SINGLE_TICKER.includes(n))
  : flag('skills', DEFAULT_SKILLS.join(',')).split(',').map(s => s.trim()).filter(Boolean);

// ── fixture ──────────────────────────────────────────────────────────────────
function loadFixture(name) {
  const file = path.join(reg.ROOT, 'data', 'fixtures', `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`fixture not found: ${path.relative(reg.ROOT, file)}`);
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('fixture needs a YAML front block');
  const meta = {}; const expect = [];
  for (const line of m[1].split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t === 'expect:') continue;
    const item = t.match(/^-\s*\{(.*)\}\s*$/);
    if (item) {
      const obj = {};
      for (const kv of item[1].split(/,(?=\s*\w+:)/)) {
        const [k, ...rest] = kv.split(':'); let v = rest.join(':').trim();
        if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\\\/g, '\\');
        else if (/^-?\d+(\.\d+)?$/.test(v)) v = parseFloat(v);
        obj[k.trim()] = v;
      }
      expect.push(obj);
      continue;
    }
    const kv = t.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = /^-?\d+(\.\d+)?$/.test(kv[2]) ? parseFloat(kv[2]) : kv[2].replace(/\s+#.*$/, '');
  }
  return { meta, expect, body: m[2].trim(), file };
}

// ── prompt assembly ──────────────────────────────────────────────────────────
function assemblePrompt(skill, fx) {
  const promptFile = path.join(reg.PROMPTS_DIR, `${skill}.md`);
  if (!fs.existsSync(promptFile)) throw new Error(`no prompt for ${skill}`);
  const framework = fs.readFileSync(promptFile, 'utf8');
  return `${framework}

---

# Task

Run the framework above on **${fx.meta.ticker}** (${fx.meta.company}).

Rules for this run:
- Use **only** the data pack below. It was pasted by the user, so the \`Data & Sources\` header must say \`Retrieval: pasted by user\` and \`As of: ${fx.meta.as_of}\`.
- Do not search the web and do not use memory for this ticker — the company is fictional and any outside figure is wrong by construction.
- Where the framework asks for data the pack does not contain, say "not in data pack" rather than estimating.
- Produce the complete output the framework specifies, including the Thesis Invalidation section and the Investment Signal block, filled in (no placeholders).

${fx.body}
`;
}

// ── number extraction for soft checks ────────────────────────────────────────
function numbersNear(text, nearRe, unit) {
  const re = new RegExp(nearRe, 'gi');
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const window = text.slice(m.index, m.index + 160);
    const numRe = /(?:\$\s?)?(-?\(?\d[\d,]*(?:\.\d+)?\)?)\s*(billion|million|bn|mm|[BMx%]|×)?/gi;
    let n;
    while ((n = numRe.exec(window)) !== null) {
      let v = parseFloat(n[1].replace(/[,()]/g, ''));
      if (Number.isNaN(v)) continue;
      const u = (n[2] || '').toLowerCase();
      if (unit === 'm') {
        if (u === 'b' || u === 'bn' || u === 'billion') v *= 1000;
        else if (u === '%' || u === 'x' || u === '×') continue;
      } else if (unit === 'pct') {
        if (u && u !== '%') continue;
      } else if (unit === 'x') {
        if (u && u !== 'x' && u !== '×') continue;
      }
      found.push(Math.abs(v));
    }
  }
  return found;
}

function softChecks(output, fx) {
  return fx.expect.map(e => {
    const nums = numbersNear(output, e.near, e.unit);
    if (!nums.length) return { label: e.label, status: 'SKIP', detail: `no figure found near /${e.near}/` };
    const target = Math.abs(e.value);
    const tol = e.tol || 0.03;
    const hit = nums.find(v => Math.abs(v - target) / target <= tol);
    if (hit !== undefined) return { label: e.label, status: 'PASS', detail: `${hit} ≈ ${e.value}` };
    const closest = nums.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
    return { label: e.label, status: 'WARN', detail: `expected ≈ ${e.value}, closest ${closest}` };
  });
}

// ── run ──────────────────────────────────────────────────────────────────────
function runModel(prompt) {
  const started = Date.now();
  const r = spawnSync('sh', ['-c', EVAL_CMD], { input: prompt, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024 });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status, timedOut: r.error && r.error.code === 'ETIMEDOUT', ms: Date.now() - started };
}

function main() {
  if (!EVAL_CMD && !dryRun && !fromDir) {
    process.stdout.write(`
  eval-skills — behavioural eval is opt-in (no model configured).

  Set EVAL_CMD to a command that reads a prompt on stdin and prints the completion:
    EVAL_CMD='claude -p' node scripts/eval-skills.js
  or write the prompts out and run them yourself:
    node scripts/eval-skills.js --dry-run
  then score the saved completions:
    node scripts/eval-skills.js --from-dir qa/eval-output/${date}

`);
    process.exit(0);
  }

  const fx = loadFixture(fixtureName);
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];

  for (const skill of skills) {
    const prompt = assemblePrompt(skill, fx);
    if (dryRun) {
      const pDir = path.join(outDir, 'prompts'); fs.mkdirSync(pDir, { recursive: true });
      fs.writeFileSync(path.join(pDir, `${skill}.md`), prompt);
      process.stdout.write(`  ✍️  ${path.relative(reg.ROOT, path.join(pDir, `${skill}.md`))}\n`);
      continue;
    }
    let output, ms = 0, error = null;
    if (fromDir) {
      const f = path.join(path.resolve(fromDir), `${skill}.md`);
      if (!fs.existsSync(f)) { results.push({ skill, error: `no completion at ${f}` }); continue; }
      output = fs.readFileSync(f, 'utf8');
    } else {
      process.stdout.write(`  ▶ ${skill} … `);
      const r = runModel(prompt); ms = r.ms;
      if (r.timedOut) error = `timed out after ${timeoutSec}s`;
      else if (r.status !== 0) error = `EVAL_CMD exited ${r.status}: ${r.stderr.slice(0, 200)}`;
      output = r.stdout;
      fs.writeFileSync(path.join(outDir, `${skill}.md`), output);
      process.stdout.write(error ? `✗ ${error}\n` : `${(ms / 1000).toFixed(0)}s\n`);
    }
    const hard = sb.validateOutput(output, { expectRetrieval: 'pasted by user' });
    const soft = softChecks(output, fx);
    results.push({ skill, error, ms, hard, soft, chars: output.length });
  }

  if (dryRun) { process.stdout.write(`\n  Prompts written to ${path.relative(reg.ROOT, outDir)}/prompts — run them, save each completion as <skill>.md, then --from-dir.\n\n`); return; }

  // ── report ────────────────────────────────────────────────────────────────
  const anyFail = results.some(r => r.error || (r.hard && !r.hard.ok));
  const lines = [];
  lines.push(`# Skill behavioural eval — ${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, '');
  lines.push(`*Fixture: \`${path.relative(reg.ROOT, fx.file)}\` (${fx.meta.company}) · Runner: \`${fromDir ? `from-dir ${fromDir}` : EVAL_CMD}\` · ${results.length} skill(s)*`, '');
  lines.push('| Skill | Contract | Signal | Score | Data & Sources | Arithmetic | Time |', '|-------|----------|--------|-------|----------------|------------|------|');
  for (const r of results) {
    if (r.error) { lines.push(`| \`${r.skill}\` | ❌ error | — | — | — | — | — |`); continue; }
    const s = r.hard.signal, ds = r.hard.dataSources;
    const passed = r.soft.filter(x => x.status === 'PASS').length, warned = r.soft.filter(x => x.status === 'WARN').length;
    lines.push(`| \`${r.skill}\` | ${r.hard.ok ? '✅' : `❌ ${r.hard.issues.length}`} | ${s ? s.signal : '—'} | ${s && s.score !== null ? s.score : '—'} | ${ds ? `${ds.retrievalKind} · ${ds.confidence}` : '—'} | ${passed} ✓ ${warned} ⚠ | ${r.ms ? `${(r.ms / 1000).toFixed(0)}s` : '—'} |`);
  }
  lines.push('');
  for (const r of results) {
    lines.push(`## \`${r.skill}\``, '');
    if (r.error) { lines.push(`❌ ${r.error}`, ''); continue; }
    lines.push(`**Hard checks:** ${r.hard.ok ? 'all passed' : r.hard.issues.map(i => `❌ ${i}`).join(' · ')}`);
    if (r.hard.warnings.length) lines.push(`**Warnings:** ${r.hard.warnings.join(' · ')}`);
    lines.push('', '| Arithmetic check | Result | Detail |', '|------------------|--------|--------|');
    for (const c of r.soft) lines.push(`| ${c.label} | ${c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️' : '⏭'} ${c.status} | ${c.detail} |`);
    if (r.hard.signal) lines.push('', '```', r.hard.signal.raw, '```');
    lines.push('');
  }
  lines.push(`*Raw completions: \`qa/eval-output/${date}/\` (git-ignored). Hard checks parse the output with \`scripts/lib/signal-block.js\`; arithmetic checks are advisory.*`, '');
  const reportFile = path.join(reg.ROOT, 'qa', `eval_${date}.md`);
  fs.writeFileSync(reportFile, lines.join('\n'));
  process.stdout.write(`\n  Report: ${path.relative(reg.ROOT, reportFile)}\n  ${anyFail ? '❌ hard-check failures — see report' : '✅ every run honoured the contract'}\n\n`);
  process.exit(anyFail ? 1 : 0);
}

if (require.main === module) {
  try { main(); } catch (e) { process.stderr.write(`\n  ✗ ${e.message}\n\n`); process.exit(1); }
}

module.exports = { loadFixture, assemblePrompt, softChecks, numbersNear };
