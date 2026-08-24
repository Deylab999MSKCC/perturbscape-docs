/* PerturbScape data explorer.
 *
 * A UMAP and a table of the same selection, always both on screen and linked:
 * selecting in either fills the shared detail panel. Backed by DuckDB-WASM
 * querying the published Parquet tables in place, so only the byte ranges a
 * query touches are fetched and the multi-million-row meta-program table stays
 * usable without downloading it.
 *
 * Markup:  <div class="ps-explorer" data-base="tables/"></div>
 */
(function () {
  "use strict";

  const DUCKDB = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";
  const PW = "pathways.parquet";
  const MP = "meta_programs.parquet";
  const UM = "umap.parquet";
  const GN = "genes.parquet";
  const PAGE = 50;
  const MAX_SUGGESTIONS = 12;
  const MAX_ZOOM = 8;
  const ZOOM_STEP = 1.08;
  const FOCUS_ZOOM = 2.2;
  const GENE_PREVIEW = 10;
  // Deep-link by stable HGNC id where we resolved one. Symbol-based links break
  // for genes HGNC has since renamed - NCL now reports under NUCLEOLIN - so the
  // symbol form is only a fallback for the handful with no id.
  const HGNC_ID = "https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/HGNC:";
  const HGNC_SEARCH = "https://www.genenames.org/tools/search/#!/?query=";

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

  const fmtP = (v) => v == null || Number.isNaN(v) ? "—"
    : v === 0 ? "0" : v < 1e-4 ? Number(v).toExponential(1) : Number(v).toFixed(4);
  const fmtTRS = (v) => v == null || Number.isNaN(v) ? "—"
    : v === 0 ? "0" : Number(v).toFixed(3);

  function rows(result) {
    return result.toArray().map((r) => {
      const o = r.toJSON();
      for (const k in o) {
        const v = o[k];
        if (typeof v === "bigint") o[k] = Number(v);
        else if (typeof v === "boolean") o[k] = v;
        else if (v && typeof v === "object" && typeof v.toString === "function"
                 && !(v instanceof Date)) o[k] = v.toString();
      }
      return o;
    });
  }

  /* ---------------------------------------------------------------- colour */

  // One continuous scale. TRS is already thresholded upstream - it is zero unless
  // the estimate was positive and significant - so the bottom of the ramp is
  // exactly "not significant" and no separate category is needed. Positive
  // values start partway up the ramp so even a small one is clearly not zero.
  // On white the ramp has to darken rather than brighten, so the two palettes
  // are not simple inversions of each other.
  const POSITIVE_FLOOR = 0.32;
  const PALETTES = {
    dark: {
      stops: [[68, 85, 106], [47, 130, 178], [56, 189, 248], [165, 243, 252]],
      ring: "#A5F3FC", hoverRing: "#B6C4D4",
    },
    light: {
      stops: [[196, 205, 218], [116, 173, 212], [26, 133, 193], [8, 63, 99]],
      ring: "#0B7FBF", hoverRing: "#46566C",
    },
  };

  const isDark = () => document.body.getAttribute("data-md-color-scheme") === "slate";
  const palette = () => PALETTES[isDark() ? "dark" : "light"];

  function ramp(t, stops) {
    t = Math.max(0, Math.min(1, t));
    const seg = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(seg));
    const f = seg - i;
    const a = stops[i], b = stops[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    ];
  }

  const rgb = (c, alpha) =>
    `rgba(${c[0]},${c[1]},${c[2]},${alpha == null ? 1 : alpha})`;

  function colourFor(pt, maxTRS, pal) {
    const v = pt.trs || 0;
    if (v <= 0) return rgb(pal.stops[0]);
    const frac = maxTRS > 0 ? Math.min(1, v / maxTRS) : 1;
    return rgb(ramp(POSITIVE_FLOOR + (1 - POSITIVE_FLOOR) * frac, pal.stops));
  }

  /* ------------------------------------------------------------------ boot */

  async function boot(el, setStatus) {
    setStatus("Loading query engine");
    const duckdb = await import(/* webpackIgnore: true */ DUCKDB);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(
      new Blob(['importScripts("' + bundle.mainWorker + '");'],
               { type: "text/javascript" }));
    const worker = new Worker(workerUrl);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    const base = new URL(el.getAttribute("data-base") || "tables/",
                         window.location.href).href;
    setStatus("Connecting to data tables");
    for (const f of [PW, MP, UM, GN]) {
      await db.registerFileURL(f, base + f, duckdb.DuckDBDataProtocol.HTTP, false);
    }
    const conn = await db.connect();
    const manifest = await fetch(base + "manifest.json").then((r) => r.json());
    return { conn, manifest, base };
  }

  /* ------------------------------------------------------------------- UI */

  const TEMPLATE = `
<div class="ps-x-filters">
  <div class="ps-x-field"><label for="psx-ds">Dataset</label>
    <select id="psx-ds"></select></div>
  <div class="ps-x-field" id="psx-ctx-field"><label for="psx-ctx">Context</label>
    <select id="psx-ctx"></select></div>
  <div class="ps-x-field"><label for="psx-trait">Trait</label>
    <select id="psx-trait"></select></div>
  <div class="ps-x-field ps-x-field--search">
    <label for="psx-pert">Find perturbation</label>
    <input id="psx-pert" type="text" placeholder="Start typing, e.g. TP53"
           autocomplete="off" role="combobox" aria-expanded="false"
           aria-controls="psx-suggest" aria-autocomplete="list">
    <ul class="ps-x-suggest" id="psx-suggest" role="listbox" hidden></ul>
  </div>
</div>

<div class="ps-x-toolbar">
  <span class="ps-x-summary" id="psx-summary">&mdash;</span>
  <span class="ps-x-spacer"></span>
  <button class="ps-x-btn" id="psx-dl-view" type="button">Download view</button>
  <button class="ps-x-btn" id="psx-dl-all" type="button">Download all</button>
</div>

<div class="ps-x-stage">
  <div class="ps-x-plotwrap" id="psx-plotwrap">
    <canvas id="psx-canvas"></canvas>
    <div class="ps-x-tooltip" id="psx-tooltip" hidden></div>
    <div class="ps-x-plotinfo">
      <div class="ps-x-legend">
        <span class="ps-x-legend-label">TRS</span>
        <span class="ps-x-legend-min">0</span>
        <span class="ps-x-legend-bar" id="psx-legend-bar"></span>
        <span class="ps-x-legend-max" id="psx-legend-max"></span>
      </div>
    </div>
    <button class="ps-x-reset" id="psx-reset-view" type="button">Reset view</button>
  </div>

  <aside class="ps-x-detail-panel" id="psx-detail"></aside>
</div>

<div class="ps-x-tablewrap">
  <div class="ps-x-tablebar">
    <span class="ps-x-tabletitle">Results</span>
    <span class="ps-x-tablecount" id="psx-tablecount"></span>
    <span class="ps-x-spacer"></span>
    <label class="ps-x-check"><input type="checkbox" id="psx-sig"> Significant only</label>
  </div>
  <div class="ps-x-scroll">
    <table class="ps-x-table"><thead><tr>
      <th data-col="perturbation">Perturbation<span class="ps-x-arrow"></span></th>
      <th data-col="trs" class="ps-x-num">TRS<span class="ps-x-arrow"></span></th>
      <th data-col="pvalue" class="ps-x-num">P<span class="ps-x-arrow"></span></th>
      <th class="ps-x-nosort">Top pathways</th>
    </tr></thead><tbody id="psx-body"></tbody></table>
  </div>
  <div class="ps-x-pager">
    <button class="ps-x-btn" id="psx-prev" type="button">Prev</button>
    <span class="ps-x-page" id="psx-page"></span>
    <button class="ps-x-btn" id="psx-next" type="button">Next</button>
  </div>
</div>`;

  function render(el, ctx) {
    const { conn, manifest } = ctx;
    el.innerHTML = TEMPLATE;
    const $ = (id) => el.querySelector("#" + id);

    const ui = {
      ds: $("psx-ds"), ctx: $("psx-ctx"), ctxField: $("psx-ctx-field"),
      trait: $("psx-trait"), pert: $("psx-pert"), suggest: $("psx-suggest"),
      sig: $("psx-sig"),
      plotwrap: $("psx-plotwrap"),
      canvas: $("psx-canvas"), tooltip: $("psx-tooltip"),
      detail: $("psx-detail"), summary: $("psx-summary"),
      body: $("psx-body"), page: $("psx-page"), tableCount: $("psx-tablecount"),
      prev: $("psx-prev"), next: $("psx-next"),
      dlView: $("psx-dl-view"), dlAll: $("psx-dl-all"),
      resetView: $("psx-reset-view"),
      legendBar: $("psx-legend-bar"), legendMax: $("psx-legend-max"),
    };

    let points = [];
    let maxTRS = 0;
    let selected = null;
    let hovered = null;
    let transform = { k: 1, x: 0, y: 0 };
    let bounds = null;
    let sortCol = "pvalue", sortAsc = true, page = 0;
    let suggestions = [], suggestIndex = -1;
    let tablePage = [];

    function paintLegend() {
      const p = palette();
      ui.legendBar.style.background = `linear-gradient(90deg, ${
        p.stops.map((c) => rgb(c)).join(", ")})`;
    }

    /* ---------------------------------------------------------- selectors */

    const natural = (a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true });

    function fillDatasets() {
      const list = Object.keys(manifest.datasets)
        .filter((d) => (manifest.datasets[d].umap_traits || []).length).sort();
      ui.ds.innerHTML = list.map((d) => `<option>${esc(d)}</option>`).join("");
      ui.ds.value = list[0];
    }

    function fillContexts() {
      const info = manifest.datasets[ui.ds.value] || { contexts: [] };
      const real = info.contexts.filter((c) => c !== ui.ds.value).slice().sort(natural);
      ui.ctxField.style.display = real.length ? "" : "none";
      const opts = real.length ? real : info.contexts;
      const keep = ui.ctx.value;
      ui.ctx.innerHTML = opts.map((c) => `<option>${esc(c)}</option>`).join("");
      ui.ctx.value = opts.includes(keep) ? keep : opts[0];
    }

    function fillTraits() {
      const traits = (manifest.datasets[ui.ds.value] || {}).umap_traits || [];
      const keep = ui.trait.value;
      ui.trait.innerHTML = traits.map((t) => `<option>${esc(t)}</option>`).join("");
      ui.trait.value = traits.includes(keep) ? keep : traits[0];
    }

    /* --------------------------------------------------------- data loads */

    async function loadPoints() {
      const d = ui.ds.value, c = ui.ctx.value, t = ui.trait.value;
      if (!d || !c || !t) return;
      ui.summary.textContent = "Loading…";
      ui.body.innerHTML =
        `<tr><td colspan="4" class="ps-x-empty">Loading…</td></tr>`;

      points = rows(await conn.query(`
        SELECT u.perturbation, u.umap1, u.umap2, u.trs,
               (p.perturbation IS NOT NULL) AS has_result,
               p.pvalue AS pvalue
        FROM '${UM}' u
        LEFT JOIN '${PW}' p
          ON u.dataset = p.dataset AND u.context = p.context
         AND u.perturbation = p.perturbation AND u.trait = p.trait
        WHERE u.dataset = ${q(d)} AND u.context = ${q(c)} AND u.trait = ${q(t)}
      `));

      maxTRS = points.reduce((m, p) => Math.max(m, p.trs || 0), 0);
      ui.legendMax.textContent = maxTRS ? maxTRS.toFixed(2) : "";

      const nSig = points.filter((p) => p.pvalue != null && p.pvalue <= 0.05).length;
      ui.summary.innerHTML =
        `<b>${points.length.toLocaleString()}</b> perturbations · ` +
        `<b>${nSig.toLocaleString()}</b> significant`;

      computeBounds();
      resetTransform();
      selected = null;
      page = 0;
      renderDetail(null);
      draw();
      // the table is always on screen, so it must be refreshed with the plot
      await drawTable();
    }

    function computeBounds() {
      if (!points.length) { bounds = null; return; }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of points) {
        if (p.umap1 < x0) x0 = p.umap1;
        if (p.umap1 > x1) x1 = p.umap1;
        if (p.umap2 < y0) y0 = p.umap2;
        if (p.umap2 > y1) y1 = p.umap2;
      }
      const padX = (x1 - x0) * 0.06 || 1, padY = (y1 - y0) * 0.06 || 1;
      bounds = { x0: x0 - padX, x1: x1 + padX, y0: y0 - padY, y1: y1 + padY };
    }

    const resetTransform = () => { transform = { k: 1, x: 0, y: 0 }; };

    /* -------------------------------------------------------------- canvas */

    function canvasSize() {
      const r = ui.canvas.getBoundingClientRect();
      return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    }

    function project(p) {
      const { w, h } = canvasSize();
      const sx = (p.umap1 - bounds.x0) / (bounds.x1 - bounds.x0) * w;
      const sy = h - (p.umap2 - bounds.y0) / (bounds.y1 - bounds.y0) * h;
      return { x: sx * transform.k + transform.x, y: sy * transform.k + transform.y };
    }

    function draw() {
      const canvas = ui.canvas;
      const { w, h } = canvasSize();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const g = canvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!bounds || !points.length) return;

      const pal = palette();
      const term = ui.pert.value.trim().toLowerCase();
      const r = 3.1 * Math.min(2.2, Math.max(0.75, transform.k));

      const order = points.slice().sort((a, b) => (a.trs || 0) - (b.trs || 0));
      for (const p of order) {
        const s = project(p);
        if (s.x < -20 || s.y < -20 || s.x > w + 20 || s.y > h + 20) continue;
        const match = term && p.perturbation.toLowerCase().includes(term);
        // size reinforces the colour, so a scored point is legible at a glance
        const pr = (p.trs || 0) > 0 ? r * 1.4 : r;
        g.beginPath();
        g.arc(s.x, s.y, match ? pr * 1.6 : pr, 0, Math.PI * 2);
        g.fillStyle = colourFor(p, maxTRS, pal);
        g.globalAlpha = term && !match ? 0.15 : 1;
        g.fill();
        if (match) {
          g.globalAlpha = 1;
          g.lineWidth = 1.2;
          g.strokeStyle = pal.ring;
          g.stroke();
        }
      }
      g.globalAlpha = 1;

      for (const p of [hovered, selected]) {
        if (!p) continue;
        const s = project(p);
        g.beginPath();
        g.arc(s.x, s.y, r + 4.5, 0, Math.PI * 2);
        g.lineWidth = p === selected ? 2 : 1.2;
        g.strokeStyle = p === selected ? pal.ring : pal.hoverRing;
        g.stroke();
      }
    }

    function pick(mx, my) {
      if (!bounds) return null;
      let best = null, bestD = 144;
      for (const p of points) {
        const s = project(p);
        const d = (s.x - mx) ** 2 + (s.y - my) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    }

    function focusOn(p) {
      if (!bounds) return;
      const { w, h } = canvasSize();
      // enough to pick the point out, not so much that context is lost
      transform.k = Math.min(Math.max(transform.k, FOCUS_ZOOM), MAX_ZOOM);
      const sx = (p.umap1 - bounds.x0) / (bounds.x1 - bounds.x0) * w;
      const sy = h - (p.umap2 - bounds.y0) / (bounds.y1 - bounds.y0) * h;
      transform.x = w / 2 - sx * transform.k;
      transform.y = h / 2 - sy * transform.k;
      draw();
    }

    /* ------------------------------------------------------------- detail */

    function select(p) {
      selected = p;
      renderDetail(p);
      draw();
      markSelectedRow();
    }

    function renderDetail(p) {
      if (!p) {
        ui.detail.innerHTML =
          `<div class="ps-x-detail-empty">Select a point on the plot, or a row in
           the table below, to see its meta-program genes and enriched
           pathways.</div>`;
        return;
      }
      const sig = p.pvalue != null && p.pvalue <= 0.05;
      ui.detail.innerHTML = `
        <div class="ps-x-detail-head">
          <span class="ps-x-detail-eyebrow">${esc(ui.ds.value)}${
            ui.ctx.value !== ui.ds.value ? " · " + esc(ui.ctx.value) : ""}</span>
          <h3>${esc(p.perturbation)}</h3>
          <p class="ps-x-detail-trait">${esc(ui.trait.value)}</p>
          <dl class="ps-x-stats">
            <div><dt>TRS</dt><dd class="${sig ? "ps-x-sig" : "ps-x-nsig"}">${fmtTRS(p.trs)}</dd></div>
            <div><dt>P</dt><dd class="${sig ? "ps-x-sig" : "ps-x-nsig"}">${fmtP(p.pvalue)}</dd></div>
          </dl>
          <button class="ps-x-locate" id="psx-locate" type="button">Centre on plot</button>
        </div>
        <div class="ps-x-detail-body" id="psx-detail-body">
          ${p.has_result ? '<div class="ps-x-detail-empty">Loading…</div>'
            : '<div class="ps-x-detail-empty">No enrichment results were produced for this perturbation and trait, so there are no meta-program genes or pathways to show.</div>'}
        </div>`;
      const locate = el.querySelector("#psx-locate");
      if (locate) locate.addEventListener("click", () => {
        focusOn(p);
        ui.plotwrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      if (p.has_result) loadDetail(p);
    }

    async function loadDetail(p) {
      // built per alias rather than string-rewritten, so a perturbation name can
      // never collide with the column names being qualified
      const clause = (a) => [
        `${a}dataset = ${q(ui.ds.value)}`,
        `${a}context = ${q(ui.ctx.value)}`,
        `${a}perturbation = ${q(p.perturbation)}`,
        `${a}trait = ${q(ui.trait.value)}`,
      ].join(" AND ");

      const [pwRows, genes] = await Promise.all([
        conn.query(`SELECT pathways, neglog10p_pathways FROM '${PW}'
                    WHERE ${clause("")} LIMIT 1`),
        conn.query(`SELECT m.gene, m.rank, g.hgnc_id
                    FROM '${MP}' m LEFT JOIN '${GN}' g ON m.gene = g.gene
                    WHERE ${clause("m.")}
                    ORDER BY m.rank LIMIT 100`),
      ]);
      if (selected !== p) return;
      const box = el.querySelector("#psx-detail-body");
      if (!box) return;
      const pw = rows(pwRows)[0] || {};
      const gs = rows(genes);
      box.innerHTML = `
        <section><h4>Top meta-program genes</h4>
          <div class="ps-x-genes" id="psx-genes"></div></section>
        <section><h4>Enriched pathways</h4>
          <div class="ps-x-pathways">${pathwayPanel(pw)}</div></section>`;
      renderGenes(el.querySelector("#psx-genes"), gs, false);
    }

    const geneUrl = (g) => g.hgnc_id
      ? HGNC_ID + g.hgnc_id
      : HGNC_SEARCH + encodeURIComponent(g.gene);

    function geneChip(g, i) {
      return `<a class="ps-x-gene ${i < GENE_PREVIEW ? "ps-x-gene--top" : ""}"
                 href="${geneUrl(g)}" target="_blank" rel="noopener noreferrer"
                 title="${esc(g.gene)} on genenames.org">${esc(g.gene)}<span
                 class="ps-x-rank">${Math.round(g.rank)}</span></a>`;
    }

    // only the top few are shown up front; the rest are one click away
    function renderGenes(box, gs, expanded) {
      if (!box) return;
      if (!gs.length) {
        box.innerHTML = '<span class="ps-x-nsig">No meta-program genes recorded.</span>';
        return;
      }
      const shown = expanded ? gs : gs.slice(0, GENE_PREVIEW);
      const hidden = gs.length - shown.length;
      box.innerHTML = shown.map(geneChip).join("") +
        (hidden > 0
          ? `<button class="ps-x-genes-more" type="button" data-expand="1">… show all ${gs.length}</button>`
          : (gs.length > GENE_PREVIEW
              ? `<button class="ps-x-genes-more" type="button" data-expand="0">show top ${GENE_PREVIEW}</button>`
              : ""));
      const btn = box.querySelector(".ps-x-genes-more");
      if (btn) btn.addEventListener("click", () =>
        renderGenes(box, gs, btn.getAttribute("data-expand") === "1"));
    }

    function pathwayPanel(row) {
      if (!row || !row.pathways)
        return '<span class="ps-x-nsig">No enriched pathways.</span>';
      const names = row.pathways.split(";").map((s) => s.trim()).filter(Boolean);
      const vals = (row.neglog10p_pathways || "").split(";")
        .map((s) => parseFloat(s.trim()));
      const finite = vals.filter((v) => !Number.isNaN(v));
      const max = finite.length ? Math.max.apply(null, finite) : 1;
      return names.map((n, i) => {
        const v = vals[i];
        const pct = Number.isNaN(v) ? 0 : Math.round((v / max) * 100);
        return `<div class="ps-x-pw">
          <span class="ps-x-pw-name">${esc(n)}</span>
          <span class="ps-x-pw-val">${Number.isNaN(v) ? "—" : v.toFixed(2)}</span>
          <span class="ps-x-pw-bar"><span style="width:${pct}%"></span></span>
        </div>`;
      }).join("");
    }

    /* --------------------------------------------------------- suggestions */

    function closeSuggest() {
      ui.suggest.hidden = true;
      ui.suggest.innerHTML = "";
      ui.pert.setAttribute("aria-expanded", "false");
      suggestions = []; suggestIndex = -1;
    }

    function openSuggest() {
      const term = ui.pert.value.trim().toLowerCase();
      if (!term) return closeSuggest();

      const starts = [], contains = [];
      for (const p of points) {
        const name = p.perturbation.toLowerCase();
        const i = name.indexOf(term);
        if (i === 0) starts.push(p);
        else if (i > 0) contains.push(p);
      }
      const rank = (a, b) => (b.trs || 0) - (a.trs || 0) ||
        natural(a.perturbation, b.perturbation);
      suggestions = starts.sort(rank).concat(contains.sort(rank))
        .slice(0, MAX_SUGGESTIONS);
      suggestIndex = -1;

      if (!suggestions.length) {
        ui.suggest.innerHTML =
          `<li class="ps-x-suggest-empty">No perturbation matches “${
            esc(ui.pert.value.trim())}”</li>`;
        ui.suggest.hidden = false;
        ui.pert.setAttribute("aria-expanded", "true");
        return;
      }

      ui.suggest.innerHTML = suggestions.map((p, i) => {
        const sig = p.pvalue != null && p.pvalue <= 0.05;
        const name = p.perturbation;
        const at = name.toLowerCase().indexOf(term);
        const marked = at < 0 ? esc(name)
          : esc(name.slice(0, at)) + "<mark>" + esc(name.slice(at, at + term.length)) +
            "</mark>" + esc(name.slice(at + term.length));
        return `<li role="option" data-i="${i}" aria-selected="false">
          <span class="ps-x-suggest-name">${marked}</span>
          <span class="ps-x-suggest-trs ${sig ? "ps-x-sig" : "ps-x-nsig"}">${
            p.has_result ? fmtTRS(p.trs) : "—"}</span></li>`;
      }).join("");
      ui.suggest.hidden = false;
      ui.pert.setAttribute("aria-expanded", "true");

      ui.suggest.querySelectorAll("li[data-i]").forEach((li) => {
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          choose(suggestions[Number(li.getAttribute("data-i"))]);
        });
      });
    }

    function highlightSuggestion(next) {
      const items = ui.suggest.querySelectorAll("li[data-i]");
      if (!items.length) return;
      suggestIndex = (next + items.length) % items.length;
      items.forEach((li, i) => {
        const on = i === suggestIndex;
        li.classList.toggle("is-active", on);
        li.setAttribute("aria-selected", on ? "true" : "false");
        if (on) li.scrollIntoView({ block: "nearest" });
      });
    }

    function choose(p) {
      if (!p) return;
      ui.pert.value = p.perturbation;
      closeSuggest();
      page = 0;
      select(p);
      focusOn(p);
      drawTable();
    }

    /* -------------------------------------------------------------- table */

    function tableRows() {
      const term = ui.pert.value.trim().toLowerCase();
      let list = points.filter((p) => p.has_result);
      if (ui.sig.checked) list = list.filter((p) => p.pvalue != null && p.pvalue <= 0.05);
      if (term) list = list.filter((p) => p.perturbation.toLowerCase().includes(term));
      const dir = sortAsc ? 1 : -1;
      return list.sort((a, b) => {
        const x = a[sortCol], y = b[sortCol];
        if (typeof x === "number" || typeof y === "number")
          return ((x == null ? Infinity : x) - (y == null ? Infinity : y)) * dir;
        return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
      });
    }

    function markSelectedRow() {
      ui.body.querySelectorAll("tr[data-idx]").forEach((tr) => {
        const p = tablePage[Number(tr.getAttribute("data-idx"))];
        tr.classList.toggle("is-selected", p === selected);
      });
    }

    async function drawTable() {
      const all = tableRows();
      const pages = Math.max(1, Math.ceil(all.length / PAGE));
      if (page >= pages) page = pages - 1;
      tablePage = all.slice(page * PAGE, page * PAGE + PAGE);

      ui.tableCount.textContent = all.length
        ? `${all.length.toLocaleString()} row${all.length === 1 ? "" : "s"}`
        : "no rows";

      if (!tablePage.length) {
        ui.body.innerHTML =
          `<tr><td colspan="4" class="ps-x-empty">${
            points.length ? "No perturbations match the current filters."
                          : "No results for this selection."}</td></tr>`;
      } else {
        const names = tablePage.map((p) => q(p.perturbation)).join(",");
        const pwMap = {};
        if (names) {
          const res = rows(await conn.query(`
            SELECT perturbation, pathways FROM '${PW}'
            WHERE dataset = ${q(ui.ds.value)} AND context = ${q(ui.ctx.value)}
              AND trait = ${q(ui.trait.value)} AND perturbation IN (${names})`));
          for (const r of res) pwMap[r.perturbation] = r.pathways;
        }
        ui.body.innerHTML = tablePage.map((p, i) => {
          const sig = p.pvalue != null && p.pvalue <= 0.05;
          const pw = (pwMap[p.perturbation] || "").split(";")
            .slice(0, 3).map((s) => s.trim()).filter(Boolean).join(" · ");
          return `<tr data-idx="${i}">
            <td class="ps-x-mono"><b>${esc(p.perturbation)}</b></td>
            <td class="ps-x-num ${sig ? "ps-x-sig" : "ps-x-nsig"}">${fmtTRS(p.trs)}</td>
            <td class="ps-x-num ${sig ? "ps-x-sig" : "ps-x-nsig"}">${fmtP(p.pvalue)}</td>
            <td><div class="ps-x-trunc">${pw ? esc(pw) : "—"}</div></td>
          </tr>`;
        }).join("");
        ui.body.querySelectorAll("tr[data-idx]").forEach((tr) => {
          tr.addEventListener("click", () => {
            const p = tablePage[Number(tr.getAttribute("data-idx"))];
            select(p);
            focusOn(p);          // bring the plot to the row you picked
          });
        });
        markSelectedRow();
      }
      ui.page.textContent = `Page ${page + 1} of ${pages.toLocaleString()}`;
      ui.prev.disabled = page === 0;
      ui.next.disabled = page >= pages - 1;
      el.querySelectorAll("th[data-col]").forEach((th) => {
        const a = th.querySelector(".ps-x-arrow");
        if (a) a.textContent = th.getAttribute("data-col") === sortCol
          ? (sortAsc ? " ▲" : " ▼") : "";
      });
    }

    /* ---------------------------------------------------------- downloads */

    const csvCell = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    function saveCSV(name, cols, data) {
      const csv = [cols.join(",")]
        .concat(data.map((r) => cols.map((c) => csvCell(r[c])).join(","))).join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    async function withBusy(btn, fn) {
      const old = btn.textContent;
      btn.disabled = true; btn.textContent = "Preparing…";
      try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
    }

    const downloadView = () => withBusy(ui.dlView, async () => {
      const list = tableRows();
      const names = list.map((p) => q(p.perturbation));
      const pwMap = {};
      for (let i = 0; i < names.length; i += 800) {
        const chunk = names.slice(i, i + 800).join(",");
        if (!chunk) continue;
        const res = rows(await conn.query(`
          SELECT perturbation, pathways, neglog10p_pathways FROM '${PW}'
          WHERE dataset = ${q(ui.ds.value)} AND context = ${q(ui.ctx.value)}
            AND trait = ${q(ui.trait.value)} AND perturbation IN (${chunk})`));
        for (const r of res) pwMap[r.perturbation] = r;
      }
      saveCSV(
        `perturbscape_${ui.ds.value}_${ui.trait.value}`.replace(/[^\w-]+/g, "_") + ".csv",
        ["dataset", "context", "trait", "perturbation", "trs", "pvalue",
         "umap1", "umap2", "pathways", "neglog10p_pathways"],
        list.map((p) => ({
          dataset: ui.ds.value, context: ui.ctx.value, trait: ui.trait.value,
          perturbation: p.perturbation, trs: p.trs, pvalue: p.pvalue,
          umap1: p.umap1, umap2: p.umap2,
          pathways: (pwMap[p.perturbation] || {}).pathways,
          neglog10p_pathways: (pwMap[p.perturbation] || {}).neglog10p_pathways,
        })));
    });

    const downloadAll = () => withBusy(ui.dlAll, async () => {
      const data = rows(await conn.query(`
        SELECT dataset, context, perturbation, trait, trs, pvalue,
               pathways, neglog10p_pathways
        FROM '${PW}' ORDER BY dataset, trait, pvalue`));
      saveCSV("perturbscape_all_results.csv",
        ["dataset", "context", "perturbation", "trait", "trs", "pvalue",
         "pathways", "neglog10p_pathways"], data);
    });

    /* ------------------------------------------------------------- events */

    ui.canvas.addEventListener("mousemove", (e) => {
      const r = ui.canvas.getBoundingClientRect();
      const p = pick(e.clientX - r.left, e.clientY - r.top);
      if (p !== hovered) { hovered = p; draw(); }
      if (p) {
        ui.tooltip.hidden = false;
        ui.tooltip.innerHTML =
          `<b>${esc(p.perturbation)}</b><span>TRS ${fmtTRS(p.trs)}` +
          (p.has_result ? ` · P ${fmtP(p.pvalue)}` : " · no results") + `</span>`;
        const s = project(p);
        ui.tooltip.style.left = s.x + "px";
        ui.tooltip.style.top = (s.y - 12) + "px";
      } else ui.tooltip.hidden = true;
    });
    ui.canvas.addEventListener("mouseleave", () => {
      hovered = null; ui.tooltip.hidden = true; draw();
    });
    ui.canvas.addEventListener("click", (e) => {
      const r = ui.canvas.getBoundingClientRect();
      const p = pick(e.clientX - r.left, e.clientY - r.top);
      if (p) select(p);
    });
    ui.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = ui.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      // normalised so a trackpad flick and a mouse notch behave comparably
      const step = Math.max(-1, Math.min(1, e.deltaY / 120));
      const f = Math.pow(ZOOM_STEP, -step);
      const k = Math.max(1, Math.min(MAX_ZOOM, transform.k * f));
      const ratio = k / transform.k;
      transform.x = mx - (mx - transform.x) * ratio;
      transform.y = my - (my - transform.y) * ratio;
      transform.k = k;
      draw();
    }, { passive: false });

    let dragging = null;
    ui.canvas.addEventListener("mousedown", (e) => {
      dragging = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
      ui.canvas.classList.add("is-dragging");
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      transform.x = dragging.tx + (e.clientX - dragging.x);
      transform.y = dragging.ty + (e.clientY - dragging.y);
      draw();
    });
    window.addEventListener("mouseup", () => {
      dragging = null; ui.canvas.classList.remove("is-dragging");
    });

    ui.resetView.addEventListener("click", () => { resetTransform(); draw(); });

    ui.ds.addEventListener("change", () => { fillContexts(); fillTraits(); loadPoints(); });
    ui.ctx.addEventListener("change", loadPoints);
    ui.trait.addEventListener("change", loadPoints);

    let t;
    ui.pert.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { openSuggest(); page = 0; draw(); drawTable(); }, 130);
    });
    ui.pert.addEventListener("focus", () => { if (ui.pert.value.trim()) openSuggest(); });
    ui.pert.addEventListener("blur", () => setTimeout(closeSuggest, 140));
    ui.pert.addEventListener("keydown", (e) => {
      if (ui.suggest.hidden) {
        if (e.key === "ArrowDown") { openSuggest(); e.preventDefault(); }
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); highlightSuggestion(suggestIndex + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlightSuggestion(suggestIndex - 1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        choose(suggestions[suggestIndex >= 0 ? suggestIndex : 0]);
      } else if (e.key === "Escape") closeSuggest();
    });

    ui.sig.addEventListener("change", () => { page = 0; drawTable(); });
    ui.prev.addEventListener("click", () => { if (page > 0) { page--; drawTable(); } });
    ui.next.addEventListener("click", () => { page++; drawTable(); });
    ui.dlView.addEventListener("click", downloadView);
    ui.dlAll.addEventListener("click", downloadAll);
    el.querySelectorAll("th[data-col]").forEach((th) => {
      th.addEventListener("click", () => {
        const c = th.getAttribute("data-col");
        if (sortCol === c) sortAsc = !sortAsc;
        else { sortCol = c; sortAsc = c !== "trs"; }
        page = 0; drawTable();
      });
    });

    let rt;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(draw, 150);
    });

    // the plot is a canvas, so it has to be repainted when the palette flips
    new MutationObserver(() => { paintLegend(); draw(); })
      .observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });

    fillDatasets(); fillContexts(); fillTraits();
    paintLegend();
    renderDetail(null);
    return loadPoints();
  }

  /* ------------------------------------------------------------------ init */

  async function init() {
    const el = document.querySelector(".ps-explorer");
    if (!el || el.dataset.psReady) return;
    el.dataset.psReady = "1";
    document.body.classList.add("ps-wide");

    const setStatus = (msg) => {
      el.innerHTML = '<div class="ps-x-boot"><span class="ps-x-spinner"></span>' +
        esc(msg) + "…</div>";
    };
    setStatus("Starting");

    try {
      const ctx = await boot(el, setStatus);
      await render(el, ctx);
    } catch (err) {
      el.innerHTML = '<div class="ps-x-boot ps-x-error">' +
        "Could not start the data explorer.<br><code>" +
        esc(err && err.message ? err.message : err) + "</code><br><br>" +
        '<span style="color:var(--ps-muted)">The explorer needs WebAssembly and ' +
        "loads its query engine from a CDN. The tables can also be downloaded " +
        "directly from the Schema and Downloads page.</span></div>";
      if (window.console) console.error("[perturbscape] explorer failed", err);
    }
  }

  if (typeof document$ !== "undefined") document$.subscribe(init);
  else if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
