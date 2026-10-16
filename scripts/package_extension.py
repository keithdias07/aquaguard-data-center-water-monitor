"""Build a reproducible ZIP of the AquaGuard Chrome extension.

Usage (from the repository root):

    python scripts/package_extension.py            # writes dist/aquaguard-prompt-optimizer-<version>.zip
    python scripts/package_extension.py --check    # also verify the ZIP contents

Only the files Chrome needs are included: manifest.json and the src/, popup/,
options/, ui/ and icons/ folders. Tests, evaluation data, node_modules and
build tools are left out. Entries are sorted and given a fixed timestamp, so
building the same source twice gives a byte-identical ZIP.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_DIR = REPO_ROOT / "extension"
DIST_DIR = REPO_ROOT / "dist"

INCLUDE_DIRS = ("src", "popup", "options", "ui", "icons")
INCLUDE_FILES = ("manifest.json",)
ALLOWED_SUFFIXES = {".js", ".html", ".css", ".png", ".json"}
FIXED_DATE = (2026, 1, 1, 0, 0, 0)  # deterministic timestamps


def collect_files() -> list[Path]:
    files = [EXTENSION_DIR / name for name in INCLUDE_FILES]
    for folder in INCLUDE_DIRS:
        for path in sorted((EXTENSION_DIR / folder).rglob("*")):
            if path.is_file() and path.suffix in ALLOWED_SUFFIXES:
                files.append(path)
    return sorted(files, key=lambda p: p.relative_to(EXTENSION_DIR).as_posix())


def check_manifest_references(manifest: dict, names: set[str]) -> list[str]:
    """Every file the manifest points to must be inside the ZIP."""
    referenced = set(manifest["content_scripts"][0]["js"])
    referenced.add(manifest["background"]["service_worker"])
    referenced.add(manifest["action"]["default_popup"])
    referenced.add(manifest["options_ui"]["page"])
    referenced.update(manifest["icons"].values())
    referenced.update(manifest["action"]["default_icon"].values())
    return sorted(ref for ref in referenced if ref not in names)


def build() -> Path:
    manifest = json.loads((EXTENSION_DIR / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    DIST_DIR.mkdir(exist_ok=True)
    out = DIST_DIR / f"aquaguard-prompt-optimizer-{version}.zip"

    files = collect_files()
    names = {f.relative_to(EXTENSION_DIR).as_posix() for f in files}
    missing = check_manifest_references(manifest, names)
    if missing:
        raise SystemExit(f"manifest.json references files that are not packaged: {missing}")

    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(EXTENSION_DIR).as_posix(), date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, path.read_bytes())
    return out


def verify(zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        manifest = json.loads(zf.read("manifest.json"))
    forbidden = [n for n in names if n.startswith(("tests/", "eval/", "node_modules/", "assets/")) or n.endswith((".py", ".md", ".map"))]
    if forbidden:
        raise SystemExit(f"ZIP contains files that should not ship: {forbidden}")
    if any("127.0.0.1" in m or "localhost" in m for m in manifest["content_scripts"][0]["matches"]):
        raise SystemExit("ZIP manifest matches localhost: this looks like a test build.")
    missing = check_manifest_references(manifest, set(names))
    if missing:
        raise SystemExit(f"ZIP is missing manifest files: {missing}")
    print(f"  verified {len(names)} files; manifest v{manifest['version']}; permissions {manifest['permissions']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="verify the ZIP after building")
    args = parser.parse_args()
    out = build()
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"Built {out.relative_to(REPO_ROOT)} ({out.stat().st_size / 1024:.1f} KB)")
    print(f"  sha256 {digest}")
    if args.check:
        verify(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
