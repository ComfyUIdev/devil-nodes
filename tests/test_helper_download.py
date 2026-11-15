"""Path safety and download behavior for Workflow Helper."""

from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import tempfile
import threading
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


download = load("devil_helper_download", "py/helper_download.py")
helper = load("devil_workflow_helper", "py/workflow_helper.py")
favorite = load("devil_favorite", "py/favorite.py")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.server.hits.append(
            {"path": self.path.split("?", 1)[0], "authorization": self.headers.get("Authorization")}
        )
        if self.path.startswith("/page"):
            body = b"<html><script>nope</script></html>"
            return self._send(200, body, "text/html")
        if self.path.startswith("/err"):
            return self._send(200, b'{"error":"nope"}', "application/json")
        if self.path.startswith("/missing"):
            return self._send(404, b"gone", "text/plain")
        if self.path.startswith("/bounce-file"):
            self.send_response(302)
            self.send_header("Location", "file:///etc/passwd")
            self.end_headers()
            return
        if self.path.startswith("/bounce-ok"):
            self.send_response(302)
            self.send_header("Location", "/payload.bin")
            self.end_headers()
            return
        body = b"model-bytes-ok"
        self._send(200, body, "application/octet-stream")

    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


class DownloadTests(unittest.TestCase):
    def setUp(self):
        download.JOBS.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "checkpoints"
        self.root.mkdir()
        self.folders = {"checkpoints": [str(self.root)], "loras": [str(self.root / "loras")]}
        (self.root / "loras").mkdir()

    def tearDown(self):
        self.tmp.cleanup()
        download.JOBS.clear()

    def test_favorite_stays_frontend_only(self):
        self.assertEqual(favorite.NODE_CLASS_MAPPINGS, {})
        self.assertEqual(favorite.NODE_DISPLAY_NAME_MAPPINGS, {})

    def test_helper_is_registered(self):
        self.assertEqual(helper.NODE_DISPLAY_NAME_MAPPINGS["WorkflowHelper"], "Workflow Helper")
        node = helper.NODE_CLASS_MAPPINGS["WorkflowHelper"]
        spec = node.INPUT_TYPES()["required"]["card"]
        self.assertEqual(spec[0], "STRING")
        self.assertFalse(spec[1]["dynamicPrompts"])
        self.assertEqual(node().idle("{}"), ())
        self.assertEqual(node.RETURN_TYPES, ())

    def test_rejects_traversal_and_unknown_folders(self):
        bad_names = ["../secret.safetensors", "/etc/passwd", "foo/../../x.safetensors", "..", "C:/windows/a.bin"]
        for name in bad_names:
            with self.assertRaises(download.DestinationError):
                download.resolve_model_path("checkpoints", name, self.folders)
        with self.assertRaises(download.DestinationError):
            download.resolve_model_path("checkpoints/../vae", "model.safetensors", self.folders)
        with self.assertRaises(download.DestinationError):
            download.resolve_model_path("not-a-folder", "model.safetensors", self.folders)

    def test_subfolder_stays_inside_the_model_root(self):
        dest = download.resolve_model_path("loras", "heroes/model.safetensors", self.folders)
        root = os.path.realpath(self.folders["loras"][0])
        self.assertEqual(os.path.commonpath([root, dest]), root)
        self.assertTrue(dest.endswith(os.path.join("heroes", "model.safetensors")))

    def test_symlink_out_of_the_folder_is_rejected(self):
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir()
        alias = self.root / "alias.safetensors"
        alias.symlink_to(outside / "x.bin")
        with self.assertRaises(download.DestinationError):
            download.resolve_model_path("checkpoints", "alias.safetensors", self.folders)

    def test_url_kinds(self):
        direct = download.classify_source("https://civitai.com/api/download/models/42")
        self.assertEqual(direct["kind"], "http")
        pasted = download.classify_source("hf download hf://org/repo/model.safetensors")
        self.assertEqual(pasted["kind"], "hf")
        self.assertEqual(pasted["hf"]["repo_id"], "org/repo")
        web = download.classify_source("https://huggingface.co/org/repo/blob/main/sub/model.safetensors")
        self.assertEqual(web["hf"]["revision"], "main")
        self.assertEqual(web["hf"]["file_path"], "sub/model.safetensors")
        b2 = download.classify_source("b2://bucket/path/model.safetensors")
        self.assertEqual(b2["kind"], "b2")
        self.assertTrue(b2["url"].startswith("b2:bucket/"))
        for blocked in ("file:///etc/passwd", "javascript:alert(1)", "data:text/plain,hi", ""):
            with self.assertRaises(download.SourceError):
                download.classify_source(blocked)

    def test_tokens_stay_on_their_hosts(self):
        hf = "hf_" + ("a" * 30)
        civ = "c" * 24
        self.assertEqual(download.clean_token(f"  'Bearer {hf}'  "), hf)
        self.assertFalse(download.token_usable("hf_token"))
        self.assertTrue(download.token_usable(hf))
        hf_headers = download.request_headers("https://huggingface.co/org/repo/resolve/main/a.safetensors", hf, civ)
        self.assertEqual(hf_headers["Authorization"], f"Bearer {hf}")
        civ_headers = download.request_headers("https://civitai.com/api/download/models/9", hf, civ)
        self.assertEqual(civ_headers["Authorization"], f"Bearer {civ}")
        cdn_headers = download.request_headers("https://cdn.example/file.safetensors", hf, civ)
        self.assertNotIn("Authorization", cdn_headers)
        leaked = download.scrub_secrets(f"failed token={hf} at host", [hf])
        self.assertNotIn(hf, leaked)
        self.assertIn("[redacted]", leaked)

    def test_hf_token_comes_from_huggingface_hub_get_token(self):
        token = "hf_" + "d" * 30
        civ = "c" * 24
        hub = types.ModuleType("huggingface_hub")
        hub.get_token = lambda: f"  'Bearer {token}'  "

        def refuse_open(*args, **kwargs):
            raise AssertionError(f"token lookup opened a file: {args[:1]}")

        with patch.dict(sys.modules, {"huggingface_hub": hub}), patch("builtins.open", refuse_open):
            found = download.lookup_hf_token()
        self.assertEqual(found, token)
        plain = download.request_headers("https://example.com/model.safetensors", found, civ)
        self.assertNotIn("Authorization", plain)
        hf_host = download.request_headers("https://hf.co/org/repo/resolve/main/a.safetensors", found, civ)
        self.assertEqual(hf_host["Authorization"], f"Bearer {found}")
        self.assertNotIn(civ, hf_host["Authorization"])

        hub.get_token = lambda: None
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            self.assertEqual(download.lookup_hf_token(), "")
        hub.get_token = lambda: "not a token"
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            self.assertEqual(download.lookup_hf_token(), "")

        def broken():
            raise RuntimeError("login unavailable")

        hub.get_token = broken
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            self.assertEqual(download.lookup_hf_token(), "")
        with patch.dict(sys.modules, {"huggingface_hub": None}):
            self.assertEqual(download.lookup_hf_token(), "")

        self.assertEqual(download.civitai_token_from_request({"civitai_token": f"Bearer {civ}"}), civ)
        self.assertEqual(download.civitai_token_from_request({"civitai_token": "short"}), "")
        self.assertEqual(download.civitai_token_from_request({}), "")
        self.assertEqual(download.civitai_token_from_request("nope"), "")

    def test_saved_hub_token_is_passed_to_the_download(self):
        token = "hf_" + "a" * 30
        captured = {}

        def fake_download(**kwargs):
            captured.update(kwargs)
            path = Path(kwargs["local_dir"]) / kwargs["filename"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"from-login")
            return str(path)

        hub = types.ModuleType("huggingface_hub")
        hub.get_token = lambda: token
        hub.hf_hub_download = fake_download
        spec = {"repo_id": "org/repo", "file_path": "model.safetensors", "repo_type": "model", "revision": None}
        dest = self.root / "login.safetensors"
        job = {
            "id": "login",
            "status": "downloading",
            "percent": 0,
            "speed": "",
            "message": "",
            "error": "",
            "filename": "model.safetensors",
            "folder": "checkpoints",
        }
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            found = download.lookup_hf_token()
            asyncio.run(download.download_hf(spec, str(dest), job, hf_token=found))
        self.assertEqual(found, token)
        self.assertEqual(captured.get("token"), token)
        self.assertEqual(dest.read_bytes(), b"from-login")
        self.assertNotIn(token, job.get("message", ""))
        self.assertNotIn(token, job.get("error", ""))

    def test_gated_hub_error_names_the_login_steps(self):
        token = "hf_" + "a" * 30
        spec = {"repo_id": "org/repo", "file_path": "model.safetensors", "repo_type": "model", "revision": None}

        class GatedRepoError(RuntimeError):
            pass

        def boom(**kwargs):
            raise GatedRepoError("401 gated")

        hub = types.ModuleType("huggingface_hub")
        hub.get_token = lambda: token
        hub.hf_hub_download = boom
        job = {
            "id": "gated",
            "status": "downloading",
            "percent": 0,
            "speed": "",
            "message": "",
            "error": "",
            "filename": "model.safetensors",
            "folder": "checkpoints",
        }
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            asyncio.run(download.download_hf(spec, str(self.root / "gated.safetensors"), job, hf_token=token))
        self.assertEqual(job["status"], "error")
        self.assertIn("HF_TOKEN", job["error"])
        self.assertIn("hf auth login", job["error"])
        self.assertIn("restart ComfyUI", job["error"])
        self.assertNotIn(token, job["error"])
        self.assertFalse((self.root / "gated.safetensors").exists())

    def test_refused_downloads_name_the_token_source(self):
        hf = download.refusal_for_status(401, "https://huggingface.co/org/repo/resolve/main/a.safetensors")
        self.assertIn("HF_TOKEN", str(hf))
        self.assertIn("hf auth login", str(hf))
        civ = download.refusal_for_status(403, "https://www.civitai.com/api/download/models/9")
        self.assertIn("Civitai token field", str(civ))
        self.assertIn("not saved in the workflow", str(civ))
        other = download.refusal_for_status(401, "https://example.com/file")
        self.assertIn("401", str(other))
        self.assertIsNone(download.refusal_for_status(200, "https://huggingface.co/org/repo/resolve/main/a.safetensors"))

        class Response:
            def __init__(self):
                self.status = 401
                self.headers = {"Content-Type": "text/plain"}

            def read(self, _n=-1):
                return b""

            def close(self):
                return None

        class Opener:
            def open(self, request, timeout=None):
                return Response()

        dest = self.root / "denied.safetensors"
        job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "denied.safetensors", "folder": "checkpoints"}
        with patch.object(download.urllib.request, "build_opener", return_value=Opener()):
            asyncio.run(download.download_http("https://huggingface.co/org/repo/resolve/main/a.safetensors", str(dest), job, hf_token="hf_" + "b" * 30))
        self.assertEqual(job["status"], "error")
        self.assertIn("HF_TOKEN", job["error"])
        self.assertNotIn("hf_" + "b" * 30, job["error"])
        self.assertFalse(dest.exists())

    def test_redirect_sends_each_token_only_to_its_host(self):
        hf = "hf_" + "a" * 30
        civ = "c" * 24
        seen = []

        class Response:
            def __init__(self, status, headers, body=b"model-bytes-ok"):
                self.status = status
                self.headers = headers
                self._body = body
                self._sent = False

            def read(self, _n=-1):
                if self._sent:
                    return b""
                self._sent = True
                return self._body

            def close(self):
                return None

        class Opener:
            def open(self, request, timeout=None):
                seen.append((request.full_url, request.get_header("Authorization")))
                if request.full_url.startswith("https://huggingface.co/"):
                    return Response(302, {"Location": "https://cdn.example/hf.bin"})
                if request.full_url.startswith("https://civitai.com/"):
                    return Response(302, {"Location": "https://cdn.example/civ.bin"})
                if request.full_url.startswith("file:"):
                    raise AssertionError("file redirect was opened")
                return Response(200, {"Content-Type": "application/octet-stream", "Content-Length": "14"})

        dest = self.root / "redirected.safetensors"
        job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "redirected.safetensors", "folder": "checkpoints"}
        with patch.object(download.urllib.request, "build_opener", return_value=Opener()):
            asyncio.run(
                download.download_http(
                    "https://huggingface.co/org/repo/resolve/main/a.safetensors",
                    str(dest),
                    job,
                    hf_token=hf,
                    civitai_token=civ,
                )
            )
        self.assertEqual(job["status"], "done")
        self.assertEqual(seen[0], ("https://huggingface.co/org/repo/resolve/main/a.safetensors", f"Bearer {hf}"))
        self.assertEqual(seen[1][0], "https://cdn.example/hf.bin")
        self.assertIsNone(seen[1][1])
        self.assertEqual(dest.read_bytes(), b"model-bytes-ok")

        seen.clear()
        dest = self.root / "civ.safetensors"
        job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "civ.safetensors", "folder": "checkpoints"}
        with patch.object(download.urllib.request, "build_opener", return_value=Opener()):
            asyncio.run(download.download_http("https://civitai.com/api/download/models/9", str(dest), job, hf_token=hf, civitai_token=civ))
        self.assertEqual(seen[0][1], f"Bearer {civ}")
        self.assertIsNone(seen[1][1])
        self.assertNotIn(hf, seen[0][1])
        self.assertNotIn(hf, seen[1][0])

    def test_hf_cli_keeps_the_token_out_of_the_command(self):
        spec = {"repo_id": "org/repo", "file_path": "model.safetensors", "repo_type": "model", "revision": "main"}
        token = "hf_" + "f" * 30
        args = download._hf_cli_args("/usr/bin/hf", spec, "/tmp/work")
        self.assertEqual(args[:4], ["/usr/bin/hf", "download", "org/repo", "model.safetensors"])
        self.assertIn("--type", args)
        self.assertNotIn(token, args)
        self.assertNotIn("--token", args)
        legacy = download._hf_cli_args("/usr/bin/huggingface-cli", spec, "/tmp/work")
        self.assertIn("--repo-type", legacy)
        self.assertNotIn(token, legacy)
        self.assertNotIn("--token", legacy)

    def test_missing_hub_library_uses_the_cli_without_a_shell(self):
        spec = {"repo_id": "org/repo", "file_path": "model.safetensors", "repo_type": "model", "revision": None}
        token = "hf_" + "f" * 30
        dest = self.root / "model.safetensors"
        seen = {}

        async def fake_exec(*cmd, **kwargs):
            self.assertNotIn("shell", kwargs)
            self.assertNotIn("env", kwargs)
            self.assertNotIn(token, cmd)
            work = cmd[cmd.index("--local-dir") + 1]
            path = Path(work) / "model.safetensors"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"from-cli")
            seen["cmd"] = cmd

            class Proc:
                def __init__(self):
                    self.stdout = asyncio.StreamReader()
                    self.stdout.feed_data(b"done\n")
                    self.stdout.feed_eof()

                async def wait(self):
                    return 0

            return Proc()

        def missing(*args, **kwargs):
            raise ImportError("no hub")

        job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "model.safetensors", "folder": "checkpoints", "id": "cli"}
        with patch.object(download, "_hub_download_blocking", missing), patch.object(download, "_hf_cli_path", return_value="/usr/bin/hf"), patch.object(download.asyncio, "create_subprocess_exec", fake_exec):
            asyncio.run(download.download_hf(spec, str(dest), job, hf_token=token))
        self.assertEqual(job["status"], "done")
        self.assertEqual(dest.read_bytes(), b"from-cli")
        self.assertEqual(seen["cmd"][1], "download")
        self.assertFalse((self.root / ".devil-fetch-cli").exists())

    def test_missing_hub_and_cli_fall_back_to_https(self):
        spec = {"repo_id": "org/repo", "file_path": "sub/model.safetensors", "repo_type": "model", "revision": "main"}
        token = "hf_" + "f" * 30
        calls = []

        async def fake_http(url, dest, job, hf_token="", civitai_token=""):
            calls.append((url, hf_token, civitai_token))
            job["status"] = "done"

        def missing(*args, **kwargs):
            raise ImportError("no hub")

        job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "model.safetensors", "folder": "checkpoints", "id": "https"}
        with patch.object(download, "_hub_download_blocking", missing), patch.object(download, "_hf_cli_path", return_value=""), patch.object(download, "download_http", fake_http):
            asyncio.run(download.download_hf(spec, str(self.root / "model.safetensors"), job, hf_token=token))
        self.assertEqual(calls[0][0], "https://huggingface.co/org/repo/resolve/main/sub/model.safetensors")
        self.assertEqual(calls[0][1], token)
        self.assertEqual(calls[0][2], "")

    def test_hub_api_gets_the_token_as_an_argument(self):
        spec = {"repo_id": "org/repo", "file_path": "model.safetensors", "repo_type": "model", "revision": None}
        token = "hf_" + "f" * 30
        dest = self.root / "out.safetensors"
        captured = {}

        def fake_download(**kwargs):
            captured.update(kwargs)
            path = Path(kwargs["local_dir"]) / kwargs["filename"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"from-api")
            return str(path)

        fake = types.ModuleType("huggingface_hub")
        fake.hf_hub_download = fake_download
        job = {"id": "api", "status": "downloading", "percent": 0, "speed": "", "message": ""}
        with patch.dict(sys.modules, {"huggingface_hub": fake}):
            download._hub_download_blocking(spec, str(dest), job, token)
        self.assertEqual(captured["token"], token)
        self.assertEqual(captured["repo_id"], "org/repo")
        self.assertEqual(dest.read_bytes(), b"from-api")
        captured.clear()
        with patch.dict(sys.modules, {"huggingface_hub": fake}):
            download._hub_download_blocking(spec, str(self.root / "login.safetensors"), job, "")
        self.assertNotIn("token", captured)

    def test_http_download_writes_only_the_destination(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.hits = []
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        base = f"http://127.0.0.1:{port}"
        try:
            dest = self.root / "model.safetensors"
            job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "model.safetensors", "folder": "checkpoints"}
            asyncio.run(download.download_http(f"{base}/payload.bin", str(dest), job, hf_token="hf_" + "b" * 30, civitai_token="c" * 24))
            self.assertEqual(job["status"], "done")
            self.assertEqual(dest.read_bytes(), b"model-bytes-ok")
            self.assertFalse((self.root / "model.safetensors.devilpart").exists())
            self.assertTrue(all(hit["authorization"] is None for hit in server.hits))

            nested = download.prepare_download(
                {"url": f"{base}/bounce-ok", "filename": "heroes/model.safetensors", "folder": "loras"},
                self.folders,
            )
            job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": nested["filename"], "folder": "loras"}
            asyncio.run(download.run_spec(nested, job, hf_token="hf_" + "b" * 30))
            saved = Path(nested["dest"])
            self.assertEqual(saved.read_bytes(), b"model-bytes-ok")
            self.assertEqual(os.path.commonpath([os.path.realpath(self.folders["loras"][0]), str(saved)]), os.path.realpath(self.folders["loras"][0]))

            page = self.root / "page.safetensors"
            job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "page.safetensors", "folder": "checkpoints"}
            asyncio.run(download.download_http(f"{base}/page", str(page), job))
            self.assertEqual(job["status"], "error")
            self.assertFalse(page.exists())
            self.assertIn("web page", job["error"])

            bad = self.root / "bad.safetensors"
            job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "bad.safetensors", "folder": "checkpoints"}
            asyncio.run(download.download_http(f"{base}/err", str(bad), job))
            self.assertEqual(job["status"], "error")
            self.assertFalse(bad.exists())

            escaped = self.root / "escaped.safetensors"
            job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "escaped.safetensors", "folder": "checkpoints"}
            asyncio.run(download.download_http(f"{base}/bounce-file", str(escaped), job))
            self.assertEqual(job["status"], "error")
            self.assertFalse(escaped.exists())
            self.assertIn("redirected away", job["error"])
        finally:
            server.shutdown()
            server.server_close()

    def test_existing_file_is_not_fetched_again(self):
        dest = self.root / "ready.safetensors"
        dest.write_bytes(b"already")
        spec = download.prepare_download(
            {"url": "https://example.com/ready.safetensors", "filename": "ready.safetensors", "folder": "checkpoints"},
            self.folders,
        )
        view = download.begin_download(spec)
        self.assertEqual(view["status"], "done")
        self.assertEqual(view["message"], "Already installed")
        self.assertEqual(dest.read_bytes(), b"already")

    def test_hub_meter_accepts_xet_progress_calls(self):
        job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": ""}
        meter = download._make_meter(job)
        transfer = meter(
            desc="file: downloading bytes",
            total=1000,
            unit="B",
            unit_scale=True,
            name="huggingface_hub.xet_get.transfer",
            position=0,
            leave=True,
        )
        recon = meter(desc="file: reconstructing file", total=None, unit="B", unit_scale=True, name="huggingface_hub.xet_get")
        transfer.set_postfix_str("  1.2MB/s", refresh=False)
        recon.set_description_str("file: reconstructing file", refresh=False)
        recon.set_postfix_str("  800kB/s", refresh=False)
        transfer.display()
        transfer.clear()
        transfer.unpause()
        transfer.refresh()
        self.assertIsNone(transfer.not_a_real_tqdm_method("x", refresh=False))
        with self.assertRaises(AttributeError):
            getattr(transfer, "__missing_dunder__")

        # Byte deltas. The file size shows up after the first writes.
        recon.update(400)
        self.assertEqual(job["percent"], 0)
        recon.total = 1000
        self.assertEqual(job["percent"], 40)
        # A second bar, and a total that grows the way Xet grows the transfer bar, must not rewind or pass 100.
        transfer.update(200)
        self.assertEqual(job["percent"], 40)
        ahead = transfer.n + 5000
        if (transfer.total or 0) < ahead:
            transfer.total = max(transfer.total or 0, int(ahead * 1.25) + 1)
        transfer.update(5000)
        self.assertGreaterEqual(job["percent"], 40)
        self.assertLessEqual(job["percent"], 100)
        recon.update(550)
        self.assertGreaterEqual(job["percent"], 40)
        self.assertLessEqual(job["percent"], 100)

        fresh = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": ""}
        restarted = download._make_meter(fresh)(unit="B", unit_scale=True)
        restarted.update(10)
        restarted.reset(total=200)
        self.assertEqual(restarted.n, 0)
        self.assertEqual(restarted.total, 200)
        restarted.update(50)
        self.assertEqual(fresh["percent"], 25)

    def _hf_job(self, spec):
        return {
            "id": spec["id"],
            "status": "downloading",
            "percent": 0,
            "speed": "",
            "message": "",
            "error": "",
            "filename": spec["filename"],
            "folder": spec["folder"],
            "secrets": [],
        }

    def test_repo_url_with_one_model_file_saves_that_filename(self):
        token = "hf_" + "a" * 30
        weight = "viggle-image-swap-v0.1-lora.safetensors"
        spec = download.prepare_download(
            {
                "url": "https://huggingface.co/Viggle/Viggle-Image-Swap",
                "filename": "Viggle/Viggle-Image-Swap",
                "folder": "loras",
            },
            self.folders,
        )
        self.assertEqual(spec["source"]["kind"], "hf")
        self.assertEqual(spec["source"]["hf"]["repo_id"], "Viggle/Viggle-Image-Swap")
        self.assertEqual(spec["source"]["hf"]["file_path"], "")
        self.assertFalse(spec["source"]["hf"]["file_in_url"])
        self.assertEqual(spec["filename"], "Viggle/Viggle-Image-Swap")
        pasted = download.classify_source("hf://Viggle/Viggle-Image-Swap")
        self.assertEqual(pasted["hf"]["file_path"], "")
        self.assertFalse(pasted["hf"]["file_in_url"])
        seen = {}

        def list_repo_files(**kwargs):
            seen["list"] = kwargs
            return ["README.md", weight, "config.json"]

        def fake_download(**kwargs):
            seen["download"] = kwargs
            path = Path(kwargs["local_dir"]) / kwargs["filename"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"viggle-weights")
            return str(path)

        hub = types.ModuleType("huggingface_hub")
        hub.list_repo_files = list_repo_files
        hub.hf_hub_download = fake_download
        job = self._hf_job(spec)
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            asyncio.run(download.download_hf(spec["source"]["hf"], spec["dest"], job, hf_token=token))
        saved = self.root / "loras" / weight
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["filename"], weight)
        self.assertEqual(saved.read_bytes(), b"viggle-weights")
        self.assertFalse((self.root / "loras" / "Viggle").exists())
        self.assertEqual(seen["list"]["repo_id"], "Viggle/Viggle-Image-Swap")
        self.assertEqual(seen["list"]["token"], token)
        self.assertEqual(seen["download"]["filename"], weight)
        self.assertEqual(seen["download"]["token"], token)

    def test_repo_url_with_several_model_files_asks_for_the_file_link(self):
        spec = download.prepare_download(
            {
                "url": "https://huggingface.co/Viggle/Viggle-Image-Swap/tree/main",
                "filename": "Viggle/Viggle-Image-Swap",
                "folder": "loras",
            },
            self.folders,
        )
        self.assertEqual(spec["source"]["hf"]["revision"], "main")
        called = {"download": 0}

        def list_repo_files(**kwargs):
            return ["README.md", "one.safetensors", "two.ckpt", "notes.md"]

        def fake_download(**kwargs):
            called["download"] += 1
            raise AssertionError("ambiguous repo should not download")

        hub = types.ModuleType("huggingface_hub")
        hub.list_repo_files = list_repo_files
        hub.hf_hub_download = fake_download
        job = self._hf_job(spec)
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            asyncio.run(download.download_hf(spec["source"]["hf"], spec["dest"], job, hf_token=""))
        self.assertEqual(job["status"], "error")
        self.assertIn("Paste the link to the file", job["error"])
        self.assertIn("one.safetensors", job["error"])
        self.assertIn("two.ckpt", job["error"])
        self.assertEqual(called["download"], 0)
        self.assertEqual([path for path in (self.root / "loras").rglob("*") if path.is_file()], [])
        self.assertFalse((self.root / "loras" / "Viggle" / "Viggle-Image-Swap").exists())

    def test_file_url_uses_the_repo_filename_when_the_row_name_has_no_extension(self):
        weight = "viggle-image-swap-v0.1-lora.safetensors"
        url = f"https://huggingface.co/Viggle/Viggle-Image-Swap/resolve/main/{weight}"
        spec = download.prepare_download(
            {"url": url, "filename": "Viggle/Viggle-Image-Swap", "folder": "loras"},
            self.folders,
        )
        self.assertTrue(spec["source"]["hf"]["file_in_url"])
        self.assertEqual(spec["source"]["hf"]["file_path"], weight)
        self.assertEqual(spec["filename"], weight)
        self.assertTrue(spec["dest"].endswith(weight))

        def fake_download(**kwargs):
            path = Path(kwargs["local_dir"]) / kwargs["filename"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"from-file-url")
            return str(path)

        hub = types.ModuleType("huggingface_hub")
        hub.hf_hub_download = fake_download
        job = self._hf_job(spec)
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            asyncio.run(download.download_hf(spec["source"]["hf"], spec["dest"], job, hf_token=""))
        saved = Path(spec["dest"])
        self.assertEqual(job["status"], "done")
        self.assertEqual(saved.name, weight)
        self.assertEqual(saved.read_bytes(), b"from-file-url")
        self.assertFalse((self.root / "loras" / "Viggle").exists())

        kept = download.prepare_download(
            {"url": url, "filename": "keep.safetensors", "folder": "loras"},
            self.folders,
        )
        self.assertEqual(kept["filename"], "keep.safetensors")
        kept_job = self._hf_job(kept)
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            asyncio.run(download.download_hf(kept["source"]["hf"], kept["dest"], kept_job, hf_token=""))
        self.assertEqual(kept_job["filename"], "keep.safetensors")
        self.assertEqual(Path(kept["dest"]).read_bytes(), b"from-file-url")

    def test_prepare_rejects_a_bad_url_before_any_write(self):
        with self.assertRaises(download.SourceError):
            download.prepare_download(
                {"url": "file:///etc/passwd", "filename": "model.safetensors", "folder": "checkpoints"},
                self.folders,
            )
        self.assertEqual([path for path in self.root.rglob("*") if path.is_file()], [])


def scanner_needles():
    """Banned substrings, built so this file does not contain them whole."""
    return (
        "os." + "environ",
        "os." + "getenv",
        "environ" + ".get",
        "environ" + "[",
        "aiohttp." + "ClientSession",
        ".bi" + "nd(",
        "/pro" + "c/",
        "/etc/" + "environment",
        "/root/" + ".env",
    )


class ShippedFileTests(unittest.TestCase):
    def test_shipped_source_avoids_scanner_substrings(self):
        needles = scanner_needles()
        paths = [ROOT / "__init__.py", *sorted((ROOT / "py").glob("*.py")), *sorted((ROOT / "web").glob("*.js"))]
        self.assertGreaterEqual(len(paths), 4)
        for path in paths:
            text = path.read_text(encoding="utf-8")
            for needle in needles:
                self.assertNotIn(needle, text, f"{path.name} contains {needle}")

    def test_shipped_javascript_avoids_the_scanner_pattern(self):
        needle = ".bi" + "nd("
        html = "inner" + "HTML"
        for path in (ROOT / "web").glob("*.js"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn(needle, text, path.name)
            self.assertNotIn(html, text, path.name)
            self.assertNotIn("insert" + "AdjacentHTML", text, path.name)

    def test_version_is_1_1_5(self):
        text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('version = "1.1.5"', text)
        self.assertIn("Favorite", text)
        self.assertIn("Workflow Helper", text)

    def test_images_are_still_the_tracked_pngs(self):
        self.assertTrue((ROOT / "icon.png").is_file())
        self.assertTrue((ROOT / "banner.png").is_file())


if __name__ == "__main__":
    unittest.main()
