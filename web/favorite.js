/**
 * Favorite — Devil Nodes canvas bookmark.
 *
 * Virtual node: no inputs, no outputs, not executed. A shortcut or a
 * double-click pans and zooms the graph so this node sits on the saved
 * anchor, plus the X/Y offsets. Shortcut capture listens through LiteGraph
 * processKey and the shortcut widget dialog.
 */
import { app } from "../../scripts/app.js";
import { ANCHORS, favoriteCanvasOffset } from "./favorite_anchor.js";

const NODE_TYPE = "Favorite";
const SHORTCUT_DEFAULTS = "1234567890abcdefghijklmnopqrstuvwxyz".split("");
const MOVE_MS = 380;
const BLUR_DEFAULT_PX = 18;
let keyEvents;
let moveFrame = 0;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function widgetByName(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function widgetValue(node, name) {
  return widgetByName(node, name)?.value;
}

function getClosestOrSelf(element, selector) {
  if (!element || element === document || element === document.documentElement) {
    return null;
  }
  if (typeof element.closest !== "function") return null;
  if (typeof element.matches === "function" && element.matches(selector)) return element;
  return element.closest(selector);
}

function eachGraph(fn) {
  const root = app.rootGraph ?? app.graph?.rootGraph ?? app.graph;
  const seen = new Set();
  const stack = [];
  const push = (graph) => {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    stack.push(graph);
  };
  push(root);
  if (root?.subgraphs?.values) {
    for (const subgraph of root.subgraphs.values()) push(subgraph);
  }
  while (stack.length) {
    const graph = stack.pop();
    fn(graph);
    for (const node of graph.nodes || []) {
      if (typeof node.isSubgraphNode === "function" && node.isSubgraphNode() && node.subgraph) {
        push(node.subgraph);
      }
    }
  }
}

function eachNode(fn) {
  eachGraph((graph) => {
    for (const node of graph.nodes || []) fn(node, graph);
  });
}

/** Subgraph node a user would double-click to open `subgraphId`. */
function findFromNodeForSubgraph(subgraphId) {
  let found = null;
  eachNode((node) => {
    if (found) return;
    if (
      typeof node.isSubgraphNode === "function" &&
      node.isSubgraphNode() &&
      node.subgraph?.id === subgraphId
    ) {
      found = node;
    }
  });
  return found;
}

function usedShortcuts() {
  const used = new Set();
  eachNode((node) => {
    if (node.type !== NODE_TYPE && node.comfyClass !== NODE_TYPE) return;
    const key = String(widgetValue(node, "shortcut_key") ?? "")
      .trim()
      .toLocaleLowerCase();
    if (key) used.add(key);
  });
  return used;
}

function nextShortcut() {
  const used = usedShortcuts();
  return SHORTCUT_DEFAULTS.find((char) => !used.has(char)) ?? "1";
}

/**
 * Visible viewport in graph units at `scale`.
 * Uses DragAndScale.getViewportSize (CSS pixels) and canvas.viewport when the
 * graph view is inset. originX/originY are 0 when the view starts at the canvas
 * origin, which keeps a zero-offset top-left on the 16 by 40 inset.
 */
function viewAtScale(canvas, scale) {
  const ds = canvas.ds;
  const safeScale = scale || 1;
  let cssW = 0;
  let cssH = 0;
  if (typeof ds.getViewportSize === "function") {
    [cssW, cssH] = ds.getViewportSize();
  } else if (canvas.canvas) {
    const rect = canvas.canvas.getBoundingClientRect();
    cssW = rect.width;
    cssH = rect.height;
  }
  let originCssX = 0;
  let originCssY = 0;
  const viewport = canvas.viewport;
  if (viewport && viewport.length >= 4 && viewport[2] > 0 && viewport[3] > 0) {
    originCssX = viewport[0];
    originCssY = viewport[1];
    cssW = viewport[2];
    cssH = viewport[3];
  }
  return {
    originX: originCssX / safeScale,
    originY: originCssY / safeScale,
    graphW: cssW / safeScale,
    graphH: cssH / safeScale,
  };
}

function favoriteBox(node) {
  const collapsed = !!node.flags?.collapsed;
  const width = collapsed ? node._collapsed_width || node.size[0] : node.size[0];
  const height = collapsed ? LiteGraph.NODE_TITLE_HEIGHT : node.size[1];
  return { x: node.pos[0], y: node.pos[1], w: width, h: height };
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function cssViewSize(canvas) {
  const ds = canvas.ds;
  let cssW = 0;
  let cssH = 0;
  let originX = 0;
  let originY = 0;
  if (typeof ds.getViewportSize === "function") {
    [cssW, cssH] = ds.getViewportSize();
  } else if (canvas.canvas) {
    const rect = canvas.canvas.getBoundingClientRect();
    cssW = rect.width;
    cssH = rect.height;
  }
  const viewport = canvas.viewport;
  if (viewport && viewport.length >= 4 && viewport[2] > 0 && viewport[3] > 0) {
    originX = viewport[0];
    originY = viewport[1];
    cssW = viewport[2];
    cssH = viewport[3];
  }
  return { cssW, cssH, originX, originY };
}

/** Visible graph rect [left, top, right, bottom] for an offset and zoom. */
function visibleRect(offsetX, offsetY, scale, cssW, cssH, originX, originY) {
  const left = -offsetX + originX / scale;
  const top = -offsetY + originY / scale;
  return [left, top, left + cssW / scale, top + cssH / scale];
}

function graphSurfaceElements(canvas) {
  const elements = [];
  if (canvas?.bgcanvas) elements.push(canvas.bgcanvas);
  if (canvas?.canvas && canvas.canvas !== canvas.bgcanvas) elements.push(canvas.canvas);
  return elements;
}

function clearCanvasBlur(canvas) {
  for (const el of graphSurfaceElements(canvas)) {
    if (el?.style) el.style.filter = "";
  }
}

function snapView(canvas, offsetX, offsetY, scale) {
  cancelAnimationFrame(moveFrame);
  moveFrame = 0;
  clearCanvasBlur(canvas);
  canvas.ds.scale = scale;
  canvas.ds.offset[0] = offsetX;
  canvas.ds.offset[1] = offsetY;
  canvas.setDirty?.(true, true);
}

/**
 * Ease the visible rect to the bookmark, with a blur that peaks mid-move
 * and is gone when the view arrives.
 */
function animateView(canvas, offsetX, offsetY, scale, blurPeak) {
  const ds = canvas.ds;
  const startScale = ds.scale || 1;
  const { cssW, cssH, originX, originY } = cssViewSize(canvas);
  if (!(cssW > 0) || !(cssH > 0)) {
    snapView(canvas, offsetX, offsetY, scale);
    return;
  }

  const start = visibleRect(ds.offset[0], ds.offset[1], startScale, cssW, cssH, originX, originY);
  const end = visibleRect(offsetX, offsetY, scale, cssW, cssH, originX, originY);
  const travel = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const zoomDelta = Math.abs(end[2] - end[0] - (start[2] - start[0]));
  if (travel < 2 && zoomDelta < 2) {
    snapView(canvas, offsetX, offsetY, scale);
    return;
  }

  cancelAnimationFrame(moveFrame);
  const started = performance.now();
  const step = (now) => {
    const raw = Math.min(1, (now - started) / MOVE_MS);
    const t = easeInOutQuad(raw);
    const left = start[0] + (end[0] - start[0]) * t;
    const top = start[1] + (end[1] - start[1]) * t;
    const right = start[2] + (end[2] - start[2]) * t;
    const width = right - left;
    const nextScale = width > 0 ? cssW / width : scale;
    ds.scale = nextScale;
    ds.offset[0] = -left + originX / nextScale;
    ds.offset[1] = -top + originY / nextScale;

    const blur = Math.sin(raw * Math.PI) * blurPeak;
    const filter = blur < 0.35 ? "" : `blur(${blur.toFixed(2)}px)`;
    for (const el of graphSurfaceElements(canvas)) {
      if (el?.style) el.style.filter = filter;
    }
    canvas.setDirty?.(true, true);

    if (raw < 1) {
      moveFrame = requestAnimationFrame(step);
    } else {
      snapView(canvas, offsetX, offsetY, scale);
    }
  };
  moveFrame = requestAnimationFrame(step);
}

class Favorite extends LGraphNode {
  constructor(title = Favorite.title) {
    super(title);
    this.comfyClass = NODE_TYPE;
    this.isVirtualNode = true;
    this.serialize_widgets = true;
    this.properties = this.properties || {};

    this.addWidget("text", "shortcut_key", nextShortcut(), (value) => {
      const next = String(value ?? "").trim();
      return next || "1";
    });
    this.addWidget("number", "zoom", 1, () => {}, {
      min: 0.5,
      max: 2,
      precision: 2,
    });
    this.addWidget("combo", "anchor", "top-left", () => {}, {
      values: ANCHORS,
    });
    this.addWidget("number", "X-Offset", 0, () => {}, {
      step: 1,
      precision: 1,
    });
    this.addWidget("number", "Y-Offset", 0, () => {}, {
      step: 1,
      precision: 1,
    });
    this.addWidget("toggle", "Animate move", false, () => {});
    this.addWidget("number", "Blur", BLUR_DEFAULT_PX, () => {}, {
      min: 0,
      max: 48,
      step: 1,
      precision: 0,
    });

    // One function reference for addEventListener and removeEventListener.
    this.keypressBound = (event) => this.onKeypress(event);
    const computed = this.computeSize();
    this.size = [Math.max(220, computed[0]), computed[1]];
  }

  onAdded() {
    keyEvents.addEventListener("keydown", this.keypressBound);
  }

  onRemoved() {
    keyEvents.removeEventListener("keydown", this.keypressBound);
  }

  onKeypress(event) {
    const originalEvent = event.detail?.originalEvent;
    if (!originalEvent) return;
    const target = originalEvent.target;
    if (getClosestOrSelf(target, 'input,textarea,[contenteditable="true"]')) return;

    const shortcut = widgetValue(this, "shortcut_key");
    if (!shortcut) return;
    if (keyEvents.areOnlyKeysDown(shortcut, true)) {
      this.canvasToFavorite();
      originalEvent.preventDefault();
      originalEvent.stopPropagation();
    }
  }

  /**
   * While the shortcut text dialog is open, record the keys held down and
   * write them into the input (`shift + b`). Older LiteGraph opens that
   * dialog inside mouse-down. Current ComfyUI opens it on click, so we also
   * look once mouse-up has run.
   */
  onMouseDown() {
    const bind = () => this.bindShortcutDialog();
    bind();
    window.addEventListener(
      "pointerup",
      () => {
        bind();
        requestAnimationFrame(bind);
      },
      { once: true },
    );
    return false;
  }

  bindShortcutDialog() {
    const input = document.querySelector(".graphdialog > input.value");
    const shortcut = widgetByName(this, "shortcut_key");
    if (!input || !shortcut || input.value !== String(shortcut.value) || input.dataset.devilFavoriteKeys) {
      return;
    }
    input.dataset.devilFavoriteKeys = "1";
    input.addEventListener("keydown", (e) => {
      keyEvents.handleKeyDownOrUp(e);
      e.preventDefault();
      e.stopPropagation();
      input.value = Object.keys(keyEvents.downKeys).join(" + ");
    });
  }

  onDblClick() {
    this.canvasToFavorite();
    return true;
  }

  async canvasToFavorite() {
    const canvas = app.canvas;
    if (!canvas?.ds) return;

    const current = canvas.getCurrentGraph?.() ?? canvas.graph;
    if (this.graph && current && this.graph !== current && typeof canvas.openSubgraph === "function") {
      const fromNode = findFromNodeForSubgraph(this.graph.id);
      canvas.openSubgraph(this.graph, fromNode);
      await wait(16);
    }

    const scale = Number(widgetValue(this, "zoom")) || 1;
    const anchor = widgetValue(this, "anchor") || "top-left";
    const xOffset = Number(widgetValue(this, "X-Offset"));
    const yOffset = Number(widgetValue(this, "Y-Offset"));
    const view = viewAtScale(canvas, scale);

    // Final offset = anchor base + X-Offset + Y-Offset. See favoriteCanvasOffset.
    const [offsetX, offsetY] = favoriteCanvasOffset(
      favoriteBox(this),
      anchor,
      view,
      xOffset,
      yOffset,
    );

    const animate = !!widgetValue(this, "Animate move");
    if (animate) {
      const blurPeak = Math.min(48, Math.max(0, Number(widgetValue(this, "Blur"))));
      animateView(canvas, offsetX, offsetY, scale, Number.isFinite(blurPeak) ? blurPeak : BLUR_DEFAULT_PX);
    } else {
      snapView(canvas, offsetX, offsetY, scale);
    }
  }
}

Favorite.title = "Favorite";
Favorite.category = "Devil Nodes";
Favorite.description = "Jump to this canvas anchor with pan, zoom, offsets, and optional animation and blur.";
keyEvents = new KeyEventService();

app.registerExtension({
  name: "devil-nodes.Favorite",
  registerCustomNodes() {
    LiteGraph.registerNodeType(NODE_TYPE, Favorite);
    Favorite.category = "Devil Nodes";
  },
});

/**
 * Tracks held keys for Favorite shortcuts.
 * ComfyUI and LiteGraph often stop key events, so processKey is wrapped and
 * window listeners fill in the gaps. The original processKey still runs.
 * Repeat keydowns are ignored.
 */
function KeyEventService() {
  this.downKeys = {};
  this.shiftDownKeys = {};
  this.ctrlKey = false;
  this.altKey = false;
  this.metaKey = false;
  this.shiftKey = false;
  this._target = new EventTarget();
  this.isMac = !!(
    navigator.platform?.toLocaleUpperCase().startsWith("MAC") ||
    navigator.userAgentData?.platform?.toLocaleUpperCase().startsWith("MAC")
  );

  const service = this;
  const processKey = LGraphCanvas.prototype.processKey;
  LGraphCanvas.prototype.processKey = function (e) {
    if (e && (e.type === "keydown" || e.type === "keyup")) {
      service.handleKeyDownOrUp(e);
    }
    return processKey.apply(this, arguments);
  };

  window.addEventListener("keydown", (e) => service.handleKeyDownOrUp(e));
  window.addEventListener("keyup", (e) => service.handleKeyDownOrUp(e));
  document.addEventListener("visibilitychange", () => service.clearKeydowns());
  window.addEventListener("blur", () => service.clearKeydowns());
}

KeyEventService.prototype.addEventListener = function (type, listener) {
  this._target.addEventListener(type, listener);
};

KeyEventService.prototype.removeEventListener = function (type, listener) {
  this._target.removeEventListener(type, listener);
};

KeyEventService.prototype.clearKeydowns = function () {
  this.ctrlKey = false;
  this.altKey = false;
  this.metaKey = false;
  this.shiftKey = false;
  for (const key in this.downKeys) delete this.downKeys[key];
  for (const key in this.shiftDownKeys) delete this.shiftDownKeys[key];
};

KeyEventService.prototype.handleKeyDownOrUp = function (e) {
  if (!e?.key) return;
  const key = e.key.toLocaleUpperCase();
  if (
    (e.type === "keydown" && this.downKeys[key] === true) ||
    (e.type === "keyup" && this.downKeys[key] === undefined)
  ) {
    return;
  }

  this.ctrlKey = !!e.ctrlKey;
  this.altKey = !!e.altKey;
  this.metaKey = !!e.metaKey;
  this.shiftKey = !!e.shiftKey;

  if (e.type === "keydown") {
    this.downKeys[key] = true;
    this._target.dispatchEvent(new CustomEvent("keydown", { detail: { originalEvent: e } }));
    if (this.shiftKey && key !== "SHIFT") this.shiftDownKeys[key] = true;
    return;
  }

  if (e.type !== "keyup") return;

  if (key === "META" && this.isMac) {
    this.clearKeydowns();
  } else {
    delete this.downKeys[key];
  }
  if (key === "SHIFT") {
    for (const held in this.shiftDownKeys) {
      delete this.downKeys[held];
      delete this.shiftDownKeys[held];
    }
  }
  this._target.dispatchEvent(new CustomEvent("keyup", { detail: { originalEvent: e } }));
};

KeyEventService.prototype.getKeysFromShortcut = function (shortcut) {
  let keys;
  if (typeof shortcut === "string") {
    let text = shortcut.replace(/\s/g, "");
    text = text.replace(/^\+/, "__PLUS__").replace(/\+\+/, "+__PLUS__");
    keys = text.split("+").map((part) => part.replace("__PLUS__", "+"));
  } else {
    keys = [...shortcut];
  }
  return keys.map((key) => key.toLocaleUpperCase());
};

KeyEventService.prototype.areAllKeysDown = function (shortcut) {
  const keys = this.getKeysFromShortcut(shortcut);
  return keys.every((key) => this.downKeys[key]);
};

KeyEventService.prototype.areOnlyKeysDown = function (shortcut, alsoAllowShift = false) {
  const keys = this.getKeysFromShortcut(shortcut);
  const allKeysDown = this.areAllKeysDown(keys);
  const downCount = Object.keys(this.downKeys).length;
  if (allKeysDown && keys.length === downCount) return true;
  if (alsoAllowShift && !keys.includes("SHIFT") && keys.length === downCount - 1) {
    return allKeysDown && this.areAllKeysDown(["SHIFT"]);
  }
  return false;
};
