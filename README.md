# Devil Nodes

ComfyUI nodes by [ComfyUIdev](https://github.com/ComfyUIdev).

**Favorite** parks the graph on a spot you care about. Press its shortcut, or double-click the node, and the canvas pans and zooms so the node sits on a saved anchor. X and Y offsets nudge that spot. The move can cut, or ease in with a blur that clears when you arrive.

**Workflow Helper** is a card you save inside the workflow. It carries a title, a Markdown how-to, the models to download, the custom node packs the graph needs, and the author's links. Open the workflow on another machine and each row is marked installed or missing. Download fetches that row's URL into the matching `models/` folder.

Favorite is frontend-only. It has no inputs, no outputs, and it does not run. Workflow Helper does not run either. Its download buttons talk to this ComfyUI in the background.

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

## Workflow Helper

In the node menu, open **Devil Nodes** and add **Workflow Helper**.

The card is view-only until you click the pencil (or right-click the node and choose **Edit Workflow Helper**). The editor saves a title, a Markdown how-to, model rows, pack rows, and links. **Card** shows all of that on the node. **Banner** shows only the title, so the same node can label a stage or a column.

| Section | What it stores |
| --- | --- |
| Title | The large heading. In the banner layout this is the whole card. |
| How-to | Markdown: headings, lists, bold, italic, code, tables, and `http(s)` links. |
| Models | File name, model folder (`checkpoints`, `loras`, `vae`, and the rest of this install), optional size and note, and a download URL. |
| Node packs | Pack name, link, and one node class from that pack. If the class is registered here, the row is installed. |
| Links | Label and `http(s)` URL for the author's pages. |

Model rows are grouped under `models/<folder>`. A dot marks each row: found, missing, or not checked (no folder, or this install has no such folder). **Check again** looks up ComfyUI's model list. Pack rows use the same installed / missing marks against the node classes this ComfyUI has loaded.

**Download** sends the row's URL, file name, and folder to this ComfyUI process. The file is written only inside a model directory ComfyUI already knows. Paths that would leave that directory are rejected. The button shows progress, then **Installed**, or the error and **Retry**.

URLs can be:

- a direct `http` or `https` link, including Civitai download links
- a Hugging Face file URL, or `hf://org/repo/file.safetensors`
- a pasted `hf download hf://...` command
- a `b2:` link, when `rclone` is on `PATH`

A Hugging Face token already available to ComfyUI (`HF_TOKEN`, `HUGGING_FACE_HUB_TOKEN`, or the Hub token file) is sent only to Hugging Face hosts. `CIVITAI_API_TOKEN` (or `CIVITAI_TOKEN`) is sent only to Civitai hosts. Tokens are not printed in the progress line. `b2:` downloads need rclone configured the same way you already use it.

The card JSON is stored on the node, so it comes back with the workflow, including copy, paste, and the API format.

## Requirements

- ComfyUI
- Python 3.8 or newer
- No extra Python packages. Workflow Helper uses `aiohttp`, which ComfyUI already provides. Hugging Face downloads use `huggingface_hub` when it is installed, and otherwise fetch the file over HTTPS. `b2:` links need `rclone` on `PATH`.

## Nodes in this pack

| Node | Runs on | What it does |
| --- | --- | --- |
| Favorite | The browser only | Pans and zooms to a saved canvas anchor |
| Workflow Helper | The browser, plus download routes on this ComfyUI | Shareable card: title, how-to, model downloads, pack checks, links |

More nodes can be added under `py/` without changing how Favorite is loaded. See the layout below.

## Layout

```text
devil-nodes/
  __init__.py                 pack entry: merges node mappings, serves web/
  py/favorite.py              Favorite's slot (no backend execution)
  py/workflow_helper.py       Workflow Helper node (card JSON, no prompt)
  py/helper_download.py       download routes into known model folders
  web/favorite.js             Favorite
  web/favorite_anchor.js
  web/workflow_helper.js      Workflow Helper card
  web/workflow_helper_card.js card JSON, Markdown, installed-file match
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
