#!/usr/bin/env python3
"""Debug a bare ESP over USB without synthesizing Unity acknowledgements."""
import argparse
import glob
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import termios
import time

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default=os.environ.get('PORT'))
    parser.add_argument('--upload', action='store_true', help='最初に対応ファームウェアを書き込む')
    parser.add_argument('--wifi', type=int, choices=(1, 2, 3), default=1)
    parser.add_argument('--seconds', type=float, default=0, help='監視時間。0はCtrl+Cまで')
    args = parser.parse_args()
    if args.seconds < 0:
        parser.error('--seconds は0以上にしてください')
    ports = sorted(glob.glob('/dev/cu.usbmodem*') + glob.glob('/dev/ttyACM*'))
    if not args.port and len(ports) != 1:
        parser.error('ESPを1台だけUSB接続するか --port で指定してください')
    port = args.port or ports[0]
    if args.upload:
        subprocess.run([sys.executable, str(ROOT / 'scripts/controller_test.py'),
                        'upload', str(args.wifi)], cwd=ROOT,
                       env=dict(os.environ, PORT=port), check=True)
        time.sleep(2)
    fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    original = termios.tcgetattr(fd)
    try:
        settings = termios.tcgetattr(fd)
        settings[0] = settings[1] = settings[3] = 0
        settings[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
        settings[4] = settings[5] = termios.B115200
        settings[6][termios.VMIN] = settings[6][termios.VTIME] = 0
        termios.tcsetattr(fd, termios.TCSANOW, settings)
        print(f'USB: {port}', flush=True)
        print('UnityでP1/P2の登録待ちを開き、p + Enterで登録開始。状態は毎秒表示。Ctrl+Cで終了。', flush=True)
        print('センサーなしでも通信確認可能。udpAckAgeMsが0〜1200未満なら直近のUnity UDP応答あり。', flush=True)
        buffer = b''
        started = time.monotonic()
        next_query = started
        watch_stdin = True
        warned_old = False
        while not args.seconds or time.monotonic() - started < args.seconds:
            if time.monotonic() >= next_query:
                os.write(fd, b'?')
                next_query = time.monotonic() + 1
            ready, _, _ = select.select([fd] + ([sys.stdin] if watch_stdin else []), [], [], .2)
            if watch_stdin and sys.stdin in ready:
                line = sys.stdin.readline()
                if not line:
                    watch_stdin = False
                elif line.strip().lower() == 'p':
                    os.write(fd, b'p')
                    print('登録開始を要求しました（登録先が更新されます）。', flush=True)
            if fd in ready:
                data = os.read(fd, 65536)
                if not data:
                    raise RuntimeError('ESPのUSB接続が切れました')
                buffer += data
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    match = re.search(rb'KJ_(?:STATUS|PAIR) [^\r]*', line)
                    if match:
                        text = match.group().decode('utf-8', 'replace')
                        print(text, flush=True)
                        if text.startswith('KJ_STATUS') and 'udpAckAgeMs=' not in text and not warned_old:
                            print('旧ファームウェアです。just controller-test --upload --wifi 番号 で更新してください。', flush=True)
                            warned_old = True
                buffer = buffer[-4096:]
    finally:
        termios.tcsetattr(fd, termios.TCSANOW, original)
        os.close(fd)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\n終了しました。')
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Controller debug: {error}', file=sys.stderr)
        sys.exit(1)
