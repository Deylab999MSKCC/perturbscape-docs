/* PerturbScape mermaid rendering.
 *
 * Rendered here rather than through the theme's built-in integration so the
 * diagrams can be themed against the site palette and re-themed when the
 * reader toggles light/dark.
 *
 * Fences are emitted as <pre class="ps-mermaid"><code>…</code></pre> by the
 * superfences custom_fences config in mkdocs.yml.
 */
(function () {
  "use strict";

  const SRC = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

  const THEMES = {
    dark: {
      background:        "#0B1017",
      mainBkg:           "#16202E",
      primaryColor:      "#16202E",
      primaryTextColor:  "#E6EDF5",
      primaryBorderColor:"#2E5C7A",
      secondaryColor:    "#141B26",
      tertiaryColor:     "#0F1620",
      nodeBorder:        "#2E5C7A",
      nodeTextColor:     "#E6EDF5",
      textColor:         "#E6EDF5",
      lineColor:         "#46586E",
      edgeLabelBackground:"#0B1017",
      clusterBkg:        "rgba(56,189,248,0.05)",
      clusterBorder:     "#223041",
      titleColor:        "#8B9BAF",
      labelBoxBorderColor:"#2E5C7A",
    },
    light: {
      background:        "#FFFFFF",
      mainBkg:           "#F6F8FB",
      primaryColor:      "#F6F8FB",
      primaryTextColor:  "#0D1520",
      primaryBorderColor:"#0B7FBF",
      secondaryColor:    "#EDF1F7",
      tertiaryColor:     "#F4F7FB",
      nodeBorder:        "#0B7FBF",
      nodeTextColor:     "#0D1520",
      textColor:         "#0D1520",
      lineColor:         "#8494A8",
      edgeLabelBackground:"#FFFFFF",
      clusterBkg:        "rgba(11,127,191,0.04)",
      clusterBorder:     "#DCE3EC",
      titleColor:        "#56657A",
      labelBoxBorderColor:"#0B7FBF",
    },
  };

  let mermaidPromise = null;
  let counter = 0;

  function load() {
    if (!mermaidPromise) {
      mermaidPromise = import(/* webpackIgnore: true */ SRC).then((m) => m.default || m);
    }
    return mermaidPromise;
  }

  const scheme = () =>
    (document.body.getAttribute("data-md-color-scheme") === "slate" ? "dark" : "light");

  function configure(mermaid) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: Object.assign({
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif',
        fontSize: "13px",
      }, THEMES[scheme()]),
      flowchart: { curve: "basis", padding: 14, useMaxWidth: true },
      sequence: { useMaxWidth: true },
    });
  }

  async function renderAll() {
    const blocks = [...document.querySelectorAll("pre.ps-mermaid, div.ps-mermaid[data-src]")];
    if (!blocks.length) return;

    let mermaid;
    try {
      mermaid = await load();
    } catch (err) {
      if (window.console) console.error("[perturbscape] mermaid failed to load", err);
      return;
    }
    configure(mermaid);

    for (const block of blocks) {
      // source lives in the <code> on first pass, in data-src on re-themes
      const source = block.getAttribute("data-src") ||
        (block.querySelector("code") ? block.querySelector("code").textContent : block.textContent);
      if (!source || !source.trim()) continue;

      const host = document.createElement("div");
      host.className = "ps-mermaid";
      host.setAttribute("data-src", source);

      try {
        const { svg } = await mermaid.render("psmermaid" + counter++, source.trim());
        host.innerHTML = svg;
      } catch (err) {
        host.classList.add("ps-mermaid--error");
        host.textContent = "Diagram could not be rendered.";
        if (window.console) console.error("[perturbscape] mermaid render failed", err, source);
      }
      block.replaceWith(host);
    }
  }

  function watchScheme() {
    let current = scheme();
    new MutationObserver(() => {
      const next = scheme();
      if (next !== current) {
        current = next;
        renderAll();
      }
    }).observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
  }

  function init() {
    renderAll();
  }

  if (typeof document$ !== "undefined") document$.subscribe(init);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  if (document.body) watchScheme();
  else document.addEventListener("DOMContentLoaded", watchScheme);
})();
