"""Install the pinned companion workflow into Codex, without overwriting edits."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

COMMIT = "7ed5f72c350236c08a55738a0495c4395942b855"
REPO = "https://github.com/chengyingzh433-stack/cyz-edu-research"
FILES = [
    ("cyz-edu-research-0.3.0.zip", REPO + "/releases/download/0.3.0/cyz-edu-research-0.3.0.zip", "a87e7c2a40779529d37c241af06b544d1409fda856b7220f9b82f1a5632294cc"),
    ("install_skill.py", f"https://raw.githubusercontent.com/chengyingzh433-stack/cyz-edu-research/{COMMIT}/scripts/install_skill.py", "12a937a37c5e9298d3659a3ef3fd2e61873f3a711262dafe7e710c0e17145419"),
    ("verify_release.py", f"https://raw.githubusercontent.com/chengyingzh433-stack/cyz-edu-research/{COMMIT}/scripts/verify_release.py", "ed62c31665ec11e7932921817eb472ab3f76b1d0e271f0a2c04b79942985c10b"),
]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex-home", type=Path, default=Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex"))
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    cache = args.cache or Path(tempfile.mkdtemp(prefix="cyz-workflow-setup-"))
    cache.mkdir(parents=True, exist_ok=True)
    for name, url, expected in FILES:
        target = cache / name
        if not target.exists():
            if args.offline:
                raise ValueError("OFFLINE_FILE_MISSING: " + name)
            request = urllib.request.Request(url, headers={"User-Agent": "CYZ-workbench-setup"})
            with urllib.request.urlopen(request, timeout=90) as response:
                content = response.read(25_000_001)
            if len(content) > 25_000_000:
                raise ValueError("DOWNLOAD_TOO_LARGE")
            if hashlib.sha256(content).hexdigest() != expected:
                raise ValueError("HASH_MISMATCH: " + name)
            with target.open("xb") as handle:
                handle.write(content)
        if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
            raise ValueError("HASH_MISMATCH: " + name)
    skill_root = args.codex_home.resolve() / "skills"
    destination = skill_root / "cyz-edu-research"
    archive = cache / FILES[0][0]
    if destination.exists():
        with zipfile.ZipFile(archive) as bundle:
            for item in bundle.infolist():
                if item.is_dir():
                    continue
                relative = Path(item.filename).relative_to("cyz-edu-research")
                current = destination / relative
                if not current.is_file() or current.read_bytes() != bundle.read(item):
                    raise ValueError("WORKFLOW_LOCAL_CONFLICT: existing skill preserved; " + str(relative))
        status = "already_verified"
    else:
        result = subprocess.run([sys.executable, str(cache / "install_skill.py"), "install", "--archive", str(archive), "--skill-root", str(skill_root)], capture_output=True, text=True, encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
        if result.returncode:
            raise ValueError("WORKFLOW_INSTALL_FAILED: " + result.stdout + result.stderr)
        status = "installed"
    print(json.dumps({"workflow": status, "version": "0.3.0", "destination": str(destination), "cache": str(cache), "codexDiscovery": "checked by workbench before every research turn", "dependenciesPresentOnly": {name: (skill_root / name / "SKILL.md").is_file() for name in ["humanizer", "humanizer-zh", "mineru"]}}, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
