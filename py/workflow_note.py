"""Workflow Note — a how-to card stored on the node.

The node keeps one JSON string: title, subtitle, author, Markdown body,
model rows, pack rows, and links. ComfyUI saves that string with the
workflow. There is no output socket, and OUTPUT_NODE is left unset, so
queueing a prompt does not run the node.

Workflow Note Tile is the same card with the compact tile layout. The
browser swaps the node type when the layout changes, so a saved workflow
records the tile as its own node.

A read-only route reports the model folders this ComfyUI is already
configured to read, including extra_model_paths entries such as a
Stability Matrix shared directory. The browser uses that list for
"also read from" hints. The route does not download anything.
"""

from __future__ import annotations

import os

# clip and unet are the older folder names. Current ComfyUI reads those
# files from text_encoders and diffusion_models.
FOLDER_ALIASES = {
    "clip": "text_encoders",
    "unet": "diffusion_models",
}

_BOUND_ROUTES = set()


class _WorkflowNoteBase:
    CATEGORY = "Devil Nodes/Utility"
    RETURN_TYPES = ()
    FUNCTION = "idle"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "note": (
                    "STRING",
                    {
                        "default": "{}",
                        "multiline": True,
                        # JSON braces must stay literal. Dynamic prompts would
                        # treat `{title}` as a prompt field and eat the note.
                        "dynamicPrompts": False,
                        # The pencil edits this. The textarea itself stays hidden.
                        "hidden": True,
                        "tooltip": (
                            "Workflow Note as JSON: title, subtitle, author, "
                            "markdown, models, packs, and links. The pencil "
                            "edits this. It is saved with the workflow."
                        ),
                    },
                ),
            },
        }

    def idle(self, note):
        # No outputs, and OUTPUT_NODE is unset, so this is not queued.
        return ()


class WorkflowNote(_WorkflowNoteBase):
    DESCRIPTION = (
        "A note saved in the workflow: title, subtitle, author, a Markdown "
        "how-to, model files, node packs, and links. Model rows are marked "
        "found or missing. Download links open in a new tab. The banner "
        "layout is a title label. Nothing runs."
    )
    SEARCH_ALIASES = [
        "workflow note",
        "note",
        "readme",
        "how to",
        "how-to",
        "banner",
        "credits",
        "model list",
    ]


class WorkflowNoteTile(_WorkflowNoteBase):
    DESCRIPTION = (
        "The same Workflow Note as a compact tile. Click the tile to read "
        "the full note. Nothing runs."
    )
    SEARCH_ALIASES = [
        "workflow note tile",
        "info tile",
        "note tile",
        "readme button",
    ]


def _as_paths(value):
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if item]
    return []


def _entry_paths(entry):
    """folder_names_and_paths values are (paths, extensions)."""
    if isinstance(entry, (list, tuple)) and entry:
        first = entry[0]
        if isinstance(first, (list, tuple, set, str)):
            return _as_paths(first)
    return _as_paths(entry)


def _is_under(path, root):
    if not path or not root:
        return False
    try:
        path_real = os.path.realpath(path)
        root_real = os.path.realpath(root)
        return os.path.commonpath([path_real, root_real]) == root_real
    except ValueError:
        return False


def collect_note_paths(paths_mod):
    """Model folders, the input directory, and clip/unet aliases.

    Paths outside the main models directory are returned again under
    ``shared`` so the note can say which extra folders are also read.
    """
    folders = {}
    mapping = getattr(paths_mod, "folder_names_and_paths", None) or {}
    getter = getattr(paths_mod, "get_folder_paths", None)
    for name in list(mapping.keys()):
        got = None
        if callable(getter):
            try:
                got = getter(name)
            except Exception:
                got = None
        folders[str(name)] = _as_paths(got) if got else _entry_paths(mapping.get(name))

    models_dir = str(getattr(paths_mod, "models_dir", "") or "")
    shared = {}
    for name, paths in folders.items():
        if not paths:
            continue
        primary = None
        if models_dir:
            for path in paths:
                if _is_under(path, models_dir):
                    primary = path
                    break
        if primary is None:
            primary = paths[0]
        extra = [path for path in paths if path != primary]
        if extra:
            shared[name] = extra

    input_dir = ""
    input_getter = getattr(paths_mod, "get_input_directory", None)
    if callable(input_getter):
        try:
            input_dir = str(input_getter() or "")
        except Exception:
            input_dir = ""
    if not input_dir:
        input_dir = str(getattr(paths_mod, "input_directory", "") or "")

    return {
        "ok": True,
        "models_dir": models_dir,
        "folders": folders,
        "shared": shared,
        "input": [input_dir] if input_dir else [],
        "aliases": dict(FOLDER_ALIASES),
    }


def _empty_payload():
    return {
        "ok": False,
        "models_dir": "",
        "folders": {},
        "shared": {},
        "input": [],
        "aliases": dict(FOLDER_ALIASES),
    }


def setup_routes():
    """Register the read-only folder route. No-op outside ComfyUI."""
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return False

    server = getattr(PromptServer, "instance", None)
    routes = getattr(server, "routes", None) if server is not None else None
    if routes is None or not hasattr(routes, "get"):
        return False
    key = id(routes)
    if key in _BOUND_ROUTES:
        return True

    async def note_model_paths(_request):
        try:
            import folder_paths
        except Exception:
            payload = _empty_payload()
        else:
            try:
                payload = collect_note_paths(folder_paths)
            except Exception:
                payload = _empty_payload()
        return web.json_response(payload)

    for prefix in ("", "/api"):
        routes.get(f"{prefix}/devil_nodes/note_model_paths")(note_model_paths)

    _BOUND_ROUTES.add(key)
    print("[devil-nodes] Workflow Note model paths ready", flush=True)
    return True


NODE_CLASS_MAPPINGS = {
    "WorkflowNote": WorkflowNote,
    "WorkflowNoteTile": WorkflowNoteTile,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WorkflowNote": "Workflow Note",
    "WorkflowNoteTile": "Workflow Note Tile",
}

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "setup_routes",
    "collect_note_paths",
    "FOLDER_ALIASES",
]
