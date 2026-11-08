/**
 * Viewport placement for Favorite (Devil Nodes).
 *
 * LiteGraph draws the graph with:
 *   screen = (graphPoint + ds.offset) * ds.scale
 * so the values returned here are written straight to `ds.offset`.
 * They are in graph units. `view.graphW` / `view.graphH` are the visible
 * viewport in those same units (CSS pixels / target zoom).
 *
 * top-left with a zero user offset lands 16 graph units in from the left
 * and 40 from the top:
 *   offset = [-node.x + 16, -node.y + 40]
 */

export const ANCHOR_PAD_X = 16;
export const ANCHOR_PAD_Y = 40;

export const ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "center",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

/**
 * @param {{x:number,y:number,w:number,h:number}} box Node rect in graph space.
 * @param {string} anchor
 * @param {{originX:number,originY:number,graphW:number,graphH:number}} view
 * @param {number} xOffset User X-Offset, added after the anchor base.
 * @param {number} yOffset User Y-Offset, added after the anchor base.
 * @returns {[number, number]} Final `ds.offset`.
 */
export function favoriteCanvasOffset(box, anchor, view, xOffset, yOffset) {
  const x = box.x;
  const y = box.y;
  const w = box.w;
  const h = box.h;
  const originX = view.originX;
  const originY = view.originY;
  const graphW = view.graphW;
  const graphH = view.graphH;
  const padX = ANCHOR_PAD_X;
  const padY = ANCHOR_PAD_Y;

  // Base canvas offset for the chosen anchor. User offsets are applied below.
  let baseX;
  let baseY;
  switch (anchor) {
    case "top-center":
      baseX = -x - w / 2 + originX + graphW / 2;
      baseY = -y + originY + padY;
      break;
    case "top-right":
      baseX = -x - w + originX + graphW - padX;
      baseY = -y + originY + padY;
      break;
    case "center":
      baseX = -x - w / 2 + originX + graphW / 2;
      baseY = -y - h / 2 + originY + graphH / 2;
      break;
    case "bottom-left":
      baseX = -x + originX + padX;
      baseY = -y - h + originY + graphH - padY;
      break;
    case "bottom-center":
      baseX = -x - w / 2 + originX + graphW / 2;
      baseY = -y - h + originY + graphH - padY;
      break;
    case "bottom-right":
      baseX = -x - w + originX + graphW - padX;
      baseY = -y - h + originY + graphH - padY;
      break;
    case "top-left":
    default:
      baseX = -x + originX + padX;
      baseY = -y + originY + padY;
      break;
  }

  const dx = Number.isFinite(xOffset) ? xOffset : 0;
  const dy = Number.isFinite(yOffset) ? yOffset : 0;
  return [baseX + dx, baseY + dy];
}
