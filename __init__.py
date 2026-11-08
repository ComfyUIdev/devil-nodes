"""Devil Nodes — ComfyUI custom nodes by ComfyUIdev.

Add a node by dropping a module in ``py/`` that exports
``NODE_CLASS_MAPPINGS`` and ``NODE_DISPLAY_NAME_MAPPINGS``, then merging
it here. Frontend scripts go in ``web/`` and load because of
``WEB_DIRECTORY``.
"""

from .py.favorite import NODE_CLASS_MAPPINGS as _FAVORITE_CLASS_MAPPINGS
from .py.favorite import NODE_DISPLAY_NAME_MAPPINGS as _FAVORITE_DISPLAY_NAME_MAPPINGS

NODE_CLASS_MAPPINGS = {}
NODE_CLASS_MAPPINGS.update(_FAVORITE_CLASS_MAPPINGS)

NODE_DISPLAY_NAME_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS.update(_FAVORITE_DISPLAY_NAME_MAPPINGS)

# Every .js file under this directory is served to the ComfyUI frontend.
WEB_DIRECTORY = "./web"

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
