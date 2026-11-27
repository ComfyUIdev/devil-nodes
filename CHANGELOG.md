# Changelog

## 1.2.0 - 2026-11-27

- Add Workflow Note and Workflow Note Tile. The note is saved in the workflow: title, subtitle, author, a Markdown how-to, model rows, pack rows, and links. Queueing a prompt does not run it.
- Card, banner, and info tile are three layouts. The tile serializes as Workflow Note Tile, opens the full note, and can be resized from the grip or with the arrow keys.
- Model rows are plain download links. Check files marks each file found or missing, including extra model folders and the clip / unet folder aliases. A single subfolder match can be applied to the loaders in the graph.
- Pack rows can be detected from the graph, including subgraphs. A missing probe class offers Update through ComfyUI Manager or the Registry. devil-nodes is listed with its Registry page.

## 1.1.4 - 2026-11-17

- Workflow Helper Hugging Face downloads work with huggingface_hub 2.2. The progress meter accepts the tqdm methods Xet uses, and the percent does not pass 100 or move backwards.
- A Hugging Face repo link, or a file link whose row name has no model extension, saves the real model file (for example `viggle-image-swap-v0.1-lora.safetensors`) into the chosen folder. A repo with several model files asks for the file link instead of saving a nameless copy. The card row uses that file name for the installed check.

## 1.1.3 - 2026-11-11

- Favorite and Workflow Helper are listed under **Devil Nodes/Utility** in the node menu.

## 1.1.2 - 2026-11-09

- Hugging Face downloads ask `huggingface_hub` for a token (`HF_TOKEN` or `hf auth login`). A gated or refused file tells you to set `HF_TOKEN` or run `hf auth login`, then restart ComfyUI.
- Workflow Helper has a masked Civitai token field. The value stays in this browser and is not saved in the workflow. It is sent only to Civitai.

## 1.1.1 - 2026-11-09

- Model downloads use the Python standard library. Hugging Face tokens still come from the ComfyUI process (`HF_TOKEN`, `HUGGING_FACE_HUB_TOKEN`, `HUGGINGFACE_HUB_TOKEN`) and, when `huggingface_hub` is installed, from `hf auth login`.

## 1.1.0 - 2026-11-09

- Add Workflow Helper: a card saved in the workflow with a title, a Markdown how-to, model rows, custom node packs, and author links. Each model and pack row is marked installed or missing on the ComfyUI that opens the workflow.
- Model Download buttons fetch the row URL (direct http(s), Hugging Face, Civitai, `hf://`, and `b2:` via rclone) into that row's models folder, with progress and errors on the card. Files are written only inside model directories ComfyUI already knows.
- Banner layout shows the title alone, as a label. The pencil opens the editor; the card stays in view mode otherwise.
- The model folder control is a dropdown of every built-in models folder plus any extra folders this ComfyUI reports. A saved folder that is not in that list stays selected.
- The card fills the node body in the classic UI and in Nodes 2.0. Classic mode sizes the card in pixels from the node. Nodes 2.0 stretches the widget grid and keeps the overlay positioning, and the pencil is hit-tested from the screen so Edit and downloads still receive clicks.
- Scan workflow suggests model files selected by loaders in this graph that are not already on the card. Choose which rows to add. The file name and folder are filled in. The URL stays empty until you add one.
- Info tile layout shows a compact button. Clicking it opens the full card, including downloads. The how-to field styles `[teal]`, `[green]`, `[amber]`, and `[glow]` tags and pipe tables.
- Hugging Face tokens are read from the ComfyUI process environment only. Gated downloads use `huggingface_hub` when it is installed, then the `hf` CLI, then HTTPS. The token is sent only to Hugging Face hosts.
- Replace `icon.png` with the official 400×400 pack logo.

## 1.0.1 - 2026-11-08

- New official icon and banner.
- Avoid a Registry scanner false positive on the Favorite keyboard handler. The shortcut listener is still a single stored function, attached when the node is added and detached when it is removed.

## 1.0.0 - 2026-11-08

- Initial release: Favorite, a canvas bookmark node with pan, zoom, offsets, and optional animation.
