/**
 * Card JSON, Markdown text nodes, and the installed-file match.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CIVITAI_TOKEN_STORAGE_KEY,
  cardHasContent,
  civitaiHost,
  downloadBody,
  folderChoices,
  folderForWidget,
  folderLabel,
  groupModels,
  inputConfig,
  missingModels,
  modelsFromNode,
  panelBox,
  hubFilePath,
  matchFile,
  modelDownloadName,
  modelNameAfterDownload,
  modelSource,
  buttonColor,
  buttonInk,
  buttonText,
  formatButton,
  mountMarkdown,
  normalizeCard,
  packsFromNodes,
  parseButtonSpec,
  parseMarkdown,
  readPixaromaButton,
  rememberCivitaiToken,
  showsTile,
  storedCivitaiToken,
  tileIsDownloadList,
  translateButtonMarkup,
  safeLink,
  serializeCard,
} from "../web/workflow_helper_card.js";

function documentShim() {
  class NodeShim {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.attrs = {};
      this._text = null;
      const props = {};
      this.style = {
        setProperty(name, value) {
          props[name] = String(value);
        },
        getPropertyValue(name) {
          return props[name] || "";
        },
      };
    }

    get textContent() {
      if (this._text != null && this.children.length === 0) return this._text;
      return this.children.map((child) => child.textContent).join("");
    }

    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }

    append(...nodes) {
      for (const node of nodes) this.children.push(node);
    }

    set href(value) {
      this.attrs.href = value;
    }

    get href() {
      return this.attrs.href || "";
    }

    set target(value) {
      this.attrs.target = value;
    }

    set rel(value) {
      this.attrs.rel = value;
    }
  }

  const walk = (node, tag, found) => {
    if (node.tag === tag) found.push(node);
    for (const child of node.children || []) walk(child, tag, found);
  };

  return {
    createElement(tag) {
      return new NodeShim(tag);
    },
    createTextNode(text) {
      const node = new NodeShim("#text");
      node.textContent = text;
      return node;
    },
    tags(root, tag) {
      const found = [];
      walk(root, tag, found);
      return found;
    },
  };
}

test("card json round-trips the fields a shared workflow needs", () => {
  const card = normalizeCard({
    title: "Portrait",
    body: "Queue it.",
    layout: "banner",
    models: [{ name: "a.safetensors", folder: "loras", url: "hf://org/repo/a.safetensors", size: "1 GB", note: "main" }],
    packs: [{ name: "SomePack", url: "https://github.com/org/some-pack", node: "SomeNode" }],
    links: [{ label: "GitHub", url: "https://github.com/org" }],
    ignored: "nope",
  });
  assert.equal(card.layout, "banner");
  assert.equal(card.models[0].url, "hf://org/repo/a.safetensors");
  assert.equal(card.packs[0].node, "SomeNode");
  assert.equal(card.links[0].label, "GitHub");
  assert.equal(card.ignored, undefined);
  const again = normalizeCard(serializeCard(card));
  assert.deepEqual(again, card);
  assert.equal(cardHasContent(card), true);
  assert.equal(cardHasContent(normalizeCard("{}")), false);
});

test("a civitai token is not part of the saved card and is sent only to civitai", () => {
  const secret = "c".repeat(32);
  const card = normalizeCard({
    title: "T",
    body: "How to run",
    civitai_token: secret,
    civitaiToken: secret,
    token: secret,
    models: [{ name: "a.safetensors", folder: "checkpoints", url: "https://civitai.com/api/download/models/7" }],
  });
  const saved = serializeCard(card);
  assert.equal(saved.includes(secret), false);
  assert.equal(card.civitai_token, undefined);
  assert.equal(card.civitaiToken, undefined);
  assert.equal(card.token, undefined);

  const storage = {
    data: new Map(),
    getItem(key) {
      return this.data.has(key) ? this.data.get(key) : null;
    },
    setItem(key, value) {
      this.data.set(key, String(value));
    },
    removeItem(key) {
      this.data.delete(key);
    },
  };
  assert.equal(rememberCivitaiToken(storage, `  ${secret}  `), secret);
  assert.equal(storage.data.get(CIVITAI_TOKEN_STORAGE_KEY), secret);
  assert.equal(storedCivitaiToken(storage), secret);
  assert.equal(rememberCivitaiToken(storage, "   "), "");
  assert.equal(storedCivitaiToken(storage), "");

  const civ = downloadBody(
    { url: "https://www.civitai.com/api/download/models/7", name: "a.safetensors", folder: "checkpoints" },
    secret,
  );
  assert.equal(civ.civitai_token, secret);
  assert.equal(civitaiHost(civ.url), true);
  const hf = downloadBody(
    { url: "https://huggingface.co/org/repo/resolve/main/a.safetensors", name: "a.safetensors", folder: "checkpoints" },
    secret,
  );
  assert.equal(hf.civitai_token, undefined);
  assert.equal(JSON.stringify(hf).includes(secret), false);
  const cdn = downloadBody({ url: "https://cdn.example/a.safetensors", name: "a.safetensors", folder: "checkpoints" }, secret);
  assert.equal(cdn.civitai_token, undefined);
});

test("unsafe urls are dropped and download urls keep the schemes the server fetches", () => {
  const card = normalizeCard({
    title: "T",
    models: [
      { name: "a.safetensors", folder: "checkpoints", url: "javascript:alert(1)" },
      { name: "b.safetensors", folder: "vae", url: "https://civitai.com/api/download/models/7" },
      { name: "c.safetensors", folder: "checkpoints", url: "hf download hf://org/repo/c.safetensors" },
    ],
    links: [{ label: "bad", url: "javascript:alert(1)" }, { label: "", url: "https://example.com/docs" }],
  });
  assert.equal(card.models[0].url, "");
  assert.equal(card.models[1].url, "https://civitai.com/api/download/models/7");
  assert.equal(card.models[2].url, "hf://org/repo/c.safetensors");
  assert.equal(card.links[0].url, "");
  assert.equal(card.links[1].url, "https://example.com/docs");
  assert.equal(safeLink("javascript:alert(1)"), "");
  assert.equal(modelSource("b2://bucket/file.safetensors").startsWith("b2:"), true);
});

test("a huggingface file url names the model, and a repo page waits for the saved file", () => {
  const weight = "viggle-image-swap-v0.1-lora.safetensors";
  const fileUrl = `https://huggingface.co/Viggle/Viggle-Image-Swap/resolve/main/${weight}`;
  const repoUrl = "https://huggingface.co/Viggle/Viggle-Image-Swap";
  assert.equal(modelDownloadName("Viggle/Viggle-Image-Swap", fileUrl), weight);
  assert.equal(modelDownloadName("custom.safetensors", fileUrl), "custom.safetensors");
  assert.equal(
    modelDownloadName("Viggle-Image-Swap", `https://hf.co/Viggle/Viggle-Image-Swap/blob/main/${weight}`),
    weight,
  );
  assert.equal(
    modelDownloadName("Viggle/Viggle-Image-Swap", `hf://Viggle/Viggle-Image-Swap/${weight}`),
    weight,
  );
  assert.equal(hubFilePath(repoUrl), "");
  assert.equal(modelDownloadName("Viggle/Viggle-Image-Swap", repoUrl), "Viggle/Viggle-Image-Swap");
  assert.equal(modelNameAfterDownload("Viggle/Viggle-Image-Swap", repoUrl, weight), weight);
  assert.equal(
    modelNameAfterDownload("Viggle/Viggle-Image-Swap", repoUrl, "one.safetensors"),
    "one.safetensors",
  );
  const posted = downloadBody({ url: fileUrl, name: "Viggle/Viggle-Image-Swap", folder: "loras" });
  assert.equal(posted.filename, weight);
  const found = matchFile(modelDownloadName("Viggle/Viggle-Image-Swap", fileUrl), [weight]);
  assert.equal(found.found, true);
  assert.equal(found.path, weight);
});

test("files match by exact path or by name inside a subfolder", () => {
  const exact = matchFile("heroes/a.safetensors", ["other.safetensors", "heroes/a.safetensors"]);
  assert.deepEqual(exact, { found: true, path: "heroes/a.safetensors" });
  const loose = matchFile("a.safetensors", ["Heroes/A.safetensors"]);
  assert.equal(loose.found, true);
  assert.equal(matchFile("missing.safetensors", ["a.safetensors"]).found, false);
  const groups = groupModels([
    { folder: "loras", name: "a" },
    { folder: "vae", name: "b" },
    { folder: "loras", name: "c" },
  ]);
  assert.equal(groups[0].folder, "loras");
  assert.equal(groups[0].rows.length, 2);
  assert.equal(folderLabel("loras"), "models/loras");
});

test("pack detection keeps custom packs and skips core modules", () => {
  const packs = packsFromNodes([
    { type: "KSampler", module: "nodes" },
    { type: "Extra", module: "comfy_extras.nodes_custom" },
    { type: "First", module: "custom_nodes.SomePack.nodes" },
    { type: "Second", module: "custom_nodes.SomePack.other" },
    { type: "Third", module: "custom_nodes.OtherPack" },
  ]);
  assert.deepEqual(packs, [
    { name: "SomePack", url: "", node: "First" },
    { name: "OtherPack", url: "", node: "Third" },
  ]);
});

test("folder dropdown lists every folder and keeps a saved one", () => {
  const { options, selected } = folderChoices(
    ["checkpoints", "custom_folder", "../nope", "loras"],
    "my_saved_folder",
  );
  assert.equal(selected, "my_saved_folder");
  assert.ok(options.includes("checkpoints"));
  assert.ok(options.includes("loras"));
  assert.ok(options.includes("vae"));
  assert.ok(options.includes("custom_folder"));
  assert.ok(options.includes("my_saved_folder"));
  assert.equal(options.includes("../nope"), false);
  assert.equal(options.indexOf("checkpoints") < options.indexOf("custom_folder"), true);
  const fresh = folderChoices(["diffusion_models"], "");
  assert.equal(fresh.selected, "checkpoints");
  assert.equal(fresh.options.filter((folder) => folder === "checkpoints").length, 1);
});

test("a workflow scan suggests loader files that the card does not already list", () => {
  const checkpoint = {
    input: {
      required: {
        ckpt_name: [["old.safetensors"], { tooltip: "checkpoint" }],
      },
    },
  };
  const lora = {
    input: {
      required: {
        lora_name: ["COMBO", { remote: { route: "/internal/models/loras" } }],
      },
    },
  };
  const vision = {
    input: {
      required: {
        clip_name: [["vision.safetensors"]],
      },
    },
  };
  assert.equal(inputConfig(lora, "lora_name").remote.route, "/internal/models/loras");
  assert.equal(folderForWidget({
    nodeType: "CustomLora",
    widgetName: "lora_name",
    spec: inputConfig(lora, "lora_name"),
  }), "loras");
  assert.equal(folderForWidget({
    nodeType: "CLIPVisionLoader",
    widgetName: "clip_name",
    spec: inputConfig(vision, "clip_name"),
  }), "clip_vision");
  assert.equal(folderForWidget({
    nodeType: "UpscaleModelLoader",
    widgetName: "model_name",
    spec: {},
  }), "upscale_models");

  const found = [
    ...modelsFromNode({
      type: "CheckpointLoaderSimple",
      widgets: [
        { name: "ckpt_name", value: "heroes\\portrait.safetensors" },
        { name: "ckpt_name", value: "None" },
      ],
      def: checkpoint,
    }),
    ...modelsFromNode({
      type: "LoraLoader",
      widgets: [{ name: "lora_name", value: "detail.safetensors" }],
      def: lora,
    }),
    ...modelsFromNode({
      type: "CLIPVisionLoader",
      widgets: [{ name: "clip_name", value: "vision.safetensors" }],
      def: vision,
    }),
    ...modelsFromNode({
      type: "Note",
      widgets: [{ name: "text", value: "not a model" }],
      def: {},
    }),
  ];
  const missing = missingModels(
    [{ name: "portrait.safetensors", folder: "checkpoints" }],
    found,
  );
  assert.deepEqual(missing.map((row) => [row.folder, row.name, row.url]), [
    ["loras", "detail.safetensors", ""],
    ["clip_vision", "vision.safetensors", ""],
  ]);
  const again = missingModels(
    [{ name: "sub/detail.safetensors", folder: "loras" }],
    [{ name: "detail.safetensors", folder: "loras" }],
  );
  assert.equal(again.length, 0);
  const otherFolder = missingModels(
    [{ name: "detail.safetensors", folder: "checkpoints" }],
    [{ name: "detail.safetensors", folder: "loras" }],
  );
  assert.equal(otherFolder.length, 1);
});

test("the card box uses the rest of the node below the title", () => {
  const filled = panelBox({ nodeWidth: 520, nodeHeight: 460, top: 36, contentMin: 120 });
  assert.equal(filled.width, 520);
  assert.equal(filled.height, 424);
  const content = panelBox({ nodeWidth: 180, nodeHeight: 90, top: 36, contentMin: 200 });
  assert.equal(content.width, 220);
  assert.equal(content.height, 200);
});

test("info tile is a saved layout and only shows when the card has content", () => {
  const tile = normalizeCard({
    layout: "tile",
    title: "Download models",
    models: [{ name: "a.safetensors", folder: "checkpoints", url: "https://example.com/a.safetensors" }],
    packs: [{ name: "Pack", url: "https://example.com", node: "Node" }],
    links: [{ label: "Site", url: "https://example.com" }],
  });
  assert.equal(tile.layout, "tile");
  assert.equal(tile.models.length, 1);
  assert.equal(showsTile(tile), true);
  assert.equal(tileIsDownloadList(tile), true);
  assert.equal(showsTile(normalizeCard({ layout: "tile" })), false);
  assert.equal(normalizeCard({ layout: "nope" }).layout, "card");
  const guide = normalizeCard({ layout: "tile", title: "How to run", body: "Queue it." });
  assert.equal(tileIsDownloadList(guide), false);
  assert.equal(tileIsDownloadList(normalizeCard({
    layout: "tile",
    title: "Notes",
    models: [{ name: "b.safetensors", folder: "loras" }],
  })), true);
});

test("color tags and pipe tables parse, and fenced code stays literal", () => {
  const heading = parseMarkdown("# [teal]Title[/teal]");
  assert.equal(heading[0].type, "heading");
  assert.equal(heading[0].spans[0].type, "tone");
  assert.equal(heading[0].spans[0].tone, "teal");
  assert.equal(heading[0].spans[0].text, "Title");

  const list = parseMarkdown("- [amber]step[/amber]");
  assert.equal(list[0].items[0][0].type, "tone");
  assert.equal(list[0].items[0][0].tone, "amber");

  const glow = parseMarkdown("[glow]look[/glow]");
  assert.equal(glow[0].spans[0].tone, "glow");

  const table = parseMarkdown("| A | B |\n| --- | --- |\n| left \\| side | [green]ok[/green] |\n");
  assert.equal(table[0].type, "table");
  assert.equal(table[0].rows[0][0][0].text, "left | side");
  assert.equal(table[0].rows[0][1][0].type, "tone");
  assert.equal(table[0].rows[0][1][0].tone, "green");
  assert.equal(table[0].rows[0][1][0].text, "ok");

  const code = parseMarkdown("```\n[teal]nope[/teal]\n| not | a | table |\n```");
  assert.equal(code[0].type, "code");
  assert.match(code[0].text, /\[teal\]nope\[\/teal\]/);
  assert.match(code[0].text, /\| not \| a \| table \|/);

  const doc = documentShim();
  const host = doc.createElement("div");
  mountMarkdown(doc, host, "[teal]one[/teal] and [glow]two[/glow]");
  const tones = [];
  const walk = (node) => {
    if (String(node.className || "").startsWith("dh-tone-")) tones.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(host);
  assert.deepEqual(tones.map((node) => node.className), ["dh-tone-teal", "dh-tone-glow"]);
  assert.deepEqual(tones.map((node) => node.textContent), ["one", "two"]);
});

test("markdown is mounted as text, including markup that must not run", () => {
  const doc = documentShim();
  const root = doc.createElement("div");
  mountMarkdown(
    doc,
    root,
    [
      "# Title",
      "",
      "Use **bold** and [docs](https://example.com/docs).",
      "",
      "[nope](javascript:alert(1))",
      "",
      "<script>alert(1)</script>",
      "",
      "```",
      "<img src=x onerror=alert(1)>",
      "```",
      "",
      "- one",
      "- two",
    ].join("\n"),
  );
  assert.equal(doc.tags(root, "script").length, 0);
  assert.equal(doc.tags(root, "img").length, 0);
  assert.equal(doc.tags(root, "strong")[0].textContent, "bold");
  const links = doc.tags(root, "a");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://example.com/docs");
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(root.textContent, /onerror=alert\(1\)/);
  assert.match(root.textContent, /javascript:alert\(1\)/);
  assert.equal(doc.tags(root, "li").length, 2);
  assert.equal(doc.tags(root, "h1")[0].textContent, "Title");
});

test("button syntax parses label, url, color, style, and a download size", () => {
  const full = parseButtonSpec(" Get the model | https://example.com/model.safetensors | #F66744 | download | 1.2 GB ");
  assert.equal(full.label, "Get the model");
  assert.equal(full.url, "https://example.com/model.safetensors");
  assert.equal(full.color, "#f66744");
  assert.equal(full.style, "download");
  assert.equal(full.size, "1.2 GB");

  const short = parseButtonSpec("Watch | https://example.com/watch");
  assert.equal(short.color, "#e25b45");
  assert.equal(short.style, "link");
  assert.equal(short.size, "");

  const styled = parseButtonSpec("Notes | https://example.com/notes | plain");
  assert.equal(styled.style, "plain");
  assert.equal(styled.color, "#e25b45");

  const rgb = parseButtonSpec("Teal | https://example.com | rgb(61, 204, 199) | readmore");
  assert.equal(rgb.color, "rgb(61, 204, 199)");
  assert.equal(rgb.style, "readmore");

  const sized = parseButtonSpec("File | https://example.com/file | download | 724 MB");
  assert.equal(sized.style, "download");
  assert.equal(sized.size, "724 MB");
  assert.equal(sized.color, "#e25b45");

  const line = parseMarkdown([
    "[[button: Watch | https://example.com/watch | #e25b45 | readmore]] [[button: Get the model | https://example.com/model.safetensors | #f0b429 | download | 1.2 GB]]",
  ].join("\n"));
  assert.equal(line[0].type, "buttons");
  assert.equal(line[0].items.length, 2);
  assert.equal(line[0].items[0].style, "readmore");
  assert.equal(line[0].items[1].size, "1.2 GB");
  assert.equal(formatButton(line[0].items[1]), "[[button: Get the model | https://example.com/model.safetensors | #f0b429 | download | 1.2 GB]]");

  const mixed = parseMarkdown("See [[button: Docs | https://example.com/docs]] now");
  assert.equal(mixed[0].type, "paragraph");
  assert.equal(mixed[0].spans.some((span) => span.type === "button"), true);

  assert.equal(buttonColor("#fff"), "#fff");
  assert.equal(buttonColor("rgb(999, 0, 0)"), "");
  assert.equal(buttonColor("red"), "");
  assert.equal(buttonColor("expression(alert(1))"), "");
  assert.equal(buttonInk("#ffffff"), "#2a100d");
  assert.equal(buttonInk("#000000"), "#fff7f4");
  assert.equal(buttonInk("#e25b45"), "#2a100d");
  assert.equal(buttonText("#e25b45", "plain"), "#e25b45");
  assert.equal(buttonText("#000000", "plain"), "#fff7f4");
});

test("unsafe button urls and colors are not painted, and pasted pixaroma html becomes a button", () => {
  const rejected = parseMarkdown("[[button: X | javascript:alert(1) | #fff | readmore]]");
  assert.equal(rejected[0].spans.some((span) => span.type === "button"), false);
  assert.match(rejected.map((block) => block.spans?.map((span) => span.text || "").join("")).join("\n"), /javascript:alert\(1\)/);

  const dyed = parseMarkdown("[[button: Safe | https://example.com/safe | #zzzzzz | plain]]");
  assert.equal(dyed[0].type, "buttons");
  assert.equal(dyed[0].items[0].color, "#e25b45");
  assert.equal(dyed[0].items[0].style, "plain");
  assert.equal(dyed[0].items[0].url, "https://example.com/safe");

  const named = parseMarkdown("[[button: Safe | https://example.com/safe | expression(alert(1))]]");
  assert.equal(named[0].items[0].color, "#e25b45");
  assert.equal(named[0].items[0].size, "");

  const pasted = [
    '<p><span class="pix-note-btnblock"><a class="pix-note-rm" style="background-color: #f66744" href="https://www.youtube.com/@pixaroma" target="_blank" rel="noopener noreferrer">Pixaroma YouTube Channel</a></span></p>',
    '<span class="pix-note-btnblock"><a class="pix-note-dl" href="https://example.com/model.safetensors" style="background-color: rgb(61, 204, 199)" onclick="alert(1)">Get the model<span class="pix-note-btnsize">1.2 GB</span></a></span>',
    '<span class="pix-note-btnblock"><a class="pix-note-btn-plain" style="background-color: red" href="https://example.com/notes">Notes</a></span>',
    "",
    '<span class="pix-note-btnblock"><a class="pix-note-vp" href="javascript:alert(1)" style="background-color: url(javascript:alert(1))">Click</a></span>',
    "<script>alert(1)</script>",
  ].join("\n");
  const read = readPixaromaButton(pasted.split("\n")[0]);
  assert.equal(read.label, "Pixaroma YouTube Channel");
  assert.equal(read.url, "https://www.youtube.com/@pixaroma");
  assert.equal(read.color, "#f66744");
  assert.equal(read.style, "readmore");
  assert.match(translateButtonMarkup(pasted), /\[\[button: Pixaroma YouTube Channel \| https:\/\/www\.youtube\.com\/@pixaroma \| #f66744 \| readmore\]\]/);
  assert.doesNotMatch(translateButtonMarkup(pasted), /onclick|pix-note-btnblock|<a /i);

  const doc = documentShim();
  const root = doc.createElement("div");
  mountMarkdown(doc, root, pasted);
  assert.equal(doc.tags(root, "script").length, 0);
  const links = doc.tags(root, "a");
  assert.equal(links.length, 3);
  assert.deepEqual(links.map((link) => link.className), [
    "devil-btn devil-btn-readmore",
    "devil-btn devil-btn-download",
    "devil-btn devil-btn-plain",
  ]);
  assert.equal(links[0].href, "https://www.youtube.com/@pixaroma");
  assert.equal(links[0].attrs.target, "_blank");
  assert.equal(links[0].attrs.rel, "noopener noreferrer");
  assert.equal(links[0].style.getPropertyValue("--devil-btn-bg"), "#f66744");
  assert.equal(links[0].style.getPropertyValue("--devil-btn-fg"), "#2a100d");
  assert.equal(links[0].attrs.onclick, undefined);
  assert.equal(links[1].href, "https://example.com/model.safetensors");
  assert.equal(links[1].style.getPropertyValue("--devil-btn-bg"), "rgb(61, 204, 199)");
  const badge = links[1].children.find((child) => child.className === "devil-btnsize");
  assert.equal(badge.textContent, "1.2 GB");
  assert.equal(links[2].style.getPropertyValue("--devil-btn-bg"), "#e25b45");
  assert.equal(links[2].style.getPropertyValue("--devil-btn-fg"), "#e25b45");
  assert.match(root.textContent, /Click/);
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(links.map((link) => link.href).join("\n"), /javascript:/);
  assert.equal(doc.tags(root, "div").some((node) => node.className === "devil-btnrow"), true);

  const fenced = parseMarkdown('```\n<span class="pix-note-btnblock"><a class="pix-note-rm" href="https://example.com">X</a></span>\n```');
  assert.equal(fenced[0].type, "code");
  assert.match(fenced[0].text, /pix-note-btnblock/);
  assert.equal(fenced.some((block) => block.type === "buttons"), false);
});
