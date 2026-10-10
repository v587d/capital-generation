// Argument-map spike — MetabrowserIcons registry with argument vocabulary.
//
// Same contract and style as MetaBrowser's shared registry
// (metabrowser/src/metabrowser/static/icons.js): raw Lucide SVG strings keyed
// by the names viz.js looks up (step/dep/process/toggle/alert), plus argument
// glyphs used by the harness CSS. Icons are Lucide (ISC; https://lucide.dev);
// the comment beside each entry is the Lucide icon id. Load BEFORE viz.js.
(() => {
  var SA =
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

  var ICONS = {
    // Viz kind shapes, remapped to the argument reading.
    step: // Lucide `circle-dot` — a claim: a plain assertion marker.
      "<svg " +
      SA +
      '><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></svg>',
    dep: // Lucide `paperclip` — evidence as an attached exhibit.
      "<svg " +
      SA +
      '><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    process: // Lucide `list-tree` — an argument branch with sub-structure.
      "<svg " +
      SA +
      '><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/></svg>',
    // Controls — the toggle chevron carries its own class so CSS can rotate it.
    toggle: // Lucide `chevron-right`
      '<svg class="toggle-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    alert: // Lucide `triangle-alert`
      "<svg " +
      SA +
      '><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    // Argument vocabulary (used by the harness meter and chips; kept here so
    // any future view shares one glyph set).
    "direction-up": // Lucide `arrow-big-up` — bears pro; pairs with the weight bars.
      "<svg " +
      SA +
      '><path d="M9 18v-6H5l7-7 7 7h-4v6H9z"/></svg>',
    "direction-down": // Lucide `arrow-big-down` — bears con; pairs with the weight bars.
      "<svg " +
      SA +
      '><path d="M15 6v6h4l-7 7-7-7h4V6h6z"/></svg>',
    check: // Lucide `eye` (v1 shape) — a standing watch for not-yet-observed evidence.
      "<svg " +
      SA +
      '><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  };

  ICONS.withClass = (name, cls) => {
    var svg = ICONS[name];
    if (!svg || !cls) {
      return svg || "";
    }
    return svg.replace("<svg ", `<svg class="${cls}" `);
  };

  var g = typeof window !== "undefined" ? window : globalThis;
  if (g) {
    g.MetabrowserIcons = ICONS;
  }
})();
