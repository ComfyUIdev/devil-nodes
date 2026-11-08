"""Favorite — a frontend-only canvas bookmark.

Press the node's shortcut, or double-click it, and the graph pans and zooms
so this node sits on a saved anchor. X/Y offsets shift that anchor. Animation
and blur are optional.

ComfyUI serves ``web/favorite.js``, which registers the LiteGraph type
``Favorite`` with the display title ``Favorite``. There is no graph input,
no graph output, and no backend execution. A Python class registered under
the same id would be published as a server node and would replace this
bookmark in the node search, so the mappings below stay empty on purpose.

Later Devil Nodes that do run on the server should export real mappings
from their own modules. The pack ``__init__.py`` merges them in.
"""

# LiteGraph type id. Also the name shown in the node menu and on the node.
NODE_TYPE = "Favorite"
DISPLAY_NAME = "Favorite"

NODE_CLASS_MAPPINGS: dict = {}
NODE_DISPLAY_NAME_MAPPINGS: dict = {}
