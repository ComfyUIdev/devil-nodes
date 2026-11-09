"""Workflow Helper — a card that travels with the workflow.

The node stores one JSON string: the title, the Markdown how-to, the model
rows, the custom-node packs, and the author's links. ComfyUI saves that
string with the workflow, so sending the workflow sends the card.

Nothing is executed. The node has no outputs, and the download buttons on
the card talk to the routes in ``helper_download`` instead of queueing a
prompt.
"""

from __future__ import annotations


class WorkflowHelper:
    CATEGORY = "Devil Nodes"
    DESCRIPTION = (
        "A workflow card for sharing: a big title, a Markdown how-to, the "
        "models the workflow needs, the custom node packs it depends on, "
        "and the author's links. Each model and pack is marked installed "
        "or missing on this ComfyUI. Download fetches the URL on a model "
        "row into that row's models folder. A Civitai token typed on the "
        "card stays in this browser and is not saved with the workflow. "
        "Click the pencil to edit. The banner layout is a plain title "
        "label. Nothing runs."
    )
    SEARCH_ALIASES = [
        "workflow helper",
        "workflow card",
        "readme",
        "how to",
        "download models",
        "model links",
        "banner",
        "credits",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "card": (
                    "STRING",
                    {
                        "default": "{}",
                        "multiline": True,
                        # JSON braces must stay literal. Dynamic prompts would
                        # treat `{title}` as a prompt field and eat the card.
                        "dynamicPrompts": False,
                        "tooltip": (
                            "Workflow Helper card as JSON: title, markdown, "
                            "models, packs, and links. The pencil edits this. "
                            "It is saved with the workflow. A Civitai token "
                            "typed on the card is not part of this JSON."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "idle"

    def idle(self, card):
        # No outputs, so ComfyUI does not run this node as part of a prompt.
        return ()


NODE_CLASS_MAPPINGS = {
    "WorkflowHelper": WorkflowHelper,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WorkflowHelper": "Workflow Helper",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
