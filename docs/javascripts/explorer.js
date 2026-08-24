/* PerturbScape data explorer.
 *
 * UMAP-first view of the published results, backed by DuckDB-WASM querying the
 * Parquet tables in place. Only the byte ranges a query touches are fetched, so
 * the multi-million-row meta-program table stays usable without downloading it.
 *
 * Markup:  <div class="ps-explorer" data-base="tables/"></div>
 */
(function () {
  "use strict";

  const DUCKDB = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";
  const PW = "pathways.parquet";
  const MP = "meta_programs.parquet";
  const UM = "umap.parquet";
  const PAGE = 50;

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

  // TRS 0 means "not significant" and is deliberately dim; positive values ramp
  // through the site accent so significant perturbations read as lit up.
  const STOPS = [[46, 92, 122], [56, 189, 248], [165, 243, 252]];
  const ZERO = [42, 54, 70];
  const NO_RESULT = [30, 39, 51];

  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    const seg = t * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(seg));
    const f = seg - i;
    const a = STOPS[i], b = STOPS[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    ];
  }

  const rgb = (c, alpha) => `rgba(${c[0]},${c[1]},${c[2]},${alpha == null ? 1 : alpha})`;

  function colourFor(pt, maxTRS) {
    if (!pt.has_result) return rgb(NO_RESULT, 0.55);
    if (!pt.trs || pt.trs <= 0) return rgb(ZERO, 0.85);
    return rgb(ramp(maxTRS > 0 ? pt.trs / maxTRS : 0));
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
    for (const f of [PW, MP, UM]) {
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
  <div class="ps-x-field"><label for="psx-pert">Find perturbation</label>
    <input id="psx-pert" type="search" placeholder="e.g. TP53" autocomplete="off"></div>
</div>
<div class="ps-x-toolbar">
  <div class="ps-x-views" role="tablist">
    <button class="ps-x-view is-active" id="psx-view-umap" type="button">UMAP</button>
    <button class="ps-x-view" id="psx-view-table" type="button">Table</button>
  </div>
  <span class="ps-x-summary" id="psx-summary">&mdash;</span>
  <span class="ps-x-spacer"></span>
  <label class="ps-x-check" id="psx-sig-wrap"><input type="checkbox" id="psx-sig"> Significant only</label>
  <button class="ps-x-btn" id="psx-dl-view" type="button">Download view</button>
  <button class="ps-x-btn" id="psx-dl-all" type="button">Download all</button>
</div>

<div class="ps-x-stage" id="psx-stage">
  <div class="ps-x-plotwrap">
    <canvas id="psx-canvas"></canvas>
    <div class="ps-x-tooltip" id="psx-tooltip" hidden></div>
    <div class="ps-x-plotinfo">
      <div class="ps-x-legend">
        <span class="ps-x-legend-label">TRS</span>
        <span class="ps-x-legend-bar" id="psx-legend-bar"></span>
        <span class="ps-x-legend-max" id="psx-legend-max"></span>
      </div>
      <div class="ps-x-legend-keys">
        <span><i class="ps-x-swatch ps-x-swatch--zero"></i>not significant</span>
        <span><i class="ps-x-swatch ps-x-swatch--none"></i>no results</span>
      </div>
    </div>
    <button class="ps-x-reset" id="psx-reset-view" type="button">Reset view</button>
  </div>
  <aside class="ps-x-detail-panel" id="psx-detail"></aside>
</div>

<div class="ps-x-tablewrap" id="psx-tablewrap" hidden>
  <div class="ps-x-scroll">
    <table class="ps-x-table"><thead><tr>
      <th data-col="perturbation">Perturbation<span class="ps-x-arrow"></span></th>
      <th data-col="trait">Trait<span class="ps-x-arrow"></span></th>
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
      trait: $("psx-trait"), pert: $("psx-pert"), sig: $("psx-sig"),
      sigWrap: $("psx-sig-wrap"),
      viewUmap: $("psx-view-umap"), viewTable: $("psx-view-table"),
      stage: $("psx-stage"), tableWrap: $("psx-tablewrap"),
      canvas: $("psx-canvas"), tooltip: $("psx-tooltip"),
      detail: $("psx-detail"), summary: $("psx-summary"),
      body: $("psx-body"), page: $("psx-page"),
      prev: $("psx-prev"), next: $("psx-next"),
      dlView: $("psx-dl-view"), dlAll: $("psx-dl-all"),
      resetView: $("psx-reset-view"),
      legendBar: $("psx-legend-bar"), legendMax: $("psx-legend-max"),
    };

    let view = "umap";
    let points = [];          // current umap selection
    let maxTRS = 0;
    let selected = null;
    let hovered = null;
    let transform = { k: 1, x: 0, y: 0 };
    let bounds = null;
    let sortCol = "pvalue", sortAsc = true, page = 0;

    ui.legendBar.style.background =
      `linear-gradient(90deg, ${rgb(STOPS[0])}, ${rgb(STOPS[1])}, ${rgb(STOPS[2])})`;

    /* ---------------------------------------------------------- selectors */

    function datasetsWithUmap() {
      return Object.keys(manifest.datasets)
        .filter((d) => (manifest.datasets[d].umap_traits || []).length)
        .sort();
    }

    function fillDatasets() {
      const list = datasetsWithUmap();
      ui.ds.innerHTML = list.map((d) => `<option>${esc(d)}</option>`).join("");
      ui.ds.value = list[0];
    }

    // D3 / D7 / D11 must not sort as D11 / D3 / D7
    const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

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
      const info = manifest.datasets[ui.ds.value] || {};
      const traits = info.umap_traits || [];
      const keep = ui.trait.value;
      ui.trait.innerHTML = traits.map((t) => `<option>${esc(t)}</option>`).join("");
      ui.trait.value = traits.includes(keep) ? keep : traits[0];
    }

    /* --------------------------------------------------------- data loads */

    async function loadPoints() {
      const d = ui.ds.value, c = ui.ctx.value, t = ui.trait.value;
      if (!d || !c || !t) return;
      ui.summary.textContent = "Loading…";

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
      const nNo = points.filter((p) => !p.has_result).length;
      ui.summary.innerHTML =
        `<b>${points.length.toLocaleString()}</b> perturbations · ` +
        `<b>${nSig.toLocaleString()}</b> significant` +
        (nNo ? ` · ${nNo.toLocaleString()} without results` : "");

      computeBounds();
      resetTransform();
      selected = null;
      renderDetail(null);
      draw();
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
      // flip y so the plot reads the same way round as ggplot output
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

      const term = ui.pert.value.trim().toLowerCase();
      const r = 3.1 * Math.min(2.2, Math.max(0.75, transform.k));

      // dim first, lit second, so significant points are never buried
      const order = points.slice().sort((a, b) => (a.trs || 0) - (b.trs || 0));
      for (const p of order) {
        const s = project(p);
        if (s.x < -20 || s.y < -20 || s.x > w + 20 || s.y > h + 20) continue;
        const match = term && p.perturbation.toLowerCase().includes(term);
        g.beginPath();
        g.arc(s.x, s.y, match ? r * 1.7 : r, 0, Math.PI * 2);
        g.fillStyle = colourFor(p, maxTRS);
        g.globalAlpha = term && !match ? 0.18 : 1;
        g.fill();
        if (match) {
          g.globalAlpha = 1;
          g.lineWidth = 1.2;
          g.strokeStyle = "#A5F3FC";
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
        g.strokeStyle = p === selected ? "#A5F3FC" : "#8B9BAF";
        g.stroke();
      }
    }

    function pick(mx, my) {
      if (!bounds) return null;
      let best = null, bestD = 12 * 12;
      for (const p of points) {
        const s = project(p);
        const d = (s.x - mx) ** 2 + (s.y - my) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    }

    /* ------------------------------------------------------------- detail */

    function renderDetail(p) {
      if (!p) {
        ui.detail.innerHTML =
          `<div class="ps-x-detail-empty">Select a point to see its
           meta-program genes and enriched pathways.</div>`;
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
        </div>
        <div class="ps-x-detail-body" id="psx-detail-body">
          ${p.has_result ? '<div class="ps-x-detail-empty">Loading…</div>'
            : '<div class="ps-x-detail-empty">No enrichment results were produced for this perturbation and trait.</div>'}
        </div>`;
      if (p.has_result) loadDetail(p);
    }

    async function loadDetail(p) {
      const d = ui.ds.value, c = ui.ctx.value, t = ui.trait.value;
      const where = `dataset = ${q(d)} AND context = ${q(c)} ` +
                    `AND perturbation = ${q(p.perturbation)} AND trait = ${q(t)}`;
      const [pwRows, genes] = await Promise.all([
        conn.query(`SELECT pathways, neglog10p_pathways FROM '${PW}' WHERE ${where} LIMIT 1`),
        conn.query(`SELECT gene, rank FROM '${MP}' WHERE ${where} ORDER BY rank LIMIT 100`),
      ]);
      if (selected !== p) return;   // selection moved on while we waited
      const box = el.querySelector("#psx-detail-body");
      if (!box) return;
      const pw = rows(pwRows)[0] || {};
      const gs = rows(genes);
      box.innerHTML = `
        <section><h4>Top meta-program genes</h4>
          <div class="ps-x-genes">${
            gs.length ? gs.map((g, i) =>
              `<span class="ps-x-gene ${i < 10 ? "ps-x-gene--top" : ""}">${
                esc(g.gene)}<span class="ps-x-rank">${Math.round(g.rank)}</span></span>`
            ).join("")
            : '<span class="ps-x-nsig">No meta-program genes recorded.</span>'}
          </div></section>
        <section><h4>Enriched pathways</h4>
          <div class="ps-x-pathways">${pathwayPanel(pw)}</div></section>`;
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

    let tableCache = [];

    async function drawTable() {
      tableCache = tableRows();
      const pages = Math.max(1, Math.ceil(tableCache.length / PAGE));
      if (page >= pages) page = pages - 1;
      const slice = tableCache.slice(page * PAGE, page * PAGE + PAGE);

      if (!slice.length) {
        ui.body.innerHTML =
          `<tr><td colspan="5" class="ps-x-empty">No perturbations match.</td></tr>`;
      } else {
        // pathway text is only needed for the visible page
        const names = slice.map((p) => q(p.perturbation)).join(",");
        const pwMap = {};
        if (names) {
          const res = rows(await conn.query(`
            SELECT perturbation, pathways FROM '${PW}'
            WHERE dataset = ${q(ui.ds.value)} AND context = ${q(ui.ctx.value)}
              AND trait = ${q(ui.trait.value)} AND perturbation IN (${names})`));
          for (const r of res) pwMap[r.perturbation] = r.pathways;
        }
        ui.body.innerHTML = slice.map((p, i) => {
          const sig = p.pvalue != null && p.pvalue <= 0.05;
          const pw = (pwMap[p.perturbation] || "").split(";")
            .slice(0, 3).map((s) => s.trim()).filter(Boolean).join(" · ");
          return `<tr data-idx="${i}">
            <td class="ps-x-mono"><b>${esc(p.perturbation)}</b></td>
            <td>${esc(ui.trait.value)}</td>
            <td class="ps-x-num ${sig ? "ps-x-sig" : "ps-x-nsig"}">${fmtTRS(p.trs)}</td>
            <td class="ps-x-num ${sig ? "ps-x-sig" : "ps-x-nsig"}">${fmtP(p.pvalue)}</td>
            <td><div class="ps-x-trunc">${pw ? esc(pw) : "—"}</div></td>
          </tr>`;
        }).join("");
        ui.body.querySelectorAll("tr[data-idx]").forEach((tr) => {
          tr.addEventListener("click", () => {
            const p = slice[Number(tr.getAttribute("data-idx"))];
            selected = p;
            setView("umap");
            focusOn(p);
            renderDetail(p);
          });
        });
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

    function focusOn(p) {
      const { w, h } = canvasSize();
      transform.k = Math.max(transform.k, 2.4);
      const sx = (p.umap1 - bounds.x0) / (bounds.x1 - bounds.x0) * w;
      const sy = h - (p.umap2 - bounds.y0) / (bounds.y1 - bounds.y0) * h;
      transform.x = w / 2 - sx * transform.k;
      transform.y = h / 2 - sy * transform.k;
      draw();
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

    async function downloadView() {
      const btn = ui.dlView, old = btn.textContent;
      btn.disabled = true; btn.textContent = "Preparing…";
      try {
        const list = tableRows();
        const names = list.map((p) => q(p.perturbation));
        let pwMap = {};
        for (let i = 0; i < names.length; i += 800) {
          const chunk = names.slice(i, i + 800).join(",");
          const res = rows(await conn.query(`
            SELECT perturbation, pathways, neglog10p_pathways FROM '${PW}'
            WHERE dataset = ${q(ui.ds.value)} AND context = ${q(ui.ctx.value)}
              AND trait = ${q(ui.trait.value)} AND perturbation IN (${chunk})`));
          for (const r of res) pwMap[r.perturbation] = r;
        }
        const data = list.map((p) => ({
          dataset: ui.ds.value, context: ui.ctx.value, trait: ui.trait.value,
          perturbation: p.perturbation, trs: p.trs, pvalue: p.pvalue,
          umap1: p.umap1, umap2: p.umap2,
          pathways: (pwMap[p.perturbation] || {}).pathways,
          neglog10p_pathways: (pwMap[p.perturbation] || {}).neglog10p_pathways,
        }));
        saveCSV(
          `perturbscape_${ui.ds.value}_${ui.trait.value}`.replace(/[^\w-]+/g, "_") + ".csv",
          ["dataset", "context", "trait", "perturbation", "trs", "pvalue",
           "umap1", "umap2", "pathways", "neglog10p_pathways"], data);
      } finally { btn.disabled = false; btn.textContent = old; }
    }

    async function downloadAll() {
      const btn = ui.dlAll, old = btn.textContent;
      btn.disabled = true; btn.textContent = "Preparing…";
      try {
        const data = rows(await conn.query(`
          SELECT dataset, context, perturbation, trait, trs, pvalue,
                 pathways, neglog10p_pathways
          FROM '${PW}' ORDER BY dataset, trait, pvalue`));
        saveCSV("perturbscape_all_results.csv",
          ["dataset", "context", "perturbation", "trait", "trs", "pvalue",
           "pathways", "neglog10p_pathways"], data);
      } finally { btn.disabled = false; btn.textContent = old; }
    }

    /* ------------------------------------------------------------- events */

    function setView(v) {
      view = v;
      const isUmap = v === "umap";
      ui.viewUmap.classList.toggle("is-active", isUmap);
      ui.viewTable.classList.toggle("is-active", !isUmap);
      ui.stage.hidden = !isUmap;
      ui.tableWrap.hidden = isUmap;
      ui.sigWrap.style.display = isUmap ? "none" : "";
      if (isUmap) requestAnimationFrame(draw); else drawTable();
    }

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
      if (!p) return;
      selected = p; renderDetail(p); draw();
    });
    ui.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = ui.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const k = Math.max(1, Math.min(40, transform.k * f));
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

    ui.ds.addEventListener("change", () => {
      fillContexts(); fillTraits(); loadPoints().then(() => { if (view === "table") drawTable(); });
    });
    ui.ctx.addEventListener("change", () =>
      loadPoints().then(() => { if (view === "table") drawTable(); }));
    ui.trait.addEventListener("change", () =>
      loadPoints().then(() => { if (view === "table") drawTable(); }));

    let t;
    ui.pert.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { page = 0; view === "umap" ? draw() : drawTable(); }, 180);
    });
    ui.sig.addEventListener("change", () => { page = 0; drawTable(); });
    ui.prev.addEventListener("click", () => { if (page > 0) { page--; drawTable(); } });
    ui.next.addEventListener("click", () => { page++; drawTable(); });
    ui.viewUmap.addEventListener("click", () => setView("umap"));
    ui.viewTable.addEventListener("click", () => setView("table"));
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
      rt = setTimeout(() => { if (view === "umap") draw(); }, 150);
    });

    fillDatasets(); fillContexts(); fillTraits();
    setView("umap");
    renderDetail(null);
    return loadPoints();
  }

  /* ------------------------------------------------------------------ init */

  async function init() {
    const el = document.querySelector(".ps-explorer");
    if (!el || el.dataset.psReady) return;
    el.dataset.psReady = "1";
    // the explorer needs more width than the prose column allows
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
