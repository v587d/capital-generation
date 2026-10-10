// Hand-authored mock for the skills-layout canvas (see README.md). The shape
// mirrors the argument-map spike's generated out/data.js, but this map is a
// static snapshot of this repo's skills/buffett-investment-framework/ built
// with two tiny helpers instead of a projection pipeline.
/* global window */
window.SKILLMAP = (function () {
  var nodes = [];
  var edges = [];
  var types = {};
  var SKILL = 'skills/buffett-investment-framework/';

  // A group is a collapsible frame plus the title card its children point
  // into (same --title convention the metaproc canvas uses).
  function group(id, parent, label, desc, path, type) {
    types[id] = type || 'group';
    types[id + '--title'] = type || 'group';
    nodes.push({
      id: id,
      kind: 'process',
      label: label,
      parent: parent,
      path: path || null,
      process: { name: label, description: desc || null },
      dep: null,
      step: null,
      progress: null,
    });
    nodes.push({
      id: id + '--title',
      kind: 'step',
      label: label,
      parent: id,
      path: path || null,
      process: null,
      dep: null,
      progress: null,
      step: { id: id + '--title', description: desc || null },
    });
    if (parent) {
      edges.push({ kind: 'needs', label: null, source: id, target: parent + '--title' });
    }
  }

  // Leaves are all the same box shape; `type` picks the icon and its color.
  function leaf(id, parent, label, desc, path, type) {
    types[id] = type || 'card';
    nodes.push({
      id: id,
      kind: 'step',
      label: label,
      parent: parent,
      path: path || null,
      process: null,
      dep: null,
      progress: null,
      step: { id: id, description: desc || null },
    });
    edges.push({ kind: 'needs', label: null, source: id, target: parent + '--title' });
  }

  // A card module: one group, one leaf per card. Card = [code, short label,
  // full card title (kept as the description)].
  function module(id, label, desc, file, cards) {
    group(id, 'references', label, desc, SKILL + 'references/' + file, 'module');
    cards.forEach(function (c) {
      leaf(
        c[0].toLowerCase(),
        id,
        c[0] + ' — ' + c[1],
        c[2],
        SKILL + 'references/' + file + '#' + c[0].toLowerCase(),
        'card',
      );
    });
  }

  group(
    'skill-root',
    null,
    'buffett-investment-framework',
    'A 65-card, Buffett-inspired framework for financial analysis, memo review, and thesis evaluation. Analytical guidance only — no buy/sell/hold or sizing authority.',
    SKILL,
    'skill',
  );

  leaf(
    'skill-md',
    'skill-root',
    'SKILL.md — entry point & router',
    'Classifies the request, confirms evidence, routes 5–12 cards, and enforces the eight-part output contract.',
    SKILL + 'SKILL.md',
    'file',
  );

  group(
    'workflows',
    'skill-root',
    'Workflows',
    'The three task intents SKILL.md routes between; each starts from an ordinary card set.',
    SKILL + 'SKILL.md',
    'workflow',
  );
  leaf(
    'wf-financial',
    'workflows',
    'financial-analysis',
    'Filed financial evidence → sourced worksheet or memo. Ordinary cards: F01 F02 F05 F06 F07.',
    SKILL + 'SKILL.md',
    'workflow',
  );
  leaf(
    'wf-memo',
    'workflows',
    'memo-review',
    'Investment memo → claim-by-claim review matrix. Ordinary cards: D01 D03 B02 V01 V05 V06 R01 R07.',
    SKILL + 'SKILL.md',
    'workflow',
  );
  leaf(
    'wf-thesis',
    'workflows',
    'thesis-evaluation',
    'Explicit thesis components → component-level dossier. Ordinary cards: D02 D03 B01 B06 V01 V04 R01 R07.',
    SKILL + 'SKILL.md',
    'workflow',
  );

  group(
    'references',
    'skill-root',
    'references/ — 65 cards in 8 modules',
    'One Markdown module per analytical area; the router loads only the modules holding the selected cards.',
    SKILL + 'references/',
    'group',
  );

  leaf(
    'source-key',
    'references',
    '00-source-key.md — citation key',
    "Resolves each card's abbreviated corroboration citations against the published Buffett/Berkshire record.",
    SKILL + 'references/00-source-key.md',
    'file',
  );

  module(
    'mod-decision',
    'Decision posture (D01–D09)',
    'Competence, ownership framing, inversion, price vs. value, alternatives, patience, concentration, skill, speculation.',
    '01-decision-posture.md',
    [
      [
        'D01',
        'Circle of competence',
        'Establish the Circle of Competence as a Forecastability Boundary',
      ],
      [
        'D02',
        'Fractional ownership',
        'Analyze Equities as Fractional Ownership of an Explainable Business',
      ],
      ['D03', 'Invert the thesis', 'Invert the Thesis and Seek Disconfirming Evidence'],
      ['D04', 'Value vs. market price', 'Separate Business Value from Market Price'],
      ['D05', 'Opportunity cost', 'Use Opportunity Cost Across Action and Inaction'],
      ['D06', 'Patience, then decisiveness', 'Pair Patient Standards with Decisive Action'],
      [
        'D07',
        'Concentration fit',
        'Assess Whether Concentration Fits Capability and Portfolio Survival',
      ],
      [
        'D08',
        'Active skill after friction',
        'Judge Active Skill After Friction, Capacity, and Precommitment',
      ],
      ['D09', 'Detect speculation', 'Detect Reflexive Speculation and Promotional Supply'],
    ],
  );

  module(
    'mod-business',
    'Business economics (B01–B07)',
    'Business model, moat, pricing power, structural advantages, franchise quality, reinvestment, cyclicality.',
    '02-business-economics.md',
    [
      ['B01', 'How a dollar is earned', 'Map How the Business Earns and Converts a Dollar'],
      ['B02', 'Causal moat & direction', 'Identify a Causal Moat and Track Its Direction'],
      ['B03', 'Pricing power & brand', 'Test Pricing Power, Brand, and Distribution Strength'],
      [
        'B04',
        'Scale & switching costs',
        'Test Cost, Scale, Switching, Network, and Efficient-Scale Advantages',
      ],
      [
        'B05',
        'Franchise vs. commodity',
        'Distinguish a Franchise from a Commodity or Capital Trap',
      ],
      [
        'B06',
        'Reinvestment runway',
        'Judge the Reinvestment Runway from Normalized Capital Returns',
      ],
      [
        'B07',
        'Cyclical vs. structural',
        'Separate Cyclical Setbacks from Structural or Turnaround Traps',
      ],
    ],
  );

  module(
    'mod-management',
    'Management & governance (M01–M08)',
    'Integrity, operating and allocation skill, incentives, culture, controls, board power, succession.',
    '03-management-governance.md',
    [
      [
        'M01',
        'Integrity & candor',
        'Evaluate Integrity and Candor Without Letting Likability Substitute for Evidence',
      ],
      ['M02', 'Operating competence', 'Judge Operating Competence in Economic Context'],
      [
        'M03',
        'Capital-allocation skill',
        'Judge Capital-Allocation Skill Separately from Operations',
      ],
      [
        'M04',
        'Incentives & alignment',
        'Inspect Incentives, Ownership Alignment, and Owner Treatment',
      ],
      [
        'M05',
        'Institutional imperative',
        'Test Culture and the Institutional Imperative Through Behavior',
      ],
      ['M06', 'Controls & bad news', 'Assess Decentralization, Controls, and Bad-News Flow'],
      ['M07', 'Board independence', 'Test Substantive Board Independence and Power'],
      ['M08', 'Succession', 'Assess Role-Specific Succession and Control Continuity'],
    ],
  );

  module(
    'mod-financial',
    'Financial reality (F01–F07)',
    'Filings to economic substance: owner earnings, capital split, look-through, normalization, returns, obligations.',
    '04-financial-reality.md',
    [
      ['F01', 'Substance from accounting', 'Reconstruct Economic Substance from Accounting'],
      ['F02', 'Owner earnings', 'Estimate Owner Earnings After All Real Costs'],
      [
        'F03',
        'Maintenance vs. growth',
        'Separate Maintenance, Growth, Restricted, and Distributable Capital',
      ],
      [
        'F04',
        'Look-through ownership',
        'Look Through Partial Ownership, Segments, and Holding Structures',
      ],
      ['F05', 'Normalized earning power', 'Build a Reconciled Normalized Earning-Power Base'],
      ['F06', 'Returns on capital', 'Measure Returns on Tangible and Incremental Capital'],
      [
        'F07',
        'Cash & hidden obligations',
        'Reconcile Cash Conversion and Hidden or Long-Duration Obligations',
      ],
    ],
  );

  module(
    'mod-valuation',
    'Valuation (V01–V06)',
    'Intrinsic value as a range of owner cash, defensible bases, growth economics, sensitivity, margin of safety.',
    '05-valuation.md',
    [
      ['V01', 'Value as a range', 'Define Intrinsic Value as a Range of Owner Cash'],
      [
        'V02',
        'Method fits economics',
        'Match the Valuation Method to Business Economics and Use Shortcuts Only as Checks',
      ],
      ['V03', 'Normalized base', 'Select a Defensible Normalized Base for Valuation'],
      ['V04', 'Growth via capital', 'Value Growth Only Through Incremental Capital Economics'],
      ['V05', 'Expose sensitivities', 'Expose Assumptions, Sensitivities, and Missing Evidence'],
      ['V06', 'Margin of safety', 'Require a Margin of Safety Proportionate to Uncertainty'],
    ],
  );

  module(
    'mod-capital',
    'Capital allocation (C01–C09)',
    'Reserves, retention, payout, repurchases, issuance, acquisitions, and the biases around them.',
    '06-capital-allocation.md',
    [
      ['C01', 'Per-share owner value', 'Optimize Long-Term Per-Share Owner Value'],
      ['C02', 'Reserve before return', 'Set the Allocation Reserve Before Optional Return'],
      [
        'C03',
        'Full allocation menu',
        'Compare the Full Capital-Allocation Menu and Available Channels',
      ],
      [
        'C04',
        'Retain for productive use',
        'Retain and Reinvest Earnings Only for Productive Deployment',
      ],
      ['C05', 'Return surplus capital', 'Return Surplus Capital When No Better Use Exists'],
      [
        'C06',
        'Repurchase below value',
        'Repurchase Only Below Value with Surplus Capacity and Material Effect',
      ],
      ['C07', 'Issue value-for-value', 'Issue Shares Only Value for Value'],
      [
        'C08',
        'Acquisition tests',
        'Evaluate Acquisitions by Quality, Price, Financing, Alternatives, and Postmortems',
      ],
      ['C09', 'Counter deal bias', 'Counter Acquisition-Process Bias'],
    ],
  );

  module(
    'mod-risk',
    'Risk & monitoring (R01–R07)',
    'Permanent harm, leverage and liquidity stress, contingent claims, inflation, friction, exit, invalidation.',
    '07-risk-monitoring.md',
    [
      ['R01', 'Risk = permanent harm', 'Define Risk by Permanent Owner Harm or Forced Action'],
      [
        'R02',
        'Stress leverage & liquidity',
        'Stress Leverage and Liquidity Under Correlated Adversity',
      ],
      [
        'R03',
        'Contingent obligations',
        'Stress Contingent Obligations, Derivatives, Models, and Counterparties',
      ],
      [
        'R04',
        'Inflation exposure',
        'Test Inflation Exposure Through Pricing Power and Capital Needs',
      ],
      ['R05', 'Minimize friction', 'Preserve Compounding by Minimizing Avoidable Friction'],
      ['R06', 'Exit-condition test', 'Test Whether an Exit Condition Has Been Met'],
      [
        'R07',
        'Monitor invalidation',
        'Monitor Assumptions, Change Indicators, and Invalidation Conditions',
      ],
    ],
  );

  module(
    'mod-overlays',
    'Specialized overlays (S01–S12)',
    'Industry-specific accounting and risk, loaded only when the supplied evidence triggers them.',
    '08-specialized-overlays.md',
    [
      [
        'S01',
        'Insurance: float value',
        'Insurance: Value Float by Amount, Cost, Duration, and Outlook',
      ],
      [
        'S02',
        'Insurance: underwriting',
        'Insurance: Underwrite Exposure and Price Rather than Volume',
      ],
      [
        'S03',
        'Insurance: reserves',
        'Insurance: Reconstruct Reserves and Earnings Through the Cycle',
      ],
      [
        'S04',
        'Insurance: tail loss',
        'Insurance: Test Aggregate Tail Loss Against Distress Capacity',
      ],
      [
        'S05',
        'Insurance: crisis liquidity',
        'Insurance: Test Crisis Liquidity and the Risk-Transfer Chain',
      ],
      [
        'S06',
        'Insurance: discipline moat',
        'Insurance: Require Discipline and Structure for a Moat',
      ],
      ['S07', 'Banking', 'Banking: Assess Funding, Credit, Leverage, and Culture'],
      [
        'S08',
        'Consumer & retail',
        'Consumer and Retail: Separate Brand Economics from Fragile Distribution',
      ],
      [
        'S09',
        'Infrastructure',
        'Infrastructure: Evaluate Regulation, Irreplaceability, and Maintenance Capital',
      ],
      [
        'S10',
        'Technology & media',
        'Technology and Media: Test Whether Disruption Strengthens or Destroys the Moat',
      ],
      [
        'S11',
        'Energy & commodities',
        'Energy and Commodities: Normalize Cycles, Inflation, and Capital Intensity',
      ],
      [
        'S12',
        'Special instruments',
        'Special Instruments: Analyze Event Probability, Duration, Downside, and Optionality',
      ],
    ],
  );

  leaf(
    'scripts',
    'skill-root',
    'scripts/framework.py — router',
    'Deterministic card router and validator: route --intent/--topic, show --id, validate.',
    SKILL + 'scripts/framework.py',
    'file',
  );

  leaf(
    'agents',
    'skill-root',
    'agents/openai.yaml — agent config',
    'Agent-platform packaging for the same skill.',
    SKILL + 'agents/openai.yaml',
    'file',
  );

  return {
    meta: {
      title: 'Buffett investment-framework skill — layout map',
      initialExpandDepth: 2,
    },
    types: types,
    expanded: ['skill-root', 'workflows', 'references', 'mod-valuation'],
    viz: {
      header: {
        name: 'Buffett investment-framework skill — layout map',
        description:
          'File-and-card layout of skills/buffett-investment-framework: the SKILL.md entry point, its three workflows, eight reference modules holding 65 cards, and the deterministic router script.',
        source_path: 'skills-map-buffett',
      },
      root_process: 'skills-map-buffett',
      root_process_node: 'skill-root',
      nodes: nodes,
      edges: edges,
    },
  };
})();
