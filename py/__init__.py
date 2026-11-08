"""Python-side nodes for the Devil Nodes pack.

Each module exports ``NODE_CLASS_MAPPINGS`` and ``NODE_DISPLAY_NAME_MAPPINGS``.
The pack entry point merges those dicts. Frontend-only nodes, such as
Favorite, export empty mappings and register themselves from ``web/``.
Workflow Helper registers a real node plus the download routes.
"""
