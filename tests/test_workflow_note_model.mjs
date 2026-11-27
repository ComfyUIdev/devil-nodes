/**
 * Workflow Note JSON, Markdown text nodes, file match, and pack detection.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVIL_REGISTRY_URL,
  SAMPLE_TABLE,
  alsoReadFrom,
  applyLoaderUpdates,
  arrowDelta,
  buttonMarkup,
  detectPacks,
  flattenGraph,
  loaderUpdates,
  matchAcrossFolders,
  mergePacks,
  mountMarkdown,
  nodeTypeForLayout,
  normalizeNote,
  notesEqual,
  packLink,
  parseMarkdown,
  parseNoteText,
  probeInstalled,
  resizeBy,
  safeHttpUrl,
  searchFolders,
  serializeNote,
  shouldAutoPick,
  sizeAfterLayout,
  subfolderHint,
  tileUsesDownloadIcon,
  uniqueMatch,
  updateDestination,
} from "../web/workflow_note_model.js";

function documentShim() {
  class NodeShim {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.attrs = {};
      this.style = {};
      this._text = null;
      this.className = "";
    }

    get textContent() {
      if (this._text != null && this.children.length === 0) return this._text;
      return this.children.map((child) => child.textContent).join("");
    }

    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }

    set innerHTML(value) {
      throw new Error(`innerHTML was set: ${value}`);
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

test("note json keeps the shared fields and drops the rest", () => {
  const extra = "token-should-not-survive";
  const note = normalizeNote({
    v: 9,
    title: "Portrait",
    subtitle: "Soft light",
    author: "Ada",
    body: "Queue it.",
    layout: "banner",
    accent: "#E25B45",
    models: [{ name: "a.safetensors", folder: "loras", url: "https://example.com/a.safetensors" }],
    packs: [{ name: "SomePack", url: "https://example.com/pack", node: "SomeNode" }],
    links: [{ label: "Site", url: "https://example.com" }],
    token: extra,
    ignored: "nope",
  });
  assert.equal(note.v, 1);
  assert.equal(note.layout, "banner");
  assert.equal(note.accent, "#E25B45");
  assert.equal(note.subtitle, "Soft light");
  assert.equal(note.author, "Ada");
  assert.equal(note.token, undefined);
  assert.equal(note.ignored, undefined);
  assert.equal(serializeNote(note).includes(extra), false);
  assert.equal(notesEqual(note, parseNoteText(serializeNote(note)).note), true);
  assert.equal(nodeTypeForLayout(note.layout), "WorkflowNote");
  assert.equal(nodeTypeForLayout("tile"), "WorkflowNoteTile");
});

test("urls, accents, and row caps are strict", () => {
  assert.equal(safeHttpUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(safeHttpUrl("http://example.com/a"), "http://example.com/a");
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("hf://org/repo/file"), "");
  assert.equal(safeHttpUrl("https://example.com/a b"), "");
  assert.equal(safeHttpUrl("https://"), "");
  const models = Array.from({ length: 61 }, (_, index) => ({
    name: `m${index}.safetensors`,
    folder: "checkpoints",
    url: "https://example.com/m",
  }));
  models.push({ name: "../secret.safetensors", folder: "checkpoints", url: "file:///etc/passwd" });
  const body = "x".repeat(20001);
  const note = normalizeNote({
    layout: "poster",
    accent: "#fff",
    body,
    models,
    packs: [{ name: "P", url: "git://example.com/p", node: "N" }],
    links: [{ label: "bad", url: "javascript:alert(1)" }, { label: "", url: "" }],
  });
  assert.equal(note.layout, "card");
  assert.equal(note.accent, "");
  assert.equal(note.body.length, 20000);
  assert.equal(note.models.length, 60);
  assert.equal(note.models[0].name, "m0.safetensors");
  assert.equal(note.packs[0].url, "");
  assert.equal(note.links.length, 0);
  assert.equal(parseNoteText("{").ok, false);
  assert.equal(parseNoteText("[]").ok, false);
});

test("markdown builds text nodes for the supported marks", () => {
  const doc = documentShim();
  const root = doc.createElement("div");
  const source = [
    "# Title",
    "## Section",
    "### Small",
    "",
    "A **bold** and *italic* `code` line.",
    "",
    "[red]hot[/red] and [yellow]**shine**[/yellow]",
    "",
    "[Docs](https://example.com/docs)",
    "[nope](javascript:alert(1))",
    "",
    "[[button: Get | https://example.com/get | #112233 | download | 2 GB]]",
    "",
    "- alpha",
    "  beta",
    "- gamma",
    "",
    "1. one",
    "   extra",
    "2. two",
    "",
    "---",
    "",
    "| A | B |",
    "| --- | --- |",
    "| c \\| d | e |",
    "",
    "```",
    "**not bold**",
    "```",
    "",
  ].join("\n");
  mountMarkdown(doc, root, source);
  assert.equal(doc.tags(root, "h1")[0].textContent, "Title");
  assert.equal(doc.tags(root, "h2")[0].textContent, "Section");
  assert.equal(doc.tags(root, "h3")[0].textContent, "Small");
  assert.equal(doc.tags(root, "strong")[0].textContent, "bold");
  assert.equal(doc.tags(root, "em")[0].textContent, "italic");
  assert.equal(doc.tags(root, "code")[0].textContent, "code");
  const tones = doc.tags(root, "span").filter((node) => node.className.startsWith("wn-tone"));
  assert.equal(tones[0].className, "wn-tone wn-tone-red");
  assert.equal(tones[0].textContent, "hot");
  assert.equal(tones[1].textContent, "shine");
  const link = doc.tags(root, "a").find((node) => node.className === "wn-mdlink");
  assert.equal(link.href, "https://example.com/docs");
  assert.equal(link.attrs.target, "_blank");
  assert.equal(link.attrs.rel, "noopener noreferrer");
  assert.equal(root.textContent.includes("javascript:alert(1)"), true);
  const button = doc.tags(root, "a").find((node) => node.className.includes("wn-linkbtn-download"));
  assert.equal(button.href, "https://example.com/get");
  assert.equal(button.style.color, "#112233");
  assert.equal(button.attrs.rel, "noopener noreferrer");
  assert.equal(doc.tags(button, "span").some((node) => node.textContent === "2 GB"), true);
  const items = doc.tags(root, "li");
  assert.equal(items[0].textContent, "alpha beta");
  assert.equal(items[1].textContent, "gamma");
  assert.equal(items[2].textContent, "one extra");
  assert.equal(doc.tags(root, "hr").length, 1);
  assert.equal(doc.tags(root, "td")[0].textContent, "c | d");
  const fenced = doc.tags(root, "pre")[0];
  assert.equal(fenced.textContent, "**not bold**");
  assert.equal(doc.tags(fenced, "strong").length, 0);
  assert.equal(parseMarkdown(SAMPLE_TABLE).some((block) => block.type === "table"), true);
  assert.equal(buttonMarkup({ label: "Read", url: "https://example.com", color: "#e25b45", style: "readmore" }).includes("readmore"), true);
});

test("file checks honor subfolders, aliases, and shared directories", () => {
  const exact = matchAcrossFolders("a.safetensors", [{ folder: "loras", files: ["a.safetensors", "other.ckpt"] }]);
  assert.equal(uniqueMatch(exact).path, "a.safetensors");
  assert.equal(subfolderHint("a.safetensors", uniqueMatch(exact)), "");
  const nested = matchAcrossFolders("hero.safetensors", [
    { folder: "loras", files: ["portraits/hero.safetensors"] },
  ]);
  const hit = uniqueMatch(nested);
  assert.equal(hit.subfolder, "portraits");
  assert.equal(subfolderHint("hero.safetensors", hit), "portraits");
  const several = matchAcrossFolders("hero.safetensors", [
    { folder: "loras", files: ["a/hero.safetensors", "b/hero.safetensors"] },
  ]);
  assert.equal(uniqueMatch(several), null);
  assert.equal(shouldAutoPick(true, several), false);
  assert.equal(shouldAutoPick(false, nested), false);
  assert.equal(shouldAutoPick(true, nested), true);
  const unread = matchAcrossFolders("hero.safetensors", [{ folder: "loras", files: null }]);
  assert.equal(unread.status, "unchecked");
  const missing = matchAcrossFolders("gone.safetensors", [{ folder: "loras", files: ["other.safetensors"] }]);
  assert.equal(missing.status, "missing");
  const aliased = matchAcrossFolders("clip.safetensors", [
    { folder: "clip", files: [] },
    { folder: "text_encoders", files: ["clip.safetensors"] },
  ]);
  assert.equal(uniqueMatch(aliased).folder, "text_encoders");
  assert.deepEqual(searchFolders("clip"), ["clip", "text_encoders"]);
  assert.deepEqual(searchFolders("text_encoders"), ["text_encoders", "clip"]);
  assert.deepEqual(searchFolders("unet"), ["unet", "diffusion_models"]);
  const catalog = {
    folders: { loras: ["/comfy/models/loras", "/shared/StabilityMatrix/Lora"] },
    shared: { loras: ["/shared/StabilityMatrix/Lora"] },
    input: ["/comfy/input"],
  };
  assert.deepEqual(alsoReadFrom("loras", catalog), ["/shared/StabilityMatrix/Lora"]);
  assert.deepEqual(alsoReadFrom("input", { input: ["/comfy/input"] }), []);
});

test("use-it plans and auto-pick touch only a single match", () => {
  const nodes = [
    {
      id: 7,
      type: "CheckpointLoaderSimple",
      widgets: [{ name: "ckpt_name", value: "model.safetensors" }],
    },
    {
      id: 8,
      type: "LoraLoader",
      widgets: [{ name: "lora_name", value: "other.safetensors" }],
    },
  ];
  const row = { name: "model.safetensors", folder: "checkpoints" };
  const plan = loaderUpdates(nodes, row, "heroes/model.safetensors");
  assert.deepEqual(plan, [{ nodeId: 7, widget: "ckpt_name", from: "model.safetensors", to: "heroes/model.safetensors" }]);
  assert.equal(applyLoaderUpdates(nodes, plan), 1);
  assert.equal(nodes[0].widgets[0].value, "heroes/model.safetensors");
  assert.equal(loaderUpdates(nodes, row, "heroes/model.safetensors").length, 0);
  const clipNodes = [
    { id: 3, type: "CLIPLoader", widgets: [{ name: "clip_name", value: "encoder.safetensors" }] },
  ];
  const clipPlan = loaderUpdates(clipNodes, { name: "encoder.safetensors", folder: "clip" }, "shared/encoder.safetensors");
  assert.equal(clipPlan.length, 1);
});

test("pack detection keeps existing rows and lists devil-nodes", () => {
  const graph = {
    nodes: [
      { type: "WorkflowNote", module: "custom_nodes.devil-nodes" },
      { type: "SomeNode", module: "custom_nodes.SomePack" },
      {
        type: "Subgraph",
        subgraph: { nodes: [{ type: "NestedNode", module: "custom_nodes.NestedPack" }] },
      },
    ],
  };
  const flat = flattenGraph(graph).map((node) => ({ type: node.type, module: node.module }));
  assert.equal(flat.some((node) => node.type === "NestedNode"), true);
  const detected = detectPacks(flat);
  assert.equal(detected.find((row) => row.name === "devil-nodes").url, DEVIL_REGISTRY_URL);
  assert.equal(packLink({ name: "devil-nodes", url: "" }), DEVIL_REGISTRY_URL);
  const merged = mergePacks(
    [{ name: "Kept", url: "https://example.com/kept", node: "OldNode" }],
    detected,
  );
  assert.equal(merged[0].name, "Kept");
  assert.equal(merged.some((row) => row.name === "SomePack"), true);
  assert.equal(merged.some((row) => row.name === "NestedPack"), true);
  assert.equal(mergePacks(merged, detected).length, merged.length);
  assert.equal(probeInstalled("SomeNode", { SomeNode: {} }, null), "installed");
  assert.equal(probeInstalled("MissingNode", { SomeNode: {} }, null), "missing");
  assert.equal(probeInstalled("MissingNode", null, null), "unchecked");
  const missing = { name: "devil-nodes", url: "", node: "WorkflowNote" };
  assert.equal(updateDestination(missing, true, "missing").type, "manager");
  assert.equal(updateDestination(missing, false, "missing").type, "registry");
  assert.equal(updateDestination(missing, false, "missing").url, DEVIL_REGISTRY_URL);
  assert.equal(updateDestination(missing, false, "installed").type, "installed");
  assert.equal(JSON.stringify(updateDestination(missing, false, "missing")).includes("clone"), false);
});

test("sizing grows a card, snaps a tile, and resizes from the keyboard", () => {
  const grown = sizeAfterLayout({ layout: "card", width: 280, height: 100, contentHeight: 220, previousLayout: "card" });
  assert.deepEqual(grown, { width: 300, height: 220 });
  const kept = sizeAfterLayout({ layout: "card", width: 420, height: 480, contentHeight: 90, previousLayout: "card" });
  assert.equal(kept.height, 480);
  const banner = sizeAfterLayout({ layout: "banner", width: 300, height: 20, contentHeight: 10, previousLayout: "card" });
  assert.equal(banner.height, 64);
  const snapped = sizeAfterLayout({ layout: "tile", width: 360, height: 400, contentHeight: 900, previousLayout: "card" });
  assert.equal(snapped.height, 80);
  const held = sizeAfterLayout({ layout: "tile", width: 360, height: 110, contentHeight: 900, previousLayout: "tile" });
  assert.equal(held.height, 110);
  assert.deepEqual(arrowDelta("ArrowUp", true), { dw: 0, dh: -1 });
  assert.deepEqual(arrowDelta("ArrowRight", false), { dw: 16, dh: 0 });
  assert.equal(resizeBy({ width: 300, height: 50 }, "tile", 0, -40).height, 42);
  assert.equal(tileUsesDownloadIcon({ title: "Model list", body: "how", models: [], packs: [], links: [] }), true);
  assert.equal(tileUsesDownloadIcon({ title: "Guide", body: "", models: [{ name: "a.safetensors" }], packs: [], links: [] }), true);
  assert.equal(tileUsesDownloadIcon({ title: "Guide", body: "Read this.", models: [{ name: "a.safetensors" }], packs: [], links: [] }), false);
});
