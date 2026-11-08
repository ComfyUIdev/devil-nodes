/**
 * Workflow Helper — the card on the graph.
 *
 * View mode shows the title, the how-to, model rows, pack rows, and links.
 * The pencil opens the editor. Download asks this ComfyUI to fetch the row's
 * URL into that row's models folder and polls progress onto the same row.
 * Markdown is mounted as text nodes.
 */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
  MODEL_FOLDERS,
  ROW_LIMIT,
  cardHasContent,
  folderLabel,
  groupModels,
  hostOf,
  matchFile,
  modelSource,
  mountMarkdown,
  normalizeCard,
  packsFromNodes,
  safeLink,
  serializeCard,
} from "./workflow_helper_card.js";

const NODE_TYPE = "WorkflowHelper";
const STYLE_ID = "devil-workflow-helper-style";
const FOLDER_CACHE_MS = 20000;

const folderCache = new Map();
let folderNamesPromise = null;
let defsPromise = null;
let openEditor = null;

const CSS = `
.dh-root{box-sizing:border-box;width:100%;height:100%;padding:4px 6px 8px;color:#f3ebe7;font:12px/1.45 system-ui,sans-serif;}
.dh-root *{box-sizing:border-box;}
.dh-card{display:flex;flex-direction:column;height:100%;min-height:72px;overflow:hidden;border:1px solid #5a3330;border-radius:8px;background:#1c1412;}
.dh-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:0 0 10px;}
.dh-head{position:relative;padding:12px 36px 10px 14px;border-left:4px solid #e25b45;}
.dh-title{margin:0;color:#fff7f4;font-size:22px;font-weight:700;line-height:1.15;overflow-wrap:anywhere;}
.dh-banner .dh-title{font-size:28px;}
.dh-banner .dh-head{padding-top:16px;padding-bottom:16px;}
.dh-edit{position:absolute;top:8px;right:8px;width:26px;height:26px;border:1px solid transparent;border-radius:6px;background:transparent;color:#c9b2ac;cursor:pointer;}
.dh-edit:hover{border-color:#6a403c;background:#2a1c1a;color:#fff;}
.dh-empty{padding:4px 14px 8px;color:#b5a29c;}
.dh-section{padding:8px 14px 0;}
.dh-section + .dh-section{margin-top:8px;border-top:1px solid rgba(255,255,255,.06);padding-top:10px;}
.dh-h{display:flex;align-items:center;gap:8px;margin:0 0 6px;color:#c9b2ac;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}
.dh-h .spacer{flex:1 1 auto;}
.dh-mini{height:20px;padding:0 8px;border:1px solid #6a403c;border-radius:5px;background:#2a1c1a;color:#f3ebe7;font:11px system-ui,sans-serif;cursor:pointer;}
.dh-body{user-select:text;cursor:text;}
.dh-body p{margin:0 0 8px;overflow-wrap:anywhere;}
.dh-body h1,.dh-body h2,.dh-body h3{margin:8px 0 4px;color:#fff7f4;line-height:1.25;}
.dh-body h1{font-size:16px;}
.dh-body h2{font-size:14px;}
.dh-body h3{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#f0c2b8;}
.dh-body ul,.dh-body ol{margin:0 0 8px;padding-left:18px;}
.dh-body li{margin:2px 0;overflow-wrap:anywhere;}
.dh-body code{padding:0 4px;border-radius:3px;background:rgba(255,255,255,.08);font:11px ui-monospace,monospace;}
.dh-body pre{margin:0 0 8px;padding:8px;overflow:auto;border-radius:6px;background:#120c0b;font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;}
.dh-body a{color:#ffb1a3;pointer-events:auto;}
.dh-body table{width:100%;margin:0 0 8px;border-collapse:collapse;}
.dh-body th,.dh-body td{padding:4px 6px;border-top:1px solid #5a3330;text-align:left;vertical-align:top;overflow-wrap:anywhere;}
.dh-body th{color:#fff7f4;}
.dh-folder{margin:8px 0 2px;color:#f0c2b8;font:11px ui-monospace,monospace;}
.dh-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0;}
.dh-dot{flex:none;width:8px;height:8px;margin-top:5px;border-radius:50%;background:#6d5c58;}
.dh-dot.is-ok{background:#7dcea0;}
.dh-dot.is-missing{background:#e25b45;}
.dh-dot.is-checking{background:#c9b2ac;}
.dh-file{flex:1 1 auto;min-width:0;}
.dh-name,.dh-label{overflow-wrap:anywhere;color:#fff7f4;font:11.5px ui-monospace,monospace;}
.dh-name{cursor:copy;}
.dh-meta{color:#b5a29c;font-size:10.5px;overflow-wrap:anywhere;}
.dh-meta.is-error{color:#ffb1a3;}
.dh-action{flex:none;display:flex;align-items:center;gap:6px;}
.dh-dl,.dh-link{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border:1px solid #e25b45;border-radius:5px;background:rgba(226,91,69,.16);color:#fff7f4;font-size:11px;font-weight:700;text-decoration:none;cursor:pointer;}
.dh-dl:hover,.dh-link:hover{background:#e25b45;color:#2a100d;}
.dh-dl:disabled{opacity:.7;cursor:default;}
.dh-pill{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:11px;background:rgba(125,206,160,.16);color:#b7ebc8;font-size:10.5px;white-space:nowrap;}
.dh-pill.is-missing{background:rgba(226,91,69,.16);color:#ffb1a3;}
.dh-bar{height:5px;margin-top:4px;overflow:hidden;border-radius:3px;background:#3a2826;}
.dh-bar > span{display:block;height:100%;width:0;background:#e25b45;}
.dh-chips{display:flex;flex-wrap:wrap;gap:6px;}
.dh-chip{display:inline-flex;align-items:center;height:24px;padding:0 10px;border:1px solid #6a403c;border-radius:12px;background:#2a1c1a;color:#fff7f4;font-size:11px;text-decoration:none;}
.dh-chip:hover{border-color:#e25b45;}
.dh-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);}
.dh-dialog{display:flex;flex-direction:column;width:min(880px,94vw);max-height:92vh;border:1px solid #6a403c;border-radius:10px;background:#1c1412;color:#f3ebe7;box-shadow:0 16px 50px rgba(0,0,0,.5);font:12px/1.4 system-ui,sans-serif;}
.dh-dialog *{box-sizing:border-box;}
.dh-dhead,.dh-dfoot{display:flex;align-items:center;gap:8px;padding:10px 14px;}
.dh-dhead{border-bottom:1px solid #3a2826;color:#ffb1a3;font-weight:700;}
.dh-dfoot{border-top:1px solid #3a2826;}
.dh-dbody{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px;}
.dh-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.dh-field{display:flex;flex-direction:column;gap:4px;}
.dh-field > span{color:#c9b2ac;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;}
.dh-hint,.dh-error{color:#b5a29c;font-size:11px;}
.dh-error{color:#ffb1a3;}
.dh-dialog input,.dh-dialog textarea,.dh-dialog select{width:100%;padding:6px 8px;border:1px solid #6a403c;border-radius:5px;background:#2a1c1a;color:#fff7f4;font:12px/1.4 system-ui,sans-serif;}
.dh-dialog textarea{min-height:120px;resize:vertical;font:12px/1.45 ui-monospace,monospace;}
.dh-table{display:flex;flex-direction:column;gap:4px;}
.dh-trow{display:grid;gap:6px;align-items:center;}
.dh-trow.models{grid-template-columns:minmax(110px,1.2fr) 110px minmax(140px,1.4fr) 72px minmax(90px,.8fr) 26px;}
.dh-trow.packs{grid-template-columns:minmax(110px,1fr) minmax(140px,1.3fr) minmax(120px,1fr) 26px;}
.dh-trow.links{grid-template-columns:minmax(100px,.7fr) minmax(160px,1.5fr) 26px;}
.dh-trow.head{color:#c9b2ac;font-size:10px;letter-spacing:.05em;text-transform:uppercase;}
.dh-btn{height:26px;padding:0 10px;border:1px solid #6a403c;border-radius:5px;background:#2a1c1a;color:#fff7f4;font:12px system-ui,sans-serif;cursor:pointer;}
.dh-btn:hover{border-color:#e25b45;}
.dh-btn.primary{border-color:#e25b45;background:#e25b45;color:#2a100d;font-weight:700;}
.dh-x{width:26px;height:26px;border:0;border-radius:5px;background:transparent;color:#c9b2ac;cursor:pointer;}
.dh-seg{display:inline-flex;border:1px solid #6a403c;border-radius:5px;overflow:hidden;}
.dh-seg button{height:26px;padding:0 10px;border:0;background:#2a1c1a;color:#c9b2ac;cursor:pointer;}
.dh-seg button + button{border-left:1px solid #6a403c;}
.dh-seg button.on{background:#e25b45;color:#2a100d;font-weight:700;}
.dh-preview{border:1px solid #6a403c;border-radius:6px;padding:8px;}
.dh-preview summary{cursor:pointer;color:#f0c2b8;}
.spacer{flex:1 1 auto;}
`;

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

function stopDrag(node) {
  node.addEventListener("pointerdown", (event) => event.stopPropagation());
  node.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
}

function cardWidget(node) {
  return node.widgets?.find((widget) => widget.name === "card");
}

function conceal(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.serialize = true;
  widget.computeSize = () => [0, -4];
  const box = widget.element || widget.inputEl;
  if (box?.style) box.style.display = "none";
}

function readSource(node, info) {
  const fromProps = info?.properties?.workflowHelper ?? node.properties?.workflowHelper;
  if (typeof fromProps === "string" && fromProps.trim()) return fromProps;
  const widget = cardWidget(node);
  if (typeof widget?.value === "string" && widget.value.trim()) return widget.value;
  return "{}";
}

function writeCard(node, card) {
  const text = serializeCard(card);
  if (node.workflowHelper) node.workflowHelper.sourceText = text;
  const widget = cardWidget(node);
  if (widget) {
    widget.value = text;
    widget.callback?.(text);
  }
  node.properties = node.properties || {};
  node.properties.workflowHelper = text;
  node.setDirtyCanvas?.(true, true);
}

function listFolder(folder, fresh) {
  const cached = folderCache.get(folder);
  if (!fresh && cached && performance.now() - cached.at < FOLDER_CACHE_MS) return cached.promise;
  const promise = api
    .fetchApi(`/models/${encodeURIComponent(folder)}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((files) => (Array.isArray(files) ? files : null))
    .catch(() => null);
  folderCache.set(folder, { at: performance.now(), promise });
  return promise;
}

function knownFolders() {
  if (!folderNamesPromise) {
    folderNamesPromise = api
      .fetchApi("/models")
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => (Array.isArray(list) ? list.filter((item) => typeof item === "string") : []))
      .catch(() => []);
  }
  return folderNamesPromise;
}

function nodeDefs(fresh) {
  if (fresh) defsPromise = null;
  if (!defsPromise) {
    defsPromise = api
      .fetchApi("/object_info")
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
  }
  return defsPromise;
}

function probeState(nodeClass, defs) {
  if (!nodeClass) return "unchecked";
  if (defs && Object.prototype.hasOwnProperty.call(defs, nodeClass)) return "installed";
  const types = globalThis.LiteGraph?.registered_node_types;
  if (types && Object.prototype.hasOwnProperty.call(types, nodeClass)) return "installed";
  return defs ? "missing" : "unchecked";
}

function walkNodes(visit) {
  const seen = new Set();
  const walk = (graph) => {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    for (const node of graph.nodes || graph._nodes || []) {
      visit(node);
      if (node.subgraph) walk(node.subgraph);
    }
  };
  walk(app.rootGraph || app.graph);
}

function moduleOf(node, defs) {
  const type = node?.type || node?.comfyClass || "";
  const fromDefs = defs?.[type]?.python_module;
  if (typeof fromDefs === "string" && fromDefs) return fromDefs;
  const registered = globalThis.LiteGraph?.registered_node_types?.[type];
  const fromNode = registered?.nodeData?.python_module;
  return typeof fromNode === "string" ? fromNode : "";
}

function externalLink(url, className, text) {
  const link = el("a", className, text);
  const safe = safeLink(url);
  if (safe) {
    link.href = safe;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  stopDrag(link);
  return link;
}

function setDot(dot, status, title) {
  dot.className = `dh-dot is-${status}`;
  dot.title = title || "";
}

function rowKey(row) {
  return `${row.folder}\n${row.name}`;
}

function applyJob(view, job) {
  const status = job?.status;
  if (status === "downloading") {
    view.showProgress(job.percent || 0, job.message || "Downloading…");
    return;
  }
  if (status === "done") {
    view.showInstalled(job.message || "Installed");
    return;
  }
  if (status === "error") {
    view.showError(job.error || job.message || "Download failed");
  }
}

function modelRowView(state, row) {
  const line = el("div", "dh-row");
  const dot = el("span", "dh-dot is-checking");
  const file = el("div", "dh-file");
  const name = el("div", "dh-name", row.name);
  name.title = "Click to copy the file name";
  stopDrag(name);
  name.addEventListener("click", () => {
    const original = row.name;
    const finish = (label) => {
      name.textContent = label;
      setTimeout(() => {
        if (name.textContent === label) name.textContent = original;
      }, 800);
    };
    navigator.clipboard?.writeText(original).then(() => finish("Copied")).catch(() => finish(original));
  });
  file.append(name);
  if (row.note || row.size) {
    const bits = [];
    if (row.note) bits.push(row.note);
    if (row.size) bits.push(row.size);
    file.append(el("div", "dh-meta", bits.join(" · ")));
  }
  const status = el("div", "dh-meta");
  const bar = el("div", "dh-bar");
  const fill = el("span");
  bar.append(fill);
  bar.hidden = true;
  file.append(bar, status);
  const action = el("span", "dh-action");
  line.append(dot, file, action);

  const view = {
    dot,
    showDownload() {
      action.textContent = "";
      bar.hidden = true;
      status.textContent = "";
      status.classList.remove("is-error");
      if (!row.url) {
        status.textContent = "No download URL on this row.";
        return;
      }
      const button = el("button", "dh-dl", "Download");
      button.type = "button";
      const where = hostOf(row.url) || "the source";
      button.title = `Download into ${folderLabel(row.folder)} from ${where}`;
      stopDrag(button);
      button.addEventListener("click", () => startDownload(state, row, view));
      action.append(button);
    },
    showProgress(percent, message) {
      action.textContent = "";
      const button = el("button", "dh-dl", `${Math.max(0, Math.min(100, percent || 0))}%`);
      button.type = "button";
      button.disabled = true;
      action.append(button);
      bar.hidden = false;
      fill.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
      status.classList.remove("is-error");
      status.textContent = message || "";
      setDot(dot, "checking", message || "Downloading");
    },
    showInstalled(where) {
      action.textContent = "";
      bar.hidden = true;
      status.textContent = "";
      status.classList.remove("is-error");
      const pill = el("span", "dh-pill", "Installed");
      if (where) pill.title = where;
      action.append(pill);
      setDot(dot, "ok", where || "Installed");
    },
    showError(message) {
      action.textContent = "";
      bar.hidden = true;
      const button = el("button", "dh-dl", "Retry");
      button.type = "button";
      stopDrag(button);
      button.addEventListener("click", () => startDownload(state, row, view));
      action.append(button);
      status.classList.add("is-error");
      status.textContent = message || "Download failed";
      setDot(dot, "missing", message || "Download failed");
    },
    showMissing(title) {
      setDot(dot, "missing", title || "Missing");
      const job = state.jobs.get(rowKey(row));
      if (job?.status === "error") view.showError(job.error || job.message);
      else view.showDownload();
    },
    showUnknown(title) {
      setDot(dot, "unknown", title || "Not checked");
      view.showDownload();
    },
  };
  view.showDownload();
  const job = state.jobs.get(rowKey(row));
  if (job?.status === "downloading" || job?.status === "error") applyJob(view, job);
  state.views.set(rowKey(row), view);
  return line;
}

async function startDownload(state, row, view) {
  view.showProgress(0, "Starting…");
  let response;
  try {
    response = await api.fetchApi("/devil-nodes/helper/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: row.url, filename: row.name, folder: row.folder }),
    });
  } catch {
    view.showError("Could not reach the download route.");
    return;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    view.showError(body.error || "Download was rejected.");
    return;
  }
  state.jobs.set(rowKey(row), body);
  applyJob(view, body);
  if (body.status === "done") {
    state.recheck(true);
    return;
  }
  if (body.id) watchJob(state, row, body.id);
}

function watchJob(state, row, id) {
  const key = rowKey(row);
  const previous = state.timers.get(key);
  if (previous) clearInterval(previous);
  const timer = setInterval(async () => {
    let job;
    try {
      const response = await api.fetchApi(`/devil-nodes/helper/status?id=${encodeURIComponent(id)}`);
      job = await response.json();
    } catch {
      return;
    }
    if (!job || job.status === "idle") return;
    state.jobs.set(key, job);
    const view = state.views.get(key);
    if (view) applyJob(view, job);
    if (job.status === "done" || job.status === "error") {
      clearInterval(timer);
      state.timers.delete(key);
      if (job.status === "done") state.recheck(true);
    }
  }, 700);
  state.timers.set(key, timer);
}

function packRow(row, defs) {
  const line = el("div", "dh-row");
  const dot = el("span", "dh-dot");
  const file = el("div", "dh-file");
  file.append(el("div", "dh-label", row.name));
  if (row.node) file.append(el("div", "dh-meta", row.node));
  const action = el("span", "dh-action");
  const state = probeState(row.node, defs);
  if (state === "installed") {
    setDot(dot, "ok", `${row.node} is registered on this ComfyUI`);
    action.append(el("span", "dh-pill", "Installed"));
  } else if (state === "missing") {
    setDot(dot, "missing", `${row.node} is not registered here`);
    if (row.url) action.append(externalLink(row.url, "dh-link", "Get pack"));
    else action.append(el("span", "dh-pill is-missing", "Missing"));
  } else {
    setDot(dot, "unknown", "Add a probe node class to check this pack");
    if (row.url) action.append(externalLink(row.url, "dh-link", "Open"));
  }
  line.append(dot, file, action);
  return line;
}

function sectionTitle(text) {
  const heading = el("div", "dh-h");
  heading.append(el("span", "", text), el("span", "spacer"));
  return heading;
}

function renderCard(state) {
  const card = state.card;
  const root = state.root;
  state.packHost = null;
  root.classList.toggle("dh-banner", card.layout === "banner");
  const scroll = state.scroll;
  scroll.textContent = "";
  state.views = new Map();

  const head = el("div", "dh-head");
  head.append(el("h1", "dh-title", card.title || "Untitled workflow"));
  const edit = el("button", "dh-edit", "✎");
  edit.type = "button";
  edit.title = "Edit Workflow Helper";
  stopDrag(edit);
  edit.addEventListener("click", () => openCardEditor(state));
  head.append(edit);
  scroll.append(head);

  if (card.layout === "banner") return;

  if (!cardHasContent(card)) {
    scroll.append(el("div", "dh-empty", "Click the pencil to add a title, a how-to, the models to download, the packs this workflow needs, and your links."));
    return;
  }

  if (card.body.trim()) {
    const section = el("div", "dh-section");
    const body = el("div", "dh-body");
    stopDrag(body);
    mountMarkdown(document, body, card.body);
    section.append(body);
    scroll.append(section);
  }

  if (card.models.length) {
    const section = el("div", "dh-section");
    const heading = sectionTitle("Models");
    const check = el("button", "dh-mini", "Check again");
    check.type = "button";
    check.title = "Look for each file in this ComfyUI";
    stopDrag(check);
    check.addEventListener("click", () => state.recheck(true));
    heading.append(check);
    section.append(heading);
    for (const group of groupModels(card.models)) {
      section.append(el("div", "dh-folder", folderLabel(group.folder)));
      for (const row of group.rows) section.append(modelRowView(state, row));
    }
    scroll.append(section);
  }

  if (card.packs.length) {
    const section = el("div", "dh-section");
    section.append(sectionTitle("Node packs"));
    state.packHost = section;
    scroll.append(section);
  }

  if (card.links.length) {
    const section = el("div", "dh-section");
    section.append(sectionTitle("Links"));
    const chips = el("div", "dh-chips");
    for (const link of card.links) {
      if (link.url) chips.append(externalLink(link.url, "dh-chip", link.label));
      else chips.append(el("span", "dh-chip", link.label));
    }
    section.append(chips);
    scroll.append(section);
  }

  state.recheck(false);
}

async function checkInstall(state, fresh) {
  const generation = (state.generation = (state.generation || 0) + 1);
  const defs = await nodeDefs(fresh);
  if (generation !== state.generation) return;
  if (state.packHost) {
    const heading = state.packHost.querySelector(".dh-h");
    state.packHost.textContent = "";
    if (heading) state.packHost.append(heading);
    else state.packHost.append(sectionTitle("Node packs"));
    for (const row of state.card.packs) state.packHost.append(packRow(row, defs));
  }
  const groups = new Map();
  for (const row of state.card.models) {
    if (!groups.has(row.folder)) groups.set(row.folder, []);
    groups.get(row.folder).push(row);
  }
  await Promise.all([...groups.entries()].map(async ([folder, rows]) => {
    if (!folder) {
      for (const row of rows) state.views.get(rowKey(row))?.showUnknown("No folder set, so this file is not checked");
      return;
    }
    const files = await listFolder(folder, fresh);
    if (generation !== state.generation) return;
    for (const row of rows) {
      const view = state.views.get(rowKey(row));
      if (!view) continue;
      const active = state.jobs.get(rowKey(row));
      if (active?.status === "downloading") {
        applyJob(view, active);
        continue;
      }
      if (files == null) {
        view.showUnknown(`This ComfyUI has no "${folder}" model folder`);
        continue;
      }
      const match = matchFile(row.name, files);
      if (match.found) view.showInstalled(match.path ? `Found: ${match.path}` : "Found");
      else view.showMissing(`Not in ${folderLabel(folder)}`);
    }
  }));
}

function field(title, control, hint) {
  const wrap = el("div", "dh-field");
  wrap.append(el("span", "", title), control);
  if (hint) wrap.append(el("p", "dh-hint", hint));
  return wrap;
}

function textInput(value, placeholder) {
  const input = el("input");
  input.type = "text";
  input.value = value || "";
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function closeEditor() {
  if (!openEditor) return;
  openEditor.abort.abort();
  openEditor.root.remove();
  openEditor = null;
}

function editorTable(kind, headers, rows, makeInputs) {
  const box = el("div", "dh-table");
  const head = el("div", `dh-trow ${kind} head`);
  for (const header of headers) head.append(el("span", "", header));
  head.append(el("span"));
  box.append(head);
  const entries = [];
  const add = (row) => {
    if (entries.length >= ROW_LIMIT) return;
    const line = el("div", `dh-trow ${kind}`);
    const inputs = makeInputs(row || {});
    for (const input of inputs) line.append(input);
    const remove = el("button", "dh-x", "✕");
    remove.type = "button";
    remove.title = "Remove row";
    const entry = { inputs };
    remove.addEventListener("click", () => {
      line.remove();
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
    });
    line.append(remove);
    box.append(line);
    entries.push(entry);
  };
  for (const row of rows) add(row);
  return { box, add, entries };
}

async function openCardEditor(state, draftCard) {
  closeEditor();
  ensureCss();
  const folders = await knownFolders();
  const folderOptions = [...new Set([...MODEL_FOLDERS, ...folders])].sort();
  const draft = normalizeCard(draftCard || state.card);
  let layout = draft.layout;

  const overlay = el("div", "dh-overlay");
  const dialog = el("div", "dh-dialog");
  const head = el("div", "dh-dhead");
  head.append(el("span", "", "Workflow Helper"), el("span", "spacer"));
  const jsonToggle = el("button", "dh-btn", "JSON");
  jsonToggle.type = "button";
  head.append(jsonToggle);
  const body = el("div", "dh-dbody");
  const foot = el("div", "dh-dfoot");
  const error = el("span", "dh-error");
  const cancel = el("button", "dh-btn", "Cancel");
  cancel.type = "button";
  const save = el("button", "dh-btn primary", "Save");
  save.type = "button";
  foot.append(error, el("span", "spacer"), cancel, save);
  dialog.append(head, body, foot);
  overlay.append(dialog);
  stopDrag(overlay);

  const form = el("div");
  form.style.display = "flex";
  form.style.flexDirection = "column";
  form.style.gap = "12px";
  const title = textInput(draft.title, "Portrait upscale");
  const seg = el("div", "dh-seg");
  const segButtons = ["card", "banner"].map((option) => {
    const button = el("button", option === layout ? "on" : "", option === "banner" ? "Banner" : "Card");
    button.type = "button";
    button.addEventListener("click", () => {
      layout = option;
      segButtons.forEach((other, index) => other.classList.toggle("on", ["card", "banner"][index] === option));
    });
    seg.append(button);
    return button;
  });
  const grid = el("div", "dh-grid");
  grid.append(
    field("Title", title),
    field("Layout", seg, "Banner is only the title, as a label on the graph."),
  );
  form.append(grid);

  const howTo = el("textarea");
  howTo.value = draft.body;
  howTo.placeholder = "## How to run\n\n1. Download the models\n2. Queue the prompt\n\n**Bold**, *italic*, `code`, and [a link](https://example.com).";
  form.append(field("How-to (Markdown)", howTo, "Headings, lists, links, and fenced code. Only http(s) links are clickable."));
  const preview = el("details", "dh-preview");
  const sample = el("div", "dh-body");
  preview.append(el("summary", "", "Preview"), sample);
  const updatePreview = () => {
    if (!preview.open) return;
    sample.textContent = "";
    mountMarkdown(document, sample, howTo.value);
  };
  preview.addEventListener("toggle", updatePreview);
  howTo.addEventListener("input", updatePreview);
  form.append(preview);

  const listId = "dh-folder-list";
  const dataList = el("datalist");
  dataList.id = listId;
  for (const folder of folderOptions) dataList.append(el("option", "", folder));
  const folderInput = (value) => {
    const input = textInput(value, "loras");
    input.setAttribute("list", listId);
    return input;
  };
  const models = editorTable("models", ["File", "Folder", "Download URL", "Size", "Note"], draft.models, (row) => [
    textInput(row.name, "model.safetensors"),
    folderInput(row.folder || "checkpoints"),
    textInput(row.url, "https://huggingface.co/.../resolve/main/model.safetensors"),
    textInput(row.size, "1.2 GB"),
    textInput(row.note, "optional note"),
  ]);
  const addModel = el("button", "dh-btn", "Add model");
  addModel.type = "button";
  addModel.addEventListener("click", () => models.add({ folder: "checkpoints" }));
  form.append(field("Models", models.box, "Each row is a file, the models folder it belongs in, and a URL. Download fetches that URL into the folder. hf://, Hugging Face, Civitai, and other http(s) links work."), addModel);
  form.append(dataList);

  const packs = editorTable("packs", ["Pack", "Link", "Probe node"], draft.packs, (row) => [
    textInput(row.name, "ComfyUI-Example"),
    textInput(row.url, "https://github.com/org/pack"),
    textInput(row.node, "ExampleNode"),
  ]);
  const packTools = el("div");
  packTools.style.display = "flex";
  packTools.style.gap = "6px";
  const addPack = el("button", "dh-btn", "Add pack");
  addPack.type = "button";
  addPack.addEventListener("click", () => packs.add({}));
  const detect = el("button", "dh-btn", "Detect from this workflow");
  detect.type = "button";
  detect.addEventListener("click", async () => {
    const defs = await nodeDefs(false);
    const nodes = [];
    walkNodes((node) => nodes.push({ type: node.type || node.comfyClass, module: moduleOf(node, defs) }));
    const have = new Set(packs.entries.map((entry) => entry.inputs[0].value.trim()));
    for (const pack of packsFromNodes(nodes)) {
      if (have.has(pack.name)) continue;
      have.add(pack.name);
      packs.add(pack);
    }
  });
  packTools.append(addPack, detect);
  form.append(field("Node packs", packs.box, "The probe node is a class that pack registers. If it is missing here, the row is marked missing."), packTools);

  const links = editorTable("links", ["Label", "URL"], draft.links, (row) => [
    textInput(row.label, "GitHub"),
    textInput(row.url, "https://github.com/"),
  ]);
  const addLink = el("button", "dh-btn", "Add link");
  addLink.type = "button";
  addLink.addEventListener("click", () => links.add({}));
  form.append(field("Links", links.box, "Pages for the person who opens this workflow."), addLink);

  const jsonBox = el("textarea");
  jsonBox.style.minHeight = "320px";
  let showingJson = false;
  body.append(form);

  const readForm = () => normalizeCard({
    title: title.value,
    body: howTo.value,
    layout,
    models: models.entries.map(({ inputs }) => ({
      name: inputs[0].value,
      folder: inputs[1].value,
      url: inputs[2].value,
      size: inputs[3].value,
      note: inputs[4].value,
    })),
    packs: packs.entries.map(({ inputs }) => ({
      name: inputs[0].value,
      url: inputs[1].value,
      node: inputs[2].value,
    })),
    links: links.entries.map(({ inputs }) => ({
      label: inputs[0].value,
      url: inputs[1].value,
    })),
  });

  const droppedUrl = () => {
    if (showingJson) return "";
    for (const entry of models.entries) {
      const raw = entry.inputs[2].value.trim();
      if (raw && !modelSource(raw)) return "A model URL was not kept. Use an http(s), hf://, or b2: link.";
    }
    for (const entry of [...packs.entries, ...links.entries]) {
      const raw = entry.inputs[1].value.trim();
      if (raw && !safeLink(raw)) return "A link was not kept. Links need to be http or https.";
    }
    return "";
  };

  jsonToggle.addEventListener("click", () => {
    error.textContent = "";
    if (!showingJson) {
      const problem = droppedUrl();
      if (problem) {
        error.textContent = problem;
        return;
      }
      jsonBox.value = JSON.stringify(readForm(), null, 2);
      body.textContent = "";
      body.append(field("Card JSON", jsonBox, "This is the text saved in the workflow."));
      jsonToggle.textContent = "Form";
      showingJson = true;
      return;
    }
    try {
      const parsed = normalizeCard(JSON.parse(jsonBox.value));
      closeEditor();
      openCardEditor(state, parsed);
    } catch {
      error.textContent = "That JSON does not parse.";
    }
  });

  const commit = () => {
    if (!showingJson) {
      const problem = droppedUrl();
      if (problem) {
        error.textContent = problem;
        return;
      }
    }
    let next;
    if (showingJson) {
      try {
        next = normalizeCard(JSON.parse(jsonBox.value));
      } catch {
        error.textContent = "That JSON does not parse.";
        return;
      }
    } else {
      next = readForm();
    }
    const wasBanner = state.card.layout === "banner";
    state.card = next;
    writeCard(state.node, next);
    closeEditor();
    renderCard(state);
    if (next.layout === "banner" && !wasBanner) state.node.setSize?.([state.node.size[0], 110]);
    if (next.layout !== "banner" && wasBanner) state.node.setSize?.([Math.max(state.node.size[0], 480), 420]);
    state.node.setDirtyCanvas?.(true, true);
  };

  const savedText = () => serializeCard(state.card);
  const dirty = () => {
    if (!showingJson) return serializeCard(readForm()) !== savedText();
    try {
      return serializeCard(normalizeCard(JSON.parse(jsonBox.value))) !== savedText();
    } catch {
      return true;
    }
  };
  const cancelEdit = () => {
    if (dirty() && !window.confirm("Discard edits to this Workflow Helper?")) return;
    closeEditor();
  };
  save.addEventListener("click", commit);
  cancel.addEventListener("click", cancelEdit);

  const abort = new AbortController();
  overlay.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") cancelEdit();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) commit();
  }, { signal: abort.signal });
  overlay.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.target === overlay) cancelEdit();
  }, { signal: abort.signal });
  document.body.append(overlay);
  openEditor = { root: overlay, abort, nodeId: state.node.id };
  title.focus();
}

function preferredHeight(card) {
  if (!card || card.layout === "banner") return 84;
  let height = 110;
  if (String(card.body || "").trim()) height += 140;
  height += (card.models?.length || 0) * 42;
  height += (card.packs?.length || 0) * 34;
  if (card.links?.length) height += 52;
  return Math.max(200, Math.min(680, height));
}

function attach(node) {
  if (node.workflowHelper) return node.workflowHelper;
  ensureCss();
  conceal(cardWidget(node));
  node.serialize_widgets = true;
  const sourceText = readSource(node);
  const root = el("div", "dh-root");
  const card = el("div", "dh-card");
  const scroll = el("div", "dh-scroll");
  card.append(scroll);
  root.append(card);
  stopDrag(scroll);

  const state = {
    node,
    root,
    scroll,
    sourceText,
    card: normalizeCard(sourceText),
    views: new Map(),
    jobs: new Map(),
    timers: new Map(),
    packHost: null,
    generation: 0,
    recheck(fresh) {
      checkInstall(state, fresh);
    },
    edit() {
      openCardEditor(state);
    },
    reload(info) {
      state.sourceText = readSource(node, info);
      state.card = normalizeCard(state.sourceText);
      renderCard(state);
    },
    dispose() {
      for (const timer of state.timers.values()) clearInterval(timer);
      state.timers.clear();
      if (openEditor?.nodeId === node.id) closeEditor();
      node.workflowHelper = null;
    },
    height() {
      return preferredHeight(state.card);
    },
  };
  node.workflowHelper = state;

  if (typeof node.addDOMWidget === "function") {
    const dom = node.addDOMWidget("helper_panel", "workflow_helper", root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight() {
        return state.height();
      },
    });
    dom.serialize = false;
    if (dom.options) dom.options.serialize = false;
  }

  renderCard(state);
  const width = Math.max(node.size?.[0] || 0, 480);
  const height = Math.max(node.size?.[1] || 0, state.height() + 30);
  node.setSize?.([width, height]);
  return state;
}

function after(proto, name, next) {
  const previous = proto[name];
  proto[name] = function workflowHelperHook(...args) {
    const result = typeof previous === "function" ? previous.apply(this, args) : undefined;
    next.apply(this, args);
    return result;
  };
}

app.registerExtension({
  name: "devil-nodes.WorkflowHelper",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_TYPE) return;
    after(nodeType.prototype, "onNodeCreated", function () {
      attach(this);
    });
    after(nodeType.prototype, "onConfigure", function (info) {
      const state = this.workflowHelper || attach(this);
      state.reload(info);
    });
    after(nodeType.prototype, "onSerialize", function (info) {
      if (!info || typeof info !== "object") return;
      const helper = this.workflowHelper;
      const text = helper?.sourceText || serializeCard(helper?.card || {});
      info.properties = { ...(info.properties || {}), workflowHelper: text };
    });
    after(nodeType.prototype, "getExtraMenuOptions", function (_canvas, options) {
      if (!Array.isArray(options)) return;
      options.unshift({
        content: "Edit Workflow Helper",
        callback: () => this.workflowHelper?.edit(),
      });
    });
    after(nodeType.prototype, "refreshComboInNode", function () {
      this.workflowHelper?.recheck(true);
    });
    after(nodeType.prototype, "onRemoved", function () {
      this.workflowHelper?.dispose();
    });
  },
});
