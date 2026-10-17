set dotenv-load
set quiet
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

default:
  just --list --list-submodules

[unix]
phone-start:
    cd apps/phone && UNITY_RUNTIME_CONFIG="$HOME/.kosen-chanbara/controller-connection.json" ./scripts/local-control.sh start

[unix]
phone-stop:
    cd apps/phone && ./scripts/local-control.sh stop

controller number="1":
    python3 scripts/controller_test.py upload {{number}}

score-server:
    node apps/score-server/src/index.mjs

# Windows player using the current saved Unity settings.
unity-build:
    python3 scripts/build_unity.py unity

# USB-ready folder, including the one-click Windows launcher.
build: unity-build
    python3 scripts/build_unity.py package


# Windows parent: network sharing, phone HTTPS/signaling and shared scores.
server:
    node scripts/server.mjs

[windows]
phone-start:
    node scripts/phone-server.mjs

[windows]
phone-stop:
    @echo 'Use Ctrl+C in the phone-start or server window.'

# Bare ESP: USB pairing command and live Wi-Fi/Unity acknowledgement status.
[unix]
controller-test *args:
    python3 scripts/controller_debug.py {{args}}
