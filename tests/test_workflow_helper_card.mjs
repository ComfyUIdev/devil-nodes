/**
 * Card JSON, Markdown text nodes, and the installed-file match.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  cardHasContent,
  folderLabel,
  groupModels,
  matchFile,
  modelSource,
  mountMarkdown,
  normalizeCard,
  packsFromNodes,
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
