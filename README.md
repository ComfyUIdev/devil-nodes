# Devil Nodes

ComfyUI nodes by [ComfyUIdev](https://github.com/ComfyUIdev).

**Favorite** parks the graph on a spot you care about. Press its shortcut, or double-click the node, and the canvas pans and zooms so the node sits on a saved anchor. X and Y offsets nudge that spot. The move can cut, or ease in with a blur that clears when you arrive.

**Workflow Helper** is a shareable card saved inside the workflow. Queueing a prompt does not run it. You fill it in when you create or share a graph: how to use it, which models to download, which custom node packs it needs, and your links. On another machine the card shows which models and packs are already there, which are missing, and downloads a missing model into the matching ComfyUI models folder. Card, banner, and info tile are three ways to show that one card.

**Workflow Note** is a how-to card for the same kind of sharing, with a subtitle, an author line, and an optional accent color. Model rows open their download link in a new tab. Workflow Helper is still the node that downloads into a models folder. Card, banner, and info tile are three ways to show the note.

Favorite is frontend-only. It has no inputs, no outputs, and it does not run. Workflow Helper's download buttons talk to this ComfyUI in the background. Workflow Note only reads the model folders this ComfyUI already has configured.

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

In the node menu, open **Devil Nodes/Utility** and add **Favorite**.

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

Workflow Helper is a shareable card saved inside the workflow. Queueing a prompt does not run it. You fill it in when you create or share a workflow: how to use the graph, which models to download, which custom node packs it needs, and your links. Someone who opens that workflow on another machine can see which models and packs they already have, which are missing, and download a missing model into the matching ComfyUI models folder. Card, banner, and info tile are ways to show that same card, not separate nodes.

In the node menu, open **Devil Nodes/Utility** and add **Workflow Helper**.

The card is view-only until you click the pencil (or right-click the node and choose **Edit Workflow Helper**). The editor saves a title, a Markdown how-to, model rows, pack rows, and links. **Card** shows all of that on the node. **Banner** shows only the title, so the same node can label a stage or a column. **Info tile** is a compact button: an icon and the title. Click it to open the full card, including downloads.

The how-to field accepts pipe tables and `[teal]`, `[green]`, `[amber]`, and `[glow]` tags with a matching closing tag. Fenced code shows those characters as typed.

| Section | What it stores |
| --- | --- |
| Title | The large heading. In the banner layout this is the whole card. |
| How-to | Markdown: headings, lists, bold, italic, code, tables, and `http(s)` links. |
| Models | File name, model folder (`checkpoints`, `loras`, `vae`, and the rest of this install), optional size and note, and a download URL. |
| Node packs | Pack name, link, and one node class from that pack. If the class is registered here, the row is installed. |
| Links | Label and `http(s)` URL for the author's pages. |

Model rows are grouped under `models/<folder>`. A dot marks each row: found, missing, or not checked (no folder, or this install has no such folder). **Check again** looks up ComfyUI's model list. Pack rows use the same installed / missing marks against the node classes this ComfyUI has loaded.

**Scan workflow**, in the editor or on the node's right-click menu, reads the loaders in this graph. It lists checkpoint, LoRA, VAE, diffusion, text encoder, ControlNet, embedding, upscale, and similar files that are not already on the card. Tick the ones you want and add them. The file name and folder are filled in. The download URL stays empty when the graph only has a local file name.

**Download** sends the row's URL, file name, and folder to this ComfyUI process. The file is written only inside a model directory ComfyUI already knows. Paths that would leave that directory are rejected. The button shows progress, then **Installed**, or the error and **Retry**.

URLs can be:

- a direct `http` or `https` link, including Civitai download links
- a Hugging Face file URL, or `hf://org/repo/file.safetensors`
- a pasted `hf download hf://...` command
- a `b2:` link, when `rclone` is on `PATH`

A Hugging Face token is read by `huggingface_hub` from `HF_TOKEN` or from `hf auth login`. It is sent only to Hugging Face hosts. If a gated file is refused, the card says to set `HF_TOKEN` or run `hf auth login`, then restart ComfyUI. When `huggingface_hub` is missing, public files still download: the `hf` CLI is used when it is on `PATH`, and otherwise the file is fetched over HTTPS.

A Civitai token is typed into the masked field on Workflow Helper. It is stored in this browser only, not in the workflow, and it is sent only to Civitai hosts.

Tokens are not printed in the progress line. `b2:` downloads need rclone configured the same way you already use it.

The card JSON is stored on the node, so it comes back with the workflow, including copy, paste, and the API format.

## Workflow Note

Workflow Note is a how-to saved inside the workflow. Queueing a prompt does not run it. In the node menu, open **Devil Nodes/Utility** and add **Workflow Note**.

The pencil (or right-click **Edit Workflow Note**) edits the title, subtitle, author, layout, accent color, Markdown how-to, model rows, pack rows, and links. **Card** shows all of that on the node. **Banner** shows the title, and the subtitle and author when they are set. **Info tile** is a short button. Click it to open the full note. Choosing the tile saves the node as **Workflow Note Tile**.

The how-to field accepts headings, lists, bold, italic, code, fenced code, rules, pipe tables, `http(s)` links, tone tags (`[red]`, `[yellow]`, `[green]`, `[teal]`, `[amber]`, `[glow]`), and colored link buttons:

```text
[[button: Label | https://example.com | #e25b45 | download | 2 GB]]
```

Button styles are `link`, `download`, `readmore`, and `plain`. Fenced code shows those characters as typed.

| Section | What it stores |
| --- | --- |
| Title, subtitle, author | The header. The author line is shown as small caps. |
| How-to | Markdown, up to 20,000 characters. |
| Accent | Optional `#rrggbb`. Empty uses devil red `#e25b45`. |
| Models | File name, folder (`checkpoints`, `loras`, `input`, and the rest of this install), and an `http(s)` download link. |
| Node packs | Pack name, link, and one node class from that pack. |
| Links | Label and `http(s)` URL. |

Model rows are grouped under `ComfyUI/models/<folder>` or `ComfyUI/input`. A dot marks each row: found, missing, or not checked. **Check files** looks through the folders this ComfyUI is configured to read, including extra model paths and the folders `clip` / `unet` share with `text_encoders` / `diffusion_models`. An extra directory is listed as “also read from”. **Download** opens the row URL in a new tab. Click the file name to copy it.

When the file is in a subfolder, the row says so and **Use it** writes that path onto the matching loader widgets in this graph, including subgraphs. **Devil Nodes → Workflow Note → Auto-pick found model files** does that on its own when there is a single match. It is on by default.

**Detect from this workflow** adds a pack row for each custom-node module in the graph, including subgraphs. Rows already on the note stay. devil-nodes is listed with its Registry page, `https://registry.comfy.org/publishers/comfyuidev/nodes/devil-nodes`. If the probe class is not registered here, the row offers **Update** (ComfyUI Manager when it is installed, otherwise the Registry) instead of a git clone link.

The note JSON is stored on a hidden widget named `note`, so it comes back with the workflow. Ctrl or Cmd+Enter saves the editor. Esc, Cancel, or a click outside asks before discarding edits.

The card fills the node in the classic UI and in Nodes 2.0. It grows to fit and does not shrink on its own. The tile snaps to a short height when you switch to it. A grip at the bottom-right resizes the node; with the grip focused, the arrow keys resize it and Shift takes one-pixel steps.

## Requirements

- ComfyUI
- Python 3.8 or newer
- No extra Python packages. Model file downloads use the Python standard library. Hugging Face downloads use `huggingface_hub` when it is installed. If it is not, and `hf` or `huggingface-cli` is on `PATH`, that command is used. Otherwise the file is fetched over HTTPS. `b2:` links need `rclone` on `PATH`.

## Nodes in this pack

| Node | Runs on | What it does |
| --- | --- | --- |
| Favorite | The browser only | Pans and zooms to a saved canvas anchor |
| Workflow Helper | The browser, plus download routes on this ComfyUI | Shareable card: title, how-to, model downloads, pack checks, links |
| Workflow Note | The browser, plus a read-only folder list on this ComfyUI | How-to card: title, subtitle, author, model links, pack checks |
| Workflow Note Tile | The browser, same folder list | The same note as a compact tile |

More nodes can be added under `py/` without changing how Favorite is loaded. See the layout below.

## Layout

```text
devil-nodes/
  __init__.py                 pack entry: merges node mappings, serves web/
  py/favorite.py              Favorite's slot (no backend execution)
  py/workflow_helper.py       Workflow Helper node (card JSON, no prompt)
  py/helper_download.py       download routes into known model folders
  py/workflow_note.py         Workflow Note and Workflow Note Tile
  web/favorite.js             Favorite
  web/favorite_anchor.js
  web/workflow_helper.js      Workflow Helper card
  web/workflow_helper_card.js card JSON, Markdown, installed-file match
  web/workflow_note.js        Workflow Note on the graph
  web/workflow_note_model.js  note JSON, Markdown, file and pack checks
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
