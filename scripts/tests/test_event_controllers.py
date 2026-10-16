import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import event_controllers as event

INPUTS = (Path("platformio.ini"), Path("src/unity_controller.cpp"),
          Path("include/controller_axes.h"), Path("include/unity_protocol.h"),
          Path("scripts/event_config.py"), Path("scripts/wifi_config.py"))


class EventControllerTests(unittest.TestCase):
    def test_fingerprint_changes_when_firmware_input_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in INPUTS:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(relative.as_posix(), encoding="utf-8")
            with patch.object(event, "HW", root):
                first = event.fingerprint({"ssid": "venue", "password": "secret"},
                                          "192.0.2.10", "#123456", "p1")
                changed = root / INPUTS[1]
                changed.write_text("changed firmware", encoding="utf-8")
                second = event.fingerprint({"ssid": "venue", "password": "secret"},
                                           "192.0.2.10", "#123456", "p1")
        self.assertNotEqual(first, second)

    def test_legacy_pc_specific_upload_fails_before_platformio(self):
        with patch.object(event.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "just controller"):
                event.install()
        run.assert_not_called()

    def test_packet_rates_use_snapshot_elapsed_time(self):
        first = {"time": 100.0, "p1": {"packets": 20}, "p2": {"packets": 5}}
        _, _, previous = event.packet_rates(first, None, ("p1", "p2"), ("packets",))
        second = {"time": 102.5, "p1": {"packets": 45}, "p2": {"packets": 10}}
        rates, counts, _ = event.packet_rates(second, previous, ("p1", "p2"), ("packets",))
        self.assertEqual(rates["p1"]["packets"], 10.0)
        self.assertEqual(rates["p2"]["packets"], 2.0)
        self.assertEqual(counts["p1"]["packets"], 45)


if __name__ == "__main__":
    unittest.main()
