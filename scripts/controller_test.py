#!/usr/bin/env python3
"""Build and upload controllers using private Wi-Fi configuration."""

import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
HW = ROOT / "apps" / "kojo_HW"
sys.path.insert(0, str(HW / "scripts"))
from wifi_config import WifiConfigError, load_config


class CommandError(RuntimeError):
    pass


def config_path():
    return Path(os.environ.get(
        "KJ_WIFI_CONFIG_FILE", str(ROOT / ".env")
    )).expanduser().resolve()


def capture(args):
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=45)
    except FileNotFoundError:
        raise CommandError(f"{args[0]} が見つかりません。") from None
    except subprocess.TimeoutExpired:
        raise CommandError(f"{args[0]} の処理が時間内に終わりませんでした。接続状態を確認してください。") from None
    if result.returncode:
        raise CommandError(result.stderr.strip() or f"{args[0]} が失敗しました。")
    return result.stdout


def build_or_upload(operation, controller=1):
    config = load_config(config_path(), controller)
    pio = shlex.split(os.environ.get("PIO") or "pio")
    if not pio or not shutil.which(pio[0]):
        raise CommandError("PlatformIO CLI (pio) が見つかりません。インストールするか PIO を指定してください。")
    profile = "unity_controller"
    args = pio + ["run", "--project-dir", str(HW), "-e", profile]
    if operation == "upload":
        args += ["-t", "upload"]
        port = os.environ.get("PORT")
        if port:
            args += ["--upload-port", port]
        else:
            # Never let auto-detection choose between two connected ESPs.
            devices = json.loads(capture(pio + ["device", "list", "--json-output"]))
            ports = [device["port"] for device in devices
                     if "USB VID:PID=" in (device.get("hwid") or "")]
            if len(ports) != 1:
                raise CommandError("USB書き込み先を選べません。ESPを1台だけ接続するか PORT=/dev/cu.usbmodem... を指定してください。")
            args += ["--upload-port", ports[0]]
    print(f"コントローラ{controller} / SSID {config['ssid']} / {operation}", flush=True)
    child_env = dict(
        os.environ,
        KJ_WIFI_CONFIG_FILE=str(config_path()),
        KJ_WIFI_CONFIG_INDEX=str(controller),
    )
    result = subprocess.run(args, cwd=ROOT, env=child_env)
    if result.returncode:
        raise CommandError(f"PlatformIOが失敗しました（終了コード {result.returncode}）。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["build", "upload"])
    parser.add_argument("controller", nargs="?", type=int, choices=(1, 2, 3), default=1)
    args = parser.parse_args()
    try:
        build_or_upload(args.operation, args.controller)
    except (CommandError, WifiConfigError) as error:
        print(f"Controller: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
