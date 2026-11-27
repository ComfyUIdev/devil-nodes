/**
 * Workflow Note data: the JSON saved on the node, a small Markdown builder,
 * and the file / pack checks. No network and no ComfyUI imports, so tests
 * can run it directly.
 *
 * Shared notes are someone else's text. Links are http(s) only, and the
 * Markdown renderer builds DOM nodes with createElement / createTextNode.
 */

export const NOTE_VERSION = 1;
export const LAYOUTS = ["card", "banner", "tile"];
export const ROW_LIMIT = 60;
export const BODY_LIMIT = 20000;
export const DEFAULT_ACCENT = "#e25b45";
export const TILE_SNAP_HEIGHT = 80;
export const DEVIL_REGISTRY_URL = "https://registry.comfy.org/publishers/comfyuidev/nodes/devil-nodes";
export const BUTTON_STYLES = ["link", "download", "readmore", "plain"];
export const TONE_NAMES = ["red", "yellow", "green", "teal", "amber", "glow"];
export const FOLDER_ALIASES = {
  clip: "text_encoders",
  unet: "diffusion_models",
};

export const MODEL_FOLDERS = [
  "checkpoints",
  "loras",
  "vae",
  "clip",
  "clip_vision",
  "text_encoders",
  "diffusion_models",
  "unet",
  "controlnet",
  "embeddings",
  "upscale_models",
  "style_models",
  "hypernetworks",
  "gligen",
  "photomaker",
  "model_patches",
  "audio_encoders",
  "latent_upscale_models",
  "input",
];

/** Widget name to models folder. Names that mean different folders on different loaders are listed below. */
export const LOADER_WIDGET_FOLDERS = {
  ckpt_name: "checkpoints",
  checkpoint_name: "checkpoints",
  lora_name: "loras",
  vae_name: "vae",
  unet_name: "diffusion_models",
  diffusion_model_name: "diffusion_models",
  clip_name: "text_encoders",
  clip_name1: "text_encoders",
  clip_name2: "text_encoders",
  clip_name3: "text_encoders",
  clip_name4: "text_encoders",
  control_net_name: "controlnet",
  controlnet_name: "controlnet",
  style_model_name: "style_models",
  clip_vision_name: "clip_vision",
  gligen_name: "gligen",
  hypernetwork_name: "hypernetworks",
  upscale_model_name: "upscale_models",
  embedding_name: "embeddings",
  image: "input",
};

export const LOADER_NODE_WIDGETS = {
  "CheckpointLoaderSimple:ckpt_name": "checkpoints",
  "CheckpointLoader:ckpt_name": "checkpoints",
  "UNETLoader:unet_name": "diffusion_models",
  "CLIPLoader:clip_name": "text_encoders",
  "DualCLIPLoader:clip_name1": "text_encoders",
  "DualCLIPLoader:clip_name2": "text_encoders",
  "VAELoader:vae_name": "vae",
  "LoraLoader:lora_name": "loras",
  "LoraLoaderModelOnly:lora_name": "loras",
  "ControlNetLoader:control_net_name": "controlnet",
  "CLIPVisionLoader:clip_name": "clip_vision",
  "LoadImage:image": "input",
};

const DEVIL_CLASSES = new Set(["WorkflowNote", "WorkflowNoteTile", "WorkflowHelper", "Favorite"]);
const MODEL_TITLES = new Set([
  "model",
  "models",
  "model list",
  "models list",
  "download",
  "downloads",
  "download model",
  "download models",
  "model download",
  "model downloads",
]);

export const SAMPLE_TABLE = [
  "| Step | What to do |",
  "| --- | --- |",
  "| 1 | Queue the prompt |",
  "| 2 | Check the model list |",
  "",
].join("\n");

function clip(value, limit) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : String(value);
  return text.length > limit ? text.slice(0, limit) : text;
}

function hasBreak(text) {
  return /[\u0000-\u001f]/.test(text);
}

/** http(s) URLs only. Anything else is dropped. */
export function safeHttpUrl(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > 2000 || hasBreak(text) || /\s/.test(text)) return "";
  if (!/^https?:\/\//i.test(text)) return "";
  if (/^https?:\/\/$/i.test(text)) return "";
  if (/^https?:\/\/[#/?]*$/i.test(text)) return "";
  return text;
}

/** Optional per-note accent. Strict #rrggbb, otherwise empty (use the default). */
export function cleanAccent(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : "";
}

export function cleanFolder(value) {
  const text = clip(value, 80).trim();
  if (!text) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) return "";
  return text;
}

export function cleanModelName(value) {
  const text = clip(value, 300).trim().replace(/\\/g, "/");
  if (!text || text.startsWith("/") || /^[A-Za-z]:/.test(text)) return "";
  const parts = text.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return "";
  return parts.join("/");
}

export function fileBase(path) {
  const text = clip(path, 1000).replace(/\\/g, "/").replace(/\/+$/, "");
  const cut = text.lastIndexOf("/");
  return cut >= 0 ? text.slice(cut + 1) : text;
}

export function emptyNote() {
  return {
    v: NOTE_VERSION,
    title: "",
    subtitle: "",
    author: "",
    body: "",
    layout: "card",
    accent: "",
    models: [],
    packs: [],
    links: [],
  };
}

function modelRow(row) {
  if (!row || typeof row !== "object") return null;
  const name = cleanModelName(row.name ?? row.filename ?? "");
  if (!name) return null;
  return {
    name,
    folder: cleanFolder(row.folder ?? row.dir ?? ""),
    url: safeHttpUrl(row.url),
  };
}

function packRow(row) {
  if (!row || typeof row !== "object") return null;
  const name = clip(row.name, 200).trim();
  if (!name) return null;
  return {
    name,
    url: safeHttpUrl(row.url),
    node: clip(row.node ?? row.probe ?? "", 200).trim(),
  };
}

function linkRow(row) {
  if (!row || typeof row !== "object") return null;
  const url = safeHttpUrl(row.url);
  if (!url) return null;
  const label = clip(row.label, 80).trim();
  return { label: label || hostOf(url) || "Link", url };
}

function takeRows(list, mapRow) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list) {
    if (out.length >= ROW_LIMIT) break;
    const clean = mapRow(row);
    if (clean) out.push(clean);
  }
  return out;
}

export function hostOf(url) {
  const safe = safeHttpUrl(url);
  if (!safe) return "";
  const rest = safe.replace(/^https?:\/\//i, "");
  const host = rest.split("/")[0].replace(/^www\./i, "");
  return host || "";
}

/**
 * Build a note object from JSON text or a plain object.
 * Unknown keys are dropped. Rows past the cap are dropped.
 */
/** Parse editor JSON. Invalid text is an error so a save cannot wipe the note. */
export function parseNoteText(raw) {
  if (typeof raw !== "string") return { ok: true, note: normalizeNote(raw) };
  const text = raw.trim();
  if (!text) return { ok: true, note: emptyNote() };
  try {
    const source = JSON.parse(text);
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return { ok: false, error: "JSON must be an object." };
    }
    return { ok: true, note: normalizeNote(source) };
  } catch {
    return { ok: false, error: "That JSON could not be read." };
  }
}

export function normalizeNote(raw) {
  let source = raw;
  if (typeof raw === "string") {
    try {
      source = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      source = {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) source = {};
  const note = emptyNote();
  note.title = clip(source.title, 200).trim();
  note.subtitle = clip(source.subtitle, 240).trim();
  note.author = clip(source.author, 120).trim();
  note.body = clip(source.body ?? source.markdown ?? "", BODY_LIMIT);
  note.layout = LAYOUTS.includes(source.layout) ? source.layout : "card";
  note.accent = cleanAccent(source.accent);
  note.models = takeRows(source.models, modelRow);
  note.packs = takeRows(source.packs, packRow);
  note.links = takeRows(source.links, linkRow);
  return note;
}

export function serializeNote(note, pretty) {
  const clean = normalizeNote(note);
  return pretty ? JSON.stringify(clean, null, 2) : JSON.stringify(clean);
}

export function notesEqual(a, b) {
  return serializeNote(a) === serializeNote(b);
}

export function noteHasContent(note) {
  if (!note) return false;
  return Boolean(
    note.title ||
      note.subtitle ||
      note.author ||
      String(note.body || "").trim() ||
      note.models?.length ||
      note.packs?.length ||
      note.links?.length,
  );
}

export function nodeTypeForLayout(layout) {
  return layout === "tile" ? "WorkflowNoteTile" : "WorkflowNote";
}

export function tileUsesDownloadIcon(note) {
  const title = String(note?.title || "").trim().toLowerCase();
  if (MODEL_TITLES.has(title)) return true;
  const body = String(note?.body || "").trim();
  const packs = note?.packs?.length || 0;
  const links = note?.links?.length || 0;
  const models = note?.models?.length || 0;
  return models > 0 && !body && packs === 0 && links === 0;
}

export function locationLabel(folder) {
  if (folder === "input") return "ComfyUI/input";
  if (!folder) return "ComfyUI/models";
  return `ComfyUI/models/${folder}`;
}

export function groupByFolder(models) {
  const groups = [];
  const index = new Map();
  for (const row of models || []) {
    const key = row.folder || "";
    let group = index.get(key);
    if (!group) {
      group = { folder: key, label: locationLabel(key), rows: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

export function folderOptions(installed, current) {
  const options = [...MODEL_FOLDERS];
  const seen = new Set(options);
  const add = (name) => {
    const folder = cleanFolder(name);
    if (!folder || seen.has(folder)) return;
    seen.add(folder);
    options.push(folder);
  };
  for (const name of installed || []) add(name);
  const selected = cleanFolder(current) || "checkpoints";
  if (!seen.has(selected)) options.push(selected);
  return { options, selected };
}

export function minimumSize(layout) {
  if (layout === "banner") return { width: 300, height: 64 };
  if (layout === "tile") return { width: 300, height: 42 };
  return { width: 300, height: 160 };
}

/**
 * Next node size. Card and banner only grow. Entering the tile layout snaps
 * to a short height and does not grow with the note body.
 */
export function sizeAfterLayout({ layout, width, height, contentHeight, previousLayout }) {
  const min = minimumSize(layout);
  const w = Math.max(min.width, Number(width) || 0);
  const h = Number(height) || 0;
  if (layout === "tile") {
    if (previousLayout && previousLayout !== "tile") {
      return { width: w, height: TILE_SNAP_HEIGHT };
    }
    return { width: w, height: h >= min.height ? h : TILE_SNAP_HEIGHT };
  }
  const needed = Math.max(min.height, Number(contentHeight) || 0);
  return { width: w, height: Math.max(h, needed) };
}

export function resizeStep(shift) {
  return shift ? 1 : 16;
}

export function arrowDelta(key, shift) {
  const step = resizeStep(shift);
  if (key === "ArrowRight") return { dw: step, dh: 0 };
  if (key === "ArrowLeft") return { dw: -step, dh: 0 };
  if (key === "ArrowDown") return { dw: 0, dh: step };
  if (key === "ArrowUp") return { dw: 0, dh: -step };
  return null;
}

export function resizeBy(size, layout, dw, dh) {
  const min = minimumSize(layout);
  return {
    width: Math.max(min.width, Math.round((Number(size?.width) || 0) + (Number(dw) || 0))),
    height: Math.max(min.height, Math.round((Number(size?.height) || 0) + (Number(dh) || 0))),
  };
}

export function searchFolders(folder, aliases) {
  const map = aliases && typeof aliases === "object" ? aliases : FOLDER_ALIASES;
  const out = [];
  const add = (name) => {
    const clean = cleanFolder(name);
    if (!clean || out.includes(clean)) return;
    out.push(clean);
  };
  add(folder);
  add(map[folder]);
  for (const [from, to] of Object.entries(map)) {
    if (to === folder) add(from);
  }
  return out;
}

/** Extra directories beyond the primary models folder, for the "also read from" line. */
export function alsoReadFrom(folder, catalog) {
  if (!catalog || typeof catalog !== "object") return [];
  if (folder === "input") {
    const input = Array.isArray(catalog.input) ? catalog.input.filter((item) => typeof item === "string" && item) : [];
    return input.length > 1 ? input.slice(1) : [];
  }
  const shared = catalog.shared && Array.isArray(catalog.shared[folder]) ? catalog.shared[folder] : null;
  if (shared && shared.length) return shared.filter((item) => typeof item === "string" && item);
  const paths = catalog.folders && Array.isArray(catalog.folders[folder]) ? catalog.folders[folder] : [];
  return paths.filter((item) => typeof item === "string" && item).slice(1);
}

function hitFrom(file, folder) {
  const path = String(file || "").replace(/\\/g, "/");
  const slash = path.lastIndexOf("/");
  return {
    path,
    subfolder: slash >= 0 ? path.slice(0, slash) : "",
    base: fileBase(path),
    folder: folder || "",
  };
}

export function matchFiles(name, files) {
  if (!Array.isArray(files)) return { status: "unchecked", matches: [] };
  const wanted = clip(name, 1000).trim().replace(/\\/g, "/");
  const base = fileBase(wanted).toLowerCase();
  if (!base) return { status: "missing", matches: [] };
  const listed = files
    .map((file) => (typeof file === "string" ? file : file?.name || file?.path || ""))
    .map((file) => String(file).replace(/\\/g, "/"))
    .filter(Boolean);
  const exact = listed.filter((file) => file.toLowerCase() === wanted.toLowerCase());
  const chosen = exact.length ? exact : listed.filter((file) => fileBase(file).toLowerCase() === base);
  if (!chosen.length) return { status: "missing", matches: [] };
  return { status: "found", matches: chosen.map((file) => hitFrom(file, "")) };
}

/**
 * Search one or more folder listings. A null listing means that folder
 * could not be read. If every listing failed, the row stays unchecked.
 */
export function matchAcrossFolders(name, lists) {
  const available = (lists || []).filter((entry) => Array.isArray(entry?.files));
  if (!available.length) return { status: "unchecked", matches: [] };
  const wanted = clip(name, 1000).trim().replace(/\\/g, "/").toLowerCase();
  const matches = [];
  for (const entry of available) {
    const found = matchFiles(name, entry.files);
    for (const hit of found.matches) {
      matches.push({ ...hit, folder: entry.folder || hit.folder });
    }
  }
  const exact = matches.filter((hit) => hit.path.toLowerCase() === wanted);
  const chosen = exact.length ? exact : matches;
  const seen = new Set();
  const unique = [];
  for (const hit of chosen) {
    const key = `${hit.folder}/${hit.path}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
  }
  if (!unique.length) return { status: "missing", matches: [] };
  return { status: "found", matches: unique };
}

export function uniqueMatch(result) {
  if (!result || result.status !== "found") return null;
  const paths = new Set((result.matches || []).map((hit) => String(hit.path || "").toLowerCase()));
  if (paths.size !== 1) return null;
  return result.matches[0];
}

/** Subfolder to offer, when the found path is not the path the note already stores. */
export function subfolderHint(wanted, match) {
  if (!match?.path) return "";
  const wantedNorm = clip(wanted, 1000).trim().replace(/\\/g, "/").toLowerCase();
  if (match.path.toLowerCase() === wantedNorm) return "";
  return match.subfolder || "";
}

export function shouldAutoPick(settingOn, result) {
  if (settingOn === false) return false;
  return Boolean(uniqueMatch(result));
}

export function folderForLoader(nodeType, widgetName) {
  const key = `${nodeType || ""}:${widgetName || ""}`;
  if (LOADER_NODE_WIDGETS[key]) return LOADER_NODE_WIDGETS[key];
  if (LOADER_WIDGET_FOLDERS[widgetName]) return LOADER_WIDGET_FOLDERS[widgetName];
  return "";
}

/** Loader widgets whose file name matches this row and whose folder is the same family. */
export function loaderUpdates(nodes, row, foundPath) {
  const next = clip(foundPath, 1000).replace(/\\/g, "/");
  if (!next || !row) return [];
  const base = fileBase(row.name).toLowerCase();
  if (!base) return [];
  const accepted = new Set(searchFolders(row.folder));
  const updates = [];
  for (const node of nodes || []) {
    const type = node?.type || node?.comfyClass || "";
    for (const widget of node?.widgets || []) {
      const folder = folderForLoader(type, widget?.name);
      if (!folder) continue;
      const family = searchFolders(folder);
      if (!family.some((name) => accepted.has(name))) continue;
      const value = typeof widget.value === "string" ? widget.value : "";
      if (fileBase(value).toLowerCase() !== base) continue;
      if (value.replace(/\\/g, "/") === next) continue;
      updates.push({ nodeId: node.id, widget: widget.name, from: value, to: next });
    }
  }
  return updates;
}

export function applyLoaderUpdates(nodes, plan) {
  let changed = 0;
  for (const step of plan || []) {
    const node = (nodes || []).find((item) => item && item.id === step.nodeId);
    if (!node) continue;
    const widget = (node.widgets || []).find((item) => item && item.name === step.widget);
    if (!widget || widget.value === step.to) continue;
    widget.value = step.to;
    changed += 1;
  }
  return changed;
}

export function flattenGraph(graph) {
  const out = [];
  const seen = new Set();
  const walk = (current) => {
    if (!current || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    const nodes = current.nodes || current._nodes || [];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      out.push(node);
      if (node.subgraph) walk(node.subgraph);
    }
  };
  walk(graph);
  return out;
}

export function isDevilPack(pack) {
  const name = String(pack?.name || "").trim().toLowerCase().replace(/\s+/g, "-");
  return name === "devil-nodes" || name === "devilnodes";
}

export function packLink(pack) {
  return safeHttpUrl(pack?.url) || (isDevilPack(pack) ? DEVIL_REGISTRY_URL : "");
}

function packFromModule(moduleName, nodeType) {
  const match = /^custom_nodes\.([^.]+)/.exec(String(moduleName || ""));
  if (!match) return null;
  const folder = match[1];
  const devil = folder === "devil-nodes" || DEVIL_CLASSES.has(nodeType);
  return {
    name: devil ? "devil-nodes" : folder,
    url: devil ? DEVIL_REGISTRY_URL : "",
    node: nodeType || "",
  };
}

/** One row per custom-node module found in the graph. Does not remove anything by itself. */
export function detectPacks(nodes) {
  const packs = [];
  const seen = new Set();
  let devilType = "";
  for (const node of nodes || []) {
    const type = String(node?.type || node?.comfyClass || "");
    if (DEVIL_CLASSES.has(type) && !devilType) devilType = type;
    const pack = packFromModule(node?.module, type);
    if (!pack) continue;
    const key = pack.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    packs.push(pack);
  }
  if (devilType && !seen.has("devil-nodes")) {
    packs.unshift({ name: "devil-nodes", url: DEVIL_REGISTRY_URL, node: devilType });
  }
  return packs;
}

/** Add detected rows. Rows already on the note stay, including ones the graph no longer has. */
export function mergePacks(existing, detected) {
  const next = (existing || []).map((row) => ({ ...row }));
  const seen = new Set(next.map((row) => String(row.name || "").toLowerCase()));
  for (const row of detected || []) {
    const key = String(row?.name || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    if (next.length >= ROW_LIMIT) break;
    next.push({ name: row.name, url: safeHttpUrl(row.url) || (isDevilPack(row) ? DEVIL_REGISTRY_URL : ""), node: row.node || "" });
    seen.add(key);
  }
  return next;
}

export function probeInstalled(nodeClass, defs, registry) {
  if (!nodeClass) return "unchecked";
  if (defs && Object.prototype.hasOwnProperty.call(defs, nodeClass)) return "installed";
  if (registry && Object.prototype.hasOwnProperty.call(registry, nodeClass)) return "installed";
  if (defs || registry) return "missing";
  return "unchecked";
}

/**
 * What to show for a pack row.
 * A missing probe class is Update (Manager when it is open, otherwise the
 * registry or pack URL). It is never a git clone command.
 */
export function updateDestination(pack, managerAvailable, status) {
  if (status === "installed") return { type: "installed", url: packLink(pack) };
  if (status !== "missing" || !pack?.node) return { type: "link", url: packLink(pack) };
  if (managerAvailable) return { type: "manager", url: "" };
  return { type: "registry", url: packLink(pack) };
}

export function insertAround(value, start, end, before, after) {
  const text = String(value ?? "");
  const a = Math.max(0, Math.min(start ?? text.length, end ?? text.length, text.length));
  const b = Math.max(a, Math.min(Math.max(start ?? a, end ?? a), text.length));
  const selected = text.slice(a, b) || "text";
  const next = text.slice(0, a) + before + selected + after + text.slice(b);
  return { value: next, caret: a + before.length + selected.length + after.length };
}

export function buttonMarkup({ label, url, color, style, size }) {
  const parts = [label || "Label", url || "https://", color || DEFAULT_ACCENT, BUTTON_STYLES.includes(style) ? style : "link"];
  if (size) parts.push(String(size));
  return `[[button: ${parts.join(" | ")}]]`;
}

function splitPipes(text) {
  const parts = [];
  let buf = "";
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\\" && text[i + 1] === "|") {
      buf += "|";
      i += 1;
      continue;
    }
    if (text[i] === "|") {
      parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += text[i];
  }
  parts.push(buf.trim());
  return parts;
}

function tableCells(line) {
  let row = String(line ?? "").trim();
  if (!row.includes("|")) return [];
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return splitPipes(row);
}

function isDivider(cells) {
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseButton(inside) {
  const parts = splitPipes(inside);
  const label = (parts[0] || "").trim() || "Link";
  const url = safeHttpUrl(parts[1] || "");
  let color = "";
  let style = "link";
  let size = "";
  const rest = parts.slice(2).map((part) => part.trim()).filter((part) => part !== "");
  for (const part of rest) {
    if (!color && /^#[0-9a-fA-F]{6}$/.test(part)) {
      color = part;
      continue;
    }
    if (BUTTON_STYLES.includes(part.toLowerCase())) {
      style = part.toLowerCase();
      continue;
    }
    if (!size) size = clip(part, 40);
  }
  return { type: "button", label: clip(label, 120), url, color, style, size };
}

export function parseInline(text, depth = 0) {
  const spans = [];
  const src = clip(text, BODY_LIMIT);
  let buf = "";
  const flush = () => {
    if (buf) spans.push({ type: "text", text: buf });
    buf = "";
  };
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i && !src.slice(i, end).includes("\n")) {
        flush();
        spans.push({ type: "code", text: src.slice(i + 1, end) });
        i = end;
        continue;
      }
    }
    if (src.startsWith("[[button:", i)) {
      const end = src.indexOf("]]", i + 9);
      if (end > i && !src.slice(i, end).includes("\n")) {
        flush();
        spans.push(parseButton(src.slice(i + 9, end)));
        i = end + 1;
        continue;
      }
    }
    if (depth < 2 && src[i] === "[") {
      const tone = new RegExp(`^(${TONE_NAMES.join("|")})\\]`).exec(src.slice(i + 1));
      if (tone) {
        const name = tone[1];
        const closer = `[/${name}]`;
        const end = src.indexOf(closer, i + name.length + 2);
        if (end > i) {
          flush();
          const inner = src.slice(i + name.length + 2, end);
          spans.push({ type: "tone", tone: name, spans: parseInline(inner, depth + 1) });
          i = end + closer.length - 1;
          continue;
        }
      }
      const close = src.indexOf("](", i + 1);
      const end = close > i ? src.indexOf(")", close + 2) : -1;
      if (close > i + 1 && end > close + 2 && !src.slice(i, end).includes("\n")) {
        const label = src.slice(i + 1, close);
        const url = safeHttpUrl(src.slice(close + 2, end));
        flush();
        if (url) spans.push({ type: "link", text: label, url });
        else spans.push({ type: "text", text: src.slice(i, end + 1) });
        i = end;
        continue;
      }
    }
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2 && !src.slice(i + 2, end).includes("\n")) {
        flush();
        spans.push({ type: "strong", spans: parseInline(src.slice(i + 2, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }
    if (src[i] === "*" && src[i + 1] !== "*") {
      const end = src.indexOf("*", i + 1);
      if (end > i + 1 && !src.slice(i + 1, end).includes("\n") && src[end - 1] !== "*") {
        flush();
        spans.push({ type: "em", spans: parseInline(src.slice(i + 1, end), depth + 1) });
        i = end;
        continue;
      }
    }
    buf += src[i];
  }
  flush();
  return spans;
}

export function parseMarkdown(text) {
  const lines = clip(text, BODY_LIMIT).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const spans = [];
    paragraph.forEach((line, index) => {
      if (index) spans.push({ type: "br" });
      spans.push(...parseInline(line));
    });
    blocks.push({ type: "paragraph", spans });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (code) {
      if (trimmed.startsWith("```")) {
        blocks.push(code);
        code = null;
      } else {
        code.text += (code.text ? "\n" : "") + raw;
      }
      continue;
    }
    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      code = { type: "code", text: "" };
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(raw);
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(raw);
    if (!bullet && !numbered && list && /^\s+\S/.test(raw)) {
      list.items[list.items.length - 1].spans.push({ type: "text", text: " " }, ...parseInline(raw.trim()));
      continue;
    }
    const divider = tableCells(lines[index + 1] || "");
    const headers = tableCells(raw);
    if (headers.length > 1 && headers.length === divider.length && isDivider(divider)) {
      flushParagraph();
      flushList();
      const rows = [];
      index += 1;
      while (lines[index + 1] != null && tableCells(lines[index + 1]).length === headers.length) {
        const cells = tableCells(lines[index + 1]);
        if (isDivider(cells)) break;
        rows.push(cells.map((cell) => parseInline(cell)));
        index += 1;
      }
      blocks.push({
        type: "table",
        headers: headers.map((cell) => parseInline(cell)),
        rows,
      });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: "list", ordered, items: [] };
      }
      list.items.push({ spans: parseInline((bullet || numbered)[2]) });
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  if (code) blocks.push(code);
  flushParagraph();
  flushList();
  return blocks;
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function paintSpans(doc, parent, spans) {
  for (const span of spans || []) {
    if (!span) continue;
    if (span.type === "br") {
      parent.append(doc.createElement("br"));
    } else if (span.type === "strong") {
      const node = element(doc, "strong");
      paintSpans(doc, node, span.spans);
      parent.append(node);
    } else if (span.type === "em") {
      const node = element(doc, "em");
      paintSpans(doc, node, span.spans);
      parent.append(node);
    } else if (span.type === "code") {
      parent.append(element(doc, "code", "", span.text || ""));
    } else if (span.type === "tone") {
      const node = element(doc, "span", `wn-tone wn-tone-${span.tone}`);
      paintSpans(doc, node, span.spans);
      parent.append(node);
    } else if (span.type === "link") {
      const url = safeHttpUrl(span.url);
      if (!url) {
        parent.append(doc.createTextNode(span.text || ""));
      } else {
        const link = element(doc, "a", "wn-mdlink", span.text || url);
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        parent.append(link);
      }
    } else if (span.type === "button") {
      const url = safeHttpUrl(span.url);
      const style = BUTTON_STYLES.includes(span.style) ? span.style : "link";
      const node = element(doc, url ? "a" : "span", `wn-linkbtn wn-linkbtn-${style}`);
      if (url) {
        node.href = url;
        node.target = "_blank";
        node.rel = "noopener noreferrer";
      }
      if (span.color && /^#[0-9a-fA-F]{6}$/.test(span.color)) node.style.color = span.color;
      node.append(element(doc, "span", "wn-linkbtn-label", span.label || url || "Link"));
      if (span.size) node.append(element(doc, "span", "wn-sizebadge", span.size));
      parent.append(node);
    } else {
      parent.append(doc.createTextNode(span.text || ""));
    }
  }
}

/** Append Markdown as DOM nodes. The parent is not cleared. */
export function mountMarkdown(doc, parent, text) {
  const factory = doc || document;
  for (const block of parseMarkdown(text)) {
    if (block.type === "heading") {
      const level = Math.min(3, Math.max(1, block.level || 1));
      const heading = element(factory, `h${level}`);
      paintSpans(factory, heading, block.spans);
      parent.append(heading);
    } else if (block.type === "paragraph") {
      const paragraph = element(factory, "p");
      paintSpans(factory, paragraph, block.spans);
      parent.append(paragraph);
    } else if (block.type === "list") {
      const list = element(factory, block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const li = element(factory, "li");
        paintSpans(factory, li, item.spans);
        list.append(li);
      }
      parent.append(list);
    } else if (block.type === "code") {
      const pre = element(factory, "pre");
      pre.append(element(factory, "code", "", block.text));
      parent.append(pre);
    } else if (block.type === "hr") {
      parent.append(factory.createElement("hr"));
    } else if (block.type === "table") {
      const table = element(factory, "table");
      const head = factory.createElement("tr");
      for (const cell of block.headers) {
        const th = element(factory, "th");
        paintSpans(factory, th, cell);
        head.append(th);
      }
      table.append(head);
      for (const row of block.rows) {
        const tr = factory.createElement("tr");
        for (const cell of row) {
          const td = element(factory, "td");
          paintSpans(factory, td, cell);
          tr.append(td);
        }
        table.append(tr);
      }
      parent.append(table);
    }
  }
}
