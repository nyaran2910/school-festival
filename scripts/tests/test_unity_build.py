import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("build_unity", Path(__file__).parents[1] / "build_unity.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class UnityDistributionTests(unittest.TestCase):
    def test_failed_build_keeps_previous_distribution_and_success_replaces_it(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            project = root / "project"
            for name in ("Assets", "Packages", "ProjectSettings"):
                (project / name).mkdir(parents=True)
            output = root / "Downloads/unity"
            output.mkdir(parents=True)
            (output / "previous.txt").write_text("working distribution")
            editor = root / "fake-editor"
            program = (
                f"#!{sys.executable}\n"
                "import os, pathlib, sys\n"
                "game = pathlib.Path(os.environ['KOSEN_BUILD_OUTPUT'])\n"
                "game.write_bytes(b'new player')\n"
            )
            editor.write_text(program + "sys.exit(1)\n")
            editor.chmod(0o755)
            with patch.object(build, "PROJECT", project), patch.object(build, "OUTPUT", output), \
                    patch.object(build, "editor_path", return_value=editor), \
                    patch.object(Path, "home", return_value=root / "home"), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, "Unity build failed"):
                    build.build_unity()
                self.assertEqual((output / "previous.txt").read_text(), "working distribution")
                self.assertEqual(list(output.parent.glob(".unity-build-*")), [])
                editor.write_text(program + "(game.parent / 'BuildInfo.json').write_text('{}')\n")
                build.build_unity()
                self.assertEqual((output / "Game/KosenChanbara.exe").read_bytes(), b"new player")
                self.assertFalse((output / "previous.txt").exists())
                self.assertEqual(list(output.parent.glob(".unity-previous-*")), [])

    def test_packaging_is_relocatable_and_contains_the_shared_firewall_logic(self):
        with tempfile.TemporaryDirectory(prefix="Game O'Brien ") as folder:
            output = Path(folder) / "Desktop/unity"
            game = output / "Game"
            game.mkdir(parents=True)
            (game / "KosenChanbara.exe").write_bytes(b"player")
            (game / "BuildInfo.json").write_text("{}")
            with patch.object(build, "OUTPUT", output), contextlib.redirect_stdout(io.StringIO()):
                build.package()
            launcher = (output / "ゲーム起動.cmd").read_bytes()
            self.assertIn(b'%~dp0Support\\StartGame.ps1', launcher)
            self.assertIn(b'-LaunchGame', launcher)
            self.assertNotIn(str(build.ROOT).encode(), launcher)
            self.assertIn(b'\r\n', launcher)
            source = (build.ROOT / "scripts/allow-controller-firewall.cmd").read_text()
            self.assertEqual((output / "Support/StartGame.ps1").read_text(),
                             source[source.index("# POWERSHELL-BEGIN"):])


if __name__ == "__main__":
    unittest.main()
