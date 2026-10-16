#!/usr/bin/env python3
"""Build a Windows player, then package a one-click LAN controller launcher."""

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "apps" / "unity"
OUTPUT = Path.home() / "Downloads" / "unity"


def editor_path():
    version = (PROJECT / "ProjectSettings" / "ProjectVersion.txt").read_text().splitlines()[0].split(":", 1)[1].strip()
    override = os.environ.get("UNITY_EDITOR")
    candidates = [Path(override)] if override else [
        Path("/Applications/Unity/Hub/Editor") / version / "Unity.app/Contents/MacOS/Unity",
        Path.home() / "Unity/Hub/Editor" / version / "Editor/Unity",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError(f"Unity {version} was not found. Set UNITY_EDITOR to its executable path.")


def build_unity():
    editor = editor_path()
    if not shutil.which("rsync"):
        raise RuntimeError("rsync is required to synchronize the isolated Unity build project.")
    cache_root = Path.home() / "Library/Caches/KosenChanbara" if sys.platform == "darwin" else Path.home() / ".cache/KosenChanbara"
    project_id = hashlib.sha256(str(PROJECT).encode()).hexdigest()[:12]
    cache = cache_root / project_id
    cache.mkdir(parents=True, exist_ok=True)
    # The source Editor can remain open. Only this isolated copy is built.
    import fcntl
    with (cache / "build.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another build of this project is already running.") from None
        isolated = cache / "project"
        isolated.mkdir(exist_ok=True)
        library = isolated / "Library"
        if not library.exists() and (PROJECT / "Library").is_dir():
            print("Preparing isolated Unity build cache...", flush=True)
            # APFS clones are independent files; unlike hardlinks, Unity cannot
            # modify the source Editor's Library through this cache.
            cloned = False
            if sys.platform == "darwin":
                cloned = subprocess.run(["/bin/cp", "-cR", str(PROJECT / "Library"), str(library)]).returncode == 0
            if not cloned:
                if library.exists():
                    shutil.rmtree(library)
                shutil.copytree(PROJECT / "Library", library)
        for folder in ("Assets", "Packages", "ProjectSettings", "UserSettings"):
            source = PROJECT / folder
            if source.is_dir():
                subprocess.run(["rsync", "-a", "--delete", str(source) + "/", str(isolated / folder) + "/"], check=True)
        # Games discover the parent on the LAN. Never ship a developer's old
        # signaling key/configuration in StreamingAssets.
        for name in ("controller-connection.json", "controller-connection.json.meta"):
            (isolated / "Assets/StreamingAssets" / name).unlink(missing_ok=True)
        # These are the Editor's saved build/profile choices, not project code.
        for name in ("EditorUserBuildSettings.asset", "BuildProfileContext.asset", "BuildSettings.asset"):
            source = PROJECT / "Library" / name
            if source.is_file():
                shutil.copy2(source, library / name)
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        if OUTPUT.is_symlink():
            raise RuntimeError(f"Refusing to replace a symlink: {OUTPUT}")
        stage = Path(tempfile.mkdtemp(prefix=".unity-build-", dir=OUTPUT.parent))
        log = cache / "unity-build.log"
        try:
            game = stage / "Game" / "KosenChanbara.exe"
            game.parent.mkdir()
            env = dict(os.environ, KOSEN_BUILD_OUTPUT=str(game))
            command = [str(editor), "-batchmode", "-quit", "-projectPath", str(isolated),
                       "-buildTarget", "Win64", "-executeMethod", "FestivalWindowsBuild.Build", "-logFile", str(log)]
            print(f"Building Windows player. Log: {log}", flush=True)
            result = subprocess.run(command, env=env)
            if result.returncode or not game.is_file() or not (game.parent / "BuildInfo.json").is_file():
                tail = "\n".join(log.read_text(errors="replace").splitlines()[-50:]) if log.exists() else "No Unity log."
                raise RuntimeError(f"Unity build failed (exit {result.returncode}).\n{tail}\nFull log: {log}")
            previous = OUTPUT.with_name(".unity-previous-" + uuid.uuid4().hex)
            if OUTPUT.exists():
                OUTPUT.rename(previous)
            try:
                stage.rename(OUTPUT)
            except OSError:
                if previous.exists():
                    previous.rename(OUTPUT)
                raise
            if previous.exists():
                shutil.rmtree(previous)
            print(f"Windows player built: {OUTPUT / 'Game/KosenChanbara.exe'}", flush=True)
        finally:
            if stage.exists():
                shutil.rmtree(stage)


def package():
    game = OUTPUT / "Game/KosenChanbara.exe"
    if not game.is_file() or not (game.parent / "BuildInfo.json").is_file():
        raise RuntimeError("Run just unity-build before packaging.")
    support = OUTPUT / "Support"
    support.mkdir(exist_ok=True)
    source = (ROOT / "scripts/allow-controller-firewall.cmd").read_text()
    marker = "# POWERSHELL-BEGIN"
    if source.count(marker) != 1:
        raise RuntimeError("The controller firewall script section could not be identified.")
    powershell = source[source.index(marker):]
    (support / "StartGame.ps1").write_bytes(powershell.replace("\n", "\r\n").encode("utf-8"))
    launcher = "\n".join([
        "@echo off", "setlocal DisableDelayedExpansion",
        'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Support\\StartGame.ps1" -LaunchGame',
        "exit /b %errorlevel%", "",
    ])
    (OUTPUT / "ゲーム起動.cmd").write_bytes(launcher.replace("\n", "\r\n").encode("ascii"))
    print(f"USB-ready folder: {OUTPUT}\nCopy the entire unity folder to the Windows Desktop, then open ゲーム起動.cmd.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("unity", "package"))
    args = parser.parse_args()
    try:
        (build_unity if args.action == "unity" else package)()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Build error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
