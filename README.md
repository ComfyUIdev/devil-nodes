# Devil Nodes

Canvas bookmarks for ComfyUI, by [ComfyUIdev](https://github.com/ComfyUIdev).

**Favorite** parks the graph on a spot you care about. Press its shortcut, or double-click the node, and the canvas pans and zooms so the node sits on a saved anchor. X and Y offsets nudge that spot. The move can cut, or ease in with a blur that clears when you arrive.

Favorite is frontend-only. It has no inputs, no outputs, and it does not run.

![Devil Nodes](banner.png)

## Install

Install **Devil Nodes** (`devil-nodes`) and restart ComfyUI.

### ComfyUI-Manager

Open Manager, search for **Devil Nodes**, and install it from the Registry.

### Registry CLI

```bash
comfy node install devil-nodes
```

### Git

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/ComfyUIdev/devil-nodes
```

The folder name ComfyUI loads is `devil-nodes`. No extra Python packages are required.

## Favorite

In the node menu, open **Devil Nodes** and add **Favorite**.

| Widget | What it does |
| --- | --- |
| `shortcut_key` | Keys that jump to this Favorite. Click the widget, then press the combo (`1`, `shift + b`, and so on). A new node takes the next free key from `1-9`, `0`, then `a-z`. |
| `zoom` | Canvas zoom after the jump. Range 0.5–2, default 1. |
| `anchor` | Where the node sits in the viewport. Default `top-left` is 16 graph units in from the left and 40 from the top. |
| `X-Offset` | Added to the anchor. Positive moves the node right on screen. Default 0. |
| `Y-Offset` | Added to the anchor. Positive moves the node down on screen. Default 0. |
| `Animate move` | Off by default: the view cuts to the anchor. On: the view eases there in about 380 ms. Blur peaks halfway and is gone when the move ends. |
| `Blur` | Peak blur, in pixels, while **Animate move** is on. Default 18, range 0–48. `0` keeps the eased move with no blur. |

Anchors: `top-left`, `top-center`, `top-right`, `center`, `bottom-left`, `bottom-center`, `bottom-right`.

Offsets are graph units, the same space LiteGraph stores in `ds.offset`:

```text
canvas offset = anchor base + X-Offset + Y-Offset
```

Widget values are saved on the node, so they come back with the workflow.

Shortcuts are ignored while you are typing in a field. If the Favorite sits in a subgraph you are not viewing, the shortcut opens that subgraph first, then pans.

## Requirements

- ComfyUI
- Python 3.8 or newer
- No third-party Python dependencies

## Nodes in this pack

| Node | Runs on | What it does |
| --- | --- | --- |
| Favorite | The browser only | Pans and zooms to a saved canvas anchor |

More nodes can be added under `py/` without changing how Favorite is loaded. See the layout below.

## Layout

```text
devil-nodes/
  __init__.py          pack entry: merges node mappings, serves web/
  py/favorite.py       Favorite's slot (no backend execution)
  web/favorite.js      the node
  web/favorite_anchor.js
  pyproject.toml
  icon.png
  banner.png
```

## Author

ComfyUIdev

Repository: https://github.com/ComfyUIdev/devil-nodes

Issues: https://github.com/ComfyUIdev/devil-nodes/issues

## License

[MIT](LICENSE)
