#!/usr/bin/env python3
"""Flash this PC's two Wi-Fi controllers and show live controller traffic."""

import argparse
import colorsys
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
HW = ROOT / "apps" / "kojo_HW"
RUNTIME = Path.home() / ".kosen-chanbara"
CONFIG_PATH = ROOT / ".env"
MANIFEST_PATH = ROOT / ".controller-ap" / "event.json"
UPDATE_FLAG = RUNTIME / "firmware-update.flag"
PHONE_TRAFFIC_PATH = RUNTIME / "phone-traffic.json"
HARDWARE_TRAFFIC_PATH = RUNTIME / "controller-traffic.json"
DEVICE_SERIAL = re.compile(r"(?:^|\s)SER=([^\s]+)")


def firmware_inputs():
    paths = [Path("platformio.ini")]
    for directory in ("src", "include"):
        paths.extend(path.relative_to(HW) for path in (HW / directory).rglob("*")
                     if path.is_file())
    paths.extend(path.relative_to(HW) for path in (HW / "scripts").glob("*.py")
                 if path.is_file())
    return sorted(set(paths))


def load_wifi():
    sys.path.insert(0, str(HW / "scripts"))
    from wifi_config import load_config
    return load_config(Path(os.environ.get("KJ_WIFI_CONFIG_FILE", CONFIG_PATH)))


def host_ip():
    override = os.environ.get("KJ_CONTROLLER_HOST_IP")
    if override:
        return str(ipaddress.IPv4Address(override))
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(("1.1.1.1", 53))
        return probe.getsockname()[0]


def fresh_color():
    hue = secrets.randbelow(360) / 360.0
    rgb = colorsys.hsv_to_rgb(hue, .82, .24)
    return "#" + "".join(f"{round(channel * 255):02X}" for channel in rgb)


def manifest():
    try:
        data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"color": fresh_color(), "devices": {}}
    if not isinstance(data.get("color"), str) or not isinstance(data.get("devices"), dict):
        raise ValueError("保存済み event.json が不正です。内容を確認してください。")
    return data


def save_manifest(data):
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    MANIFEST_PATH.chmod(0o600)


def controllers(pio):
    result = subprocess.run([pio, "device", "list", "--json-output"], text=True,
                            capture_output=True, check=True)
    devices = json.loads(result.stdout)
    found = {}
    for device in devices:
        port = device.get("port", "")
        serial = DEVICE_SERIAL.search(device.get("hwid", ""))
        if serial and ("usbmodem" in port or "ttyACM" in port or "COM" in port):
            found[serial.group(1)] = port
    return dict(sorted(found.items()))


def fingerprint(wifi, target, color, slot):
    digest = hashlib.sha256()
    # Include content and relative names so code, build flags, generated-header
    # logic, and Wi-Fi config parsing changes all invalidate a prior upload.
    for relative in firmware_inputs():
        digest.update(relative.as_posix().encode("utf-8") + b"\0")
        digest.update((HW / relative).read_bytes())
        digest.update(b"\0")
    digest.update(json.dumps([wifi["ssid"], wifi["password"], target, color, slot],
                             ensure_ascii=False).encode("utf-8"))
    return digest.hexdigest()


def install(force=False):
    raise RuntimeError("PC別ファームウェアの書き込みは廃止しました。just controller を使ってください。登録仕様は docs/CONTROLLER_PAIRING.md を参照してください。")


def read_snapshot(path):
    try:
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        return snapshot if isinstance(snapshot, dict) else {}
    except (FileNotFoundError, ValueError, OSError):
        return {}


def packet_rates(snapshot, previous, slots, fields):
    timestamp = snapshot.get("time")
    try:
        timestamp = float(timestamp)
    except (TypeError, ValueError):
        timestamp = None
    rates = {}
    if timestamp is not None and previous is not None:
        elapsed = timestamp - previous[0]
        if elapsed > 0:
            for slot in slots:
                old = previous[1].get(slot, {})
                item = snapshot.get(slot, {})
                rates[slot] = {
                    field: max(0, int(item.get(field, 0)) - int(old.get(field, 0))) / elapsed
                    for field in fields
                }
    counts = {slot: {field: int(snapshot.get(slot, {}).get(field, 0)) for field in fields}
              for slot in slots}
    next_previous = (timestamp, snapshot) if timestamp is not None else previous
    return rates, counts, next_previous


def monitor():
    data = manifest()
    print(f"このPC: {data.get('host_ip', '未設定')} / コントローラLED {data['color']}")
    previous_phone = None
    previous_hardware = None
    while True:
        now = time.time()
        phone = read_snapshot(PHONE_TRAFFIC_PATH)
        if now - float(phone.get("time", 0) or 0) > 3:
            print("Unity: 受信待ち", flush=True)
        else:
            rates, counts, previous_phone = packet_rates(
                phone, previous_phone, ("p1", "p2"), ("packets",))
            parts = []
            for slot in ("p1", "p2"):
                item = phone.get(slot, {})
                age = item.get("age", -1)
                connected = bool(item.get("connected", False))
                state = "接続中" if connected else "待機中"
                rate = rates.get(slot, {}).get("packets")
                rate_text = f"{rate:.1f}/s" if rate is not None else "計測中"
                parts.append(f"{slot.upper()} {state} {counts[slot]['packets']} packets ({rate_text}) age={float(age):.2f}s")
            print(" | ".join(parts), flush=True)
        hardware = read_snapshot(HARDWARE_TRAFFIC_PATH)
        if now - float(hardware.get("time", 0) or 0) <= 3:
            rates, counts, previous_hardware = packet_rates(
                hardware, previous_hardware, ("p1", "p2"), ("udp", "usb"))
            parts = []
            for slot in ("p1", "p2"):
                item = hardware.get(slot, {})
                rate = rates.get(slot, {})
                rate_text = "計測中" if not rate else ", ".join(
                    f"{rate.get(field, 0):.1f} {field}/s" for field in ("udp", "usb"))
                parts.append(f"{slot.upper()} UDP {counts[slot]['udp']} USB {counts[slot]['usb']} ({rate_text}) age={float(item.get('age', -1)):.2f}s")
            print(f"ESP LED {data['color']} | " + " | ".join(parts), flush=True)
        else:
            print(f"ESP LED {data['color']} | Unity hardware stats: 受信待ち", flush=True)
        time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("setup", "traffic"))
    parser.add_argument("--force", action="store_true", help="既に設定されたESPも再書き込み")
    args = parser.parse_args()
    try:
        if args.command == "setup":
            install(args.force)
        else:
            monitor()
    except KeyboardInterrupt:
        return 130
    except (ValueError, OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"コントローラ: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
