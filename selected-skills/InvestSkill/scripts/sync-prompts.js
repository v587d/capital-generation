#!/usr/bin/env node
/**
 * sync-prompts.js — generate prompts/<name>.md from each skill's SKILL.md.
 *
 * SKILL.md is the source of truth. The universal prompt is the same document
 * with the Claude Code specifics removed:
 *
 *   • YAML frontmatter stripped
 *   • `/us-stock-analysis:<skill>`  →  `<skill>`
 *   • `/<skill>` (a known skill name, at a word start)  →  `<skill>`
 *   • example-transcript lines "Claude analyzes …" / "Claude: …"  →  "The assistant …" / "Assistant: …"
 *
 * Nothing else is rewritten, so anything platform-specific must be written
 * platform-neutrally in SKILL.md itself.
 *
 * Usage:
 *   node scripts/sync-prompts.js                 # regenerate every prompt
 *   node scripts/sync-prompts.js stock-eval …    # only the named skills
 *   node scripts/sync-prompts.js --check         # exit 1 if any prompt is out of date (CI)
 *   node scripts/sync-prompts.js --diff          # show which lines differ
 */
const fs = require('fs');
const path = require('path');
const reg = require('./lib/skill-registry');

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const DIFF = argv.includes('--diff');
const only = argv.filter(a => !a.startsWith('--'));

const skills = reg.listSkillDirs();
const skillNames = skills.slice().sort((a, b) => b.length - a.length); // longest first

function generatePrompt(skillMd) {
  let body = skillMd.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n(\r?\n)?/, '');
  body = body.replace(/\/us-stock-analysis:([a-z0-9-]+)/g, '$1');
  // Bare slash commands: only known skill names, only where a command could
  // start (line start, whitespace, backtick, quote, bracket) — never inside URLs.
  const alt = skillNames.map(n => n.replace(/[-]/g, '\\-')).join('|');
  body = body.replace(new RegExp(`(^|[\\s\`"'(\\[|])\\/(${alt})(?![a-z0-9-])`, 'gm'), '$1$2');
  // Example transcripts: "Claude analyzes …" / "Claude: …" → assistant-neutral.
  body = body.replace(/^Claude (?=[a-z])/gm, 'The assistant ').replace(/^Claude: /gm, 'Assistant: ');
  return body;
}

function lineDiff(a, b) {
  const al = a.split('\n'), bl = b.split('\n');
  const out = [];
  const max = Math.max(al.length, bl.length);
  for (let i = 0; i < max; i++) {
    if (al[i] !== bl[i]) {
      out.push(`    @${i + 1}\n    - ${al[i] === undefined ? '<eof>' : al[i]}\n    + ${bl[i] === undefined ? '<eof>' : bl[i]}`);
      if (out.length >= 5) { out.push('    …'); break; }
    }
  }
  return out.join('\n');
}

function main() {
let drift = 0, written = 0, unchanged = 0;
for (const skill of skills) {
  if (only.length && !only.includes(skill)) continue;
  const src = path.join(reg.SKILLS_DIR, skill, 'SKILL.md');
  const dst = path.join(reg.PROMPTS_DIR, `${skill}.md`);
  if (!fs.existsSync(src)) { process.stdout.write(`  ⚠️  ${skill} — SKILL.md missing\n`); continue; }
  const generated = generatePrompt(fs.readFileSync(src, 'utf8'));
  const current = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null;

  if (current === generated) { unchanged++; continue; }
  drift++;
  if (CHECK || DIFF) {
    process.stdout.write(`  ❌ prompts/${skill}.md — out of sync with SKILL.md${current === null ? ' (missing)' : ''}\n`);
    if (DIFF && current !== null) process.stdout.write(lineDiff(current, generated) + '\n');
  } else {
    fs.writeFileSync(dst, generated);
    written++;
    process.stdout.write(`  ✍️  prompts/${skill}.md — ${current === null ? 'created' : 'regenerated'}\n`);
  }
}

if (CHECK || DIFF) {
  process.stdout.write(`\n  ${unchanged} in sync, ${drift} out of sync\n`);
  if (drift) process.stdout.write('  Run `node scripts/sync-prompts.js` to regenerate.\n\n');
  process.exit(drift ? 1 : 0);
} else {
  process.stdout.write(`\n  ${written} written, ${unchanged} already in sync\n\n`);
}
}

if (require.main === module) main();

module.exports = { generatePrompt };
