/**
 * Workflow Note on the graph.
 *
 * Card, banner, and info tile share one JSON note. The pencil opens the
 * editor. Model rows link out to a download URL and show whether the file
 * is already in a models folder. Markdown is built as text nodes.
 */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
  DEFAULT_ACCENT,
  DEVIL_REGISTRY_URL,
  LAYOUTS,
  ROW_LIMIT,
  SAMPLE_TABLE,
  TONE_NAMES,
  alsoReadFrom,
  applyLoaderUpdates,
  arrowDelta,
  buttonMarkup,
  cleanAccent,
  detectPacks,
  flattenGraph,
  folderOptions,
  groupByFolder,
  insertAround,
  loaderUpdates,
  locationLabel,
  matchAcrossFolders,
  mergePacks,
  minimumSize,
  mountMarkdown,
  nodeTypeForLayout,
  normalizeNote,
  noteHasContent,
  parseNoteText,
  notesEqual,
  packLink,
  probeInstalled,
  resizeBy,
  safeHttpUrl,
  searchFolders,
  serializeNote,
  shouldAutoPick,
  subfolderHint,
  tileUsesDownloadIcon,
  uniqueMatch,
  updateDestination,
} from "./workflow_note_model.js";

const NODE_TYPES = ["WorkflowNote", "WorkflowNoteTile"];
const STYLE_ID = "devil-workflow-note-style";
const AUTO_PICK_ID = "devil-nodes.workflow-note.auto-pick";
const FILE_CACHE_MS = 20000;

const CSS = `
.wn-root{box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;color:#f6f1e8;font:12.5px/1.45 ui-sans-serif,"Segoe UI",sans-serif;pointer-events:auto;}
.wn-root *{box-sizing:border-box;}
.wn-card{position:relative;display:flex;flex:1 1 auto;flex-direction:column;min-height:0;overflow:hidden;border:1px solid rgba(226,91,69,.45);border-radius:16px;background:#12110f;box-shadow:inset 0 1px 0 rgba(255,244,230,.04);}
.wn-card::before{content:"";display:block;height:3px;background:var(--wn-accent,#e25b45);}
.wn-scroll{flex:1 1 auto;min-height:0;overflow:auto;}
.wn-stack{padding:0 0 16px;}
.wn-head{position:relative;padding:12px 40px 8px 14px;}
.wn-title{margin:0;color:#f6f1e8;font-size:22px;font-weight:720;letter-spacing:-.02em;line-height:1.15;overflow-wrap:anywhere;}
.wn-sub{margin:4px 0 0;color:#f0d7c4;font-size:13px;line-height:1.35;overflow-wrap:anywhere;}
.wn-by{margin:6px 0 0;color:#e4f54a;font-size:11px;font-variant-caps:all-small-caps;letter-spacing:.16em;}
.wn-banner .wn-head{padding-top:10px;padding-bottom:10px;}
.wn-banner .wn-title{font-size:20px;}
.wn-banner .wn-stack{padding-bottom:8px;}
.wn-pencil,.wn-tile,.wn-mini,.wn-download,.wn-chip,.wn-linkbtn,.wn-grip,.wn-copy,.wn-text,.wn-use{pointer-events:auto;}
.wn-pencil{position:absolute;z-index:2;top:8px;right:8px;width:28px;height:28px;border:1px solid transparent;border-radius:8px;background:transparent;color:#d9c7ba;cursor:pointer;}
.wn-pencil:hover{border-color:rgba(228,245,74,.7);background:#221c18;color:#e4f54a;}
.wn-pencil svg{width:15px;height:15px;display:block;margin:0 auto;}
.wn-empty{padding:2px 14px 8px;color:#b7a79c;}
.wn-section{padding:8px 14px 0;}
.wn-section+.wn-section{margin-top:8px;border-top:1px solid rgba(246,241,232,.08);padding-top:10px;}
.wn-h{display:flex;align-items:center;gap:8px;margin:0 0 6px;color:#e4f54a;font-size:10px;font-weight:750;letter-spacing:.12em;text-transform:uppercase;}
.wn-h .wn-spacer{flex:1 1 auto;}
.wn-folder{margin:8px 0 1px;color:#f0d7c4;font:11px ui-monospace,monospace;}
.wn-also{margin:0 0 4px;color:#e4f54a;font-size:10.5px;overflow-wrap:anywhere;}
.wn-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0;}
.wn-dot{flex:none;width:8px;height:8px;margin-top:5px;border-radius:50%;background:#6d625b;}
.wn-dot.is-found{background:#9ddeaf;}
.wn-dot.is-missing{background:#e25b45;}
.wn-dot.is-checking{background:#e4f54a;}
.wn-file{flex:1 1 auto;min-width:0;}
.wn-copy{display:inline;padding:0;border:0;background:transparent;color:#f6f1e8;font:12px ui-monospace,monospace;text-align:left;cursor:copy;overflow-wrap:anywhere;}
.wn-copy.is-copied{color:#e4f54a;}
.wn-meta{color:#b7a79c;font-size:11px;overflow-wrap:anywhere;}
.wn-hint{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:3px;color:#f0d7c4;font-size:11px;}
.wn-action{flex:none;display:flex;align-items:center;gap:6px;}
.wn-download,.wn-chip,.wn-use,.wn-mini{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;cursor:pointer;}
.wn-download{height:24px;padding:0 9px;border:1px solid var(--wn-accent,#e25b45);border-radius:999px;background:rgba(226,91,69,.14);color:#f6f1e8;font-size:11px;font-weight:720;}
.wn-download:hover{background:var(--wn-accent,#e25b45);color:#1a0d0b;}
.wn-pill{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;background:rgba(157,222,175,.16);color:#c9f0d2;font-size:10.5px;white-space:nowrap;}
.wn-pill.is-missing{background:rgba(226,91,69,.16);color:#ffc2b6;}
.wn-mini,.wn-use{height:22px;padding:0 8px;border:1px solid rgba(228,245,74,.55);border-radius:7px;background:#221c18;color:#e4f54a;font:11px ui-sans-serif,sans-serif;}
.wn-mini:hover,.wn-use:hover{background:#e4f54a;color:#1a1608;}
.wn-chips{display:flex;flex-wrap:wrap;gap:6px;}
.wn-chip{height:24px;padding:0 10px;border:1px solid rgba(246,241,232,.16);border-radius:999px;background:#221c18;color:#f6f1e8;font-size:11px;}
.wn-chip:hover{border-color:#e4f54a;color:#e4f54a;}
.wn-badges{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 4px;}
.wn-badge{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:999px;background:#221c18;color:#f0d7c4;font-size:10px;}
.wn-badge .wn-dot{margin-top:0;}
.wn-banner .wn-badges{display:none;}
.wn-text{user-select:text;cursor:text;color:#f6f1e8;}
.wn-text p{margin:0 0 8px;overflow-wrap:anywhere;}
.wn-text h1,.wn-text h2,.wn-text h3{margin:10px 0 4px;color:#f6f1e8;line-height:1.25;}
.wn-text h1{font-size:18px;}
.wn-text h2{font-size:15px;}
.wn-text h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#e4f54a;}
.wn-text ul,.wn-text ol{margin:0 0 8px;padding-left:18px;}
.wn-text li{margin:2px 0;overflow-wrap:anywhere;}
.wn-text code{padding:0 4px;border-radius:4px;background:rgba(246,241,232,.08);font:11.5px ui-monospace,monospace;}
.wn-text pre{margin:0 0 8px;padding:8px 10px;overflow:auto;border-radius:10px;background:#0c0b0a;font:11.5px/1.45 ui-monospace,monospace;white-space:pre-wrap;}
.wn-text a,.wn-mdlink{color:#ffb7a8;pointer-events:auto;}
.wn-text table{width:100%;margin:0 0 8px;border-collapse:collapse;}
.wn-text th,.wn-text td{padding:4px 6px;border-top:1px solid rgba(226,91,69,.35);text-align:left;vertical-align:top;overflow-wrap:anywhere;}
.wn-text th{color:#e4f54a;font-weight:700;}
.wn-tone-red{color:#ff8d7a;}
.wn-tone-yellow{color:#e4f54a;}
.wn-tone-green{color:#9ddeaf;}
.wn-tone-teal{color:#7edcd2;}
.wn-tone-amber{color:#f0b45a;}
.wn-tone-glow{color:#fff4e4;text-shadow:0 0 6px rgba(228,245,74,.85),0 0 14px rgba(226,91,69,.55);}
.wn-linkbtn{display:inline-flex;align-items:center;gap:6px;margin:2px 4px 2px 0;padding:4px 10px;border:1px solid var(--wn-accent,#e25b45);border-radius:999px;color:#f6f1e8;font-weight:700;text-decoration:none;pointer-events:auto;}
.wn-linkbtn-download{background:rgba(226,91,69,.18);}
.wn-linkbtn-readmore{border-radius:8px;}
.wn-linkbtn-plain{border-color:transparent;padding-left:0;}
.wn-sizebadge{padding:0 6px;border-radius:999px;background:#e4f54a;color:#1a1608;font-size:10px;font-weight:750;}
.wn-tileface{min-height:42px;}
.wn-tile{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;padding:8px 42px 8px 12px;border:0;background:transparent;color:#f6f1e8;text-align:left;font:650 15px/1.3 ui-sans-serif,sans-serif;cursor:pointer;}
.wn-tile:hover{background:rgba(228,245,74,.06);}
.wn-tile svg{width:20px;height:20px;flex:none;color:var(--wn-accent,#e25b45);}
.wn-tileface .wn-pencil{top:50%;right:8px;transform:translateY(-50%);}
.wn-grip{position:absolute;z-index:3;right:3px;bottom:3px;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:
  linear-gradient(135deg, transparent 0 38%, #e4f54a 38% 48%, transparent 48% 58%, #e25b45 58% 70%, transparent 70%);
  cursor:nwse-resize;}
.wn-grip:focus{outline:1px solid #e4f54a;}
.wn-overlay{position:fixed;inset:0;z-index:300000;display:flex;align-items:center;justify-content:center;background:rgba(8,7,6,.62);}
.wn-dialog{display:flex;flex-direction:column;width:min(920px,94vw);max-height:92vh;border:1px solid rgba(226,91,69,.5);border-radius:18px;background:#161412;color:#f6f1e8;box-shadow:0 24px 70px rgba(0,0,0,.55);font:12.5px/1.4 ui-sans-serif,sans-serif;}
.wn-dialog.wn-reader{width:min(760px,94vw);}
.wn-dialog *{box-sizing:border-box;}
.wn-dhead,.wn-dfoot{display:flex;align-items:center;gap:8px;padding:12px 14px;}
.wn-dhead{border-bottom:1px solid rgba(246,241,232,.08);color:#e4f54a;font-weight:750;}
.wn-dfoot{border-top:1px solid rgba(246,241,232,.08);}
.wn-dbody{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px;}
.wn-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
.wn-field{display:flex;flex-direction:column;gap:4px;}
.wn-field>span,.wn-label{color:#e4f54a;font-size:10px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;}
.wn-dialog input,.wn-dialog textarea,.wn-dialog select{width:100%;padding:6px 8px;border:1px solid rgba(226,91,69,.4);border-radius:8px;background:#221c18;color:#f6f1e8;font:12.5px/1.4 ui-sans-serif,sans-serif;}
.wn-dialog textarea{min-height:140px;resize:vertical;font:12px/1.45 ui-monospace,monospace;}
.wn-accentrow{display:flex;gap:8px;align-items:center;}
.wn-accentrow input[type="color"]{width:42px;height:32px;padding:2px;cursor:pointer;}
.wn-tools{display:flex;flex-wrap:wrap;gap:4px;}
.wn-tool{height:24px;padding:0 8px;border:1px solid rgba(246,241,232,.14);border-radius:7px;background:#221c18;color:#f6f1e8;font:11px ui-sans-serif,sans-serif;cursor:pointer;}
.wn-tool:hover{border-color:#e4f54a;color:#e4f54a;}
.wn-seg{display:inline-flex;overflow:hidden;border:1px solid rgba(226,91,69,.45);border-radius:9px;}
.wn-seg button{height:28px;padding:0 12px;border:0;background:#221c18;color:#d9c7ba;cursor:pointer;}
.wn-seg button+button{border-left:1px solid rgba(226,91,69,.35);}
.wn-seg button.on{background:#e25b45;color:#1a0d0b;font-weight:750;}
.wn-table{display:flex;flex-direction:column;gap:4px;}
.wn-trow{display:grid;gap:6px;align-items:center;}
.wn-trow.models{grid-template-columns:minmax(120px,1.2fr) minmax(120px,.8fr) minmax(140px,1.3fr) 28px;}
.wn-trow.packs{grid-template-columns:minmax(110px,1fr) minmax(140px,1.2fr) minmax(110px,1fr) 28px;}
.wn-trow.links{grid-template-columns:minmax(100px,.7fr) minmax(160px,1.4fr) 28px;}
.wn-trow.head{color:#b7a79c;font-size:10px;letter-spacing:.06em;text-transform:uppercase;}
.wn-btn{height:28px;padding:0 12px;border:1px solid rgba(246,241,232,.16);border-radius:8px;background:#221c18;color:#f6f1e8;font:12px ui-sans-serif,sans-serif;cursor:pointer;}
.wn-btn:hover{border-color:#e4f54a;}
.wn-btn.primary{border-color:#e25b45;background:#e25b45;color:#1a0d0b;font-weight:750;}
.wn-x{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#d9c7ba;cursor:pointer;}
.wn-preview{border:1px solid rgba(246,241,232,.1);border-radius:10px;padding:8px;}
.wn-preview summary{cursor:pointer;color:#e4f54a;}
.wn-error{color:#ffb7a8;font-size:11px;}
.wn-spacer{flex:1 1 auto;}
.lg-node.wn-on-node [data-testid="node-preview-body"],
.lg-node.wn-on-node .lg-node-preview{display:none !important;}
.lg-node:has(.wn-root) [data-testid="node-widgets"]{flex:1 1 auto;min-height:0;align-self:stretch;}
.lg-node:has(.wn-root) [data-widget-name="note"]{display:none !important;height:0 !important;min-height:0 !important;overflow:hidden !important;}
`;

const fileCache = new Map();
let catalogCache = null;
let defsCache = null;
let defsAt = 0;
const liveNotes = new Set();
let hitsReady = false;
let keysReady = false;

function ensureCss() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgIcon(pathD, className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.7");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("d", pathD);
  svg.append(path);
  return svg;
}

function bookIcon() {
  return svgIcon("M4 5h6.2A2.8 2.8 0 0 1 13 7.8V20H7.2A3.2 3.2 0 0 0 4 23.2V5zM20 5h-6.2A2.8 2.8 0 0 0 11 7.8V20h5.8A3.2 3.2 0 0 1 20 23.2V5z", "wn-ico");
}

function downloadIcon() {
  return svgIcon("M12 3.5v9.2M8.2 9.4 12 13.2l3.8-3.8M4.5 16.2h15v4h-15z", "wn-ico");
}

function pencilIcon() {
  return svgIcon("M4 20.2 5.4 16 16.2 5.2l2.8 2.8L8.2 18.8 4 20.2z", "wn-ico");
}

function stopPress(node) {
  node.addEventListener("pointerdown", (event) => {
    const zone = event.target.closest?.("[data-wn-hit], a, button, input, textarea, select, summary, .wn-copy, .wn-text");
    if (zone) event.stopPropagation();
  });
  node.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
}

function cssName(value) {
  const text = String(value);
  const escape = globalThis.CSS && globalThis.CSS.escape;
  if (typeof escape === "function") return escape(text);
  return text.replace(/["\\]/g, "\\$&");
}

function isNote(node) {
  const type = node?.type || node?.comfyClass || "";
  return NODE_TYPES.includes(type);
}

function noteWidget(node) {
  return (node.widgets || []).find((widget) => widget && widget.name === "note");
}

function conceal(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.serialize = true;
  widget.options = widget.options || {};
  widget.options.hidden = true;
  widget.options.serialize = true;
  widget.options.minNodeSize = [300, 42];
  widget.computeSize = () => [0, -4];
  widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
  const box = widget.element || widget.inputEl;
  if (box?.style) {
    box.style.display = "none";
    box.hidden = true;
  }
}

function readSource(node, info) {
  const props = info?.properties?.workflowNote ?? node.properties?.workflowNote;
  if (typeof props === "string" && props.trim()) return props;
  const widget = noteWidget(node);
  if (typeof widget?.value === "string" && widget.value.trim()) return widget.value;
  const values = info?.widgets_values;
  if (Array.isArray(values)) {
    const text = values.find((item) => typeof item === "string" && item.trim().startsWith("{"));
    if (text) return text;
  }
  return "{}";
}

function writeWidget(widget, text) {
  if (!widget) return;
  if (typeof widget.setValue === "function") {
    try {
      widget.setValue(text);
      return;
    } catch {
      // Some setters only accept an event. The value write below still sticks.
    }
  }
  widget.value = text;
  if (typeof widget.callback === "function") widget.callback(text);
}

function writeNote(node, note) {
  const text = serializeNote(note);
  if (node.workflowNote) node.workflowNote.note = normalizeNote(note);
  writeWidget(noteWidget(node), text);
  node.properties = node.properties || {};
  node.properties.workflowNote = text;
  adoptType(node, node.workflowNote?.note || note);
  node.setDirtyCanvas?.(true, true);
}

function adoptType(node, note) {
  const next = nodeTypeForLayout(note?.layout);
  if (node.type !== next) node.type = next;
  if (node.comfyClass !== next) node.comfyClass = next;
}

function readAutoPick() {
  try {
    const value = app.extensionManager?.setting?.get?.(AUTO_PICK_ID);
    if (typeof value === "boolean") return value;
  } catch {
    // The setting store is not ready yet. Default stays on.
  }
  try {
    const legacy = app.ui?.settings?.getSettingValue?.(AUTO_PICK_ID);
    if (typeof legacy === "boolean") return legacy;
  } catch {
    // Older settings UI.
  }
  return true;
}

function managerAvailable() {
  const list = app.extensionManager?.extensions;
  if (Array.isArray(list) && list.some((item) => /manager/i.test(String(item?.name || item?.packageName || "")))) return true;
  return Boolean(globalThis.comfyManager);
}

function openManager() {
  const opener = globalThis.comfyManager?.open || globalThis.showManagerMenu;
  if (typeof opener === "function") {
    opener();
    return true;
  }
  const button = document.querySelector("#comfy-manager-button, [data-id='comfyui-manager']");
  if (button && typeof button.click === "function") {
    button.click();
    return true;
  }
  return false;
}

async function loadCatalog(fresh) {
  if (!fresh && catalogCache) return catalogCache;
  try {
    const response = await api.fetchApi("/devil_nodes/note_model_paths");
    if (response?.ok) {
      const data = await response.json();
      if (data && typeof data === "object") {
        catalogCache = data;
        return catalogCache;
      }
    }
  } catch {
    // The route is absent outside ComfyUI. Checks still use /models.
  }
  catalogCache = catalogCache || { folders: {}, shared: {}, input: [], aliases: { clip: "text_encoders", unet: "diffusion_models" } };
  return catalogCache;
}

async function loadDefs(fresh) {
  const now = performance.now();
  if (!fresh && defsCache && now - defsAt < FILE_CACHE_MS) return defsCache;
  try {
    const response = await api.fetchApi("/object_info");
    if (response?.ok) {
      const data = await response.json();
      defsCache = data && typeof data === "object" ? data : {};
      defsAt = now;
      return defsCache;
    }
  } catch {
    // Leave the previous map in place.
  }
  defsCache = defsCache || null;
  return defsCache;
}

async function listFiles(folder, fresh) {
  const cached = fileCache.get(folder);
  if (!fresh && cached && performance.now() - cached.at < FILE_CACHE_MS) return cached.value;
  let value = null;
  try {
    const response = await api.fetchApi(`/models/${encodeURIComponent(folder)}`);
    if (response?.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        value = data
          .map((item) => (typeof item === "string" ? item : item?.name || item?.path || ""))
          .filter((item) => typeof item === "string" && item);
      }
    }
  } catch {
    value = null;
  }
  fileCache.set(folder, { at: performance.now(), value });
  return value;
}

function moduleOf(node, defs) {
  const type = node?.type || node?.comfyClass || "";
  const fromDefs = defs?.[type]?.python_module;
  if (typeof fromDefs === "string" && fromDefs) return fromDefs;
  const registered = globalThis.LiteGraph?.registered_node_types?.[type];
  const fromNode = registered?.nodeData?.python_module;
  return typeof fromNode === "string" ? fromNode : "";
}

function graphNodes(state) {
  return flattenGraph(state.node.graph || app.rootGraph || app.graph);
}

function registryOf() {
  return globalThis.LiteGraph?.registered_node_types || null;
}

function externalLink(url, className, text) {
  const safe = safeHttpUrl(url);
  if (!safe) return el("span", className, text);
  const link = el("a", className, text);
  link.href = safe;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.dataset.wnHit = "link";
  return link;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // The browser refused the clipboard. The click still selected nothing secret.
  }
  return false;
}

function applyUse(state, row, foundPath) {
  const nodes = graphNodes(state);
  const plan = loaderUpdates(nodes, row, foundPath);
  applyLoaderUpdates(nodes, plan);
  for (const step of plan) {
    const node = nodes.find((item) => item.id === step.nodeId);
    const widget = node?.widgets?.find((item) => item.name === step.widget);
    if (widget && typeof widget.callback === "function") widget.callback(step.to);
  }
  state.node.setDirtyCanvas?.(true, true);
  render(state);
}

function resultFor(state, row) {
  const aliases = state.catalog?.aliases;
  const names = searchFolders(row.folder, aliases);
  const lists = names.map((folder) => ({ folder, files: state.files?.[folder] }));
  if (!state.files) return { status: "unchecked", matches: [] };
  return matchAcrossFolders(row.name, lists);
}

function installedTip(row, hit, catalog) {
  const folder = hit?.folder || row.folder;
  const roots = [];
  if (folder === "input" && Array.isArray(catalog?.input)) roots.push(...catalog.input);
  const listed = catalog?.folders?.[folder];
  if (Array.isArray(listed)) roots.push(...listed);
  const unique = [...new Set(roots.filter((item) => typeof item === "string" && item))];
  const rel = hit?.path || row.name;
  if (unique.length === 1) return `${unique[0].replace(/[\\/]+$/, "")}/${rel}`;
  return rel;
}

function paintBody(parent, text) {
  const body = el("div", "wn-text");
  body.dataset.wnHit = "text";
  mountMarkdown(document, body, text || "");
  parent.append(body);
}

function modelBlock(state, parent) {
  const note = state.note;
  if (!note.models.length) return;
  const section = el("div", "wn-section");
  const heading = el("div", "wn-h");
  heading.append(el("span", "", "Models"), el("span", "wn-spacer"));
  const check = el("button", "wn-mini", state.checking ? "Checking…" : "Check files");
  check.type = "button";
  check.dataset.wnHit = "check";
  check.disabled = Boolean(state.checking);
  check.addEventListener("click", () => recheck(state, true));
  heading.append(check);
  section.append(heading);
  for (const group of groupByFolder(note.models)) {
    section.append(el("div", "wn-folder", locationLabel(group.folder)));
    const extras = alsoReadFrom(group.folder, state.catalog);
    if (extras.length) section.append(el("div", "wn-also", `also read from ${extras.join(", ")}`));
    const alias = state.catalog?.aliases?.[group.folder];
    if (alias) section.append(el("div", "wn-also", `also checks ${alias}`));
    for (const row of group.rows) section.append(modelLine(state, row));
  }
  parent.append(section);
}

function modelLine(state, row) {
  const line = el("div", "wn-row");
  const dot = el("span", "wn-dot");
  const file = el("div", "wn-file");
  const name = el("button", "wn-copy", row.name);
  name.type = "button";
  name.dataset.wnHit = "copy";
  name.title = "Copy file name";
  name.addEventListener("click", async () => {
    const ok = await copyText(row.name);
    if (!ok) return;
    name.classList.add("is-copied");
    window.setTimeout(() => name.classList.remove("is-copied"), 900);
  });
  file.append(name);
  const result = state.checking ? { status: "checking", matches: [] } : resultFor(state, row);
  const unique = uniqueMatch(result);
  if (result.status === "found") {
    dot.classList.add("is-found");
    dot.title = "Found";
  } else if (result.status === "missing") {
    dot.classList.add("is-missing");
    dot.title = "Missing";
  } else if (result.status === "checking") {
    dot.classList.add("is-checking");
  } else {
    dot.title = "Not checked";
  }
  const hint = unique ? subfolderHint(row.name, unique) : "";
  if (hint || (result.matches || []).length > 1) {
    const meta = el("div", "wn-hint");
    if ((result.matches || []).length > 1) {
      meta.append(el("span", "", "Several files match this name"));
    } else if (hint) {
      meta.append(el("span", "", `In subfolder ${hint}`));
      const use = el("button", "wn-use", "Use it");
      use.type = "button";
      use.dataset.wnHit = "use";
      use.title = "Point matching loaders at this subfolder";
      use.addEventListener("click", () => applyUse(state, row, unique.path));
      meta.append(use);
    }
    if (unique && unique.folder && unique.folder !== row.folder) {
      meta.append(el("span", "", `in ${unique.folder}`));
    }
    file.append(meta);
  }
  const action = el("span", "wn-action");
  if (result.status === "found" && unique) {
    const pill = el("span", "wn-pill", "Installed");
    pill.title = installedTip(row, unique, state.catalog);
    action.append(pill);
  }
  if (row.url) action.append(externalLink(row.url, "wn-download", "Download"));
  line.append(dot, file, action);
  return line;
}

function packBlock(state, parent) {
  const note = state.note;
  if (!note.packs.length) return;
  const section = el("div", "wn-section");
  section.append(el("div", "wn-h", "Packs"));
  for (const row of note.packs) section.append(packLine(state, row));
  parent.append(section);
}

function packLine(state, row) {
  const line = el("div", "wn-row");
  const status = probeInstalled(row.node, state.defs, registryOf());
  const dot = el("span", "wn-dot");
  if (status === "installed") dot.classList.add("is-found");
  else if (status === "missing") dot.classList.add("is-missing");
  const file = el("div", "wn-file");
  file.append(el("div", "wn-copy", row.name));
  if (row.node) file.append(el("div", "wn-meta", row.node));
  const listed = packLink(row);
  if (listed && (row.name.toLowerCase().replace(/\s+/g, "-") === "devil-nodes" || listed === DEVIL_REGISTRY_URL)) {
    file.append(externalLink(listed, "wn-meta wn-mdlink", listed.replace(/^https?:\/\//, "")));
  }
  const action = el("span", "wn-action");
  const offer = updateDestination(row, managerAvailable(), status);
  if (offer.type === "installed") {
    action.append(el("span", "wn-pill", "Installed"));
  } else if (offer.type === "manager" || offer.type === "registry") {
    const button = el("button", "wn-use", "Update");
    button.type = "button";
    button.dataset.wnHit = "update";
    button.title = offer.type === "manager" ? "Open ComfyUI Manager" : "Open the registry page";
    button.addEventListener("click", () => {
      if (offer.type === "manager" && openManager()) return;
      const url = offer.url || packLink(row);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });
    action.append(button);
  } else if (offer.url) {
    action.append(externalLink(offer.url, "wn-chip", "Open"));
  }
  line.append(dot, file, action);
  return line;
}

function linkBlock(parent, note) {
  if (!note.links.length) return;
  const section = el("div", "wn-section");
  section.append(el("div", "wn-h", "Links"));
  const chips = el("div", "wn-chips");
  for (const link of note.links) chips.append(externalLink(link.url, "wn-chip", link.label));
  section.append(chips);
  parent.append(section);
}

function badgeRow(parent, state) {
  if (state.note.layout !== "card" || !state.note.packs.length) return;
  const row = el("div", "wn-badges");
  for (const pack of state.note.packs) {
    const status = probeInstalled(pack.node, state.defs, registryOf());
    const badge = el("span", "wn-badge");
    const dot = el("span", "wn-dot");
    if (status === "installed") dot.classList.add("is-found");
    else if (status === "missing") dot.classList.add("is-missing");
    badge.append(dot, el("span", "", pack.name));
    badge.dataset.wnHit = "badge";
    row.append(badge);
  }
  parent.append(row);
}

function render(state) {
  conceal(noteWidget(state.node));
  suppressPreview(state.node);
  const note = state.note;
  const root = state.root;
  const accent = cleanAccent(note.accent) || DEFAULT_ACCENT;
  root.style.setProperty("--wn-accent", accent);
  root.replaceChildren();
  const card = el("div", "wn-card");
  if (note.layout === "banner") card.classList.add("wn-banner");
  if (note.layout === "tile") card.classList.add("wn-tileface");
  const pencil = el("button", "wn-pencil");
  pencil.type = "button";
  pencil.title = "Edit Workflow Note";
  pencil.setAttribute("aria-label", "Edit Workflow Note");
  pencil.dataset.wnHit = "edit";
  pencil.append(pencilIcon());
  pencil.addEventListener("click", () => openEditor(state));
  const grip = el("button", "wn-grip");
  grip.type = "button";
  grip.tabIndex = 0;
  grip.title = "Resize. Arrow keys resize this note. Shift is one pixel.";
  grip.setAttribute("aria-label", "Resize note");
  grip.dataset.wnHit = "grip";
  grip.addEventListener("pointerdown", (event) => beginResize(state, event));
  grip.addEventListener("keydown", (event) => {
    const delta = arrowDelta(event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const next = resizeBy({ width: state.node.size?.[0], height: state.node.size?.[1] }, note.layout, delta.dw, delta.dh);
    setNodeSize(state, next.width, next.height);
  });

  if (note.layout === "tile") {
    const open = el("button", "wn-tile");
    open.type = "button";
    open.dataset.wnHit = "read";
    open.append(tileUsesDownloadIcon(note) ? downloadIcon() : bookIcon());
    open.append(el("span", "wn-tile-title", note.title || "Workflow note"));
    open.addEventListener("click", () => openReader(state));
    card.append(open, pencil, grip);
    root.append(card);
    fill(state);
    return;
  }

  const scroll = el("div", "wn-scroll");
  const stack = el("div", "wn-stack");
  const head = el("div", "wn-head");
  head.append(el("h2", "wn-title wn-text", note.title || "Workflow note"));
  if (note.subtitle) head.append(el("p", "wn-sub wn-text", note.subtitle));
  if (note.author) head.append(el("p", "wn-by", `by ${note.author}`));
  stack.append(head);
  if (note.layout === "card") {
    badgeRow(stack, state);
    if (!noteHasContent(note)) stack.append(el("p", "wn-empty", "Empty note. Use the pencil to write it."));
    if (note.body.trim()) {
      const section = el("div", "wn-section");
      paintBody(section, note.body);
      stack.append(section);
    }
    modelBlock(state, stack);
    packBlock(state, stack);
    linkBlock(stack, note);
  }
  scroll.append(stack);
  card.append(scroll, pencil, grip);
  root.append(card);
  fill(state);
  grow(state);
}

function titleChrome() {
  const title = globalThis.LiteGraph?.NODE_TITLE_HEIGHT;
  return Number.isFinite(title) && title > 0 ? title : 30;
}

function contentPixels(state) {
  const stack = state.root.querySelector(".wn-stack");
  if (!stack) return minimumSize(state.note.layout).height;
  return Math.ceil(stack.getBoundingClientRect().height + titleChrome() + 12);
}

function setNodeSize(state, width, height) {
  const next = [Math.round(width), Math.round(height)];
  if (typeof state.node.setSize === "function") state.node.setSize(next);
  else state.node.size = next;
  state.node.setDirtyCanvas?.(true, true);
  fill(state);
}

function grow(state) {
  const layout = state.note.layout;
  if (layout === "tile") return;
  const min = minimumSize(layout);
  const width = Math.max(min.width, state.node.size?.[0] || 0);
  const current = state.node.size?.[1] || 0;
  const needed = Math.max(min.height, contentPixels(state));
  if (current + 1 < needed || (state.node.size?.[0] || 0) + 1 < min.width) {
    setNodeSize(state, width, Math.max(current, needed));
  }
}

function fill(state) {
  const root = state.root;
  if (!root) return;
  enableHits(root);
  markVueNode(state);
  const overlay = root.closest?.(".dom-widget");
  if (overlay) return;
  const min = minimumSize(state.note.layout);
  const width = Math.max(min.width, (state.node.size?.[0] || min.width) - 16);
  const height = Math.max(state.note.layout === "tile" ? 42 : min.height - titleChrome(), (state.node.size?.[1] || min.height) - titleChrome());
  root.style.width = `${Math.round(width)}px`;
  root.style.height = `${Math.round(height)}px`;
}

function enableHits(root) {
  root.style.setProperty("width", "100%", "important");
  root.style.setProperty("height", "100%", "important");
  root.style.setProperty("pointer-events", "auto", "important");
  let node = root.parentElement;
  while (node && node !== document.body) {
    node.style.setProperty("pointer-events", "auto", "important");
    if (node.classList?.contains("dom-widget") || node.classList?.contains("lg-node")) break;
    node = node.parentElement;
  }
}

function markVueNode(state) {
  const id = state.node?.id;
  if (id == null) return;
  const shell = document.querySelector(`.lg-node[data-node-id="${cssName(id)}"]`);
  if (!shell) return;
  shell.classList.add("wn-on-node");
  state.node.imgs = null;
  state.node.images = null;
}

function suppressPreview(node) {
  node.imgs = null;
  node.images = null;
  for (const widget of node.widgets || []) {
    const kind = String(widget?.type || "");
    const name = String(widget?.name || "");
    if (name === "note" || name === "note_panel") continue;
    if (kind === "image" || kind === "preview" || /preview/i.test(name)) {
      widget.hidden = true;
      widget.computeSize = () => [0, -4];
      widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    }
  }
}

function beginResize(state, event) {
  event.preventDefault();
  event.stopPropagation();
  const scale = state.node.graph?.canvas?.ds?.scale || state.node.graph?.ds?.scale || 1;
  const start = {
    x: event.clientX,
    y: event.clientY,
    w: state.node.size?.[0] || minimumSize(state.note.layout).width,
    h: state.node.size?.[1] || minimumSize(state.note.layout).height,
  };
  const move = (ev) => {
    const next = resizeBy(
      { width: start.w, height: start.h },
      state.note.layout,
      (ev.clientX - start.x) / (scale || 1),
      (ev.clientY - start.y) / (scale || 1),
    );
    setNodeSize(state, next.width, next.height);
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}

function snapTile(state, previous) {
  if (state.note.layout !== "tile" || previous === "tile") return;
  const width = Math.max(minimumSize("tile").width, state.node.size?.[0] || 0);
  setNodeSize(state, width, 80);
}

async function recheck(state, fresh) {
  if (!state.root?.isConnected && state.dom) return;
  state.checking = true;
  render(state);
  const catalog = await loadCatalog(fresh);
  const defs = await loadDefs(fresh);
  const names = new Set();
  for (const row of state.note.models) {
    for (const folder of searchFolders(row.folder, catalog.aliases)) names.add(folder);
  }
  const files = {};
  await Promise.all(
    [...names].map(async (folder) => {
      files[folder] = await listFiles(folder, fresh);
    }),
  );
  state.catalog = catalog;
  state.defs = defs;
  state.files = files;
  state.checking = false;
  if (readAutoPick()) {
    const nodes = graphNodes(state);
    for (const row of state.note.models) {
      const result = resultFor(state, row);
      const unique = uniqueMatch(result);
      if (!unique || !shouldAutoPick(true, result)) continue;
      const plan = loaderUpdates(nodes, row, unique.path);
      applyLoaderUpdates(nodes, plan);
      for (const step of plan) {
        const node = nodes.find((item) => item.id === step.nodeId);
        const widget = node?.widgets?.find((item) => item.name === step.widget);
        if (widget && typeof widget.callback === "function") widget.callback(step.to);
      }
    }
  }
  render(state);
  readerRefresh?.();
}

let readerRefresh = null;
let readerKey = null;

function closeLayer() {
  readerRefresh = null;
  if (readerKey) {
    document.removeEventListener("keydown", readerKey, true);
    readerKey = null;
  }
  document.getElementById("wn-layer")?.remove();
}

function layer(className) {
  closeLayer();
  const overlay = el("div", "wn-overlay");
  overlay.id = "wn-layer";
  const dialog = el("div", `wn-dialog ${className || ""}`.trim());
  overlay.append(dialog);
  overlay.addEventListener("pointerdown", (event) => event.stopPropagation());
  overlay.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  document.body.append(overlay);
  return { overlay, dialog };
}

function fillReader(body, state) {
  body.replaceChildren();
  const face = normalizeNote({ ...state.note, layout: "card" });
  if (face.subtitle) body.append(el("p", "wn-sub", face.subtitle));
  if (face.author) body.append(el("p", "wn-by", `by ${face.author}`));
  if (face.body.trim()) paintBody(body, face.body);
  modelBlock(state, body);
  packBlock(state, body);
  linkBlock(body, face);
}

function openReader(state) {
  const { overlay, dialog } = layer("wn-reader");
  const head = el("div", "wn-dhead");
  head.append(el("span", "", state.note.title || "Workflow note"), el("span", "wn-spacer"));
  const edit = el("button", "wn-btn", "Edit");
  edit.type = "button";
  edit.addEventListener("click", () => openEditor(state));
  const close = el("button", "wn-btn", "Close");
  close.type = "button";
  const body = el("div", "wn-dbody");
  const dismiss = () => {
    readerRefresh = null;
    if (readerKey) {
      document.removeEventListener("keydown", readerKey, true);
      readerKey = null;
    }
    overlay.remove();
  };
  close.addEventListener("click", dismiss);
  head.append(edit, close);
  fillReader(body, state);
  readerRefresh = () => {
    if (!overlay.isConnected) return;
    const title = head.querySelector("span");
    if (title) title.textContent = state.note.title || "Workflow note";
    fillReader(body, state);
  };
  dialog.append(head, body);
  overlay.addEventListener("pointerup", (event) => {
    if (event.target !== overlay) return;
    const sel = document.getSelection?.();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    dismiss();
  });
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    if (document.getElementById("wn-layer") !== overlay) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };
  readerKey = onKey;
  document.addEventListener("keydown", onKey, true);
}

function field(label, control) {
  const wrap = el("label", "wn-field");
  wrap.append(el("span", "", label), control);
  return wrap;
}

function openEditor(state) {
  const draft = normalizeNote(state.note);
  const { overlay, dialog } = layer();
  const head = el("div", "wn-dhead");
  head.append(el("span", "", "Edit Workflow Note"), el("span", "wn-spacer"));
  const rawButton = el("button", "wn-btn", "JSON");
  rawButton.type = "button";
  head.append(rawButton);
  const body = el("div", "wn-dbody");
  const rawWrap = el("div", "wn-field");
  const raw = el("textarea");
  raw.spellcheck = false;
  rawWrap.append(el("span", "", "Raw JSON"), raw);
  rawWrap.hidden = true;
  const error = el("span", "wn-error");
  let rawMode = false;

  const title = el("input");
  title.type = "text";
  title.value = draft.title;
  const subtitle = el("input");
  subtitle.type = "text";
  subtitle.value = draft.subtitle;
  const author = el("input");
  author.type = "text";
  author.value = draft.author;
  const grid = el("div", "wn-grid");
  grid.append(field("Title", title), field("Subtitle", subtitle), field("Author", author));

  const seg = el("div", "wn-seg");
  const segButtons = LAYOUTS.map((layout) => {
    const button = el("button", layout === draft.layout ? "on" : "", layout === "tile" ? "Tile" : layout[0].toUpperCase() + layout.slice(1));
    button.type = "button";
    button.dataset.layout = layout;
    button.addEventListener("click", () => {
      draft.layout = layout;
      for (const item of segButtons) item.classList.toggle("on", item.dataset.layout === layout);
    });
    seg.append(button);
    return button;
  });

  const picker = el("input");
  picker.type = "color";
  picker.value = cleanAccent(draft.accent) || DEFAULT_ACCENT;
  const hex = el("input");
  hex.type = "text";
  hex.value = draft.accent;
  hex.placeholder = "default";
  hex.spellcheck = false;
  const clear = el("button", "wn-btn", "Default");
  clear.type = "button";
  const accentRow = el("div", "wn-accentrow");
  accentRow.append(picker, hex, clear);
  picker.addEventListener("input", () => {
    hex.value = picker.value;
    draft.accent = cleanAccent(picker.value);
  });
  hex.addEventListener("input", () => {
    const next = cleanAccent(hex.value);
    draft.accent = hex.value.trim() ? next : "";
    if (next) picker.value = next;
  });
  clear.addEventListener("click", () => {
    draft.accent = "";
    hex.value = "";
    picker.value = DEFAULT_ACCENT;
  });

  const how = el("textarea");
  how.value = draft.body;
  const tools = el("div", "wn-tools");
  for (const tone of TONE_NAMES) {
    const button = el("button", "wn-tool", tone);
    button.type = "button";
    button.addEventListener("click", () => {
      const next = insertAround(how.value, how.selectionStart, how.selectionEnd, `[${tone}]`, `[/${tone}]`);
      how.value = next.value;
      draft.body = next.value;
      how.focus();
      how.selectionStart = next.caret;
      how.selectionEnd = next.caret;
      refreshPreview();
    });
    tools.append(button);
  }
  const tableButton = el("button", "wn-tool", "Table");
  tableButton.type = "button";
  tableButton.addEventListener("click", () => {
    const start = how.selectionStart || 0;
    const end = how.selectionEnd || 0;
    how.value = how.value.slice(0, start) + SAMPLE_TABLE + how.value.slice(end);
    draft.body = how.value;
    refreshPreview();
  });
  const buttonButton = el("button", "wn-tool", "Link button");
  buttonButton.type = "button";
  buttonButton.addEventListener("click", () => {
    const markup = buttonMarkup({
      label: "Label",
      url: "https://example.com",
      color: cleanAccent(draft.accent) || DEFAULT_ACCENT,
      style: "link",
    });
    const start = how.selectionStart || 0;
    const end = how.selectionEnd || 0;
    how.value = how.value.slice(0, start) + markup + how.value.slice(end);
    draft.body = how.value;
    how.focus();
    refreshPreview();
  });
  tools.append(tableButton, buttonButton);
  how.addEventListener("input", () => {
    draft.body = how.value;
    refreshPreview();
  });
  const preview = el("details", "wn-preview");
  const previewBox = el("div", "wn-text");
  preview.append(el("summary", "", "Preview"), previewBox);
  const refreshPreview = () => {
    if (!preview.open) return;
    previewBox.replaceChildren();
    mountMarkdown(document, previewBox, draft.body);
  };
  preview.addEventListener("toggle", refreshPreview);

  const modelsHost = el("div");
  const packsHost = el("div");
  const linksHost = el("div");

  function paintRows(host, kind) {
    host.replaceChildren();
    const heading = el("div", "wn-h");
    heading.append(el("span", "", kind), el("span", "wn-spacer"));
    if (kind === "Packs") {
      const detect = el("button", "wn-mini", "Detect from this workflow");
      detect.type = "button";
      detect.addEventListener("click", () => detectPacksInto(state, draft, () => paintRows(packsHost, "Packs")));
      heading.append(detect);
    }
    const add = el("button", "wn-mini", "Add");
    add.type = "button";
    add.disabled = draft[kindKey(kind)].length >= ROW_LIMIT;
    add.addEventListener("click", () => {
      const list = draft[kindKey(kind)];
      if (list.length >= ROW_LIMIT) return;
      list.push(blankRow(kind));
      paintRows(host, kind);
    });
    heading.append(add);
    host.append(heading);
    const table = el("div", "wn-table");
    table.append(headerRow(kind));
    draft[kindKey(kind)].forEach((row, index) => table.append(editorRow(kind, row, index, () => paintRows(host, kind), draft)));
    host.append(table);
  }

  function syncDraftFromFields() {
    draft.title = title.value;
    draft.subtitle = subtitle.value;
    draft.author = author.value;
    draft.body = how.value;
  }

  rawButton.addEventListener("click", () => {
    error.textContent = "";
    if (!rawMode) {
      syncDraftFromFields();
      raw.value = serializeNote(draft, true);
      rawMode = true;
      body.hidden = true;
      rawWrap.hidden = false;
      rawButton.textContent = "Fields";
      return;
    }
    const parsedResult = parseNoteText(raw.value);
    if (!parsedResult.ok) {
      error.textContent = parsedResult.error;
      return;
    }
    const parsed = parsedResult.note;
    try {
      Object.assign(draft, parsed);
      draft.models = parsed.models;
      draft.packs = parsed.packs;
      draft.links = parsed.links;
      title.value = draft.title;
      subtitle.value = draft.subtitle;
      author.value = draft.author;
      how.value = draft.body;
      hex.value = draft.accent;
      picker.value = cleanAccent(draft.accent) || DEFAULT_ACCENT;
      for (const item of segButtons) item.classList.toggle("on", item.dataset.layout === draft.layout);
      paintRows(modelsHost, "Models");
      paintRows(packsHost, "Packs");
      paintRows(linksHost, "Links");
      rawMode = false;
      body.hidden = false;
      rawWrap.hidden = true;
      rawButton.textContent = "JSON";
    } catch {
      error.textContent = "That JSON could not be read.";
    }
  });

  body.append(grid, field("Layout", seg), field("Accent", accentRow), field("How-to", how));
  const howField = body.lastChild;
  howField.insertBefore(tools, how);
  body.append(preview, modelsHost, packsHost, linksHost);
  paintRows(modelsHost, "Models");
  paintRows(packsHost, "Packs");
  paintRows(linksHost, "Links");

  const foot = el("div", "wn-dfoot");
  const cancel = el("button", "wn-btn", "Cancel");
  cancel.type = "button";
  const save = el("button", "wn-btn primary", "Save");
  save.type = "button";
  foot.append(error, el("span", "wn-spacer"), cancel, save);

  const requestClose = () => {
    if (rawMode) {
      const parsedResult = parseNoteText(raw.value);
      if (parsedResult.ok) {
        Object.assign(draft, parsedResult.note);
        draft.models = parsedResult.note.models;
        draft.packs = parsedResult.note.packs;
        draft.links = parsedResult.note.links;
      }
    } else {
      syncDraftFromFields();
    }
    if (!notesEqual(draft, state.note)) {
      if (!window.confirm("Discard changes to this note?")) return;
    }
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const commit = () => {
    error.textContent = "";
    if (rawMode) {
      const parsedResult = parseNoteText(raw.value);
      if (!parsedResult.ok) {
        error.textContent = parsedResult.error;
        return;
      }
      const parsed = parsedResult.note;
      Object.assign(draft, parsed);
      draft.models = parsed.models;
      draft.packs = parsed.packs;
      draft.links = parsed.links;
    } else {
      syncDraftFromFields();
    }
    const previous = state.note.layout;
    const next = normalizeNote(draft);
    state.note = next;
    writeNote(state.node, next);
    const dom = state.dom;
    if (dom?.options) {
      const min = minimumSize(next.layout);
      dom.options.minNodeSize = [min.width, next.layout === "tile" ? 42 : min.height];
    }
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    render(state);
    snapTile(state, previous);
    recheck(state, false);
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  };
  cancel.addEventListener("click", requestClose);
  save.addEventListener("click", commit);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) requestClose();
  });
  document.addEventListener("keydown", onKey, true);
  dialog.append(head, body, rawWrap, foot);
  title.focus();
}

function kindKey(kind) {
  if (kind === "Models") return "models";
  if (kind === "Packs") return "packs";
  return "links";
}

function blankRow(kind) {
  if (kind === "Models") return { name: "", folder: "checkpoints", url: "" };
  if (kind === "Packs") return { name: "", url: "", node: "" };
  return { label: "", url: "" };
}

function headerRow(kind) {
  const row = el("div", `wn-trow head ${kindKey(kind)}`);
  const labels = kind === "Models" ? ["File", "Folder", "URL", ""] : kind === "Packs" ? ["Name", "URL", "Probe class", ""] : ["Label", "URL", ""];
  for (const label of labels) row.append(el("span", "", label));
  return row;
}

function editorRow(kind, row, index, repaint, draft) {
  const line = el("div", `wn-trow ${kindKey(kind)}`);
  const list = draft[kindKey(kind)];
  if (kind === "Models") {
    const name = el("input");
    name.value = row.name || "";
    name.placeholder = "model.safetensors";
    name.addEventListener("input", () => {
      list[index].name = name.value;
    });
    const folder = el("select");
    const choices = folderOptions(Object.keys(catalogCache?.folders || {}), row.folder || "checkpoints");
    for (const optionName of choices.options) {
      const option = el("option", "", optionName);
      option.value = optionName;
      if (optionName === choices.selected) option.selected = true;
      folder.append(option);
    }
    folder.addEventListener("change", () => {
      list[index].folder = folder.value;
    });
    const url = el("input");
    url.value = row.url || "";
    url.placeholder = "https://";
    url.addEventListener("input", () => {
      list[index].url = url.value;
    });
    line.append(name, folder, url, removeButton(list, index, repaint));
  } else if (kind === "Packs") {
    const name = el("input");
    name.value = row.name || "";
    name.addEventListener("input", () => {
      list[index].name = name.value;
    });
    const url = el("input");
    url.value = row.url || "";
    url.placeholder = "https://";
    url.addEventListener("input", () => {
      list[index].url = url.value;
    });
    const probe = el("input");
    probe.value = row.node || "";
    probe.placeholder = "NodeClass";
    probe.addEventListener("input", () => {
      list[index].node = probe.value;
    });
    line.append(name, url, probe, removeButton(list, index, repaint));
  } else {
    const label = el("input");
    label.value = row.label || "";
    label.addEventListener("input", () => {
      list[index].label = label.value;
    });
    const url = el("input");
    url.value = row.url || "";
    url.placeholder = "https://";
    url.addEventListener("input", () => {
      list[index].url = url.value;
    });
    line.append(label, url, removeButton(list, index, repaint));
  }
  return line;
}

function removeButton(list, index, repaint) {
  const button = el("button", "wn-x", "×");
  button.type = "button";
  button.title = "Remove row";
  button.addEventListener("click", () => {
    list.splice(index, 1);
    repaint();
  });
  return button;
}

async function detectPacksInto(state, draft, repaint) {
  const defs = await loadDefs(false);
  const found = graphNodes(state).map((node) => ({
    type: node.type || node.comfyClass || "",
    module: moduleOf(node, defs),
  }));
  draft.packs = mergePacks(draft.packs, detectPacks(found));
  repaint();
}

function hitControl(x, y, root) {
  if (!root?.isConnected) return null;
  const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [];
  for (const node of stack) {
    if (!root.contains(node)) continue;
    return node.closest?.("[data-wn-hit], a, button, input, textarea, select, summary") || node;
  }
  let found = null;
  root.querySelectorAll("[data-wn-hit]").forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) found = node;
  });
  return found;
}

function installHits() {
  if (hitsReady) return;
  hitsReady = true;
  let armed = null;
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      for (const state of liveNotes) {
        if (state.root?.contains(event.target)) return;
        const hit = hitControl(event.clientX, event.clientY, state.root);
        if (!hit) continue;
        event.preventDefault();
        event.stopPropagation();
        armed = { hit, x: event.clientX, y: event.clientY, state };
        if (hit.dataset?.wnHit === "grip") beginResize(state, event);
        return;
      }
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      const pending = armed;
      armed = null;
      if (!pending || pending.hit.dataset?.wnHit === "grip") return;
      if (Math.abs(event.clientX - pending.x) > 6 || Math.abs(event.clientY - pending.y) > 6) return;
      const again = hitControl(event.clientX, event.clientY, pending.state.root);
      if (again !== pending.hit && !pending.hit.contains?.(again)) return;
      event.preventDefault();
      event.stopPropagation();
      if (pending.hit.tagName === "A") {
        const href = pending.hit.getAttribute("href");
        if (href) window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      pending.hit.click();
    },
    true,
  );
  document.addEventListener(
    "contextmenu",
    (event) => {
      for (const state of liveNotes) {
        if (!state.root?.isConnected || !hitControl(event.clientX, event.clientY, state.root)) continue;
        const shell = document.querySelector(`.lg-node[data-node-id="${cssName(state.node.id)}"]`);
        if (!shell || shell.contains(event.target)) return;
        event.preventDefault();
        shell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, button: 2 }));
        return;
      }
    },
    true,
  );
}

function installKeys() {
  if (keysReady) return;
  keysReady = true;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "r" && event.key !== "R") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
    if (!liveNotes.size) return;
    for (const state of liveNotes) recheck(state, true);
  });
}

function widgetHeight(state) {
  const layout = state.note.layout;
  const min = minimumSize(layout);
  const nodeH = state.node.size?.[1] || min.height;
  const interior = Math.max(layout === "tile" ? 42 : min.height - titleChrome(), nodeH - titleChrome());
  return interior;
}

function attach(node) {
  if (!node || node.workflowNote) return node?.workflowNote;
  ensureCss();
  installHits();
  installKeys();
  conceal(noteWidget(node));
  suppressPreview(node);
  const root = el("div", "wn-root");
  stopPress(root);
  const state = {
    node,
    root,
    note: normalizeNote("{}"),
    files: null,
    catalog: null,
    defs: null,
    checking: false,
    dom: null,
  };
  node.workflowNote = state;
  node.color = "#5c342f";
  node.bgcolor = "#12110f";
  if (typeof node.addDOMWidget === "function") {
    const dom = node.addDOMWidget("note_panel", "workflow_note", root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight() {
        return widgetHeight(state);
      },
      getHeight() {
        return widgetHeight(state);
      },
      afterResize() {
        fill(state);
      },
    });
    dom.serialize = false;
    if (dom.options) dom.options.serialize = false;
    dom.computeLayoutSize = () => {
      const min = minimumSize(state.note.layout);
      return {
        minHeight: widgetHeight(state),
        minWidth: Math.min(min.width, state.node.size?.[0] || min.width),
      };
    };
    dom.computeSize = () => [Math.max(state.node.size?.[0] || 0, 220), widgetHeight(state)];
    state.dom = dom;
  }
  liveNotes.add(state);
  reload(state);
  const previousRemoved = node.onRemoved;
  node.onRemoved = function workflowNoteRemoved(...args) {
    liveNotes.delete(state);
    if (typeof previousRemoved === "function") previousRemoved.apply(this, args);
    node.workflowNote = null;
  };
  return state;
}

function reload(state, info) {
  let note = normalizeNote(readSource(state.node, info));
  const type = state.node.type || state.node.comfyClass;
  if (type === "WorkflowNoteTile" && note.layout !== "tile") note = normalizeNote({ ...note, layout: "tile" });
  state.note = note;
  writeWidget(noteWidget(state.node), serializeNote(note));
  state.node.properties = state.node.properties || {};
  state.node.properties.workflowNote = serializeNote(note);
  adoptType(state.node, note);
  const min = minimumSize(note.layout);
  if ((state.node.size?.[0] || 0) < min.width || (state.node.size?.[1] || 0) < (note.layout === "tile" ? 42 : min.height)) {
    setNodeSize(state, Math.max(min.width, state.node.size?.[0] || 0), Math.max(note.layout === "tile" ? 80 : min.height, state.node.size?.[1] || 0));
  }
  render(state);
  recheck(state, false);
}

function after(proto, name, next) {
  const previous = proto[name];
  proto[name] = function workflowNoteHook(...args) {
    const result = typeof previous === "function" ? previous.apply(this, args) : undefined;
    next(this, args);
    return result;
  };
}

function beforeDraw(proto) {
  const previous = proto.onDrawBackground;
  proto.onDrawBackground = function workflowNoteDraw(...args) {
    this.imgs = null;
    this.images = null;
    return typeof previous === "function" ? previous.apply(this, args) : undefined;
  };
}

app.registerExtension({
  name: "devil-nodes.WorkflowNote",
  settings: [
    {
      id: AUTO_PICK_ID,
      name: "Auto-pick found model files",
      category: ["Devil Nodes", "Workflow Note", "Auto-pick found model files"],
      type: "boolean",
      defaultValue: true,
      tooltip: "When one model file matches a row, write that path onto the loaders in this workflow.",
    },
  ],
  setup() {
    ensureCss();
    installKeys();
    const settings = app.ui?.settings;
    if (settings && typeof settings.addSetting === "function") {
      try {
        settings.addSetting({
          id: AUTO_PICK_ID,
          name: "Devil Nodes -> Workflow Note -> Auto-pick found model files",
          type: "boolean",
          defaultValue: true,
        });
      } catch {
        // The modern settings list already registered this id.
      }
    }
  },
  nodeCreated(node) {
    if (isNote(node)) attach(node);
  },
  loadedGraphNode(node) {
    if (!isNote(node)) return;
    const state = node.workflowNote || attach(node);
    reload(state);
  },
  getNodeMenuItems(node) {
    if (!isNote(node)) return;
    return [
      {
        content: "Edit Workflow Note",
        callback: () => (node.workflowNote ? openEditor(node.workflowNote) : undefined),
      },
    ];
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!NODE_TYPES.includes(nodeData?.name)) return;
    after(nodeType.prototype, "onNodeCreated", function (node) {
      attach(node);
    });
    after(nodeType.prototype, "onConfigure", function (node, args) {
      const state = node.workflowNote || attach(node);
      reload(state, args?.[0]);
    });
    const previousSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function workflowNoteSerialize(info) {
      const result = typeof previousSerialize === "function" ? previousSerialize.apply(this, arguments) : undefined;
      const state = this.workflowNote;
      const note = state?.note || normalizeNote(readSource(this));
      const text = serializeNote(note);
      writeWidget(noteWidget(this), text);
      if (info && typeof info === "object") {
        info.type = nodeTypeForLayout(note.layout);
        info.properties = { ...(info.properties || {}), workflowNote: text };
        const serialized = (this.widgets || []).filter((widget) => widget && widget.serialize !== false);
        const index = serialized.indexOf(noteWidget(this));
        if (Array.isArray(info.widgets_values) && index >= 0) info.widgets_values[index] = text;
      }
      adoptType(this, note);
      return result;
    };
    after(nodeType.prototype, "getExtraMenuOptions", function (node, args) {
      const options = Array.isArray(args?.[1]) ? args[1] : Array.isArray(args?.[0]) ? args[0] : null;
      if (!Array.isArray(options)) return;
      options.unshift({
        content: "Edit Workflow Note",
        callback: () => (node.workflowNote ? openEditor(node.workflowNote) : undefined),
      });
    });
    after(nodeType.prototype, "refreshComboInNode", function (node) {
      if (node.workflowNote) recheck(node.workflowNote, true);
    });
    after(nodeType.prototype, "onRemoved", function (node) {
      if (node.workflowNote) {
        liveNotes.delete(node.workflowNote);
        node.workflowNote = null;
      }
    });
    beforeDraw(nodeType.prototype);
  },
});
