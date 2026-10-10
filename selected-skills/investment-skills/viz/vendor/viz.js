/* Fork of ../argument-map-figma/vendor/viz.js for the skills-map spike —
 * unmodified except the marked changes (search "SPIKE PATCH (skills-map)"):
 * frame ports sit at the vertical middle of the west side instead of the
 * title row. All other assets stay shared with the argument-map spike. */
// Browser viz renderer (ELK.js compound layout).
//
// Projects a VizModel JSON payload (from /api/viz) into a nested DOM graph
// using ELK.js for hierarchical layout. Nodes are absolutely-positioned HTML
// divs; edges are an SVG overlay. Process nodes become enclosing frames
// whose children are laid out inside them by ELK. Click-to-file on
// path-bearing nodes, hover tooltips for step/dep details, plane toggles
// and a pin-able side panel sit on top.
//
// See https://github.com/jlevy/metabrowser/blob/main/docs/architecture.md.

((global) => {
  // ── Layout knobs (single source of truth, exported) ────────────

  var VIZ_ELK_OPTIONS = {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "40",
    "elk.spacing.nodeNode": "24",
    // BRANDES_KOEPF + LEFTUP keeps siblings flush with the top of their
    // layer — when one node grows taller (e.g. an expanded sub-process)
    // its shorter peers don't drift downward to balance edge bends, so a
    // row of mixed-height children continues to share a top edge.
    // NETWORK_SIMPLEX optimizes for fewer bends but lets nodes float in
    // the cross-axis, which broke the row's visual baseline on expand.
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    "elk.layered.nodePlacement.bk.fixedAlignment": "LEFTUP",
    "elk.edgeRouting": "ORTHOGONAL",
    // Top padding is sized for the frame header (~23px at 12px font with
    // 1.25 line-height + vertical padding) plus a small breathing line
    // between header and first child — wider top margins just read as empty
    // space stacked above nested content.
    "elk.padding": "[top=24,left=10,bottom=10,right=10]",
    // Target a near-square aspect ratio and let layered wrapping split wide
    // rows across multiple layers — keeps the process frame from stretching
    // into a single very-wide row when many children live at the same depth.
    "elk.aspectRatio": "1.0",
    "elk.layered.wrapping.strategy": "MULTI_EDGE",
  };

  // Per-node ELK options applied to every node in the input graph.
  // Graph-level options don't propagate to children, so anything that
  // must take effect per-node belongs here. `elk.alignment: TOP` anchors
  // a node's top edge to the top of its layer's Y range; without it,
  // mixed-height siblings get centered within the layer band so a row
  // breaks alignment whenever one node grows (e.g. an expanded
  // sub-process). Cloned per node in elkNodeFor so callers can append
  // node-specific overrides (e.g. elk.padding) without mutating this.
  var VIZ_ELK_NODE_OPTIONS = {
    "elk.alignment": "TOP",
  };

  // Starting dimensions per node kind. Auto-sizing (B5) will override these
  // by measuring real card content.
  var DEFAULT_NODE_DIMS = {
    step: { width: 240, height: 86 },
    dep: { width: 200, height: 56 },
    process: { width: 280, height: 88 }, // container; ELK expands to fit children
    process_collapsed: { width: 260, height: 52 },
    file: { width: 160, height: 36 },
  };

  var CARD_MIN_WIDTH = 140;
  var CARD_MAX_WIDTH = 320;
  var CARD_MIN_HEIGHT = 18;

  // ── View-state persistence (expansion, plane toggles) ──────────

  function _viewStateKey(sourcePath) {
    return "viz-view-state:" + (sourcePath || "__unknown__");
  }

  function loadViewState(sourcePath) {
    try {
      var raw = global.localStorage?.getItem(_viewStateKey(sourcePath));
      if (!raw) {
        return _defaultViewState();
      }
      var parsed = JSON.parse(raw);
      return {
        expanded_nodes: Array.isArray(parsed.expanded_nodes) ? parsed.expanded_nodes : [],
        planes:
          parsed.planes && typeof parsed.planes === "object"
            ? parsed.planes
            : _defaultViewState().planes,
        focused_node: typeof parsed.focused_node === "string" ? parsed.focused_node : null,
        zoom: typeof parsed.zoom === "number" && parsed.zoom > 0 ? parsed.zoom : null,
        scroll_x: typeof parsed.scroll_x === "number" ? parsed.scroll_x : 0,
        scroll_y: typeof parsed.scroll_y === "number" ? parsed.scroll_y : 0,
      };
    } catch (_e) {
      return _defaultViewState();
    }
  }

  function saveViewState(sourcePath, state) {
    try {
      if (!global.localStorage) {
        return;
      }
      global.localStorage.setItem(_viewStateKey(sourcePath), JSON.stringify(state));
    } catch (_e) {
      /* storage full or disabled — ignore */
    }
  }

  function _defaultViewState() {
    return {
      expanded_nodes: [],
      planes: { steps: true, artifacts: false, files: false },
      focused_node: null,
      zoom: null, // null → fit-to-width on first load; a number means preserve
      scroll_x: 0,
      scroll_y: 0,
    };
  }

  var ZOOM_MIN = 0.25;
  var ZOOM_MAX = 2.5;
  var ZOOM_STEP = 1.2; // per toolbar-button click
  var WHEEL_ZOOM_STEP = 1.05; // per wheel tick (trackpad-friendly)

  // ── Kind icons ─────────────────────────────────────────────────
  //
  // Kind icon shapes live in the host's shared registry, exposed as
  // window.MetabrowserIcons. This IIFE only wraps them in
  // the `viz-kind-icon viz-kind-icon-<kind>` class so color + size
  // CSS rules in viz.css attach. No SVG markup is duplicated here.
  //
  // Color comes from the kind's accent token (--viz-accent-*-icon),
  // applied via .viz-kind-header-<kind> .viz-kind-icon in viz.css.
  function kindIconHtml(kind) {
    var reg = typeof window !== "undefined" ? window.MetabrowserIcons : null;
    if (!reg) {
      return "";
    }
    // `file` fallback renders as the dep shape.
    var name = kind === "file" ? "dep" : kind;
    return reg.withClass
      ? reg.withClass(name, "viz-kind-icon viz-kind-icon-" + kind)
      : reg[name] || "";
  }
  // Toggle chevron also comes from the shared registry (class is
  // baked in on the SVG itself so CSS can rotate it).
  var TOGGLE_CHEVRON_SVG =
    typeof window !== "undefined" && window.MetabrowserIcons
      ? window.MetabrowserIcons.toggle || ""
      : "";

  // Compute the file-type subtype class for a dep node's path, using the
  // shared MetabrowserFileTypes registry provided by the host. Kept as a lazy
  // lookup because the plugin communicates with the host through its public browser
  // globals. Falls back to "" so the dep's default --viz-accent-dep-icon
  // color still applies if the registry is unavailable (e.g., isolated
  // viz-test harness).
  function fileTypeClassFor(path) {
    if (!path) {
      return "";
    }
    var reg = typeof window !== "undefined" ? window.MetabrowserFileTypes : null;
    return reg?.classFor ? reg.classFor(path) : "";
  }
  function depFtClass(node) {
    if (node?.kind !== "dep") {
      return "";
    }
    var path = node.dep?.path || node.path || null;
    var cls = fileTypeClassFor(path);
    return cls ? " " + cls : "";
  }

  // Icon shape for a node. Dep nodes usually render the shared dep/doc
  // shape, but a .process.md file on a dep card uses the "process" cube
  // shape — mirroring how the file tree icons that filetype, so the
  // visual reads as "this dep IS a process spec" at a glance.
  function nodeIconKind(node) {
    if (node && node.kind === "dep") {
      var path = node.dep?.path || node.path || null;
      if (fileTypeClassFor(path) === "ft-md-process") {
        return "process";
      }
    }
    return node ? node.kind : "";
  }

  // ── HTML escaping ──────────────────────────────────────────────

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escHtmlWrappable(s) {
    return escHtml(s)
      .replace(/([_-])/g, "$1<wbr>")
      .replace(/\./g, "<wbr>.");
  }

  // CSS-safe view-transition-name for a node id. Each named element is
  // matched between old and new snapshots by name, so the browser can
  // morph it between positions/sizes instead of crossfading the whole
  // canvas. Prefix avoids collisions with any non-viz use of view
  // transitions; the regex sanitizes ids that contain ``/`` ``.`` etc.
  function _vtName(id) {
    return "vt-" + String(id).replace(/[^A-Za-z0-9_-]/g, "_");
  }

  function _prefersReducedMotion() {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function isRunRelative(p) {
    return typeof p === "string" && p.length > 0 && p.indexOf("{{") === -1;
  }

  // ── Compound-graph builder (pure; unit-testable) ───────────────

  // Turn a VizModel into an ELK input graph. Nodes with a `parent` become
  // nested children of that parent; nodes with no parent become root-level
  // children of the ELK graph. Process nodes act as containers — their
  // dimensions are omitted so ELK sizes them to fit children.
  //
  // `options`:
  //   - layoutOptions: overrides merged into VIZ_ELK_OPTIONS
  //   - nodeDims: overrides merged into DEFAULT_NODE_DIMS (per kind)
  //   - expanded: Set-like of process-node ids that should render expanded;
  //     process nodes NOT in this set (except the root) collapse to a leaf
  //     with placeholder dims and their children are dropped from the graph.
  //     When omitted, every process node is expanded.
  function buildElkInput(viz, options) {
    options = options || {};
    var layoutOptions = Object.assign({}, VIZ_ELK_OPTIONS, options.layoutOptions || {});
    var dims = Object.assign({}, DEFAULT_NODE_DIMS, options.nodeDims || {});
    var rootId = viz.root_process_node || null;
    var expanded = options.expanded || null; // null ⇒ all expanded

    function isExpanded(nodeId, kind) {
      if (kind !== "process") {
        return true;
      }
      if (nodeId === rootId) {
        return true; // Root never collapses.
      }
      if (!expanded) {
        return true;
      }
      return expanded.has ? expanded.has(nodeId) : !!expanded[nodeId];
    }

    // Index nodes, split by parent.
    var byId = {};
    var byParent = {};
    for (var i = 0; i < viz.nodes.length; i++) {
      var n = viz.nodes[i];
      byId[n.id] = n;
      var key = n.parent || null;
      if (!byParent[key]) {
        byParent[key] = [];
      }
      byParent[key].push(n);
    }

    // Node ids that will be emitted into the ELK graph. A collapsed process
    // hides its descendants — we track the hidden set to filter edges too.
    var visible = {};
    (function markVisible(parentId) {
      var kids = byParent[parentId] || [];
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        visible[n.id] = true;
        if (isExpanded(n.id, n.kind)) {
          markVisible(n.id);
        }
      }
    })(null);

    var perNodeDims = options.perNodeDims || {};
    // SPIKE PATCH (argument-map): frames get an outgoing port on their west
    // side, so ELK itself routes frame edges — spacing, bends, and arrowheads
    // stay entirely ELK's, with no post-layout rewriting.
    // SPIKE PATCH (skills-map): the port side is fixed but its position is
    // ELK's, which centers a lone west port — frame edges leave from the
    // vertical middle of the box, matching the centered title card inside,
    // instead of the title row at the top.
    var portIds = {};
    function addTitlePort(base, viznode) {
      var pid = viznode.id + "::out";
      base.ports = [{
        id: pid,
        width: 1,
        height: 1,
        layoutOptions: { "elk.port.side": "WEST" },
      }];
      base.layoutOptions["elk.portConstraints"] = "FIXED_SIDE";
      portIds[viznode.id] = pid;
    }

    function elkNodeFor(viznode) {
      var base = { id: viznode.id, layoutOptions: Object.assign({}, VIZ_ELK_NODE_OPTIONS) };
      var childrenVizNodes = byParent[viznode.id] || [];
      if (viznode.kind === "process" && !isExpanded(viznode.id, viznode.kind)) {
        // SPIKE PATCH (argument-map): collapsed frames hug their measured
        // title-strip size — measureNodes already measures containers with a
        // compact title-only body — instead of one global fixed box, so a
        // collapsed tree reads as text-height list items. Upstream candidate.
        var collapsed = dims.process_collapsed || { width: 220, height: 48 };
        var compact = perNodeDims[viznode.id];
        base.width = compact ? compact.width : collapsed.width;
        base.height = compact ? compact.height : collapsed.height;
        addTitlePort(base, viznode);
        return base;
      }
      if (childrenVizNodes.length > 0) {
        // Composite step containers need extra top padding so the step's own
        // card body (title/chips/IO) isn't overlapped by the nested process
        // frame ELK places inside. Use the measured body height when we have
        // it, falling back to a conservative default that fits a typical
        // step card.
        var pad = layoutOptions["elk.padding"];
        if (viznode.kind === "step") {
          var measured = perNodeDims[viznode.id];
          // Just enough to clear the composite step's own card body — the
          // previous +8 buffer was visible as wasted vertical space above
          // every nested process frame.
          var stepPadTop = measured ? Math.ceil(measured.height) : 32;
          pad = "[top=" + stepPadTop + ",left=10,bottom=10,right=10]";
        }
        base.layoutOptions["elk.padding"] = pad;
        // SPIKE PATCH (skills-map): spacing options apply to the children of
        // the node they are set on and don't reach nested compounds from the
        // root — copy the effective spacing values onto every container so
        // inner frames pack as tightly as the root level.
        [
          "elk.spacing.nodeNode",
          "elk.spacing.edgeNode",
          "elk.spacing.edgeEdge",
          "elk.layered.spacing.nodeNodeBetweenLayers",
          "elk.layered.spacing.edgeNodeBetweenLayers",
          "elk.layered.considerModelOrder.strategy",
          "elk.layered.crossingMinimization.forceNodeModelOrder",
        ].forEach(function (k) {
          if (layoutOptions[k] !== undefined) {
            base.layoutOptions[k] = layoutOptions[k];
          }
        });
        base.children = childrenVizNodes.map(elkNodeFor);
        if (viznode.kind === "process") {
          addTitlePort(base, viznode); // SPIKE PATCH: expanded frames too
        }
      } else {
        var override = perNodeDims[viznode.id];
        if (override) {
          base.width = override.width;
          base.height = override.height;
        } else {
          var d = dims[viznode.kind] || dims.step;
          base.width = d.width;
          base.height = d.height;
        }
      }
      return base;
    }

    var rootChildren = (byParent[null] || []).map(elkNodeFor);

    var edges = [];
    for (var j = 0; j < viz.edges.length; j++) {
      var e = viz.edges[j];
      // Only include edges whose endpoints are still visible.
      if (!visible[e.source] || !visible[e.target]) {
        continue;
      }
      // Visual direction per kind — arrow direction must match the data-flow
      // story the legend and drawer tell for each kind:
      //   needs     — prerequisite step → needing step  (pass through)
      //   consumes  — artifact → consuming step         (flip source/target)
      //   produces  — producing step → artifact         (pass through)
      // project.py stores `produces` as source=step, target=artifact, and
      // `consumes` as source=step, target=artifact. `produces` is the natural
      // direction ("step creates this artifact"), so it passes through;
      // `consumes` flips so the arrow lands on the consumer rather than on
      // the artifact.
      var src = e.source,
        tgt = e.target;
      if (e.kind === "consumes") {
        src = e.target;
        tgt = e.source;
      }
      if (portIds[src]) {
        src = portIds[src]; // SPIKE PATCH: leave the frame via its title port
      }
      // (Targets are never ports: child-to-own-parent boundary edges are
      // hierarchical and this elkjs path mis-renders them — children target
      // their parent's title card instead.)
      edges.push({
        id: "e:" + e.source + "::" + e.target + "::" + e.kind,
        sources: [src],
        targets: [tgt],
        kind: e.kind,
      });
    }

    return {
      id: "__viz_root__",
      layoutOptions: layoutOptions,
      children: rootChildren,
      edges: edges,
    };
  }

  // ── Plane filter (Steps · Artifacts · Files) ───────────────────

  // Returns a VizModel shape with nodes + edges filtered per plane selection.
  //   planes.steps      → include kind=step nodes and "needs" edges.
  //   planes.artifacts  → include kind=dep nodes and "produces"/"consumes" edges.
  //   planes.files      → include kind=file nodes (placeholder; no file-kind
  //                       projector ships in Phase 2, so this is a no-op today).
  //
  // kind="process" nodes are always retained initially: they're scaffolding
  // for the hierarchy, and hiding them would orphan surviving children.
  // When a surviving node's parent gets filtered out, we reparent it up to
  // the nearest surviving ancestor so the compound graph stays connected
  // (this is the fix for the bug Levy's review caught — toggling Steps off
  // with Artifacts on used to produce a blank graph because every dep node
  // sat under a composite step node which had been filtered away).
  //
  // After reparenting, process nodes that end up as empty containers (no
  // surviving descendants) are pruned — except the root, so the toolbar +
  // header panel always have a home.
  function filterVizByPlanes(viz, planes) {
    planes = planes || { steps: true, artifacts: false, files: false };
    var keepKinds = { process: true };
    if (planes.steps) {
      keepKinds.step = true;
    }
    if (planes.artifacts) {
      keepKinds.dep = true;
    }
    if (planes.files) {
      keepKinds.file = true;
    }
    var keepEdgeKinds = {};
    if (planes.steps) {
      keepEdgeKinds.needs = true;
    }
    if (planes.artifacts) {
      keepEdgeKinds.produces = true;
      keepEdgeKinds.consumes = true;
    }

    var byId = {};
    for (var i = 0; i < viz.nodes.length; i++) {
      byId[viz.nodes[i].id] = viz.nodes[i];
    }

    function surviveAncestor(parentId) {
      while (parentId) {
        var node = byId[parentId];
        if (!node) {
          return null;
        }
        if (keepKinds[node.kind]) {
          return parentId;
        }
        parentId = node.parent || null;
      }
      return null;
    }

    var nodes = [];
    for (var i = 0; i < viz.nodes.length; i++) {
      var n = viz.nodes[i];
      if (!keepKinds[n.kind]) {
        continue;
      }
      var newParent = surviveAncestor(n.parent || null);
      nodes.push(n.parent === newParent ? n : Object.assign({}, n, { parent: newParent }));
    }

    // Prune empty process containers (keep the root).
    var rootId = viz.root_process_node || null;
    var hasLeafUnder = {};
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.kind === "process") {
        continue;
      }
      var p = n.parent;
      while (p) {
        hasLeafUnder[p] = true;
        var container = byId[p];
        p = container ? container.parent : null;
      }
    }
    nodes = nodes.filter((n) => n.kind !== "process" || n.id === rootId || !!hasLeafUnder[n.id]);

    var keepIds = {};
    for (var k = 0; k < nodes.length; k++) {
      keepIds[nodes[k].id] = true;
    }

    var edges = [];
    for (var j = 0; j < viz.edges.length; j++) {
      var e = viz.edges[j];
      if (!keepEdgeKinds[e.kind]) {
        continue;
      }
      if (!keepIds[e.source] || !keepIds[e.target]) {
        continue;
      }
      edges.push(e);
    }
    return Object.assign({}, viz, { nodes: nodes, edges: edges });
  }

  // ── ELK layout → absolute-coord LaidOut (for the renderer) ─────

  // Walk the laid ELK graph and flatten nested coordinates to absolute.
  // Returns { nodes: {id: {x, y, width, height, kind, depth}}, edges: [...], width, height }.
  function flattenElkLayout(vizById, elkRoot) {
    var placed = {};
    var depthById = {};
    // Under `elk.hierarchyHandling: INCLUDE_CHILDREN`, ELK pulls every edge
    // up to the root and tags it with a `container` id; each edge's section
    // points are expressed in THAT container's coord frame — not the parent
    // chain of where the edge ends up stored in the output tree. So we index
    // every container's absolute origin here, then look each edge's origin
    // up by its `container` id below. Walking the tree and accumulating
    // offsets is the wrong model and produced arrows shifted by the
    // container's absolute position.
    var containerAbs = {};
    containerAbs[elkRoot.id] = { x: 0, y: 0 };

    function walk(node, offsetX, offsetY, depth) {
      var absX = offsetX + (node.x || 0);
      var absY = offsetY + (node.y || 0);
      containerAbs[node.id] = { x: absX, y: absY };
      var viznode = vizById[node.id];
      if (viznode) {
        placed[node.id] = {
          x: absX,
          y: absY,
          width: node.width || 0,
          height: node.height || 0,
          kind: viznode.kind,
          depth: depth,
        };
        depthById[node.id] = depth;
      }
      if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
          walk(node.children[i], absX, absY, depth + 1);
        }
      }
    }
    if (elkRoot.children) {
      for (var i = 0; i < elkRoot.children.length; i++) {
        walk(elkRoot.children[i], 0, 0, 0);
      }
    }

    var edges = [];
    function collectEdges(container) {
      if (container.edges) {
        for (var i = 0; i < container.edges.length; i++) {
          var ee = container.edges[i];
          // Prefer the edge's own `container` hint; fall back to the node
          // that stores it (covers older ELK builds or hand-crafted input).
          var originId = ee.container || container.id;
          var origin = containerAbs[originId] || { x: 0, y: 0 };
          var offX = origin.x;
          var offY = origin.y;
          var pts = [];
          var sections = ee.sections || [];
          for (var s = 0; s < sections.length; s++) {
            var sec = sections[s];
            if (sec.startPoint) {
              pts.push({ x: sec.startPoint.x + offX, y: sec.startPoint.y + offY });
            }
            if (sec.bendPoints) {
              for (var b = 0; b < sec.bendPoints.length; b++) {
                pts.push({ x: sec.bendPoints[b].x + offX, y: sec.bendPoints[b].y + offY });
              }
            }
            if (sec.endPoint) {
              pts.push({ x: sec.endPoint.x + offX, y: sec.endPoint.y + offY });
            }
          }
          edges.push({
            source: ee.sources ? ee.sources[0] : null,
            target: ee.targets ? ee.targets[0] : null,
            kind: ee.kind || ee.labels?.[0] || "needs",
            points: pts,
          });
        }
      }
      if (container.children) {
        for (var c = 0; c < container.children.length; c++) {
          collectEdges(container.children[c]);
        }
      }
    }
    collectEdges(elkRoot);

    return {
      nodes: placed,
      edges: edges,
      width: elkRoot.width || 800,
      height: elkRoot.height || 600,
    };
  }

  async function layoutWithElk(viz, options) {
    if (!global.ELK) {
      throw new Error("ELK global not found — is the bundled elk.bundled.js extra script loaded?");
    }
    var input = buildElkInput(viz, options);
    var elk = new global.ELK();
    var laid = await elk.layout(input);
    var vizById = {};
    for (var i = 0; i < viz.nodes.length; i++) {
      vizById[viz.nodes[i].id] = viz.nodes[i];
    }
    return flattenElkLayout(vizById, laid);
  }

  // ── Node/edge rendering ────────────────────────────────────────

  // Identity-section HTML for a node — the same block the drawer
  // renders for this node kind. The drawer is a strict superset:
  // tooltip = Identity only; drawer = Identity + kind-specific extras
  // (Adapter, Fan-out, Inputs table, Defaults…). Hovering and opening
  // the drawer show the same rows in the same order so the two views
  // read as one.
  function nodeIdentityHtml(node) {
    if (!node) {
      return "";
    }
    if (node.kind === "step" && node.step) {
      return _section("Identity", _stepIdentityRows(node.step));
    }
    if (node.kind === "dep" && node.dep) {
      return _section("Identity", _depIdentityRows(node.dep));
    }
    if (node.kind === "process" && node.process) {
      return _section("Identity", _processIdentityRows(node.process));
    }
    return "";
  }

  function tooltipHtmlFor(node, decoration) {
    var html = nodeIdentityHtml(node);
    if (decoration?.tooltip_addendum) {
      html += '<div class="viz-panel-desc">' + escHtml(decoration.tooltip_addendum) + "</div>";
    }
    return html;
  }

  function mergeDecorations(node, decorators) {
    var out = null;
    for (var i = 0; i < decorators.length; i++) {
      var d = decorators[i];
      if (!d.predicate(node)) {
        continue;
      }
      var add = d.decorate(node);
      if (!add) {
        continue;
      }
      if (out === null) {
        out = { badge: null, icon: null, accent_token: null, tooltip_addendum: null };
      }
      if (out.badge == null && add.badge) {
        out.badge = add.badge;
      }
      if (out.icon == null && add.icon) {
        out.icon = add.icon;
      }
      if (out.accent_token == null && add.accent_token) {
        out.accent_token = add.accent_token;
      }
      if (add.tooltip_addendum) {
        out.tooltip_addendum = out.tooltip_addendum
          ? out.tooltip_addendum + "\n" + add.tooltip_addendum
          : add.tooltip_addendum;
      }
    }
    return out;
  }

  function renderEdgesSvg(laid) {
    var paths = [];
    for (var i = 0; i < laid.edges.length; i++) {
      var edge = laid.edges[i];
      if (!edge.points || edge.points.length < 2) {
        continue;
      }
      var d = "M " + edge.points[0].x + " " + edge.points[0].y;
      for (var p = 1; p < edge.points.length; p++) {
        d += " L " + edge.points[p].x + " " + edge.points[p].y;
      }
      var cls = "viz-edge viz-edge-" + (edge.kind || "needs");
      paths.push('<path class="' + cls + '" d="' + d + '" />');
    }
    // Per-edge-kind marker heads. All arrows use context-stroke so each head
    // picks up its line's color, and every head lands on a step.
    //   needs     — open chevron (control dependency; lighter visual weight)
    //   produces  — filled triangle, bold stroke (step creates this artifact)
    //   consumes  — filled triangle, bold stroke (artifact feeds this step)
    return (
      '<svg class="viz-edges" width="' +
      laid.width +
      '" height="' +
      laid.height +
      '" ' +
      'viewBox="0 0 ' +
      laid.width +
      " " +
      laid.height +
      '" ' +
      'style="view-transition-name:viz-edges">' +
      "<defs>" +
      '<marker id="viz-arrow-needs" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 1 L 10 5 L 0 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />' +
      "</marker>" +
      '<marker id="viz-arrow-produces" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 2 L 10 5 L 0 8 z" fill="context-stroke" />' +
      "</marker>" +
      '<marker id="viz-arrow-consumes" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 2 L 10 5 L 0 8 z" fill="context-stroke" />' +
      "</marker>" +
      "</defs>" +
      paths.join("") +
      "</svg>"
    );
  }

  // Compact IO summary. Two-line footer on a step card:
  //   ↓ in1, in2
  //   ↑ out1
  function renderIoSummary(step) {
    if (!step) {
      return "";
    }
    var parts = [];
    var ins = step.inputs_summary || [];
    var outs = step.outputs_summary || [];
    function line(label, entries) {
      return (
        '<div class="viz-card-io">' +
        '<span class="viz-card-io-label">' +
        label +
        "</span> " +
        entries.map((e) => escHtmlWrappable(e.name)).join(", ") +
        "</div>"
      );
    }
    if (ins.length > 0) {
      parts.push(line("in:", ins));
    }
    if (outs.length > 0) {
      parts.push(line("out:", outs));
    }
    return parts.join("");
  }

  // Emit a single colored pill. Kept as a helper so viz cards and the side
  // panel use identical HTML + color tokens — visual consistency signals
  // that both views describe the same underlying field.
  function _chip(kind, text, title) {
    if (text === null || text === undefined || text === "") {
      return "";
    }
    var attrs = title ? ' title="' + escHtml(title) + '"' : "";
    return '<span class="viz-chip viz-chip-' + kind + '"' + attrs + ">" + escHtml(text) + "</span>";
  }

  function renderStepChips(step) {
    if (!step) {
      return "";
    }
    var chips = [];
    if (step.mode) {
      chips.push(_chip("mode", step.mode));
    }
    if (step.adapter?.type) {
      chips.push(_chip("adapter", step.adapter.type));
      if (step.adapter.model) {
        chips.push(_chip("model", step.adapter.model));
      }
    }
    if (step.fan_out && (step.fan_out.over || step.fan_out.item_count != null)) {
      // Show the source variable being fanned over rather than a bare "×N"
      // (which reads as mysterious when item_count is 0 because items haven't
      // been resolved yet). Count is suffixed only when > 0.
      var over = step.fan_out.over || "items";
      var count = step.fan_out.item_count;
      var text = "×" + over + (count && count > 0 ? " " + count : "");
      var tip =
        "fan-out over " + over + (count && count > 0 ? " (" + count + " items)" : " (unresolved)");
      chips.push(_chip("fan", text, tip));
    }
    if (step.variant) {
      chips.push(_chip("variant", step.variant));
    }
    if (chips.length === 0) {
      return "";
    }
    return '<div class="viz-card-chips">' + chips.join("") + "</div>";
  }

  function renderDepChips(dep) {
    if (!dep) {
      return "";
    }
    var chips = [];
    if (dep.usage?.length) {
      for (var i = 0; i < dep.usage.length; i++) {
        chips.push(_chip("usage", dep.usage[i]));
      }
    }
    if (dep.as_type) {
      chips.push(_chip("type", dep.as_type));
    }
    return '<div class="viz-card-chips">' + chips.join("") + "</div>";
  }

  // Body HTML for a non-process node. Kept separate from the outer wrapper so
  // we can reuse the same content string for off-screen measurement and for
  // the final positioned render.
  function renderCardBody(node, opts) {
    opts = opts || {};
    // Composite step containers get a minimal header — just the title +
    // inline mode — because the nested process frame below them already
    // carries the visual weight. Rendering chips + IO there only adds a
    // tall top-strip of whitespace above the enclosed process; chips and
    // IO remain visible via the side panel.
    var compact = !!opts.compact;
    var sub = "";
    if (node.kind === "step" && node.step) {
      sub = node.step.step_id;
    } else if (node.kind === "dep" && node.dep) {
      sub = node.dep.dep_name;
    }
    var parts = [];
    parts.push(
      '<div class="viz-card-title viz-kind-header-' +
        escHtml(node.kind) +
        depFtClass(node) +
        '">' +
        kindIconHtml(nodeIconKind(node)) +
        '<span class="viz-card-title-text">' +
        escHtmlWrappable(node.label) +
        "</span>" +
        "</div>",
    );
    if (compact) {
      return parts.join("");
    }
    if (sub && sub !== node.label) {
      parts.push('<div class="viz-card-id">' + escHtmlWrappable(sub) + "</div>");
    }
    if (node.kind === "step") {
      parts.push(renderStepChips(node.step));
    }
    if (node.kind === "dep") {
      parts.push(renderDepChips(node.dep));
    }
    if (node.kind === "step") {
      parts.push(renderIoSummary(node.step));
    }
    return parts.join("");
  }

  function renderNodeHtml(node, placed, decoration, ctx) {
    ctx = ctx || {};
    var accentClass = decoration?.accent_token ? " accent-" + decoration.accent_token : "";
    var badge = decoration?.badge
      ? '<span class="viz-node-badge">' + escHtml(decoration.badge) + "</span>"
      : "";
    var path = node.path || node.dep?.path || null;
    var clickable = isRunRelative(path) ? " viz-node-clickable" : "";
    var kindClass = node.kind === "process" ? "viz-frame" : "viz-node";
    var focusedClass =
      ctx.focusedNodeId && ctx.focusedNodeId === node.id ? " " + kindClass + "-focused" : "";
    var style =
      "left:" +
      placed.x +
      "px;top:" +
      placed.y +
      "px;" +
      "width:" +
      placed.width +
      "px;height:" +
      placed.height +
      "px;" +
      "view-transition-name:" +
      _vtName(node.id) +
      ";";
    var attrs = 'data-id="' + escHtml(node.id) + '"';
    if (clickable) {
      attrs += ' data-path="' + escHtml(path) + '"';
    }

    if (node.kind === "process") {
      var expanded = !!ctx.isExpanded;
      var isRoot = !!ctx.isRoot;
      var counts = ctx.counts || { steps: 0, deps: 0 };
      // Two-tone summary: numbers are black + bold (stand out against the
      // header line); unit labels stay muted grey like every other label.
      function _sumPart(n, unit) {
        var label = unit + (n === 1 ? "" : "s");
        return (
          '<span class="viz-frame-summary-num">' +
          n +
          "</span>" +
          '<span class="viz-frame-summary-label">' +
          label +
          "</span>"
        );
      }
      var summaryHtml =
        _sumPart(counts.steps, "step") +
        '<span class="viz-frame-summary-sep">·</span>' +
        _sumPart(counts.deps, "dep");
      var frameClasses =
        kindClass +
        " " +
        kindClass +
        "-" +
        escHtml(node.kind) +
        accentClass +
        clickable +
        focusedClass;
      frameClasses += expanded ? " viz-frame-expanded" : " viz-frame-collapsed";
      // Split interaction: clicks on the chevron (only) toggle expand/collapse;
      // clicks anywhere else on the header open the side panel. Placing
      // data-toggle-expand on the whole header made the process drawer
      // effectively unreachable because a process frame is almost all header.
      // Root can't collapse, so it gets no chevron.
      var headerClass =
        "viz-frame-header viz-kind-header-process" + (isRoot ? " viz-frame-header-root" : "");
      var chevron = isRoot
        ? ""
        : '<span class="viz-frame-chevron" data-toggle-expand="1">' +
          TOGGLE_CHEVRON_SVG +
          "</span>";
      return (
        '<div class="' +
        frameClasses +
        '" ' +
        attrs +
        ' style="' +
        style +
        '">' +
        '<div class="' +
        headerClass +
        '">' +
        chevron +
        kindIconHtml("process") +
        '<span class="viz-frame-label" title="' +
        escHtml(node.label) +
        '">' +
        escHtml(node.label) +
        "</span>" +
        '<span class="viz-frame-summary">' +
        summaryHtml +
        "</span>" +
        badge +
        "</div>" +
        "</div>"
      );
    }
    return (
      '<div class="' +
      kindClass +
      " " +
      kindClass +
      "-" +
      escHtml(node.kind) +
      depFtClass(node) +
      accentClass +
      clickable +
      focusedClass +
      '" ' +
      attrs +
      ' style="' +
      style +
      '">' +
      badge +
      renderCardBody(node, { compact: !!ctx.hasChildren }) +
      "</div>"
    );
  }

  // Off-screen DOM measurement: render each leaf node's card into a hidden
  // shell, read its bounding rect, and return per-node dims ready to feed
  // buildElkInput. Skipped gracefully when the DOM isn't available (tests).
  function measureNodes(viz) {
    if (!global.document?.body) {
      return {};
    }
    var shell = global.document.createElement("div");
    shell.className = "viz-measure-shell";
    shell.style.cssText =
      "position:absolute;visibility:hidden;pointer-events:none;top:-9999px;left:-9999px;";
    // Steps that are parents of another node are composite containers — we
    // measure them with a compact title-only body so buildElkInput's pad-top
    // (card body + 2px) shrinks to just the title strip.
    var containerIds = {};
    for (var pi = 0; pi < viz.nodes.length; pi++) {
      var pparent = viz.nodes[pi].parent;
      if (pparent) {
        containerIds[pparent] = true;
      }
    }
    // Pass 1: measure natural width within [CARD_MIN_WIDTH, CARD_MAX_WIDTH].
    // `min-width` pins measurement to CARD_MIN_WIDTH so flex children with
    // `word-break: break-word` can't shrink to a sliver and inflate height.
    var pieces = [];
    for (var i = 0; i < viz.nodes.length; i++) {
      var n = viz.nodes[i];
      // SPIKE PATCH (argument-map): process nodes are measured too (their
      // compact title-only body), so collapsed frames can hug their actual
      // title height instead of a fixed box. Previously skipped here.
      var compact = !!containerIds[n.id];
      pieces.push(
        '<div class="viz-node viz-node-' +
          escHtml(n.kind) +
          depFtClass(n) +
          ' viz-measure" ' +
          'data-id="' +
          escHtml(n.id) +
          '" ' +
          'data-compact="' +
          (compact ? "1" : "0") +
          '" ' +
          'style="position:absolute;width:auto;display:inline-block;' +
          "min-width:" +
          CARD_MIN_WIDTH +
          "px;" +
          "max-width:" +
          CARD_MAX_WIDTH +
          'px;">' +
          renderCardBody(n, { compact: compact }) +
          "</div>",
      );
    }
    shell.innerHTML = pieces.join("");
    global.document.body.appendChild(shell);
    var dims = {};
    try {
      /** @type {NodeListOf<HTMLElement>} */
      var els = shell.querySelectorAll(".viz-measure");
      // Pass 2: lock each element to its target render width, then read final
      // height. Natural width measured in pass 1 is what the node will render
      // at — ensures content wraps the same way for measurement and render,
      // so ELK-declared height exactly matches rendered content height.
      var targets = [];
      for (var j = 0; j < els.length; j++) {
        var natural = Math.ceil(els[j].getBoundingClientRect().width);
        var target = Math.max(CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, natural));
        targets.push(target);
      }
      for (var k = 0; k < els.length; k++) {
        els[k].style.width = targets[k] + "px";
        els[k].style.minWidth = targets[k] + "px";
        els[k].style.maxWidth = targets[k] + "px";
      }
      for (var m = 0; m < els.length; m++) {
        var r = els[m].getBoundingClientRect();
        dims[els[m].dataset.id] = {
          width: targets[m],
          height: Math.max(CARD_MIN_HEIGHT, Math.ceil(r.height)),
        };
      }
    } finally {
      global.document.body.removeChild(shell);
    }
    return dims;
  }

  // ── Public entrypoint ──────────────────────────────────────────

  async function renderViz(container, viz, options) {
    options = options || {};
    var decorators = options.decorators || [];
    var sourcePath = viz.header?.source_path || viz.root_process || "";
    var viewState = options.viewState || loadViewState(sourcePath);
    var expandedSet = new Set(viewState.expanded_nodes || []);
    var planes = viewState.planes || { steps: true, artifacts: false, files: false };

    // Apply plane filter first — nodes hidden in the current plane drop out of
    // counts, dims measurement, and ELK layout all in one step.
    var filteredViz = filterVizByPlanes(viz, planes);

    var perNodeDims = options.perNodeDims || measureNodes(filteredViz);
    var counts = _countDescendants(filteredViz);

    var laid;
    try {
      laid = await layoutWithElk(
        filteredViz,
        Object.assign({}, options, {
          expanded: expandedSet,
          perNodeDims: perNodeDims,
        }),
      );
    } catch (err) {
      container.innerHTML =
        '<div class="viz-error">Layout failed: ' +
        escHtml(err instanceof Error ? err.message : String(err)) +
        "</div>";
      return;
    }

    var canvas = document.createElement("div");
    canvas.className = "viz-canvas";
    canvas.style.width = laid.width + "px";
    canvas.style.height = laid.height + "px";

    // Sort by ELK depth ascending so outer containers render before inner
    // children.
    var orderedNodes = filteredViz.nodes.slice().sort((a, b) => {
      var da = (laid.nodes[a.id] && laid.nodes[a.id].depth) || 0;
      var db = (laid.nodes[b.id] && laid.nodes[b.id].depth) || 0;
      return da - db;
    });

    // Index which nodes are containers in the filtered graph (i.e. have at
    // least one surviving child). Edges inside a container need to paint on
    // TOP of its background — otherwise the container's solid/translucent
    // bg covers the SVG and the inner arrows disappear. We render in three
    // passes: containers → SVG edge layer → leaves. This way SVG sits above
    // every container background (arrows visible) but below every leaf card
    // (leaf content never overlapped by an arrow line).
    var hasChildren = {};
    for (var hi = 0; hi < filteredViz.nodes.length; hi++) {
      var parentId = filteredViz.nodes[hi].parent;
      if (parentId) {
        hasChildren[parentId] = true;
      }
    }

    // Build a tooltip registry during node iteration so hover handlers
    // can look up the Identity HTML by node id without re-deriving it
    // from the DOM. Keeps tooltip content in sync with render state
    // (decorations, selected variant, etc.) for free.
    var tooltipById = {};

    function appendNode(node) {
      var placed = laid.nodes[node.id];
      if (!placed) {
        return;
      }
      var decoration = mergeDecorations(node, decorators);
      var isExpanded =
        node.kind !== "process" || node.id === viz.root_process_node || expandedSet.has(node.id);
      var isRoot = node.id === viz.root_process_node;
      tooltipById[node.id] = tooltipHtmlFor(node, decoration);
      canvas.insertAdjacentHTML(
        "beforeend",
        renderNodeHtml(node, placed, decoration, {
          isExpanded: isExpanded,
          isRoot: isRoot,
          counts: node.kind === "process" ? counts[node.id] : null,
          focusedNodeId: viewState.focused_node || null,
          hasChildren: !!hasChildren[node.id],
        }),
      );
    }

    for (var i = 0; i < orderedNodes.length; i++) {
      if (hasChildren[orderedNodes[i].id]) {
        appendNode(orderedNodes[i]);
      }
    }
    canvas.insertAdjacentHTML("beforeend", renderEdgesSvg(laid));
    for (var i2 = 0; i2 < orderedNodes.length; i2++) {
      if (!hasChildren[orderedNodes[i2].id]) {
        appendNode(orderedNodes[i2]);
      }
    }

    var sizer = document.createElement("div");
    sizer.className = "viz-sizer";
    sizer.appendChild(canvas);

    var viewport = document.createElement("div");
    viewport.className = "viz-viewport";
    viewport.appendChild(sizer);

    var label = document.createElement("span");
    label.className = "viz-tool-label";
    var toolbar = _toolbar(label, planes);

    // Plane toggles re-render the whole view with updated state.
    function togglePlane(key) {
      planes[key] = !planes[key];
      viewState.planes = planes;
      saveViewState(sourcePath, viewState);
      renderViz(container, viz, Object.assign({}, options, { viewState: viewState }));
    }
    toolbar.btnSteps.addEventListener("click", () => {
      togglePlane("steps");
    });
    toolbar.btnArtifacts.addEventListener("click", () => {
      togglePlane("artifacts");
    });

    // Bulk expand/collapse: if every non-root process is already expanded,
    // collapse them all; otherwise expand them all. The root process stays
    // open either way.
    var nonRootProcessIds = [];
    for (var npi = 0; npi < filteredViz.nodes.length; npi++) {
      var nn = filteredViz.nodes[npi];
      if (nn.kind === "process" && nn.id !== viz.root_process_node) {
        nonRootProcessIds.push(nn.id);
      }
    }
    var allExpanded =
      nonRootProcessIds.length > 0 && nonRootProcessIds.every((id) => expandedSet.has(id));
    toolbar.btnExpandAll.textContent = allExpanded ? "Collapse all" : "Expand all";
    toolbar.btnExpandAll.addEventListener("click", () => {
      if (allExpanded) {
        for (var ci = 0; ci < nonRootProcessIds.length; ci++) {
          expandedSet.delete(nonRootProcessIds[ci]);
        }
      } else {
        for (var ei = 0; ei < nonRootProcessIds.length; ei++) {
          expandedSet.add(nonRootProcessIds[ei]);
        }
      }
      viewState.expanded_nodes = Array.from(expandedSet);
      saveViewState(sourcePath, viewState);
      renderViz(container, viz, Object.assign({}, options, { viewState: viewState }));
    });

    // Wrap the commit step in document.startViewTransition so the
    // browser snapshots the old DOM, runs the swap below, snapshots the
    // new DOM, and crossfades / morphs between them. Per-node
    // view-transition-name (set in renderNodeHtml's inline style)
    // matches each node across the snapshots so it animates from its
    // old position+size to its new ones instead of crossfading. The
    // entire commit (DOM swap, zoom install, listener attach) runs
    // inside the callback so we keep one render flow rather than
    // splitting visual mutation from wiring.
    function _commit() {
      container.innerHTML = "";
      var warnings = options.warnings || [];
      if (warnings.length > 0) {
        container.appendChild(_warningBanner(warnings));
      }
      container.appendChild(_headerPanel(viz));
      container.appendChild(toolbar.el);

      // Viewport + side panel sit in a flex row so the panel slides in from the
      // right without overlapping the graph.
      var stage = document.createElement("div");
      stage.className = "viz-stage";
      stage.appendChild(viewport);
      var sidePanel = document.createElement("aside");
      sidePanel.className = "viz-side-panel";
      // view-transition-name on the drawer so it gets its own ::view-transition-group
      // and a CSS z-index above the morphing viz nodes; without this the drawer
      // sits in the root snapshot and morphing named nodes paint on top of it.
      sidePanel.style.viewTransitionName = "viz-drawer";
      if (viewState.focused_node) {
        var focusedNode = _findNode(viz, viewState.focused_node);
        if (focusedNode) {
          sidePanel.innerHTML = renderSidePanel(focusedNode);
          sidePanel.classList.add("viz-side-panel-open");
        }
      }
      stage.appendChild(sidePanel);
      container.appendChild(stage);
      container.appendChild(_legend());

      // Zoom/pan: on first load, fit-to-width; on re-renders (after
      // expand/collapse or a plane toggle), restore whatever the user had so
      // we don't yank them back to overview on every interaction. Writes back
      // into VizViewState via a debounced onChange.
      var zoom = _installZoom(viewport, sizer, canvas, laid, label, toolbar, (s, sx, sy) => {
        viewState.zoom = s;
        viewState.scroll_x = sx;
        viewState.scroll_y = sy;
        saveViewState(sourcePath, viewState);
      });
      requestAnimationFrame(() => {
        if (typeof viewState.zoom === "number" && viewState.zoom > 0) {
          zoom.apply(viewState.zoom);
          viewport.scrollLeft = viewState.scroll_x || 0;
          viewport.scrollTop = viewState.scroll_y || 0;
        } else {
          zoom.fit();
        }
      });

      function _clearFocusClass() {
        var prev = canvas.querySelectorAll(".viz-node-focused,.viz-frame-focused");
        for (var i = 0; i < prev.length; i++) {
          prev[i].classList.remove("viz-node-focused");
          prev[i].classList.remove("viz-frame-focused");
        }
      }
      function _applyFocusClass(nodeId) {
        _clearFocusClass();
        if (!nodeId) {
          return;
        }
        var el = canvas.querySelector(
          '[data-id="' + (global.CSS?.escape ? global.CSS.escape(nodeId) : nodeId) + '"]',
        );
        if (!el) {
          return;
        }
        var isFrame = el.classList.contains("viz-frame");
        el.classList.add(isFrame ? "viz-frame-focused" : "viz-node-focused");
      }
      function openPanel(nodeId) {
        var node = _findNode(viz, nodeId);
        if (!node) {
          return;
        }
        sidePanel.innerHTML = renderSidePanel(node);
        sidePanel.classList.add("viz-side-panel-open");
        viewState.focused_node = nodeId;
        saveViewState(sourcePath, viewState);
        _applyFocusClass(nodeId);
      }
      function closePanel() {
        sidePanel.classList.remove("viz-side-panel-open");
        sidePanel.innerHTML = "";
        viewState.focused_node = null;
        saveViewState(sourcePath, viewState);
        _clearFocusClass();
      }

      // Clicks in the canvas:
      //   caret ([data-toggle-expand]) → expand/collapse the surrounding frame
      //   anything else with [data-id]  → open the side panel on that node
      // Caret is a separate target so clicks on the rest of the frame header
      // (or the frame body area) open the panel instead of toggling — the
      // previous "whole-header = toggle" rule made the process panel nearly
      // unreachable.
      canvas.addEventListener("click", (ev) => {
        var target = ev.target instanceof Element ? ev.target : null;
        if (!target) {
          return;
        }
        var caret = target.closest("[data-toggle-expand]");
        if (caret) {
          var frame = caret.closest(".viz-frame");
          if (
            frame instanceof HTMLElement &&
            frame.dataset.id &&
            frame.dataset.id !== viz.root_process_node
          ) {
            var id = frame.dataset.id;
            if (expandedSet.has(id)) {
              expandedSet.delete(id);
            } else {
              expandedSet.add(id);
            }
            viewState.expanded_nodes = Array.from(expandedSet);
            saveViewState(sourcePath, viewState);
            renderViz(container, viz, Object.assign({}, options, { viewState: viewState }));
            ev.stopPropagation();
            return;
          }
        }
        var nodeEl = target.closest(".viz-node[data-id], .viz-frame[data-id]");
        if (!(nodeEl instanceof HTMLElement)) {
          return;
        }
        var nodeId = nodeEl.dataset.id;
        if (nodeId) {
          openPanel(nodeId);
        }
      });

      // Hover tooltip — Identity block, same classes + rows as the
      // drawer section. Uses the shared custom-tooltip system
      // (window.MetabrowserTooltip) so file-tree and viz tooltips share
      // one DOM node, one stylesheet, and one delay/fade.
      var _tipEl = null;
      canvas.addEventListener("mouseover", (ev) => {
        var target = ev.target instanceof Element ? ev.target : null;
        if (!target) {
          return;
        }
        var nodeEl = target.closest(".viz-node[data-id], .viz-frame[data-id]");
        if (!(nodeEl instanceof HTMLElement) || nodeEl === _tipEl) {
          return;
        }
        var tip = global.MetabrowserTooltip;
        if (!tip) {
          return;
        }
        var html = tooltipById[nodeEl.dataset.id];
        if (!html) {
          return;
        }
        _tipEl = nodeEl;
        tip.show(html, ev);
      });
      canvas.addEventListener("mousemove", (ev) => {
        if (!_tipEl) {
          return;
        }
        var tip = global.MetabrowserTooltip;
        if (tip) {
          tip.move(ev);
        }
      });
      canvas.addEventListener("mouseout", (ev) => {
        if (!_tipEl) {
          return;
        }
        // Only hide when leaving the current tipped node entirely
        // (not when moving to one of its children).
        if (ev.relatedTarget instanceof Node && _tipEl.contains(ev.relatedTarget)) {
          return;
        }
        var tip = global.MetabrowserTooltip;
        if (tip) {
          tip.hide();
        }
        _tipEl = null;
      });

      // Clicks in the side panel: close button, or an inline path link → onOpenFile.
      sidePanel.addEventListener("click", (ev) => {
        var target = ev.target instanceof Element ? ev.target : null;
        if (!target) {
          return;
        }
        if (target.closest(".viz-panel-close")) {
          closePanel();
          return;
        }
        var link = target.closest(".viz-panel-link");
        if (link instanceof HTMLElement && options.onOpenFile && link.dataset.path) {
          ev.preventDefault();
          options.onOpenFile(link.dataset.path);
        }
      });

      // Esc closes the side panel. The listener is attached to the persistent
      // container (which survives innerHTML replacement on rerender), so we must
      // guard against re-attaching on every rerender — otherwise each
      // expand/collapse / plane toggle adds another listener. Keep one listener
      // per container, pointed at the latest sidePanel via a mutable ref.
      container._vizEscState = { sidePanel: sidePanel, closePanel: closePanel };
      if (!container._vizEscAttached) {
        container._vizEscAttached = true;
        container.addEventListener("keydown", (ev) => {
          if (ev.key !== "Escape") {
            return;
          }
          var state = container._vizEscState;
          if (state?.sidePanel.classList.contains("viz-side-panel-open")) {
            state.closePanel();
          }
        });
      }
      // Make the container a focus target so keydown fires without requiring
      // the user to click a button first.
      if (!container.hasAttribute("tabindex")) {
        container.setAttribute("tabindex", "-1");
      }
    }

    if (
      typeof document !== "undefined" &&
      typeof document.startViewTransition === "function" &&
      !_prefersReducedMotion()
    ) {
      document.startViewTransition(_commit);
    } else {
      _commit();
    }
  }

  function _findNode(viz, id) {
    for (var i = 0; i < viz.nodes.length; i++) {
      if (viz.nodes[i].id === id) {
        return viz.nodes[i];
      }
    }
    return null;
  }

  // For each process node, count the steps + deps anywhere in its descendant tree.
  // Shown in the frame header so collapsed frames still tell the reader what's inside.
  function _countDescendants(viz) {
    var byParent = {};
    for (var i = 0; i < viz.nodes.length; i++) {
      var n = viz.nodes[i];
      var p = n.parent || null;
      if (!byParent[p]) {
        byParent[p] = [];
      }
      byParent[p].push(n);
    }
    var counts = {};
    (function walk(id) {
      var c = { steps: 0, deps: 0 };
      var kids = byParent[id] || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.kind === "step") {
          c.steps++;
        } else if (k.kind === "dep") {
          c.deps++;
        }
        if (k.kind === "process") {
          walk(k.id);
          c.steps += counts[k.id].steps;
          c.deps += counts[k.id].deps;
        } else {
          // steps can wrap their own child process node; recurse to count inside.
          walk(k.id);
          if (counts[k.id]) {
            c.steps += counts[k.id].steps;
            c.deps += counts[k.id].deps;
          }
        }
      }
      counts[id] = c;
    })(null);
    return counts;
  }

  function _toolbar(label, planes) {
    var bar = document.createElement("div");
    bar.className = "viz-toolbar";
    planes = planes || { steps: true, artifacts: false };

    // No "Files" toggle: there's no file-kind projector today and the
    // button was a visible no-op. When Files arrives as a real plane it
    // can be added back here with its own icon.
    var btnSteps = _toggleBtn(
      "Steps",
      "Toggle step/process nodes",
      planes.steps,
      kindIconHtml("step"),
    );
    var btnArtifacts = _toggleBtn(
      "Artifacts",
      "Toggle dep nodes + produces/consumes edges",
      planes.artifacts,
      kindIconHtml("dep"),
    );
    var planeSpacer = document.createElement("span");
    planeSpacer.className = "viz-tool-divider";

    var btnOut = _btn("−", "Zoom out");
    var btnIn = _btn("+", "Zoom in");
    var btnFit = _btn("Fit", "Fit to width");
    var btnReset = _btn("100%", "Reset to 100%");
    var btnExpandAll = _btn("Expand all", "Expand or collapse every process except the root");
    var spacer = document.createElement("span");
    spacer.className = "viz-tool-spacer";
    var hint = document.createElement("span");
    hint.className = "viz-tool-hint";
    hint.textContent = "⌃/⌘ + scroll to zoom";

    bar.appendChild(btnSteps);
    bar.appendChild(btnArtifacts);
    bar.appendChild(planeSpacer);
    bar.appendChild(btnOut);
    bar.appendChild(label);
    bar.appendChild(btnIn);
    bar.appendChild(btnFit);
    bar.appendChild(btnReset);
    bar.appendChild(btnExpandAll);
    bar.appendChild(spacer);
    bar.appendChild(hint);

    return {
      el: bar,
      btnIn: btnIn,
      btnOut: btnOut,
      btnFit: btnFit,
      btnReset: btnReset,
      btnExpandAll: btnExpandAll,
      btnSteps: btnSteps,
      btnArtifacts: btnArtifacts,
    };
  }

  function _toggleBtn(text, title, active, iconHtml) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "viz-tool-btn viz-tool-toggle" + (active ? " viz-tool-toggle-on" : "");
    b.innerHTML =
      (iconHtml || "") + '<span class="viz-tool-btn-label">' + escHtml(text) + "</span>";
    if (title) {
      b.title = title;
    }
    return b;
  }

  function _btn(text, title) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "viz-tool-btn";
    b.textContent = text;
    if (title) {
      b.title = title;
    }
    return b;
  }

  // Install zoom + scroll. When `onChange(scale, scrollLeft, scrollTop)` is
  // passed, it fires whenever the user changes either (debounced 250 ms) so
  // renderViz can persist it into VizViewState for the next re-layout.
  function _installZoom(viewport, sizer, canvas, laid, label, toolbar, onChange) {
    var scale = 1;
    function clamp(s) {
      return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s));
    }
    function apply(s) {
      scale = clamp(s);
      canvas.style.transform = "scale(" + scale + ")";
      sizer.style.width = Math.ceil(laid.width * scale) + "px";
      sizer.style.height = Math.ceil(laid.height * scale) + "px";
      label.textContent = Math.round(scale * 100) + "%";
      notifyChange();
    }
    function fit() {
      var avail = viewport.clientWidth - 8;
      if (avail <= 0 || laid.width <= 0) {
        apply(1);
        return;
      }
      apply(Math.min(1, avail / laid.width));
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      notifyChange();
    }
    function zoomAt(newScale, clientX, clientY) {
      var rect = viewport.getBoundingClientRect();
      var px = clientX - rect.left + viewport.scrollLeft;
      var py = clientY - rect.top + viewport.scrollTop;
      var prev = scale;
      apply(newScale);
      var ratio = scale / prev;
      viewport.scrollLeft = px * ratio - (clientX - rect.left);
      viewport.scrollTop = py * ratio - (clientY - rect.top);
    }
    var changeTimer = null;
    function notifyChange() {
      if (!onChange) {
        return;
      }
      if (changeTimer) {
        global.clearTimeout(changeTimer);
      }
      changeTimer = global.setTimeout(() => {
        onChange(scale, viewport.scrollLeft, viewport.scrollTop);
      }, 250);
    }

    toolbar.btnIn.addEventListener("click", () => {
      apply(scale * ZOOM_STEP);
    });
    toolbar.btnOut.addEventListener("click", () => {
      apply(scale / ZOOM_STEP);
    });
    toolbar.btnFit.addEventListener("click", fit);
    toolbar.btnReset.addEventListener("click", () => {
      apply(1);
    });
    viewport.addEventListener(
      "wheel",
      (ev) => {
        if (!(ev.ctrlKey || ev.metaKey)) {
          return;
        }
        ev.preventDefault();
        var direction = ev.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
        zoomAt(scale * direction, ev.clientX, ev.clientY);
      },
      { passive: false },
    );
    viewport.addEventListener("scroll", notifyChange, { passive: true });
    apply(1);
    return { apply: apply, fit: fit };
  }

  // ── Side panel (click-to-inspect) ──────────────────────────────

  function _row(key, value) {
    if (value === null || value === undefined || value === "") {
      return "";
    }
    return (
      '<div class="viz-panel-row"><span class="viz-panel-key">' +
      escHtml(key) +
      "</span>" +
      '<span class="viz-panel-val">' +
      value +
      "</span></div>"
    );
  }

  function _section(title, body) {
    if (!body) {
      return "";
    }
    return (
      '<div class="viz-panel-section">' +
      '<div class="viz-panel-section-title">' +
      escHtml(title) +
      "</div>" +
      '<div class="viz-panel-section-body">' +
      body +
      "</div>" +
      "</div>"
    );
  }

  function _ioTable(entries) {
    if (!entries?.length) {
      return "";
    }
    var rows = entries
      .map(
        (e) =>
          '<tr><td class="viz-panel-name">' +
          escHtmlWrappable(e.name) +
          "</td>" +
          '<td class="viz-panel-type">' +
          escHtml(e.as_type || "—") +
          "</td>" +
          '<td class="viz-panel-prod">' +
          escHtml(e.produced_by || "—") +
          "</td></tr>",
      )
      .join("");
    return (
      '<table class="viz-panel-table">' +
      "<thead><tr><th>name</th><th>as</th><th>produced_by</th></tr></thead>" +
      "<tbody>" +
      rows +
      "</tbody>" +
      "</table>"
    );
  }

  function _pathLink(path, label) {
    if (!path || !isRunRelative(path)) {
      return escHtml(path || "—");
    }
    return (
      '<a href="#" class="viz-panel-link" data-path="' +
      escHtml(path) +
      '">' +
      escHtml(label || path) +
      "</a>"
    );
  }

  function _formatList(items) {
    if (!items?.length) {
      return "";
    }
    return items.map(escHtml).join(", ");
  }

  function _formatMap(map) {
    if (!map) {
      return "";
    }
    var keys = Object.keys(map);
    if (!keys.length) {
      return "";
    }
    return keys.map((k) => escHtml(k) + "=" + escHtml(String(map[k]))).join(", ");
  }

  function _retryRow(retry) {
    if (!retry) {
      return null;
    }
    var bits = [];
    if (retry.max_retries != null) {
      bits.push("max=" + retry.max_retries);
    }
    if (retry.initial_backoff_s != null) {
      bits.push("init=" + retry.initial_backoff_s + "s");
    }
    if (retry.backoff_multiplier != null) {
      bits.push("×" + retry.backoff_multiplier);
    }
    if (retry.max_backoff_s != null) {
      bits.push("max=" + retry.max_backoff_s + "s");
    }
    return bits.length ? escHtml(bits.join(", ")) : null;
  }

  // Full IO table: name / as_type / produced_by plus the raw path drawn from
  // the authored IOSpec (when set). Keeps compact summaries discoverable
  // without hiding the path — which is what operators most often need.
  function _ioTableFull(summary, rawMap) {
    if (!summary?.length) {
      return "";
    }
    rawMap = rawMap || {};
    var rows = summary
      .map((e) => {
        var raw = rawMap[e.name] || {};
        var path = raw.path || raw.ref || null;
        return (
          '<tr><td class="viz-panel-name">' +
          escHtmlWrappable(e.name) +
          "</td>" +
          '<td class="viz-panel-type">' +
          escHtml(e.as_type || "—") +
          "</td>" +
          '<td class="viz-panel-prod">' +
          escHtml(e.produced_by || "—") +
          "</td>" +
          "<td>" +
          (path ? _pathLink(path) : "—") +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<table class="viz-panel-table">' +
      "<thead><tr><th>name</th><th>as</th><th>produced_by</th><th>path</th></tr></thead>" +
      "<tbody>" +
      rows +
      "</tbody>" +
      "</table>"
    );
  }

  // Identity rows per node kind — single source of truth shared by the
  // drawer (full panel with Identity + extra sections) and the hover
  // tooltip (Identity only). Every kind shows what it is, where it's
  // defined (schema + source), and its kind-specific fields.
  function _stepIdentityRows(step) {
    return [
      _row("id", escHtml(step.step_id)),
      _row("description", step.description ? escHtml(step.description) : null),
      _row("mode", _chip("mode", step.mode)),
      _row("schema", step.process_schema_token ? escHtml(step.process_schema_token) : null),
      _row("source", step.source_path ? _pathLink(step.source_path) : null),
      _row("variant", step.variant ? _chip("variant", step.variant) : null),
      _row("reuse_policy", step.reuse_policy ? escHtml(step.reuse_policy) : null),
      _row(
        "max_budget_usd",
        step.max_budget_usd != null ? escHtml(String(step.max_budget_usd)) : null,
      ),
      _row("token_budget", step.token_budget != null ? escHtml(String(step.token_budget)) : null),
      _row("needs", step.needs?.length ? _formatList(step.needs) : null),
    ].join("");
  }

  function _depIdentityRows(dep) {
    var usageChips = dep.usage?.length ? dep.usage.map((u) => _chip("usage", u)).join(" ") : null;
    return [
      _row("name", escHtml(dep.dep_name)),
      _row("usage", usageChips),
      _row("schema", dep.process_schema_token ? escHtml(dep.process_schema_token) : null),
      _row("source", dep.source_path ? _pathLink(dep.source_path) : null),
      _row("as_type", dep.as_type ? _chip("type", dep.as_type) : null),
      _row("path", _pathLink(dep.path)),
      _row("produced_by", dep.produced_by ? escHtml(dep.produced_by) : null),
    ].join("");
  }

  function renderStepPanel(step) {
    if (!step) {
      return "";
    }
    var parts = [];
    parts.push(_section("Identity", _stepIdentityRows(step)));
    if (step.adapter) {
      var a = step.adapter;
      parts.push(
        _section(
          "Adapter",
          [
            _row("type", _chip("adapter", a.type)),
            _row("model", a.model ? _chip("model", a.model) : null),
            _row("provider", a.provider ? escHtml(a.provider) : null),
            _row("tools", _formatList(a.tools)),
            _row("timeout_s", a.timeout_s != null ? escHtml(String(a.timeout_s)) : null),
            _row(
              "max_budget_usd",
              a.max_budget_usd != null ? escHtml(String(a.max_budget_usd)) : null,
            ),
          ].join(""),
        ),
      );
    }
    if (step.fan_out) {
      var f = step.fan_out;
      parts.push(
        _section(
          "Fan-out",
          [
            _row("over", escHtml(f.over)),
            _row("bind", f.bind ? escHtml(f.bind) : null),
            _row("bind_fields", _formatList(f.bind_fields)),
            _row("batch_size", f.batch_size != null ? escHtml(String(f.batch_size)) : null),
            _row("item_count", f.item_count != null ? escHtml(String(f.item_count)) : null),
            _row("retry", _retryRow(f.retry)),
          ].join(""),
        ),
      );
    }
    parts.push(_section("Inputs", _ioTableFull(step.inputs_summary, step.inputs)));
    parts.push(_section("Outputs", _ioTableFull(step.outputs_summary, step.outputs)));
    // `with:` parameter bindings — primarily relevant for composite steps
    // which pass values down into the child process.
    var withMap = step.with_ || step.with; // alias-aware
    if (withMap && Object.keys(withMap).length) {
      var withRows = Object.keys(withMap)
        .map((k) => _row(k, escHtml(String(withMap[k]))))
        .join("");
      parts.push(_section("With (parameter bindings)", withRows));
    }
    var exec = [
      _row("handler", step.handler ? escHtml(step.handler) : null),
      _row("command", step.command ? escHtml(step.command) : null),
      _row("uses_path", step.uses_path ? _pathLink(step.uses_path) : null),
      _row("output_root", step.output_root ? escHtml(step.output_root) : null),
      _row("env", _formatMap(step.env)),
      _row("prompt_prefix", step.prompt_prefix ? escHtml(step.prompt_prefix) : null),
    ].join("");
    if (exec) {
      parts.push(_section("Execution", exec));
    }
    if (step.prompt_paths?.length) {
      parts.push(
        _section(
          "Prompt paths",
          step.prompt_paths.map((p) => "<div>" + _pathLink(p) + "</div>").join(""),
        ),
      );
    }
    return parts.join("");
  }

  function renderDepPanel(dep) {
    if (!dep) {
      return "";
    }
    var parts = [];
    parts.push(_section("Identity", _depIdentityRows(dep)));
    if (dep.consumers?.length) {
      parts.push(_section("Consumers", _formatList(dep.consumers)));
    }
    if (dep.parse) {
      parts.push(
        _section(
          "Parse",
          '<pre class="viz-panel-json">' + escHtml(JSON.stringify(dep.parse, null, 2)) + "</pre>",
        ),
      );
    }
    return parts.join("");
  }

  function renderProcessPanel(header) {
    if (!header) {
      return "";
    }
    var parts = [];
    parts.push(_section("Identity", _processIdentityRows(header)));
    if (header.process_inputs) {
      var ikeys = Object.keys(header.process_inputs);
      if (ikeys.length) {
        var rows = ikeys
          .map((k) => {
            var v = header.process_inputs[k] || {};
            return (
              '<tr><td class="viz-panel-name">' +
              escHtml(k) +
              "</td>" +
              '<td class="viz-panel-type">' +
              escHtml(v.as_type || "—") +
              "</td>" +
              "<td>" +
              escHtml(v.param || "—") +
              "</td>" +
              "<td>" +
              escHtml(v.description || "—") +
              "</td></tr>"
            );
          })
          .join("");
        parts.push(
          _section(
            "Operator inputs",
            '<table class="viz-panel-table">' +
              "<thead><tr><th>name</th><th>as</th><th>param</th><th>desc</th></tr></thead>" +
              "<tbody>" +
              rows +
              "</tbody></table>",
          ),
        );
      }
    }
    var defaults = header.defaults || {};
    if (defaults.default_adapter || defaults.retry) {
      parts.push(
        _section(
          "Defaults",
          [
            _row(
              "default_adapter",
              defaults.default_adapter ? escHtml(defaults.default_adapter) : null,
            ),
            _row("retry", _retryRow(defaults.retry)),
          ].join(""),
        ),
      );
    }
    if (defaults.adapters) {
      var akeys = Object.keys(defaults.adapters);
      if (akeys.length) {
        var adapterRows = akeys
          .map((k) => {
            var a = defaults.adapters[k];
            return (
              "<tr><td>" +
              escHtml(k) +
              "</td><td>" +
              escHtml(a.type || "—") +
              "</td>" +
              "<td>" +
              escHtml(a.model || "—") +
              "</td>" +
              "<td>" +
              escHtml(a.provider || "—") +
              "</td></tr>"
            );
          })
          .join("");
        parts.push(
          _section(
            "Adapters",
            '<table class="viz-panel-table">' +
              "<thead><tr><th>name</th><th>type</th><th>model</th><th>provider</th></tr></thead>" +
              "<tbody>" +
              adapterRows +
              "</tbody></table>",
          ),
        );
      }
    }
    if (header.registered_schemas?.length) {
      parts.push(
        _section(
          "Registered schemas",
          '<div class="viz-panel-val">' + _formatList(header.registered_schemas) + "</div>",
        ),
      );
    }
    if (header.body_markdown) {
      // Collapsible "About" block so long prose doesn't dominate the panel.
      parts.push(
        '<details class="viz-panel-section viz-panel-body-details">' +
          '<summary class="viz-panel-section-title">About</summary>' +
          '<div class="viz-panel-section-body">' +
          '<div class="viz-panel-body-md">' +
          escHtml(header.body_markdown) +
          "</div>" +
          "</div></details>",
      );
    }
    return parts.join("");
  }

  function renderSidePanel(node) {
    if (!node) {
      return "";
    }
    var title = node.label;
    var body = "";
    if (node.kind === "step") {
      body = renderStepPanel(node.step);
    } else if (node.kind === "dep") {
      body = renderDepPanel(node.dep);
    } else if (node.kind === "process") {
      body = renderProcessPanel(node.process);
    }
    return (
      '<div class="viz-panel-head viz-kind-header-' +
      escHtml(node.kind) +
      depFtClass(node) +
      '">' +
      kindIconHtml(node.kind) +
      '<span class="viz-panel-title">' +
      escHtmlWrappable(title) +
      "</span>" +
      '<button type="button" class="viz-panel-close" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="viz-panel-content">' +
      body +
      "</div>"
    );
  }

  // Legend pinned under the canvas explaining the icon + edge-style
  // vocabulary so the diagram reads without a codebook. Each swatch reuses
  // the same HTML/SVG tokens the diagram itself emits (kind icons, arrow
  // markers, dashed stroke) so a palette change propagates without drift.
  function _legend() {
    var div = document.createElement("div");
    div.className = "viz-legend";
    var kindItem = (kind, text) =>
      '<span class="viz-legend-item viz-kind-header-' +
      kind +
      '">' +
      kindIconHtml(kind) +
      "<span>" +
      escHtml(text) +
      "</span>" +
      "</span>";
    // File-type swatch — uses the "dep" wrapper class so the same
    // .viz-kind-header-dep.ft-* .viz-kind-icon color rule in viz.css
    // that paints artifact icons in the graph also paints these
    // swatches. `iconName` is the shared-registry key ("dep" for
    // doc-shaped subtypes, "process" for process specs).
    var ftItem = (ftClass, iconName, text) => {
      var reg = typeof window !== "undefined" ? window.MetabrowserIcons : null;
      var icon = reg?.withClass ? reg.withClass(iconName, "viz-kind-icon viz-kind-icon-dep") : "";
      return (
        '<span class="viz-legend-item viz-kind-header-dep ' +
        ftClass +
        '">' +
        icon +
        "<span>" +
        escHtml(text) +
        "</span>" +
        "</span>"
      );
    };
    // Each arrow swatch is a standalone SVG that inlines its own marker
    // definition — SVG <defs> don't cross document-level boundaries, so the
    // canvas's markers aren't visible from the legend's SVG scope.
    var arrowHeads = {
      needs:
        '<path d="M 0 1 L 10 5 L 0 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
      produces: '<path d="M 0 2 L 10 5 L 0 8 z" fill="context-stroke"/>',
      consumes: '<path d="M 0 2 L 10 5 L 0 8 z" fill="context-stroke"/>',
    };
    var arrowItem = (kind, text) => {
      var markerId = "viz-legend-arrow-" + kind;
      return (
        '<span class="viz-legend-item">' +
        '<svg class="viz-legend-arrow viz-edge viz-edge-' +
        kind +
        '" viewBox="0 0 40 10">' +
        '<defs><marker id="' +
        markerId +
        '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
        arrowHeads[kind] +
        "</marker></defs>" +
        '<line x1="0" y1="5" x2="32" y2="5" marker-end="url(#' +
        markerId +
        ')" />' +
        "</svg>" +
        "<span>" +
        escHtml(text) +
        "</span>" +
        "</span>"
      );
    };
    div.innerHTML =
      kindItem("step", "step") +
      kindItem("process", "process") +
      kindItem("dep", "artifact") +
      '<span class="viz-legend-sep"></span>' +
      ftItem("ft-md", "dep", ".md") +
      ftItem("ft-md-runbook", "dep", ".runbook.md") +
      ftItem("ft-md-template", "dep", ".template.md") +
      ftItem("ft-md-process", "process", ".process.md") +
      '<span class="viz-legend-sep"></span>' +
      arrowItem("needs", "needs") +
      arrowItem("produces", "produces") +
      arrowItem("consumes", "consumes");
    return div;
  }

  function _warningBanner(warnings) {
    var div = document.createElement("div");
    div.className = "viz-warning-banner";
    var items = warnings
      .map((w) => '<pre class="viz-warning-detail">' + escHtml(w) + "</pre>")
      .join("");
    var reg = typeof window !== "undefined" ? window.MetabrowserIcons : null;
    var alertIcon = reg?.withClass ? reg.withClass("alert", "viz-alert-icon") : "";
    div.innerHTML =
      alertIcon +
      '<div class="viz-warning-content">' +
      '<div class="viz-warning-title">Rendered without full validation</div>' +
      items +
      "</div>";
    return div;
  }

  // Identity rows for a process header — single source of truth used by
  // both the top-of-page panel and the drawer's process section, so they
  // render with identical labels, formatting, and styling.
  function _processIdentityRows(h) {
    return [
      _row("name", escHtml(h.name || "")),
      _row("description", h.description ? escHtml(h.description) : null),
      _row("schema", h.process_schema_token ? escHtml(h.process_schema_token) : null),
      _row("source", h.source_path ? _pathLink(h.source_path) : null),
      _row(
        "inputs",
        h.process_inputs && Object.keys(h.process_inputs).length
          ? _formatList(Object.keys(h.process_inputs))
          : null,
      ),
    ].join("");
  }

  function _headerPanel(viz) {
    var panel = document.createElement("div");
    panel.className = "viz-header-panel";
    // Named so the view-transition layer can stack it above the morphing
    // viz nodes; without a name the panel sits in the root snapshot,
    // which paints below named groups by default and gets covered.
    panel.style.viewTransitionName = "viz-header";
    panel.innerHTML = _section("Identity", _processIdentityRows(viz.header || {}));
    return panel;
  }

  global.MetaprocViz = {
    renderViz: renderViz,
    // Exported for tests + for downstream planes that want to preview layout:
    buildElkInput: buildElkInput,
    filterVizByPlanes: filterVizByPlanes,
    loadViewState: loadViewState,
    saveViewState: saveViewState,
    renderSidePanel: renderSidePanel,
    VIZ_ELK_OPTIONS: VIZ_ELK_OPTIONS,
    VIZ_ELK_NODE_OPTIONS: VIZ_ELK_NODE_OPTIONS,
    DEFAULT_NODE_DIMS: DEFAULT_NODE_DIMS,
  };
})(window);
