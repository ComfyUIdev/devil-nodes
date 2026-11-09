# Changelog

## Unreleased

- Add Workflow Helper: a card saved in the workflow with a title, a Markdown how-to, model rows, custom node packs, and author links. Each model and pack row is marked installed or missing on the ComfyUI that opens the workflow.
- Model Download buttons fetch the row URL (direct http(s), Hugging Face, Civitai, `hf://`, and `b2:` via rclone) into that row's models folder, with progress and errors on the card. Files are written only inside model directories ComfyUI already knows.
- Banner layout shows the title alone, as a label. The pencil opens the editor; the card stays in view mode otherwise.
- The model folder control is a dropdown of every built-in models folder plus any extra folders this ComfyUI reports. A saved folder that is not in that list stays selected.
- The card fills the node body in the classic UI and in Nodes 2.0. Classic mode sizes the card in pixels from the node. Nodes 2.0 stretches the widget grid and keeps the overlay positioning, and the pencil is hit-tested from the screen so Edit and downloads still receive clicks.
- Scan workflow suggests model files selected by loaders in this graph that are not already on the card. Choose which rows to add. The file name and folder are filled in. The URL stays empty until you add one.
- Info tile layout shows a compact button. Clicking it opens the full card, including downloads. The how-to field styles `[teal]`, `[green]`, `[amber]`, and `[glow]` tags and pipe tables.

## 1.0.1 - 2026-11-08

- New official icon and banner.
- Avoid a Registry scanner false positive on the Favorite keyboard handler. The shortcut listener is still a single stored function, attached when the node is added and detached when it is removed.

## 1.0.0 - 2026-11-08

- Initial release: Favorite, a canvas bookmark node with pan, zoom, offsets, and optional animation.
