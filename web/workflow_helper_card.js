/**
 * Workflow Helper card: the JSON saved with a workflow, Markdown as data,
 * and the installed-file match. No network and no ComfyUI imports.
 *
 * Shared workflows are someone else's text. Links are http(s) only, and the
 * Markdown renderer builds text nodes rather than HTML.
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
    } else {
      parent.append(doc.createTextNode(span.text || ""));
    }
  }
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
