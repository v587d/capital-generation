/**
 * skill-registry.js — single source of truth for how skills are classified.
 *
 * Every script that counts, lints, or lists skills should import these lists
 * instead of hardcoding names, so a reclassification lands in one place.
 *
 *   analysis frameworks  = skill dirs − OUTPUT_TOOLS − ALIAS_SKILLS
 *
 * - OUTPUT_TOOLS  render other skills' results (HTML/PDF); they produce no
 *                 signal of their own and are not advertised as frameworks.
 * - ALIAS_SKILLS  are thin redirect stubs kept for backwards compatibility
 *                 (their SKILL.md points at the skill that absorbed them).
 *                 They are installed and still work, but are advertised as
 *                 aliases, not counted as frameworks.
 * - META_SKILLS   operate on another analysis' output rather than on market
 *                 data, so the Data Verification / Data & Sources / Thesis
 *                 Invalidation contract does not apply to them.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKILLS_DIR = path.join(ROOT, 'plugins', 'us-stock-analysis', 'skills');
const PROMPTS_DIR = path.join(ROOT, 'prompts');

const OUTPUT_TOOLS = ['report-generator'];
const ALIAS_SKILLS = ['fundamental-analysis', 'dcf-valuation', 'research-bundle'];
const META_SKILLS = ['result-validator'];

// Which skills are exempt from each contract section.
const CONTRACT_EXEMPT = {
  signalBlock:        [...OUTPUT_TOOLS],
  dataVerification:   [...OUTPUT_TOOLS, ...ALIAS_SKILLS, ...META_SKILLS],
  dataSources:        [...OUTPUT_TOOLS, ...ALIAS_SKILLS, ...META_SKILLS],
  thesisInvalidation: [...OUTPUT_TOOLS, ...ALIAS_SKILLS, ...META_SKILLS],
  disclaimer:         [...OUTPUT_TOOLS],
};

function listSkillDirs() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR)
    .filter(d => fs.statSync(path.join(SKILLS_DIR, d)).isDirectory())
    .sort();
}

function listPromptNames() {
  if (!fs.existsSync(PROMPTS_DIR)) return [];
  return fs.readdirSync(PROMPTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''))
    .sort();
}

function isFramework(name) {
  return !OUTPUT_TOOLS.includes(name) && !ALIAS_SKILLS.includes(name);
}

/** Advertised framework count, derived from the filesystem. */
function frameworkCount(names = listSkillDirs()) {
  return names.filter(isFramework).length;
}

module.exports = {
  ROOT, SKILLS_DIR, PROMPTS_DIR,
  OUTPUT_TOOLS, ALIAS_SKILLS, META_SKILLS, CONTRACT_EXEMPT,
  listSkillDirs, listPromptNames, isFramework, frameworkCount,
};
