"""Download one model file into a ComfyUI models folder.

Workflow Helper posts the row's URL, file name, and folder here. The file is
written only under a directory ComfyUI already uses for that folder. Names
that would leave that directory are rejected.

Supported sources:
- ``http`` and ``https`` links, including Hugging Face and Civitai pages
- ``hf://org/repo/path`` and a pasted ``hf download hf://...`` command
- ``b2:`` links, fetched with rclone when it is installed

A Hugging Face token comes from this process environment
(``HF_TOKEN``, ``HUGGING_FACE_HUB_TOKEN``, or ``HUGGINGFACE_HUB_TOKEN``).
When none of those is usable and ``huggingface_hub`` is installed, the
login saved by ``hf auth login`` is used. That token is sent only to
Hugging Face hosts. A Civitai token in this process environment is sent
only to Civitai hosts. Tokens are never written into status messages.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request

HF_TOKEN_NAMES = ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACE_HUB_TOKEN")
CIVITAI_TOKEN_NAMES = ("CIVITAI_API_TOKEN", "CIVITAI_TOKEN")
HF_PAGE_HOSTS = {"huggingface.co", "www.huggingface.co", "hf.co"}
CIVITAI_HOSTS = {"civitai.com", "www.civitai.com", "civitai.red", "www.civitai.red"}
USER_AGENT = "devil-nodes/workflow-helper"
PARTIAL_SUFFIX = ".devilpart"
# One socket operation, connect or read. The download itself is not capped.
HTTP_TIMEOUT_SECONDS = 300

_TOKEN_PLACEHOLDERS = {
    "hf_token",
    "hugging_face_hub_token",
    "huggingface_hub_token",
    "civitai_api_token",
    "civitai_token",
    "none",
    "null",
    "undefined",
    "changeme",
    "your_token",
    "token",
    "placeholder",
}

_PASTED_HF = re.compile(
    r"^(?:hf|huggingface-cli)\s+download\s+(hf://\S+)\s*$",
    re.IGNORECASE,
)
_PERCENT = re.compile(r"(\d+)%")
_SPEED = re.compile(r"([\d.]+\s*[KMGT]?i?B/s)", re.IGNORECASE)

# job id -> public status fields plus a few private bookkeeping keys
JOBS: dict[str, dict] = {}
_ROUTES_READY = False


class DestinationError(ValueError):
    """The folder or file name is not a safe model path."""


class SourceError(ValueError):
    """The URL is missing or uses a scheme we will not fetch."""


class DownloadError(RuntimeError):
    """The fetch ran and failed. The message is safe to show in the UI."""


def clean_token(value):
    """Drop quotes, a copied ``KEY=`` prefix, and a leading Bearer label."""
    token = (value or "").replace("\ufeff", "").strip()
    while len(token) >= 2 and token[0] == token[-1] and token[0] in "'\"":
        token = token[1:-1].strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if "=" in token:
        key, rest = token.split("=", 1)
        if key.strip() in HF_TOKEN_NAMES or key.strip() in CIVITAI_TOKEN_NAMES:
            token = clean_token(rest)
    return token


def token_usable(token):
    if not token or len(token) < 20 or any(ch.isspace() for ch in token):
        return False
    if token.lower() in _TOKEN_PLACEHOLDERS or token.startswith("${") or token.startswith("<"):
        return False
    return re.fullmatch(r"[A-Za-z0-9_\-]+", token) is not None


def scrub_secrets(message, secrets):
    text = str(message)
    for secret in secrets:
        if secret and len(secret) >= 8:
            text = text.replace(secret, "[redacted]")
    text = re.sub(r"(?i)(token|authorization|bearer)\s*[:=]\s*\S+", r"\1=[redacted]", text)
    return text[:500]


def _rank_token(token):
    if not token_usable(token):
        return 0
    if token.startswith("hf_"):
        return 2
    return 1


def _accept_hub_token(raw):
    """A token ``huggingface_hub`` already resolved, or empty.

    Saved logins can be opaque session strings, so this allows a few more
    characters than :func:`token_usable`. Placeholders are still rejected.
    """
    token = clean_token(raw or "")
    if token_usable(token):
        return token
    if not token or len(token) < 20 or any(ch.isspace() for ch in token):
        return ""
    if token.lower() in _TOKEN_PLACEHOLDERS or token.startswith("${") or token.startswith("<"):
        return ""
    if re.fullmatch(r"[A-Za-z0-9_\-.=+/]+", token) is None:
        return ""
    return token


def _process_env_token(names):
    """Best usable token among ``names`` in this process environment.

    Only those names are considered. Token files are not opened here.
    An earlier name wins when two values are equally good, and a value
    that starts with ``hf_`` beats one that does not.
    """
    order = {name: index for index, name in enumerate(names)}
    best = ""
    best_rank = 0
    best_index = len(names)
    for name, value in list(os.environ.items()):
        index = order.get(name)
        if index is None:
            continue
        token = clean_token(value or "")
        rank = _rank_token(token)
        if not rank:
            continue
        if rank > best_rank or (rank == best_rank and index < best_index):
            best = token
            best_rank = rank
            best_index = index
    return best


def _saved_hf_login():
    """Token stored by ``hf auth login``, when ``huggingface_hub`` is installed.

    A failure here returns no token. Public downloads still run, and
    ``hf_hub_download`` reports its own error if a gated file needs auth.
    """
    try:
        import huggingface_hub
    except ImportError:
        return ""
    getter = getattr(huggingface_hub, "get_token", None)
    if getter is None:
        folder = getattr(huggingface_hub, "HfFolder", None)
        getter = getattr(folder, "get_token", None) if folder is not None else None
    if not callable(getter):
        return ""
    try:
        raw = getter()
    except Exception:  # noqa: BLE001 - a broken login lookup must not block a public download
        return ""
    if not isinstance(raw, str):
        return ""
    return _accept_hub_token(raw)


def lookup_hf_token():
    """Token for Hugging Face hosts.

    Named variables in this process win, including the cleaning of a copied
    ``Bearer`` prefix or ``KEY=`` line. ``huggingface_hub`` does not read
    ``HUGGINGFACE_HUB_TOKEN`` and only strips whitespace, so that library is
    not the first source. When no named variable is usable, ``get_token``
    supplies the login saved by ``hf auth login``. An empty string means
    neither source had a usable token. The ``hf`` CLI can still see variables
    it inherits, and a public HTTPS download still runs.
    """
    found = _process_env_token(HF_TOKEN_NAMES)
    if found:
        return found
    return _saved_hf_login()


def lookup_civitai_token():
    """Token for Civitai hosts, from this process environment only."""
    return _process_env_token(CIVITAI_TOKEN_NAMES)


def request_headers(url, hf_token="", civitai_token=""):
    """Headers for one request. Auth is attached only to the matching host."""
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if hf_token and host in HF_PAGE_HOSTS:
        headers["Authorization"] = f"Bearer {hf_token}"
    elif civitai_token and host in CIVITAI_HOSTS:
        headers["Authorization"] = f"Bearer {civitai_token}"
    return headers


def describe_source(source):
    kind = source.get("kind")
    if kind == "hf":
        return "Hugging Face"
    if kind == "b2":
        return "B2"
    host = urllib.parse.urlparse(source.get("url") or "").hostname
    return host or "the host"


def classify_source(url):
    """Turn a row URL into ``http``, ``hf``, or ``b2``. Reject anything else."""
    text = (url or "").strip()
    if not text:
        raise SourceError("This row has no download URL.")
    if len(text) > 4000:
        raise SourceError("The download URL is too long.")
    if any(ch in text for ch in "\r\n\x00"):
        raise SourceError("The download URL contains a line break.")

    pasted = _PASTED_HF.match(text)
    if pasted:
        text = pasted.group(1)

    if text.startswith("hf://") or text.lower().startswith("hf:"):
        spec = _parse_hf_url(text)
        return {"kind": "hf", "url": text, "hf": spec}

    if text.startswith("b2://") or text.startswith("b2:"):
        remote = "b2:" + text.split(":", 1)[1].lstrip("/")
        if not remote[3:] or ".." in remote.split("/"):
            raise SourceError("The b2 link needs a bucket and a file.")
        return {"kind": "b2", "url": remote}

    parsed = urllib.parse.urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise SourceError("Use an http(s), hf://, or b2: link.")
    if parsed.username or parsed.password:
        # Credentials ride in the URL the author saved. They are not logged.
        pass
    web = _parse_hf_web(text)
    if web:
        return {"kind": "hf", "url": text, "hf": web}
    return {"kind": "http", "url": text}


def _parse_hf_url(url):
    raw = url[5:] if url.startswith("hf://") else url[3:]
    raw = raw.lstrip("/")
    parts = [part for part in raw.split("/") if part]
    if any(part in {".", ".."} for part in parts):
        raise SourceError("The Hugging Face link cannot contain '..'.")
    repo_type = "model"
    if parts and parts[0] in {"datasets", "dataset", "spaces", "space", "models", "model"}:
        prefix = parts.pop(0)
        repo_type = {"datasets": "dataset", "dataset": "dataset", "spaces": "space", "space": "space"}.get(prefix, "model")
    if len(parts) < 3:
        raise SourceError("The Hugging Face link needs org/repo/file.")
    file_path = "/".join(parts[2:])
    return {
        "repo_id": f"{parts[0]}/{parts[1]}",
        "repo_type": repo_type,
        "revision": None,
        "file_path": file_path,
    }


def _parse_hf_web(url):
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    if host not in HF_PAGE_HOSTS:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if any(part in {".", ".."} for part in parts):
        raise SourceError("The Hugging Face link cannot contain '..'.")
    repo_type = "model"
    if parts and parts[0] in {"datasets", "dataset", "spaces", "space"}:
        prefix = parts.pop(0)
        repo_type = "dataset" if prefix.startswith("dataset") else "space"
    if len(parts) < 5 or parts[2] not in {"resolve", "blob"}:
        return None
    file_path = urllib.parse.unquote("/".join(parts[4:]))
    if not file_path:
        return None
    return {
        "repo_id": f"{parts[0]}/{parts[1]}",
        "repo_type": repo_type,
        "revision": urllib.parse.unquote(parts[3]),
        "file_path": file_path,
    }


def relative_parts(filename):
    """Path pieces inside a model folder. ``..`` and absolute paths are rejected.

    A subfolder such as ``characters/model.safetensors`` is allowed because it
    still lives under the folder ComfyUI configured. Anything that would climb
    out of that folder is not.
    """
    text = (filename or "").strip().replace("\\", "/")
    if not text or text.startswith("/") or text.startswith("~"):
        raise DestinationError("The model row needs a file name inside its folder.")
    if len(text) > 240:
        raise DestinationError("The file name is too long.")
    parts = text.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise DestinationError("The file name cannot leave its model folder.")
    for part in parts:
        if any(ord(ch) < 32 for ch in part):
            raise DestinationError("The file name contains a control character.")
        if any(mark in part for mark in (":", "*", "?", '"', "<", ">", "|")):
            raise DestinationError("The file name contains a character this OS cannot store.")
        if len(part) > 180:
            raise DestinationError("The file name is too long.")
    return parts


def installed_model_folders():
    """``folder name -> [absolute roots]`` from this ComfyUI install."""
    try:
        import folder_paths
    except ImportError:
        return {}
    mapping = getattr(folder_paths, "folder_names_and_paths", {}) or {}
    found = {}
    for name, entry in mapping.items():
        if not isinstance(name, str) or not name or any(mark in name for mark in ("/", "\\", "..")):
            continue
        paths = entry[0] if isinstance(entry, (list, tuple)) and entry else entry
        if isinstance(paths, str):
            paths = [paths]
        if not isinstance(paths, (list, tuple)):
            continue
        roots = []
        for path in paths:
            if isinstance(path, str) and path:
                roots.append(os.path.realpath(path))
        if roots:
            found[name] = roots
    return found


def resolve_model_path(folder, filename, folders):
    """Absolute file path inside the first root configured for ``folder``."""
    folder_name = (folder or "").strip()
    if not folder_name or folder_name in {".", ".."}:
        raise DestinationError("Choose a model folder.")
    if any(mark in folder_name for mark in ("/", "\\", "\x00", "..")):
        raise DestinationError("The model folder must be one ComfyUI directory name.")
    roots = folders.get(folder_name) if isinstance(folders, dict) else None
    if not roots:
        raise DestinationError(f"'{folder_name}' is not a model folder on this ComfyUI.")
    root = os.path.realpath(roots[0])
    parts = relative_parts(filename)
    dest = os.path.realpath(os.path.join(root, *parts))
    if dest == root:
        raise DestinationError("That file name would leave the model folder.")
    try:
        inside = os.path.commonpath([root, dest]) == root
    except ValueError as exc:
        raise DestinationError("That file name would leave the model folder.") from exc
    if not inside:
        raise DestinationError("That file name would leave the model folder.")
    return dest


def _job_id(folder, filename):
    material = f"{folder}\n{filename}".encode("utf-8", errors="replace")
    return hashlib.sha256(material).hexdigest()[:20]


def _public_job(job):
    return {
        "id": job.get("id", ""),
        "status": job.get("status", "idle"),
        "percent": int(job.get("percent") or 0),
        "speed": job.get("speed") or "",
        "message": job.get("message") or "",
        "error": job.get("error") or "",
        "folder": job.get("folder") or "",
        "filename": job.get("filename") or "",
    }


def job_snapshot(job_id):
    job = JOBS.get(job_id or "")
    if not job:
        return {"status": "idle", "percent": 0, "message": "", "error": ""}
    return _public_job(job)


def _note(job, percent=None, message="", speed=""):
    if percent is not None:
        job["percent"] = max(0, min(99, int(percent)))
    if speed:
        job["speed"] = speed
    if message:
        job["message"] = message
    elif percent is not None:
        bits = [f"{job['percent']}%"]
        if job.get("speed"):
            bits.append(job["speed"])
        job["message"] = " · ".join(bits)


def _fail(job, message, secrets):
    text = scrub_secrets(message, secrets)
    job.update(status="error", error=text, message=text)
    print(f"[devil-nodes] download failed ({job.get('filename', '')}): {text}", flush=True)


def _finish(job, dest):
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        job.update(status="done", percent=100, message="Installed", error="", speed="")
        print(f"[devil-nodes] installed {job.get('folder')}/{job.get('filename')}", flush=True)
        return
    try:
        if os.path.isfile(dest):
            os.remove(dest)
    except OSError:
        pass
    _fail(job, "The download finished but the model file is missing.", job.get("secrets") or [])


def prepare_download(data, folders):
    """Validate a request body. Raises DestinationError or SourceError."""
    if not isinstance(data, dict):
        raise SourceError("Expected a JSON object.")
    source = classify_source(data.get("url") or data.get("source") or "")
    filename = "/".join(relative_parts(data.get("filename") or data.get("name") or ""))
    folder = (data.get("folder") or data.get("dir") or "").strip()
    dest = resolve_model_path(folder, filename, folders)
    return {
        "id": _job_id(folder, filename),
        "source": source,
        "folder": folder,
        "filename": filename,
        "dest": dest,
    }


def _secrets_for(hf_token, civitai_token, url):
    secrets = [item for item in (hf_token, civitai_token) if item]
    parsed = urllib.parse.urlparse(url or "")
    if parsed.password:
        secrets.append(urllib.parse.unquote(parsed.password))
    query = urllib.parse.parse_qs(parsed.query)
    for key in ("token", "access_token", "api_key"):
        for value in query.get(key, []):
            secrets.append(value)
    return secrets


class _Unredirected(urllib.request.HTTPErrorProcessor):
    """Return the response unchanged, including redirects and HTTP errors.

    The download loop follows redirects itself. That keeps a token on the
    host it belongs to, and it refuses a redirect whose scheme is not http
    or https before another request is opened.
    """

    def http_response(self, request, response):
        return response

    https_response = http_response


def _header(response, name):
    headers = getattr(response, "headers", None)
    if headers is not None and hasattr(headers, "get"):
        return headers.get(name)
    getter = getattr(response, "getheader", None)
    if getter is not None:
        return getter(name)
    return None


async def download_http(url, dest, job, hf_token="", civitai_token=""):
    """Fetch one http(s) URL. Proxy variables are honored by ``urllib``."""
    try:
        await asyncio.to_thread(_download_http_blocking, url, dest, job, hf_token, civitai_token)
    except asyncio.CancelledError:
        if job.get("status") == "downloading":
            _fail(job, "The download was cancelled.", job.get("secrets") or [])
        raise


def _download_http_blocking(url, dest, job, hf_token="", civitai_token=""):
    secrets = _secrets_for(hf_token, civitai_token, url)
    job["secrets"] = secrets
    partial = dest + PARTIAL_SUFFIX
    current = url
    try:
        for _hop in range(8):
            if urllib.parse.urlparse(current).scheme not in {"http", "https"}:
                raise DownloadError("The host redirected away from http.")
            headers = request_headers(current, hf_token, civitai_token)
            request = urllib.request.Request(current, headers=headers, method="GET")
            opener = urllib.request.build_opener(_Unredirected)
            try:
                response = opener.open(request, timeout=HTTP_TIMEOUT_SECONDS)
            except urllib.error.URLError as exc:
                raise DownloadError(f"Download failed: {exc.reason}") from exc
            try:
                status = getattr(response, "status", None)
                if status is None:
                    status = response.getcode()
                if status in {301, 302, 303, 307, 308}:
                    location = _header(response, "Location")
                    if not location:
                        raise DownloadError("The host redirected without a destination.")
                    nxt = urllib.parse.urljoin(getattr(response, "url", None) or current, location)
                    if urllib.parse.urlparse(nxt).scheme not in {"http", "https"}:
                        raise DownloadError("The host redirected away from http.")
                    current = nxt
                    continue
                if status == 401:
                    raise DownloadError("The host refused the download (401). A token may be required.")
                if status == 403:
                    raise DownloadError("The host refused the download (403).")
                if status == 404:
                    raise DownloadError("The file was not found (404).")
                if status >= 400 or status < 200:
                    raise DownloadError(f"The host returned HTTP {status}.")
                ctype = (_header(response, "Content-Type") or "").lower()
                if "text/html" in ctype:
                    raise DownloadError("The link returned a web page, not a model file.")
                try:
                    total = int(_header(response, "Content-Length") or 0)
                except (TypeError, ValueError):
                    total = 0
                if "application/json" in ctype and (total == 0 or total < 2_000_000):
                    peek = response.read(64)
                    if peek.lstrip().startswith((b"{", b"[")):
                        raise DownloadError("The host returned an error page instead of the file.")
                    _write_body(partial, response, job, total, prefix=peek)
                else:
                    _write_body(partial, response, job, total)
                break
            finally:
                response.close()
        else:
            raise DownloadError("The host redirected too many times.")
        os.replace(partial, dest)
        _finish(job, dest)
    except DownloadError as exc:
        _fail(job, str(exc), secrets)
    except Exception as exc:  # noqa: BLE001 - the UI needs the failure, not a traceback
        _fail(job, f"Download failed: {exc}", secrets)
    finally:
        if os.path.exists(partial) and job.get("status") != "downloading":
            try:
                os.remove(partial)
            except OSError:
                pass


def _write_body(partial, response, job, total, prefix=b""):
    os.makedirs(os.path.dirname(partial), exist_ok=True)
    written = 0
    last_tick = time.monotonic()
    last_bytes = 0
    with open(partial, "wb") as handle:
        if prefix:
            handle.write(prefix)
            written += len(prefix)
        while True:
            chunk = response.read(256 * 1024)
            if not chunk:
                break
            handle.write(chunk)
            written += len(chunk)
            now = time.monotonic()
            if now - last_tick >= 0.4:
                elapsed = now - last_tick
                speed = _format_rate((written - last_bytes) / elapsed) if elapsed > 0 else ""
                percent = int(written * 100 / total) if total else 0
                _note(job, percent=percent if total else None, speed=speed, message="" if total else f"Downloaded {_format_bytes(written)}")
                last_tick = now
                last_bytes = written
    if written <= 0:
        raise DownloadError("The host returned an empty file.")
    _note(job, percent=99, message="Writing file…")


def _format_rate(rate):
    if not rate or rate < 0:
        return ""
    return f"{_format_bytes(rate)}/s"


def _format_bytes(amount):
    value = float(amount)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            digits = 0 if unit == "B" or value >= 100 else 1
            return f"{value:.{digits}f} {unit}"
        value /= 1024
    return f"{value:.1f} TB"


def _hub_https_url(spec):
    revision = urllib.parse.quote(spec.get("revision") or "main", safe="")
    file_path = "/".join(urllib.parse.quote(part) for part in spec["file_path"].split("/"))
    repo = "/".join(urllib.parse.quote(part) for part in spec["repo_id"].split("/"))
    prefix = ""
    if spec.get("repo_type") == "dataset":
        prefix = "datasets/"
    elif spec.get("repo_type") == "space":
        prefix = "spaces/"
    return f"https://huggingface.co/{prefix}{repo}/resolve/{revision}/{file_path}"


def _make_meter(job):
    class HubMeter:
        def __init__(self, *args, **kwargs):
            self.total = kwargs.get("total") or 0
            self.n = 0

        def update(self, n=1):
            try:
                self.n += float(n or 0)
            except (TypeError, ValueError):
                return None
            if self.total:
                _note(job, percent=self.n * 100 / self.total)
            return None

        def close(self):
            return None

        def set_description(self, *args, **kwargs):
            return None

        def set_postfix(self, *args, **kwargs):
            return None

        def refresh(self, *args, **kwargs):
            return None

        def reset(self, total=None):
            self.n = 0
            if total:
                self.total = total

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.close()
            return False

    return HubMeter


def _hf_cli_path():
    """``hf`` when it is installed, otherwise ``huggingface-cli``."""
    for name in ("hf", "huggingface-cli"):
        found = shutil.which(name)
        if found:
            return found
    return ""


def _hf_cli_args(binary, spec, work):
    """Argv for one file. The token is never one of these arguments."""
    repo_type = spec.get("repo_type") or "model"
    args = [binary, "download", spec["repo_id"], spec["file_path"], "--local-dir", work]
    if os.path.basename(binary).lower().startswith("huggingface-cli"):
        args.extend(["--repo-type", repo_type])
    else:
        args.extend(["--type", repo_type if repo_type in {"dataset", "space"} else "model"])
    if spec.get("revision"):
        args.extend(["--revision", spec["revision"]])
    return args


def _place_download(saved, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.islink(saved):
        shutil.copyfile(saved, dest)
    else:
        shutil.move(saved, dest)


async def download_hf(spec, dest, job, hf_token=""):
    """Prefer ``huggingface_hub``, then the official CLI, then HTTPS.

    With no token argument, ``huggingface_hub`` and the CLI use the login
    saved by ``hf auth login``. HTTPS sends ``hf_token`` only to Hugging
    Face hosts.
    """
    secrets = [hf_token] if hf_token else []
    job["secrets"] = secrets
    _note(job, message="Downloading from Hugging Face…")
    try:
        await asyncio.to_thread(_hub_download_blocking, spec, dest, job, hf_token)
    except ImportError:
        cli = _hf_cli_path()
        if cli:
            await _download_hf_cli(cli, spec, dest, job, hf_token)
            return
        await download_http(_hub_https_url(spec), dest, job, hf_token=hf_token)
        return
    except DownloadError as exc:
        _fail(job, str(exc), secrets)
        return
    except Exception as exc:  # noqa: BLE001
        _fail(job, f"Hugging Face download failed: {exc}", secrets)
        return
    _finish(job, dest)


def _hub_download_blocking(spec, dest, job, token):
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        raise
    root = os.path.dirname(dest)
    work = os.path.join(root, f".devil-fetch-{job.get('id', 'hf')}")
    os.makedirs(work, exist_ok=True)
    try:
        kwargs = {
            "repo_id": spec["repo_id"],
            "filename": spec["file_path"],
            "repo_type": spec.get("repo_type") or "model",
            "local_dir": work,
            "tqdm_class": _make_meter(job),
        }
        # Omit token when this process has none. The library then uses the
        # login it already stored. An explicit token is passed as an argument,
        # not through a shell command.
        if token:
            kwargs["token"] = token
        if spec.get("revision"):
            kwargs["revision"] = spec["revision"]
        try:
            saved = hf_hub_download(**kwargs)
        except TypeError:
            kwargs.pop("tqdm_class", None)
            saved = hf_hub_download(**kwargs)
        if not saved or not os.path.isfile(saved):
            raise DownloadError("Hugging Face did not return a file.")
        _place_download(saved, dest)
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def _download_hf_cli(binary, spec, dest, job, hf_token):
    secrets = job.get("secrets") or ([hf_token] if hf_token else [])
    root = os.path.dirname(dest)
    work = os.path.join(root, f".devil-fetch-{job.get('id', 'hf')}")
    os.makedirs(work, exist_ok=True)
    cmd = _hf_cli_args(binary, spec, work)
    env = os.environ.copy()
    if hf_token:
        env["HF_TOKEN"] = hf_token
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
    except FileNotFoundError:
        shutil.rmtree(work, ignore_errors=True)
        await download_http(_hub_https_url(spec), dest, job, hf_token=hf_token)
        return
    tail = ""
    try:
        assert proc.stdout is not None
        while True:
            chunk = await proc.stdout.read(8192)
            if not chunk:
                break
            line = scrub_secrets(chunk.decode(errors="ignore").replace("\r", "\n").strip(), secrets)
            if line:
                tail = line[-180:]
                match = _PERCENT.search(line)
                if match:
                    _note(job, percent=int(match.group(1)), message=tail)
                else:
                    _note(job, message=tail)
        code = await proc.wait()
        if code != 0:
            detail = f" {tail}" if tail else ""
            _fail(job, f"Hugging Face CLI exited with code {code}.{detail}", secrets)
            return
        saved = os.path.join(work, *spec["file_path"].split("/"))
        if not os.path.isfile(saved):
            _fail(job, "Hugging Face CLI did not return a file.", secrets)
            return
        _place_download(saved, dest)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    if job.get("status") == "downloading":
        _finish(job, dest)


async def download_b2(url, dest, job):
    if shutil.which("rclone") is None:
        _fail(job, "rclone is not installed, so this b2: link cannot be fetched.", [])
        return
    _note(job, message="Downloading from B2…")
    cmd = [
        "rclone", "copyto", url, dest,
        "--multi-thread-streams", "8",
        "--multi-thread-cutoff", "64M",
        "--stats-one-line",
        "--stats", "1s",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except FileNotFoundError:
        _fail(job, "rclone is not installed, so this b2: link cannot be fetched.", [])
        return
    pending = ""
    assert proc.stdout is not None
    while True:
        chunk = await proc.stdout.read(8192)
        if not chunk:
            break
        text = pending + chunk.decode(errors="ignore").replace("\r", "\n")
        parts = text.split("\n")
        pending = parts.pop()
        for line in parts:
            _note_rclone(job, line)
    if pending.strip():
        _note_rclone(job, pending)
    code = await proc.wait()
    if code != 0:
        _fail(job, f"rclone exited with code {code}.", [])
        return
    _finish(job, dest)


def _note_rclone(job, line):
    match = _PERCENT.search(line)
    speed = _SPEED.search(line)
    if match:
        _note(job, percent=int(match.group(1)), speed=speed.group(1).strip() if speed else "")
    elif line.strip():
        _note(job, message=line.strip()[-180:])


async def run_spec(spec, job, hf_token="", civitai_token=""):
    dest = spec["dest"]
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    kind = spec["source"]["kind"]
    try:
        if kind == "hf":
            await download_hf(spec["source"]["hf"], dest, job, hf_token=hf_token)
        elif kind == "b2":
            await download_b2(spec["source"]["url"], dest, job)
        else:
            await download_http(spec["source"]["url"], dest, job, hf_token=hf_token, civitai_token=civitai_token)
    except Exception as exc:  # noqa: BLE001
        if job.get("status") == "downloading":
            _fail(job, f"Download failed: {exc}", job.get("secrets") or [])


def begin_download(spec, hf_token="", civitai_token=""):
    """Start a job or return the one already saving this file. Does not block."""
    dest = spec["dest"]
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        job = {
            "id": spec["id"],
            "status": "done",
            "percent": 100,
            "speed": "",
            "message": "Already installed",
            "error": "",
            "folder": spec["folder"],
            "filename": spec["filename"],
        }
        JOBS[spec["id"]] = job
        return _public_job(job)

    current = JOBS.get(spec["id"])
    if current and current.get("status") == "downloading":
        return _public_job(current)

    job = {
        "id": spec["id"],
        "status": "downloading",
        "percent": 0,
        "speed": "",
        "message": "Starting…",
        "error": "",
        "folder": spec["folder"],
        "filename": spec["filename"],
        "secrets": [],
    }
    JOBS[spec["id"]] = job
    asyncio.create_task(run_spec(spec, job, hf_token=hf_token, civitai_token=civitai_token))
    return _public_job(job)


def setup_routes():
    """Register the download routes on ComfyUI's server. Safe to call once."""
    global _ROUTES_READY
    if _ROUTES_READY:
        return
    from aiohttp import web
    from server import PromptServer

    server = PromptServer.instance
    if server is None:
        raise RuntimeError("ComfyUI's server is not ready")
    routes = server.routes

    async def start(request):
        try:
            data = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"error": "Expected a JSON body."}, status=400)
        try:
            spec = prepare_download(data, installed_model_folders())
        except (DestinationError, SourceError) as exc:
            return web.json_response({"error": str(exc)}, status=400)
        view = begin_download(spec, hf_token=lookup_hf_token(), civitai_token=lookup_civitai_token())
        return web.json_response(view)

    async def status(request):
        job_id = request.rel_url.query.get("id", "")
        return web.json_response(job_snapshot(job_id))

    # The frontend calls these with or without the /api prefix, depending
    # on the ComfyUI version. Register both so the button reaches the route.
    for prefix in ("", "/api"):
        routes.post(f"{prefix}/devil-nodes/helper/download")(start)
        routes.get(f"{prefix}/devil-nodes/helper/status")(status)

    _ROUTES_READY = True
    print("[devil-nodes] Workflow Helper downloads ready", flush=True)
