"""Workflow Note registration and the read-only model-folder route."""

from __future__ import annotations

import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


note = load("devil_workflow_note", "py/workflow_note.py")


class Paths:
    models_dir = "/comfy/models"

    def __init__(self):
        self.folder_names_and_paths = {
            "checkpoints": (["/comfy/models/checkpoints", "/shared/StabilityMatrix/Checkpoints"], {".safetensors"}),
            "clip": (["/comfy/models/clip"], {".safetensors"}),
            "text_encoders": (["/comfy/models/text_encoders"], {".safetensors"}),
            "unet": (["/comfy/models/unet"], {".safetensors"}),
            "diffusion_models": (
                ["/comfy/models/diffusion_models", "/shared/StabilityMatrix/Diffusion"],
                {".safetensors"},
            ),
        }
        self.fail = set()

    def get_folder_paths(self, name):
        if name in self.fail:
            raise RuntimeError("unavailable")
        return list(self.folder_names_and_paths[name][0])

    def get_input_directory(self):
        return "/comfy/input"


class NoteTests(unittest.TestCase):
    def test_both_nodes_are_registered_and_do_not_run(self):
        self.assertEqual(note.NODE_DISPLAY_NAME_MAPPINGS["WorkflowNote"], "Workflow Note")
        self.assertEqual(note.NODE_DISPLAY_NAME_MAPPINGS["WorkflowNoteTile"], "Workflow Note Tile")
        for name in ("WorkflowNote", "WorkflowNoteTile"):
            cls = note.NODE_CLASS_MAPPINGS[name]
            self.assertEqual(cls.CATEGORY, "Devil Nodes/Utility")
            self.assertEqual(cls.RETURN_TYPES, ())
            self.assertFalse(hasattr(cls, "OUTPUT_NODE"))
            spec = cls.INPUT_TYPES()["required"]["note"]
            self.assertEqual(spec[0], "STRING")
            self.assertEqual(spec[1]["default"], "{}")
            self.assertTrue(spec[1]["multiline"])
            self.assertFalse(spec[1]["dynamicPrompts"])
            self.assertTrue(spec[1]["hidden"])
            self.assertEqual(list(cls.INPUT_TYPES()["required"]), ["note"])
            self.assertEqual(cls().idle("{}"), ())

    def test_paths_include_shared_dirs_input_and_aliases(self):
        payload = note.collect_note_paths(Paths())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["input"], ["/comfy/input"])
        self.assertEqual(payload["aliases"], {"clip": "text_encoders", "unet": "diffusion_models"})
        self.assertIn("/shared/StabilityMatrix/Checkpoints", payload["folders"]["checkpoints"])
        self.assertEqual(payload["shared"]["checkpoints"], ["/shared/StabilityMatrix/Checkpoints"])
        self.assertEqual(payload["shared"]["diffusion_models"], ["/shared/StabilityMatrix/Diffusion"])
        self.assertNotIn("clip", payload["shared"])
        self.assertEqual(payload["models_dir"], "/comfy/models")

    def test_a_failing_folder_lookup_falls_back_to_the_configured_list(self):
        paths = Paths()
        paths.fail.add("checkpoints")
        payload = note.collect_note_paths(paths)
        self.assertIn("/comfy/models/checkpoints", payload["folders"]["checkpoints"])

    def test_setup_routes_is_a_no_op_outside_comfyui(self):
        note._BOUND_ROUTES.clear()
        with patch.dict(sys.modules, {"server": None, "aiohttp": None}):
            self.assertFalse(note.setup_routes())

    def test_setup_routes_registers_a_get(self):
        note._BOUND_ROUTES.clear()
        recorded = []

        class Routes:
            def get(self, path):
                def deco(fn):
                    recorded.append((path, fn))
                    return fn

                return deco

        server_mod = types.ModuleType("server")

        class PromptServer:
            instance = types.SimpleNamespace(routes=Routes())

        server_mod.PromptServer = PromptServer
        aio = types.ModuleType("aiohttp")
        web = types.ModuleType("aiohttp.web")
        web.json_response = lambda payload, status=200: {"payload": payload, "status": status}
        aio.web = web
        paths = Paths()
        folder_mod = types.ModuleType("folder_paths")
        for key in ("models_dir", "folder_names_and_paths", "get_folder_paths", "get_input_directory"):
            setattr(folder_mod, key, getattr(paths, key))
        with patch.dict(sys.modules, {"server": server_mod, "aiohttp": aio, "aiohttp.web": web, "folder_paths": folder_mod}):
            self.assertTrue(note.setup_routes())
            self.assertTrue(note.setup_routes())
            paths_registered = [path for path, _fn in recorded]
            self.assertIn("/devil_nodes/note_model_paths", paths_registered)
            self.assertIn("/api/devil_nodes/note_model_paths", paths_registered)
            self.assertEqual(len(recorded), 2)
            view = asyncio.run(recorded[0][1](None))
        self.assertTrue(view["payload"]["ok"])
        self.assertEqual(view["payload"]["aliases"]["clip"], "text_encoders")
        self.assertIn("/shared/StabilityMatrix/Checkpoints", view["payload"]["shared"]["checkpoints"])

    def test_pack_entry_merges_the_note_nodes(self):
        text = (ROOT / "__init__.py").read_text(encoding="utf-8")
        self.assertIn("workflow_note", text)
        self.assertIn("setup_note_routes", text)


if __name__ == "__main__":
    unittest.main()
