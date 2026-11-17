/**
 * Workflow Helper card: the JSON saved with a workflow, Markdown as data,
 * and the installed-file match. No network and no ComfyUI imports.
 *
 * Shared workflows are someone else's text. Links are http(s) only, and the
 * Markdown renderer builds text nodes rather than HTML. A colored button is
 * the same kind of link: the URL is checked, and the color is hex or rgb().
 */

export const CARD_VERSION = 1;
export const LAYOUTS = ["card", "banner", "tile"];
export const ROW_LIMIT = 40;
export const BODY_LIMIT = 20000;

export const MODEL_FOLDERS = [
  "checkpoints",
  "loras",
  "vae",
  "clip",
  "clip_vision",
  "controlnet",
  "embeddings",
  "upscale_models",
  "diffusion_models",
  "unet",
  "text_encoders",
  "style_models",
  "hypernetworks",
  "gligen",
  "photomaker",
  "model_patches",
  "audio_encoders",
  "latent_upscale_models",
];

function clip(value, limit) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : String(value);
  return text.slice(0, limit);
}

function hasBreak(text) {
  return /[\u0000-\u001f]/.test(text);
}

export function safeLink(value) {
  const text = clip(value, 2000).trim();
  if (!text || hasBreak(text) || /\s/.test(text)) return "";
  if (!/^https?:\/\//i.test(text)) return "";
  return text;
}

/** Download URLs the server knows how to fetch. Not used as link hrefs. */
export function modelSource(value) {
  const text = clip(value, 4000).trim();
  if (!text || hasBreak(text)) return "";
  const pasted = /^(?:hf|huggingface-cli)\s+download\s+(hf:\/\/\S+)$/i.exec(text);
  if (pasted) return pasted[1];
  if (/\s/.test(text)) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^hf:\/\/\S+$/i.test(text)) return text;
  if (/^b2:\/\/?\S+$/i.test(text)) return text;
  return "";
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Browser storage key for the Civitai token. It is not part of the card. */
export const CIVITAI_TOKEN_STORAGE_KEY = "devil-nodes.workflow-helper.civitai-token";

export function civitaiHost(url) {
  const host = hostOf(url);
  return host === "civitai.com" || host === "civitai.red";
}

export function storedCivitaiToken(storage) {
  if (!storage || typeof storage.getItem !== "function") return "";
  try {
    const value = storage.getItem(CIVITAI_TOKEN_STORAGE_KEY);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export function rememberCivitaiToken(storage, value) {
  const text = String(value ?? "").trim();
  if (!storage || typeof storage.setItem !== "function") return text;
  try {
    if (text) storage.setItem(CIVITAI_TOKEN_STORAGE_KEY, text);
    else if (typeof storage.removeItem === "function") storage.removeItem(CIVITAI_TOKEN_STORAGE_KEY);
  } catch {
    // The browser refused storage. The caller can still hold the text.
  }
  return text;
}

/** Download POST body. The Civitai token is attached only for Civitai hosts. */
export function downloadBody(row, civitaiToken) {
  const body = {
    url: row?.url || "",
    filename: modelDownloadName(row?.name || "", row?.url || ""),
    folder: row?.folder || "",
  };
  const token = typeof civitaiToken === "string" ? civitaiToken.trim() : "";
  if (token && civitaiHost(body.url)) body.civitai_token = token;
  return body;
}

export function baseName(path) {
  const text = clip(path, 1000).replace(/\\/g, "/").trim();
  const cut = text.lastIndexOf("/");
  return cut >= 0 ? text.slice(cut + 1) : text;
}

export function emptyCard() {
  return {
    v: CARD_VERSION,
    title: "",
    body: "",
    layout: "card",
    models: [],
    packs: [],
    links: [],
  };
}

function modelRow(row) {
  if (!row || typeof row !== "object") return null;
  const name = clip(row.name, 240).trim();
  if (!name) return null;
  const folder = clip(row.folder ?? row.dir, 80).trim().replace(/^[/\\]+|[/\\]+$/g, "");
  return {
    name,
    folder,
    url: modelSource(row.url),
    size: clip(row.size, 40).trim(),
    note: clip(row.note, 300).trim(),
  };
}

function packRow(row) {
  if (!row || typeof row !== "object") return null;
  const name = clip(row.name, 200).trim();
  if (!name) return null;
  return {
    name,
    url: safeLink(row.url),
    node: clip(row.node, 200).trim(),
  };
}

function linkRow(row) {
  if (!row || typeof row !== "object") return null;
  const url = safeLink(row.url);
  const label = clip(row.label, 80).trim();
  if (!url && !label) return null;
  return { label: label || hostOf(url) || "Link", url };
}

function takeRows(list, mapRow) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list.slice(0, ROW_LIMIT)) {
    const clean = mapRow(row);
    if (clean) out.push(clean);
  }
  return out;
}

export function normalizeCard(raw) {
  let source = raw;
  if (typeof raw === "string") {
    try {
      source = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      source = {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) source = {};
  const card = emptyCard();
  card.title = clip(source.title, 200).trim();
  card.body = clip(source.body ?? source.markdown, BODY_LIMIT);
  card.layout = LAYOUTS.includes(source.layout) ? source.layout : "card";
  card.models = takeRows(source.models, modelRow);
  card.packs = takeRows(source.packs, packRow);
  card.links = takeRows(source.links, linkRow);
  return card;
}

export function serializeCard(card) {
  return JSON.stringify(normalizeCard(card));
}

export function cardHasContent(card) {
  if (!card) return false;
  return Boolean(
    card.title ||
      String(card.body || "").trim() ||
      card.models?.length ||
      card.packs?.length ||
      card.links?.length,
  );
}

/** A tile button only when that layout has something to open. */
export function showsTile(card) {
  return card?.layout === "tile" && cardHasContent(card);
}

/** Download arrow for a model list; a book for a how-to. */
export function tileIsDownloadList(card) {
  const title = String(card?.title || "").trim().toLowerCase();
  const downloadTitle = new Set([
    "download",
    "downloads",
    "model",
    "models",
    "download model",
    "download models",
    "model download",
    "model downloads",
  ]);
  if (downloadTitle.has(title)) return true;
  const body = String(card?.body || "").trim();
  return Boolean(card?.models?.length) && !body && !card.packs?.length && !card.links?.length;
}

export function groupModels(models) {
  const groups = [];
  const byFolder = new Map();
  for (const row of models || []) {
    let group = byFolder.get(row.folder);
    if (!group) {
      group = { folder: row.folder, rows: [] };
      byFolder.set(row.folder, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

export function folderLabel(folder) {
  return folder ? `models/${folder}` : "models";
}

/**
 * Every folder the editor can offer. Built-in names come first, then any
 * extra names this ComfyUI reports. The row's current folder stays in the
 * list even when this install does not have it, so saving cannot drop it.
 */
export function folderChoices(installed, current) {
  const options = [...MODEL_FOLDERS];
  const seen = new Set(options);
  for (const name of installed || []) {
    const folder = clip(name, 80).trim();
    if (!folder || seen.has(folder)) continue;
    if (/[\\/\0]|\.\./.test(folder)) continue;
    seen.add(folder);
    options.push(folder);
  }
  const selected = clip(current, 80).trim() || "checkpoints";
  if (!seen.has(selected)) options.push(selected);
  return { options, selected };
}

/**
 * Pixel box for the card inside a node. `top` is the widget's offset from
 * the top of the node (the title bar, when the node height includes it).
 * The card is at least `contentMin` tall and otherwise uses the rest of the
 * node, so it does not sit in the corner of an empty body.
 */
export function panelBox({ nodeWidth, nodeHeight, top, contentMin }) {
  const width = Math.max(220, Number(nodeWidth) || 0);
  const min = Math.max(72, Number(contentMin) || 0);
  const height = Number(nodeHeight) || 0;
  const offset = Number.isFinite(top) && top > 0 ? top : 0;
  const available = height - offset;
  return {
    width,
    height: Math.max(min, available > 0 ? available : min),
  };
}

/**
 * Match a row against ComfyUI's file list for one folder.
 * An exact relative path wins. Otherwise the file name matches anywhere
 * in that folder, case-insensitively.
 */
export function matchFile(name, files) {
  if (!Array.isArray(files) || !files.length) return { found: false, path: "" };
  const wanted = clip(name, 1000).trim().replace(/\\/g, "/");
  const wantedBase = baseName(wanted).toLowerCase();
  if (!wantedBase) return { found: false, path: "" };
  const listed = files.map((file) => clip(file, 1000).replace(/\\/g, "/"));
  const exact = listed.find((file) => file.toLowerCase() === wanted.toLowerCase());
  if (exact) return { found: true, path: exact };
  const loose = listed.find((file) => baseName(file).toLowerCase() === wantedBase);
  return loose ? { found: true, path: loose } : { found: false, path: "" };
}

const MODEL_EXTENSIONS = [".safetensors", ".ckpt", ".pt", ".pt2", ".pth", ".bin", ".gguf", ".onnx", ".sft", ".pkl"];

/** Widget names that always mean one models folder. Ambiguous names are omitted. */
export const WIDGET_FOLDERS = {
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
};

/** Node class plus widget, for names that mean different folders on different loaders. */
export const NODE_WIDGET_FOLDERS = {
  "CheckpointLoaderSimple:ckpt_name": "checkpoints",
  "CheckpointLoader:ckpt_name": "checkpoints",
  "unCLIPCheckpointLoader:ckpt_name": "checkpoints",
  "LoraLoader:lora_name": "loras",
  "LoraLoaderModelOnly:lora_name": "loras",
  "VAELoader:vae_name": "vae",
  "UNETLoader:unet_name": "diffusion_models",
  "CLIPLoader:clip_name": "text_encoders",
  "DualCLIPLoader:clip_name1": "text_encoders",
  "DualCLIPLoader:clip_name2": "text_encoders",
  "TripleCLIPLoader:clip_name1": "text_encoders",
  "TripleCLIPLoader:clip_name2": "text_encoders",
  "TripleCLIPLoader:clip_name3": "text_encoders",
  "CLIPVisionLoader:clip_name": "clip_vision",
  "ControlNetLoader:control_net_name": "controlnet",
  "DiffControlNetLoader:control_net_name": "controlnet",
  "StyleModelLoader:style_model_name": "style_models",
  "GLIGENLoader:gligen_name": "gligen",
  "UpscaleModelLoader:model_name": "upscale_models",
  "HypernetworkLoader:hypernetwork_name": "hypernetworks",
  "PhotoMakerLoader:photomaker_model_name": "photomaker",
};

export function looksLikeModelFile(value) {
  const text = String(value ?? "").trim().replace(/\\/g, "/");
  if (!text || text.length > 240 || text.startsWith("/") || text.includes("\0")) return false;
  const parts = text.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return false;
  const base = parts[parts.length - 1].toLowerCase();
  return MODEL_EXTENSIONS.some((ext) => base.endsWith(ext));
}

const HUB_HOSTS = new Set(["huggingface.co", "hf.co"]);

function decodePart(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function stripHubPrefix(parts) {
  if (!parts.length) return parts;
  const head = parts[0];
  if (head === "datasets" || head === "dataset" || head === "spaces" || head === "space" || head === "models" || head === "model") {
    return parts.slice(1);
  }
  return parts;
}

/** Relative file path when a Hugging Face URL names a file. Empty for a repo page. */
export function hubFilePath(url) {
  const source = modelSource(url);
  if (!source) return "";
  let kind = "web";
  let parts = [];
  if (/^hf:\/\//i.test(source)) {
    kind = "hf";
    parts = source.replace(/^hf:\/\//i, "").split("/").filter(Boolean);
  } else {
    let parsed;
    try {
      parsed = new URL(source);
    } catch {
      return "";
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!HUB_HOSTS.has(host)) return "";
    parts = parsed.pathname.split("/").filter(Boolean).map(decodePart);
  }
  parts = stripHubPrefix(parts);
  let file = "";
  if (kind === "hf") {
    if (parts.length < 3) return "";
    file = parts.slice(2).join("/");
  } else if (parts.length >= 5 && (parts[2] === "resolve" || parts[2] === "blob")) {
    file = parts.slice(4).join("/");
  }
  return looksLikeModelFile(file) ? file : "";
}

/**
 * Name to show and to match in the models folder.
 * A file URL replaces a row name that has no model extension.
 * A repo page keeps the row name until the download reports the real file.
 */
export function modelDownloadName(name, url) {
  const current = String(name ?? "").trim().replace(/\\/g, "/");
  const fromUrl = hubFilePath(url);
  if (fromUrl && !looksLikeModelFile(current)) return fromUrl;
  return current;
}

/** Prefer the file the server saved, then the name a file URL already implies. */
export function modelNameAfterDownload(name, url, reported) {
  const fromServer = String(reported ?? "").trim().replace(/\\/g, "/");
  if (looksLikeModelFile(fromServer)) return fromServer;
  return modelDownloadName(name, url);
}

function cleanFolder(value) {
  const folder = clip(value, 80).trim();
  if (!folder || /[\\/\0]|\.\./.test(folder)) return "";
  return folder;
}

/** Options object from one object_info input, either `[files, options]` or `["COMBO", options]`. */
export function inputConfig(def, widgetName) {
  const groups = def?.input || {};
  for (const group of ["required", "optional"]) {
    const entry = groups[group]?.[widgetName];
    if (!entry) continue;
    if (Array.isArray(entry)) {
      const config = entry.find((item) => item && typeof item === "object" && !Array.isArray(item));
      return config || {};
    }
    if (typeof entry === "object") return entry;
  }
  return {};
}

function folderFromSpec(spec) {
  if (!spec || typeof spec !== "object") return "";
  const direct = spec.folder || spec.model_folder || spec.modelFolder;
  const named = cleanFolder(direct);
  if (named) return named;
  const route = spec.remote?.route || spec.remote?.url || "";
  const match = /\/models\/([A-Za-z0-9._-]+)\/?$/.exec(String(route));
  return match ? cleanFolder(match[1]) : "";
}

export function folderForWidget({ nodeType, widgetName, spec }) {
  const fromSpec = folderFromSpec(spec);
  if (fromSpec) return fromSpec;
  const typed = NODE_WIDGET_FOLDERS[`${nodeType || ""}:${widgetName || ""}`];
  if (typed) return typed;
  return WIDGET_FOLDERS[widgetName] || "";
}

function modelValues(value) {
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  if (looksLikeModelFile(text)) return [text.replace(/\\/g, "/")];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every((line) => looksLikeModelFile(line))) {
    return lines.map((line) => line.replace(/\\/g, "/"));
  }
  return [];
}

/** Model files selected on one node. `def` is that node type's object_info entry. */
export function modelsFromNode({ type, widgets, def }) {
  const found = [];
  for (const widget of widgets || []) {
    const folder = folderForWidget({
      nodeType: type,
      widgetName: widget?.name,
      spec: inputConfig(def, widget?.name),
    });
    if (!folder) continue;
    for (const name of modelValues(widget?.value)) found.push({ name, folder });
  }
  return found;
}

export function sameModel(existing, candidate) {
  const folderA = String(existing?.folder || "").trim().toLowerCase();
  const folderB = String(candidate?.folder || "").trim().toLowerCase();
  if (!folderA || folderA !== folderB) return false;
  const nameA = String(existing?.name || "").replace(/\\/g, "/").trim().toLowerCase();
  const nameB = String(candidate?.name || "").replace(/\\/g, "/").trim().toLowerCase();
  if (!nameA || !nameB) return false;
  return nameA === nameB || baseName(nameA) === baseName(nameB);
}

/** Files from the graph that this card does not already list in that folder. */
export function missingModels(existing, found) {
  const rows = [];
  for (const row of found || []) {
    const name = String(row?.name || "").replace(/\\/g, "/").trim();
    const folder = cleanFolder(row?.folder);
    if (!folder || !looksLikeModelFile(name)) continue;
    const candidate = { name, folder };
    if ((existing || []).some((item) => sameModel(item, candidate))) continue;
    const dup = rows.find((item) => sameModel(item, candidate));
    if (!dup) {
      rows.push({ name, folder, url: "", size: "", note: "" });
      continue;
    }
    if (name.includes("/") && !dup.name.includes("/")) dup.name = name;
  }
  return rows;
}

/** One pack per custom_nodes module, probed by the first node type seen. */
export function packsFromNodes(nodes) {
  const packs = [];
  const seen = new Set();
  for (const node of nodes || []) {
    const moduleName = clip(node?.module, 300);
    const match = /^custom_nodes\.([^.]+)/.exec(moduleName);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    packs.push({ name: match[1], url: "", node: clip(node?.type, 200).trim() });
  }
  return packs;
}

export const DEFAULT_BUTTON_COLOR = "#e25b45";
const BUTTON_INK_LIGHT = "#fff7f4";
const BUTTON_INK_DARK = "#2a100d";
const BUTTON_CARD = "#1c1412";

function buttonChannels(color) {
  const text = buttonColor(color);
  if (!text) return null;
  if (text.startsWith("#")) {
    let hex = text.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.slice(0, 3).split("").map((part) => part + part).join("");
    } else {
      hex = hex.slice(0, 6);
    }
    return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  }
  const rgb = /^rgba?\((\d+),(\d+),(\d+)/i.exec(text.replace(/\s+/g, ""));
  if (!rgb) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

function channelLuminance(channels) {
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(left, right) {
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Hex or rgb()/rgba(). Anything else is rejected so it cannot be painted. */
export function buttonColor(value) {
  const text = String(value ?? "").trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) {
    return text.toLowerCase();
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*((?:0|1)(?:\.0+)?|0?\.\d+)\s*)?\)$/i.exec(text);
  if (!rgb) return "";
  const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (channels.some((channel) => channel > 255)) return "";
  if (rgb[4] == null) return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
  const alpha = Number(rgb[4]);
  if (!(alpha >= 0 && alpha <= 1)) return "";
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function looksLikeColor(token) {
  return /^#|^rgba?\(/i.test(String(token ?? "").trim());
}

function looksLikeSize(token) {
  return /^\d+(?:[.,]\d+)?\s*(?:bytes|[kmgt]?b)?$/i.test(String(token ?? "").trim());
}

export function normalizeButtonStyle(value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "link" || key === "view" || key === "viewpage") return "link";
  if (key === "download") return "download";
  if (key === "readmore") return "readmore";
  if (key === "plain") return "plain";
  return "";
}

/** Ink that stays readable on `color`. Invalid colors use the default red. */
export function buttonInk(color) {
  const fill = channelLuminance(buttonChannels(buttonColor(color) || DEFAULT_BUTTON_COLOR));
  const light = channelLuminance(buttonChannels(BUTTON_INK_LIGHT));
  const dark = channelLuminance(buttonChannels(BUTTON_INK_DARK));
  return contrastRatio(fill, light) >= contrastRatio(fill, dark) ? BUTTON_INK_LIGHT : BUTTON_INK_DARK;
}

/** Text color for a filled pill, or for a plain pill sitting on the card. */
export function buttonText(color, style) {
  const fill = buttonColor(color) || DEFAULT_BUTTON_COLOR;
  if ((normalizeButtonStyle(style) || "link") !== "plain") return buttonInk(fill);
  const onCard = contrastRatio(channelLuminance(buttonChannels(fill)), channelLuminance(buttonChannels(BUTTON_CARD)));
  return onCard >= 4.5 ? fill : BUTTON_INK_LIGHT;
}

function splitPipes(raw) {
  const cells = [];
  let buf = "";
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "\\" && raw[i + 1] === "|") {
      buf += "|";
      i += 1;
      continue;
    }
    if (raw[i] === "|") {
      cells.push(buf.trim());
      buf = "";
      continue;
    }
    buf += raw[i];
  }
  cells.push(buf.trim());
  return cells;
}

function cleanSize(value) {
  return clip(value, 40).replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * `[[button: Label | https://url | #color | style | size]]`
 * Color, style, and size may be omitted. A bad color falls back to the
 * default red. A URL that is not http(s) is not a button.
 */
export function parseButtonSpec(raw) {
  const parts = splitPipes(String(raw ?? ""));
  if (parts.length < 2) return null;
  const label = clip(parts[0].replace(/\s+/g, " ").trim(), 200);
  const url = safeLink(parts[1]);
  if (!label || !url) return null;
  let color = "";
  let style = "";
  let size = "";
  const extra = parts.slice(2).map((part) => part.trim()).filter(Boolean);
  if (extra.length === 1) {
    const token = extra[0];
    const asStyle = normalizeButtonStyle(token);
    const asColor = buttonColor(token);
    if (asStyle) style = asStyle;
    else if (asColor) color = asColor;
    else if (!looksLikeColor(token) && looksLikeSize(token)) size = cleanSize(token);
  } else if (extra.length >= 2) {
    const asColor = buttonColor(extra[0]);
    if (asColor) color = asColor;
    if (!looksLikeColor(extra[0]) && normalizeButtonStyle(extra[0])) {
      style = normalizeButtonStyle(extra[0]);
      size = cleanSize(extra.slice(1).join(" "));
    } else {
      style = normalizeButtonStyle(extra[1]) || "";
      if (extra.length > 2) size = cleanSize(extra.slice(2).join(" "));
    }
  }
  return {
    type: "button",
    label,
    url,
    color: color || DEFAULT_BUTTON_COLOR,
    style: style || "link",
    size,
  };
}

/** Markdown for one button. Empty when the label or URL cannot be kept. */
export function formatButton(spec) {
  const label = clip(spec?.label, 200).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const url = safeLink(spec?.url);
  if (!label || !url) return "";
  const color = buttonColor(spec?.color);
  const style = normalizeButtonStyle(spec?.style) || "link";
  const size = cleanSize(spec?.size);
  const fields = [label.replace(/\|/g, "\\|"), url];
  const colored = Boolean(color) && color !== DEFAULT_BUTTON_COLOR;
  const styled = style !== "link";
  if (colored || styled || size) fields.push(color || DEFAULT_BUTTON_COLOR);
  if (styled || size) fields.push(style);
  if (size) fields.push(size.replace(/\|/g, "\\|"));
  return `[[button: ${fields.join(" | ")}]]`;
}

function decodeBasic(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits) => {
      const code = Number(digits);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => {
      const code = parseInt(digits, 16);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    });
}

function attrValue(attrs, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return match ? decodeBasic(match[2] ?? match[3] ?? "").trim() : "";
}

function plainText(html) {
  return decodeBasic(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

const PIXAROMA_STYLES = [
  ["pix-note-dl", "download"],
  ["pix-note-vp", "link"],
  ["pix-note-rm", "readmore"],
  ["pix-note-btn-plain", "plain"],
];

/** Pull label, href, color, and style out of one pasted button span. */
export function readPixaromaButton(chunk) {
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(String(chunk ?? ""));
  if (!anchor) return null;
  const classes = attrValue(anchor[1], "class").toLowerCase().split(/\s+/).filter(Boolean);
  const style = PIXAROMA_STYLES.find(([name]) => classes.includes(name))?.[1] || "";
  if (!style) return null;
  const href = attrValue(anchor[1], "href").replace(/\s+/g, "");
  const background = /background-color\s*:\s*([^;]+)/i.exec(attrValue(anchor[1], "style"));
  const color = background ? buttonColor(decodeBasic(background[1]).trim()) : "";
  const sizeMatch = /<span\b[^>]*\bclass\s*=\s*(["'])[^"']*\bpix-note-btnsize\b[^"']*\1[^>]*>([\s\S]*?)<\/span>/i.exec(anchor[2]);
  const size = sizeMatch ? cleanSize(plainText(sizeMatch[2])) : "";
  const labelHtml = sizeMatch ? anchor[2].replace(sizeMatch[0], " ") : anchor[2];
  const label = clip(plainText(labelHtml), 200);
  return {
    label,
    url: safeLink(href),
    color,
    style,
    size,
  };
}

function spanOpenAt(text, classIndex) {
  const start = text.slice(0, classIndex).toLowerCase().lastIndexOf("<span");
  if (start < 0) return -1;
  if (text.slice(start, classIndex).includes(">")) return -1;
  return start;
}

function findSpanEnd(text, start) {
  const tags = /<\/?span\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match = tags.exec(text);
  while (match) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return match.index + match[0].length;
    } else {
      depth += 1;
    }
    match = tags.exec(text);
  }
  return -1;
}

function pixaromaReplacement(chunk) {
  const button = readPixaromaButton(chunk);
  if (button?.url) {
    const syntax = formatButton(button);
    if (syntax) return syntax;
  }
  if (button?.label) return button.label;
  return plainText(chunk);
}

function replacePixaromaBlocks(text) {
  const needle = "pix-note-btnblock";
  if (!text.toLowerCase().includes(needle)) return text;
  const lower = text.toLowerCase();
  let out = "";
  let cursor = 0;
  let from = 0;
  while (from < text.length) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    const start = spanOpenAt(text, at);
    if (start < 0 || start < cursor) {
      from = at + needle.length;
      continue;
    }
    const end = findSpanEnd(text, start);
    if (end < 0 || end - start > 8000) {
      from = at + needle.length;
      continue;
    }
    out += text.slice(cursor, start);
    out += pixaromaReplacement(text.slice(start, end));
    cursor = end;
    from = end;
  }
  return out + text.slice(cursor);
}

function unwrapButtonWrappers(text) {
  return text.replace(/<(p|div)\b[^>]*>([\s\S]*?)<\/\1>/gi, (full, _tag, inner) => {
    if (!/\[\[button:/i.test(inner)) return full;
    const leftover = inner
      .replace(/\[\[button:[\s\S]*?\]\]/gi, "")
      .replace(/&nbsp;|&#160;|&#xa0;/gi, "")
      .replace(/\s+/g, "");
    if (leftover) return full;
    return inner.replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/[ \t]{2,}/g, " ").trim();
  });
}

/**
 * Turn pasted Pixaroma button HTML into button syntax. Only the label,
 * href, color, and style are kept. The HTML itself is never mounted.
 * Fenced code, inline code, script, and style are left unchanged.
 */
export function translateButtonMarkup(text) {
  const source = String(text ?? "");
  const protectedRegion = /```[\s\S]*?```|`[^`\n]+`|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi;
  let out = "";
  let last = 0;
  let match = protectedRegion.exec(source);
  const rewrite = (region) => unwrapButtonWrappers(unwrapButtonWrappers(replacePixaromaBlocks(region)));
  while (match) {
    out += rewrite(source.slice(last, match.index));
    out += match[0];
    last = match.index + match[0].length;
    match = protectedRegion.exec(source);
  }
  return out + rewrite(source.slice(last));
}

export function parseInline(text) {
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
      if (end > i + 1 && !src.slice(i, end).includes("\n")) {
        flush();
        spans.push({ type: "code", text: src.slice(i + 1, end) });
        i = end;
        continue;
      }
    }
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2 && !src.slice(i + 2, end).includes("\n")) {
        flush();
        spans.push({ type: "strong", text: src.slice(i + 2, end) });
        i = end + 1;
        continue;
      }
    }
    if (src[i] === "[") {
      const opener = /^\[\[button:/i.exec(src.slice(i));
      if (opener) {
        const end = src.indexOf("]]", i + opener[0].length);
        if (end > i && !src.slice(i, end).includes("\n")) {
          const spec = parseButtonSpec(src.slice(i + opener[0].length, end));
          flush();
          if (spec) spans.push(spec);
          else spans.push({ type: "text", text: src.slice(i, end + 2) });
          i = end + 1;
          continue;
        }
      }
      const tone = /^(teal|green|amber|glow)\]/.exec(src.slice(i + 1));
      if (tone) {
        const name = tone[1];
        const closer = `[/${name}]`;
        const end = src.indexOf(closer, i + name.length + 2);
        if (end > i && !src.slice(i + name.length + 2, end).includes("\n")) {
          flush();
          spans.push({ type: "tone", tone: name, text: src.slice(i + name.length + 2, end) });
          i = end + closer.length - 1;
          continue;
        }
      }
      const close = src.indexOf("](", i + 1);
      const end = close > i ? src.indexOf(")", close + 2) : -1;
      if (close > i + 1 && end > close + 2 && !src.slice(close + 2, end).includes("\n")) {
        const label = src.slice(i + 1, close);
        const url = safeLink(src.slice(close + 2, end));
        flush();
        if (url) spans.push({ type: "link", text: label, url });
        else spans.push({ type: "text", text: src.slice(i, end + 1) });
        i = end;
        continue;
      }
    }
    if (src[i] === "*" && src[i + 1] !== "*") {
      const end = src.indexOf("*", i + 1);
      const beforeOk = i === 0 || /\s/.test(src[i - 1]);
      const afterOk = end === src.length - 1 || /\s/.test(src[end + 1] || "");
      if (end > i + 1 && beforeOk && afterOk && !src.slice(i + 1, end).includes("\n")) {
        flush();
        spans.push({ type: "em", text: src.slice(i + 1, end) });
        i = end;
        continue;
      }
    }
    buf += src[i];
  }
  flush();
  return spans;
}

function splitCells(line) {
  let row = line.trim();
  if (!row.includes("|")) return [];
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells = [];
  let buf = "";
  for (let i = 0; i < row.length; i += 1) {
    if (row[i] === "\\" && row[i + 1] === "|") {
      buf += "|";
      i += 1;
      continue;
    }
    if (row[i] === "|") {
      cells.push(buf.trim());
      buf = "";
      continue;
    }
    buf += row[i];
  }
  cells.push(buf.trim());
  return cells;
}

function isDivider(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function buttonGroup(spans) {
  let count = 0;
  for (const span of spans) {
    if (span.type === "button") {
      count += 1;
      continue;
    }
    if (span.type === "br") continue;
    if (span.type === "text" && !String(span.text || "").trim()) continue;
    return null;
  }
  return count ? spans.filter((span) => span.type === "button") : null;
}

export function parseMarkdown(text) {
  const lines = translateButtonMarkup(clip(text, BODY_LIMIT)).replace(/\r\n?/g, "\n").split("\n");
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
    const group = buttonGroup(spans);
    if (group) blocks.push({ type: "buttons", items: group });
    else blocks.push({ type: "paragraph", spans });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trimEnd();
    if (code) {
      if (line.trim().startsWith("```")) {
        blocks.push(code);
        code = null;
      } else code.text += (code.text ? "\n" : "") + raw;
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      code = { type: "code", text: "" };
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const divider = splitCells(lines[index + 1] || "");
    const headers = splitCells(line);
    if (headers.length > 1 && headers.length === divider.length && isDivider(divider)) {
      flushParagraph();
      flushList();
      const rows = [];
      index += 1;
      while (lines[index + 1] && splitCells(lines[index + 1]).length === headers.length) {
        const cells = splitCells(lines[index + 1]);
        if (isDivider(cells)) break;
        rows.push(cells.map((cell) => parseInline(cell)));
        index += 1;
      }
      blocks.push({ type: "table", headers: headers.map((cell) => parseInline(cell)), rows });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line.trim());
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph();
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: "list", ordered, items: [] };
      }
      list.items.push(parseInline((bullet || numbered)[1]));
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  if (code) blocks.push(code);
  flushParagraph();
  flushList();
  return blocks;
}

function element(doc, tag, text) {
  const node = doc.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

function paintSpans(doc, parent, spans) {
  for (const span of spans || []) {
    if (span.type === "br") {
      parent.append(doc.createElement("br"));
    } else if (span.type === "strong") {
      parent.append(element(doc, "strong", span.text));
    } else if (span.type === "em") {
      parent.append(element(doc, "em", span.text));
    } else if (span.type === "code") {
      parent.append(element(doc, "code", span.text));
    } else if (span.type === "tone") {
      const tone = element(doc, "span", span.text);
      tone.className = `dh-tone-${span.tone}`;
      parent.append(tone);
    } else if (span.type === "link") {
      const url = safeLink(span.url);
      if (!url) {
        parent.append(doc.createTextNode(span.text || ""));
      } else {
        const link = element(doc, "a", span.text || url);
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        parent.append(link);
      }
    } else if (span.type === "button") {
      paintButton(doc, parent, span);
    } else {
      parent.append(doc.createTextNode(span.text || ""));
    }
  }
}

const BUTTON_ICONS = {
  download: "M6 1.8v5.2M3.7 5.1 6 7.6 8.3 5.1M2.4 9.4h7.2",
  link: "M4.2 7.8 7.8 4.2M5.2 3.6h3.4v3.2M3.2 5.6v3.4h3.4",
  readmore: "M2.2 2.2h3.5v7.6H2.2zM5.7 2.2H9.6v7.6H5.7",
};

function paintButton(doc, parent, span) {
  const url = safeLink(span?.url);
  if (!url) {
    parent.append(doc.createTextNode(span?.label || ""));
    return;
  }
  const styleName = normalizeButtonStyle(span.style) || "link";
  const color = buttonColor(span.color) || DEFAULT_BUTTON_COLOR;
  const text = buttonText(color, styleName);
  const link = element(doc, "a");
  link.className = `devil-btn devil-btn-${styleName}`;
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (link.style && typeof link.style.setProperty === "function") {
    link.style.setProperty("--devil-btn-bg", color);
    link.style.setProperty("--devil-btn-fg", text);
    link.style.setProperty("--devil-btn-hover-fg", buttonInk(color));
  }
  const icon = BUTTON_ICONS[styleName];
  if (icon && typeof doc.createElementNS === "function") {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "devil-btnicon");
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", icon);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    link.append(svg);
  }
  link.append(doc.createTextNode(span.label || url));
  const size = cleanSize(span.size);
  if (size) {
    const badge = element(doc, "span", size);
    badge.className = "devil-btnsize";
    link.append(badge);
  }
  parent.append(link);
}

/** Build Markdown with text nodes. `parent` is not cleared. */
export function mountMarkdown(doc, parent, text) {
  for (const block of parseMarkdown(text)) {
    if (block.type === "heading") {
      const level = Math.min(3, Math.max(1, block.level || 1));
      const heading = element(doc, `h${level}`);
      paintSpans(doc, heading, block.spans);
      parent.append(heading);
    } else if (block.type === "paragraph") {
      const paragraph = element(doc, "p");
      paintSpans(doc, paragraph, block.spans);
      parent.append(paragraph);
    } else if (block.type === "buttons") {
      const row = element(doc, "div");
      row.className = "devil-btnrow";
      for (const item of block.items) paintButton(doc, row, item);
      parent.append(row);
    } else if (block.type === "list") {
      const list = element(doc, block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const li = element(doc, "li");
        paintSpans(doc, li, item);
        list.append(li);
      }
      parent.append(list);
    } else if (block.type === "code") {
      const pre = element(doc, "pre");
      pre.append(element(doc, "code", block.text));
      parent.append(pre);
    } else if (block.type === "hr") {
      parent.append(doc.createElement("hr"));
    } else if (block.type === "table") {
      const table = element(doc, "table");
      const head = doc.createElement("tr");
      for (const cell of block.headers) {
        const th = element(doc, "th");
        paintSpans(doc, th, cell);
        head.append(th);
      }
      table.append(head);
      for (const row of block.rows) {
        const tr = doc.createElement("tr");
        for (const cell of row) {
          const td = element(doc, "td");
          paintSpans(doc, td, cell);
          tr.append(td);
        }
        table.append(tr);
      }
      parent.append(table);
    }
  }
}
