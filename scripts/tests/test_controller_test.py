"""Boundary tests; USB flashing is mocked, never performed."""

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import controller_test as controller
from wifi_config import WifiConfigError, load_config, validate_config, write_header

CONFIG = {"ssid": "Kosen-Test", "password": "test-password"}


class WifiConfigTests(unittest.TestCase):
    def test_bad_or_missing_configuration_fails_without_disclosing_password(self):
        bad_configs = [None, {}, {**CONFIG, "ssid": "あ" * 11},
                       {**CONFIG, "ssid": "bad\nssid"}, {**CONFIG, "ssid": "\ud800"},
                       {**CONFIG, "password": "短い"}, {**CONFIG, "password": "x" * 64}]
        for config in bad_configs:
            with self.subTest(config=config), self.assertRaises(WifiConfigError) as caught:
                validate_config(config)
            self.assertNotIn(CONFIG["password"], str(caught.exception))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            with self.assertRaisesRegex(WifiConfigError, "Wi-Fi設定ファイルがありません"):
                load_config(path)
            path.write_text('broken "private-password"', encoding="utf-8")
            with self.assertRaises(WifiConfigError) as caught:
                load_config(path)
            self.assertNotIn("private-password", str(caught.exception))

    def test_generated_cpp_preserves_utf8_quotes_and_shell_characters(self):
        config = {"ssid": '実験"$`\\AP', "password": 'abc"\\$`;$(foo)123'}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            header = root / "kj_test_wifi.h"
            write_header(config, header)
            self.assertEqual(header.stat().st_mode & 0o777, 0o600)
            changed = header.stat().st_mtime_ns
            write_header(config, header)
            self.assertEqual(header.stat().st_mtime_ns, changed)
            source = '#include "kj_test_wifi.h"\n#include <cstring>\n#include <cassert>\nint main(){\n'
            for key, name in [("ssid", "WIFI_SSID"), ("password", "WIFI_PASS")]:
                values = ",".join(str(byte) for byte in config[key].encode("utf-8")) + ",0"
                source += f"const unsigned char {key}[] = {{{values}}};\n"
                source += f"assert(std::strlen({name}) == sizeof({key}) - 1);\n"
                source += f"assert(std::memcmp({name}, {key}, sizeof({key})) == 0);\n"
            source += "}\n"
            (root / "check.cpp").write_text(source)
            subprocess.run(["c++", "-std=c++11", "-Wall", "-Wextra", "-Werror",
                            str(root / "check.cpp"), "-o", str(root / "check")], check=True)
            subprocess.run([str(root / "check")], check=True)
            write_header(CONFIG, header)
            self.assertNotEqual(header.stat().st_mtime_ns, changed)

class UploadTests(unittest.TestCase):
    def setUp(self):
        self.patches = [patch.object(controller, "load_config", return_value=CONFIG),
                        patch.object(controller.shutil, "which", return_value="/mock/pio"),
                        patch.dict(os.environ, {"PIO": "pio", "PORT": ""}),
                        patch.object(controller.subprocess, "run", return_value=subprocess.CompletedProcess([], 0))]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_auto_upload_requires_one_usb_device(self):
        for devices in [[], [{"port": "bluetooth", "hwid": "n/a"}],
                        [{"port": "usb1", "hwid": "USB VID:PID=303A:1001"},
                         {"port": "usb2", "hwid": "USB VID:PID=303A:1001"}]]:
            with patch.object(controller, "capture", return_value=json.dumps(devices)):
                with self.assertRaisesRegex(controller.CommandError, "PORT="):
                    controller.build_or_upload("upload")
        controller.subprocess.run.assert_not_called()

    def test_explicit_port_reaches_shared_profile_without_password_arguments(self):
        with patch.dict(os.environ, {"PORT": "/dev/cu.mock"}), contextlib.redirect_stdout(io.StringIO()):
            controller.build_or_upload("upload")
        args = controller.subprocess.run.call_args.args[0]
        self.assertIn("unity_controller", args)
        self.assertEqual(args[-4:], ["-t", "upload", "--upload-port", "/dev/cu.mock"])
        self.assertNotIn(CONFIG["password"], " ".join(args))

    def test_build_only_does_not_select_usb_or_upload(self):
        with patch.object(controller, "capture") as capture, contextlib.redirect_stdout(io.StringIO()):
            controller.build_or_upload("build")
        capture.assert_not_called()
        args = controller.subprocess.run.call_args.args[0]
        self.assertIn("unity_controller", args)
        self.assertNotIn("upload", args)


if __name__ == "__main__":
    unittest.main()
