/* PerturbScape data explorer.
 *
 * Queries the published Parquet tables in the browser with DuckDB-WASM.
 * Only the byte ranges a query touches are fetched, so the 6.9M-row
 * meta-program table stays usable without downloading it up front.
 *
 * Markup:
 *   <div class="ps-explorer" data-base="tables/"></div>
 */
(function () {
  "use strict";

  const DUCKDB = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";
  const PW = "pathways.parquet";
  const MP = "meta_programs.parquet";
  const PAGE = 50;

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

  function fmtP(v) {
    if (v == null || Number.isNaN(v)) return "—";
    if (v === 0) return "0";
    if (v < 1e-4) return Number(v).toExponential(1);
    return Number(v).toFixed(4);
  }
  function fmtTau(v) {
    if (v == null || Number.isNaN(v)) return "—";
    if (v === 0) return "0";
    return Number(v).toFixed(3);
  }

  // Arrow -> plain JS rows
  function rows(result) {
    return result.toArray().map((r) => {
      const o = r.toJSON();
      for (const k in o) {
        const v = o[k];
        if (typeof v === "bigint") o[k] = Number(v);
        else if (v && typeof v === "object" && typeof v.toString === "function"
                 && !(v instanceof Date)) o[k] = v.toString();
      }
      return o;
    });
  }

  async function boot(el, setStatus) {
    setStatus("Loading query engine");
    const duckdb = await import(/* webpackIgnore: true */ DUCKDB);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(
      new Blob(['importScripts("' + bundle.mainWorker + '");'], { type: "text/javascript" })
    );
    const worker = new Worker(workerUrl);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    const base = new URL(el.getAttribute("data-base") || "tables/", window.location.href).href;
    setStatus("Connecting to data tables");
    await db.registerFileURL(PW, base + PW, duckdb.DuckDBDataProtocol.HTTP, false);
    await db.registerFileURL(MP, base + MP, duckdb.DuckDBDataProtocol.HTTP, false);
    return db.connect();
  }

  function render(el, conn) {
    el.innerHTML = [
      '<div class="ps-x-filters">',
      '  <div class="ps-x-field"><label for="psx-ds">Dataset</label>',
      '    <select id="psx-ds"><option value="">All datasets</option></select></div>',
      '  <div class="ps-x-field" id="psx-ctx-field"><label for="psx-ctx">Context</label>',
      '    <select id="psx-ctx"><option value="">All contexts</option></select></div>',
      '  <div class="ps-x-field"><label for="psx-trait">Trait</label>',
      '    <select id="psx-trait"><option value="">All traits</option></select></div>',
      '  <div class="ps-x-field"><label for="psx-pert">Perturbation</label>',
      '    <input id="psx-pert" type="search" placeholder="e.g. TP53" autocomplete="off"></div>',
      '  <div class="ps-x-field"><label for="psx-pw">Pathway contains</label>',
      '    <input id="psx-pw" type="search" placeholder="e.g. Wnt" autocomplete="off"></div>',
      '  <div class="ps-x-checks">',
      '    <label class="ps-x-check"><input type="checkbox" id="psx-sig" checked> Significant only (p &le; 0.05)</label>',
      '    <label class="ps-x-check"><input type="checkbox" id="psx-pooled"> Include pooled (All)</label>',
      '  </div>',
      '</div>',
      '<div class="ps-x-toolbar">',
      '  <span class="ps-x-summary" id="psx-summary">&mdash;</span>',
      '  <span class="ps-x-spacer"></span>',
      '  <button class="ps-x-btn" id="psx-reset" type="button">Reset</button>',
      '  <button class="ps-x-btn" id="psx-dl" type="button">Download CSV</button>',
      '</div>',
      '<div class="ps-x-scroll"><table class="ps-x-table"><thead><tr>',
      '  <th data-col="dataset">Dataset<span class="ps-x-arrow"></span></th>',
      '  <th data-col="context">Context<span class="ps-x-arrow"></span></th>',
      '  <th data-col="perturbation">Perturbation<span class="ps-x-arrow"></span></th>',
      '  <th data-col="trait">Trait<span class="ps-x-arrow"></span></th>',
      '  <th data-col="tau" class="ps-x-num">tau*<span class="ps-x-arrow"></span></th>',
      '  <th data-col="pvalue_tau" class="ps-x-num">P<span class="ps-x-arrow"></span></th>',
      '  <th class="ps-x-nosort">Top pathways</th>',
      '</tr></thead><tbody id="psx-body"></tbody></table></div>',
      '<div class="ps-x-pager">',
      '  <button class="ps-x-btn" id="psx-prev" type="button">Prev</button>',
      '  <span class="ps-x-page" id="psx-page"></span>',
      '  <button class="ps-x-btn" id="psx-next" type="button">Next</button>',
      '</div>',
    ].join("\n");

    const $ = (id) => el.querySelector("#" + id);
    const ui = {
      ds: $("psx-ds"), ctx: $("psx-ctx"), ctxField: $("psx-ctx-field"),
      trait: $("psx-trait"), pert: $("psx-pert"), pw: $("psx-pw"),
      sig: $("psx-sig"), pooled: $("psx-pooled"),
      summary: $("psx-summary"), body: $("psx-body"), page: $("psx-page"),
      prev: $("psx-prev"), next: $("psx-next"),
      reset: $("psx-reset"), dl: $("psx-dl"),
    };

    let sortCol = "pvalue_tau", sortAsc = true, page = 0, total = 0, openKey = null;

    function where() {
      const c = [];
      if (ui.ds.value) c.push("dataset = " + q(ui.ds.value));
      if (ui.ctx.value) c.push("context = " + q(ui.ctx.value));
      if (ui.trait.value) c.push("trait = " + q(ui.trait.value));
      const p = ui.pert.value.trim();
      if (p) c.push("perturbation ILIKE " + q("%" + p + "%"));
      const w = ui.pw.value.trim();
      if (w) c.push("pathways ILIKE " + q("%" + w + "%"));
      if (ui.sig.checked) c.push("pvalue_tau <= 0.05");
      if (!ui.pooled.checked) c.push("lower(perturbation) NOT IN ('all','pooled')");
      return c.length ? "WHERE " + c.join(" AND ") : "";
    }

    async function fillFacets() {
      const dsRows = rows(await conn.query(
        "SELECT DISTINCT dataset FROM '" + PW + "' ORDER BY dataset"));
      ui.ds.innerHTML = '<option value="">All datasets</option>' +
        dsRows.map((r) => "<option>" + esc(r.dataset) + "</option>").join("");
      await fillDependent();
    }

    async function fillDependent() {
      const dsClause = ui.ds.value ? "WHERE dataset = " + q(ui.ds.value) : "";
      const [ctxRows, trRows] = await Promise.all([
        conn.query("SELECT DISTINCT context, dataset FROM '" + PW + "' " + dsClause + " ORDER BY context"),
        conn.query("SELECT DISTINCT trait FROM '" + PW + "' " + dsClause + " ORDER BY trait"),
      ]);
      // a context that just repeats the dataset name carries no information
      const ctxs = rows(ctxRows).filter((r) => r.context !== r.dataset);
      ui.ctxField.style.display = ctxs.length ? "" : "none";
      const keepCtx = ui.ctx.value;
      ui.ctx.innerHTML = '<option value="">All contexts</option>' +
        ctxs.map((r) => "<option>" + esc(r.context) + "</option>").join("");
      if (ctxs.some((r) => r.context === keepCtx)) ui.ctx.value = keepCtx;

      const traits = rows(trRows);
      const keepTrait = ui.trait.value;
      ui.trait.innerHTML = '<option value="">All traits</option>' +
        traits.map((r) => "<option>" + esc(r.trait) + "</option>").join("");
      if (traits.some((r) => r.trait === keepTrait)) ui.trait.value = keepTrait;
    }

    function pathwayCell(pw) {
      if (!pw) return '<span class="ps-x-nsig">&mdash;</span>';
      const first = pw.split(";").slice(0, 3).map((s) => s.trim()).filter(Boolean);
      return '<div class="ps-x-trunc">' + esc(first.join(" · ")) + "</div>";
    }

    async function draw() {
      ui.body.innerHTML = '<tr><td colspan="7" class="ps-x-empty">Querying…</td></tr>';
      const w = where();
      const cnt = rows(await conn.query("SELECT count(*) AS n FROM '" + PW + "' " + w));
      total = cnt[0].n;

      const order = "ORDER BY " + sortCol + " " + (sortAsc ? "ASC" : "DESC") + " NULLS LAST";
      const data = rows(await conn.query(
        "SELECT dataset, context, perturbation, trait, tau, pvalue_tau, " +
        "pathways, neglog10p_pathways FROM '" + PW + "' " + w + " " + order +
        " LIMIT " + PAGE + " OFFSET " + (page * PAGE)));

      ui.summary.innerHTML = "<b>" + total.toLocaleString() + "</b> perturbation–trait pairs";
      const pages = Math.max(1, Math.ceil(total / PAGE));
      ui.page.textContent = "Page " + (page + 1) + " of " + pages.toLocaleString();
      ui.prev.disabled = page === 0;
      ui.next.disabled = page >= pages - 1;

      if (!data.length) {
        ui.body.innerHTML = '<tr><td colspan="7" class="ps-x-empty">' +
          "No perturbation–trait pairs match these filters.</td></tr>";
        return;
      }

      ui.body.innerHTML = data.map((r, i) => {
        const sig = r.pvalue_tau != null && r.pvalue_tau <= 0.05;
        const ctx = r.context === r.dataset
          ? '<span class="ps-x-nsig">&mdash;</span>' : esc(r.context);
        return '<tr data-idx="' + i + '">' +
          '<td class="ps-x-mono">' + esc(r.dataset) + "</td>" +
          "<td>" + ctx + "</td>" +
          '<td class="ps-x-mono"><b>' + esc(r.perturbation) + "</b></td>" +
          "<td>" + esc(r.trait) + "</td>" +
          '<td class="ps-x-num ' + (sig ? "ps-x-sig" : "ps-x-nsig") + '">' + fmtTau(r.tau) + "</td>" +
          '<td class="ps-x-num ' + (sig ? "ps-x-sig" : "ps-x-nsig") + '">' + fmtP(r.pvalue_tau) + "</td>" +
          "<td>" + pathwayCell(r.pathways) + "</td></tr>";
      }).join("");

      ui.body.querySelectorAll("tr[data-idx]").forEach((tr) => {
        const row = data[Number(tr.getAttribute("data-idx"))];
        tr.addEventListener("click", () => toggle(tr, row));
        if (openKey && keyOf(row) === openKey) toggle(tr, row, true);
      });
    }

    const keyOf = (r) => JSON.stringify([r.dataset, r.context, r.perturbation, r.trait]);

    async function toggle(tr, row, keepOpen) {
      const next = tr.nextElementSibling;
      if (next && next.classList.contains("ps-x-detail")) {
        if (keepOpen) return;
        next.remove();
        tr.classList.remove("ps-x-open");
        openKey = null;
        return;
      }
      ui.body.querySelectorAll(".ps-x-detail").forEach((n) => n.remove());
      ui.body.querySelectorAll(".ps-x-open").forEach((n) => n.classList.remove("ps-x-open"));
      tr.classList.add("ps-x-open");
      openKey = keyOf(row);

      const detail = document.createElement("tr");
      detail.className = "ps-x-detail";
      detail.innerHTML = '<td colspan="7"><div class="ps-x-detail-inner">' +
        '<div class="ps-x-panel"><h4>Top meta-program genes</h4>' +
        '<div class="ps-x-genes" data-genes>Loading…</div></div>' +
        '<div class="ps-x-panel"><h4>Enriched pathways</h4>' +
        '<div class="ps-x-pathways">' + pathwayPanel(row) + "</div></div>" +
        "</div></td>";
      tr.after(detail);

      const genes = rows(await conn.query(
        "SELECT gene, rank FROM '" + MP + "' WHERE dataset = " + q(row.dataset) +
        " AND context = " + q(row.context) + " AND perturbation = " + q(row.perturbation) +
        " AND trait = " + q(row.trait) + " ORDER BY rank LIMIT 100"));
      const box = detail.querySelector("[data-genes]");
      box.innerHTML = genes.length
        ? genes.map((g, i) =>
            '<span class="ps-x-gene ' + (i < 10 ? "ps-x-gene--top" : "") + '">' +
            esc(g.gene) + '<span class="ps-x-rank">' + Math.round(g.rank) + "</span></span>"
          ).join("")
        : '<span class="ps-x-nsig">No meta-program genes recorded for this pair.</span>';
    }

    function pathwayPanel(row) {
      if (!row || !row.pathways) return '<span class="ps-x-nsig">No enriched pathways.</span>';
      const names = row.pathways.split(";").map((s) => s.trim()).filter(Boolean);
      const vals = (row.neglog10p_pathways || "").split(";").map((s) => parseFloat(s.trim()));
      const finite = vals.filter((v) => !Number.isNaN(v));
      const max = finite.length ? Math.max.apply(null, finite) : 1;
      return names.map((n, i) => {
        const v = vals[i];
        const pct = Number.isNaN(v) ? 0 : Math.round((v / max) * 100);
        return '<div class="ps-x-pw">' +
          '<span class="ps-x-pw-name">' + esc(n) + "</span>" +
          '<span class="ps-x-pw-val">' + (Number.isNaN(v) ? "—" : v.toFixed(2)) + "</span>" +
          '<span class="ps-x-pw-bar"><span style="width:' + pct + '%"></span></span></div>';
      }).join("");
    }

    async function download() {
      ui.dl.disabled = true;
      const old = ui.dl.textContent;
      ui.dl.textContent = "Preparing…";
      try {
        const data = rows(await conn.query(
          "SELECT dataset, context, perturbation, trait, tau, pvalue_tau, " +
          "pathways, neglog10p_pathways FROM '" + PW + "' " + where() +
          " ORDER BY " + sortCol + " " + (sortAsc ? "ASC" : "DESC") + " NULLS LAST"));
        const cols = ["dataset", "context", "perturbation", "trait", "tau",
                      "pvalue_tau", "pathways", "neglog10p_pathways"];
        const cell = (v) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const csv = [cols.join(",")]
          .concat(data.map((r) => cols.map((c) => cell(r[c])).join(","))).join("\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "perturbscape_perturbation_trait.csv";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } finally {
        ui.dl.disabled = false;
        ui.dl.textContent = old;
      }
    }

    function markSort() {
      el.querySelectorAll("th[data-col]").forEach((th) => {
        const a = th.querySelector(".ps-x-arrow");
        if (!a) return;
        a.textContent = th.getAttribute("data-col") === sortCol
          ? (sortAsc ? " ▲" : " ▼") : "";
      });
    }

    let t;
    const reload = () => { page = 0; openKey = null; draw(); };
    const debounced = () => { clearTimeout(t); t = setTimeout(reload, 220); };

    ui.ds.addEventListener("change", async () => { await fillDependent(); reload(); });
    ui.ctx.addEventListener("change", reload);
    ui.trait.addEventListener("change", reload);
    ui.pert.addEventListener("input", debounced);
    ui.pw.addEventListener("input", debounced);
    ui.sig.addEventListener("change", reload);
    ui.pooled.addEventListener("change", reload);
    ui.prev.addEventListener("click", () => { if (page > 0) { page--; openKey = null; draw(); } });
    ui.next.addEventListener("click", () => { page++; openKey = null; draw(); });
    ui.dl.addEventListener("click", download);
    ui.reset.addEventListener("click", async () => {
      ui.ds.value = ""; ui.ctx.value = ""; ui.trait.value = "";
      ui.pert.value = ""; ui.pw.value = "";
      ui.sig.checked = true; ui.pooled.checked = false;
      sortCol = "pvalue_tau"; sortAsc = true;
      await fillDependent(); markSort(); reload();
    });
    el.querySelectorAll("th[data-col]").forEach((th) => {
      th.addEventListener("click", () => {
        const c = th.getAttribute("data-col");
        if (sortCol === c) sortAsc = !sortAsc;
        else { sortCol = c; sortAsc = c !== "tau"; }
        markSort(); reload();
      });
    });

    markSort();
    return fillFacets().then(draw);
  }

  async function init() {
    const el = document.querySelector(".ps-explorer");
    if (!el || el.dataset.psReady) return;
    el.dataset.psReady = "1";

    const setStatus = (msg) => {
      el.innerHTML = '<div class="ps-x-boot"><span class="ps-x-spinner"></span>' +
        esc(msg) + "…</div>";
    };
    setStatus("Starting");

    try {
      const conn = await boot(el, setStatus);
      await render(el, conn);
    } catch (err) {
      el.innerHTML = '<div class="ps-x-boot ps-x-error">' +
        "Could not start the data explorer.<br><code>" +
        esc(err && err.message ? err.message : err) + "</code><br><br>" +
        '<span style="color:var(--ps-muted)">The explorer needs WebAssembly and loads its ' +
        "query engine from a CDN. The tables can also be downloaded directly below.</span></div>";
      if (window.console) console.error("[perturbscape] explorer failed", err);
    }
  }

  if (typeof document$ !== "undefined") document$.subscribe(init);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
