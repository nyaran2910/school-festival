# R8 5IE2 チャンバラゲーム

令和8年の文化祭出し物の総合管理レポジトリ

## 安定版（2026-10-17）

現在の安定版はタグ **`stable-2026-10-17`** です。ゲーム・実機・スマホ・スコアサーバーを含む、この時点の構成を固定しています。

安定版を取得する場合は次を実行します。

```sh
git clone --branch stable-2026-10-17 --recurse-submodules https://github.com/nyaran2910/school-festival.git
```

## アプリ

- `apps/kojo_HW/`: 古城作のハードウェア管理レポジトリ
- `apps/unity/`: 小林作のUnityゲーム本体
- `apps/phone/`: ハードウェア完成前にunityでテストプレイができるよう、スマホのセンサを用いてコントローラの動きを再現したやつ
- `apps/score-server/`: LAN内でシングルプレイの上位10件を共有するスコアAPIとSQLite保存

## 起動・停止と書き込み

ルートの `justfile` はスマホ操作用のターゲットを提供し、Makefileの `controller` は実機の書き込みに使います。

```sh
just phone-start  # スマホコントローラをローカル起動
just phone-stop   # スマホコントローラを停止
```

ESPへの書き込みは `make controller` です。

スマホサーバーにはNode.jsとnpmが必要です（Windows親機は24以上）。一時HTTPS URLの利用中はインターネット接続が必要です。UnityはLAN内のサーバーを自動探索します。Unity Hubで `apps/unity` を開き、Unity `6000.3.21f1` で `Assets/Scenes/BattleGround.unity` を再生し、Esc → コントローラ → P1/P2の登録画面からQRを読み取ります。

物理コントローラにはPlatformIO CLI（`pio`）が必要です。ルートの `.env` に `WIFI_SSID1` / `WIFI_PASS1` から `WIFI_SSID3` / `WIFI_PASS3` まで設定し、書き込むWi-Fiに合わせて `just controller 1`、`just controller 2`、`just controller 3` を実行します。ESPは1台だけ接続するか、複数台なら `PORT=/dev/cu.usbmodem... just controller 2` のようにポートを指定します。番号なしの `WIFI_SSID` / `WIFI_PASS` は1番として使えます。書き込み後、Esc → コントローラ → P1/P2を選び、ガード＋リセットを1秒間同時押しして登録します。PCとESPは選んだWi-Fiへ接続します。

ゲーム内でPCとP1/P2を登録する新しい運用、Escメニュー、スマホの軸調整は [コントローラ登録仕様](docs/CONTROLLER_PAIRING.md) を参照してください。UnityとESPを更新後、Esc → コントローラ → P1/P2から登録します。実機はガード＋リセットを1秒間同時押し、スマホはQRを読み取り、軸の組み合わせと各軸の正転・反転を選びます。

通信のパケットサイズ・送信頻度・帯域・Wi-Fi探索は [コントローラ通信](docs/CONTROLLER_COMMUNICATION.md)、接続手順は [セットアップ手順](docs/UNITY_PHONE_CONTROLLER_SETUP.md) を参照してください。

ゲームはタイトルから始まり、シングルプレイ／デュエル／フリーモード、キャラと色、ステージの順に選択します。シングルはキャラ選択前にイージー／ノーマルを選びます。対戦・フリーはメニューで画面分割／1画面を切り替えられ、全画面でP1/P2の入力元（リモコン・スマホ・未接続）を確認できます。剣を上下左右へ振って移動し、ガードでキャラ・色を選んで決定します。マウスでも選択できます。デュエルは3本先取（引き分けは両方に1本）、シングルプレイは3つのハートで100人に挑戦します。イージーでは敵の出現間隔と攻撃準備を1.5倍、剣を振る時間を1.35倍にします。フリーモードは時間・得点・敵なしで2人の剣とガードを確認できます。10人を倒すたび次の地点へ自動で歩き、全10区間を進みます。

全画面でEscまたはリセットの0.5秒長押しが接続ポーズです。Yのデバッグ画面は削除しました。リセットの短押しはメニューを含む全画面で向きを合わせます。前の画面へは「もどる」を選んでガードで決定します。キャラ選択では最下段で左に振ると「もどる」、右に振ると「プレビュー」を選べます。両方のコントローラで共通メニューとシングルのキャラを操作できます。デュエルのキャラ選択と対戦ではそれぞれのプレイヤーを操作します。スマホ接続中はスマホ、未接続ならリモコンを自動で使います。キーボードはいつでも併用でき、P1はWASD＋左Shift、P2は矢印キー＋右Shiftを使います。

センサー・ボタンなしのESP単体で通信を確認する場合、Macで `just controller-test` を実行します。初回は `just controller-test --upload --wifi 3` のように `.env` のWi-Fi番号を指定して対応ファームウェアを書き込みます（現在のTP-Link_F4B4は3番）。WindowsのUnityでEsc → コントローラ → P1/P2の登録待ちを開き、Macのテスト画面で `p` + Enterを入力すると登録を開始します。登録先はESPに保存されます。毎秒表示する `paired=1` は登録済み、`udpAckAgeMs` が0以上1200未満なら直近にUnityがUDP入力を受理して応答しています。`-1` は起動後まだUDP応答なしです。ESP単体では `imu=none` が正常で、姿勢操作は確認できません。終了はCtrl+C。ポート指定は `--port /dev/cu.usbmodem101`、時間指定は `--seconds 10` です。Python標準ライブラリのみを使い、Mac/Linuxで動作します。

自作ESPリモコンは同じWi-FiのPCと直接通信でき、受信機は不要です。今後のファームウェア書き込みはESPをUSB接続して行い、ゲーム中の通信にはWi-Fi UDPを使います。ビルド・USB書き込み・接続方法は [`apps/kojo_HW/docs/PROTOCOL.md`](apps/kojo_HW/docs/PROTOCOL.md) を参照してください。

## 親機でまとめて起動（Windows／Mac）

学校Wi-Fiへ接続し、AP／ブリッジモード（DHCPオフ）のルータへ有線接続したWindows親機で `just server` を実行します。Git・Node.js 24以上・justを用意し、`git clone --recurse-submodules` で取得してください。Windowsの共有設定、LAN通信許可、phoneの依存導入とビルド、HTTPSトンネル、phone-server、score-serverをまとめて起動します。初回のWindowsの管理者確認は許可してください。

ゲームPC4台は `just build` の配布フォルダーを配置し、同じルータへ接続して「ゲーム起動.cmd」を実行します。phoneはUDP42045、scoreはUDP42044で自動探索するため、IP・キーの入力は不要です。親機でゲームを起動する必要はありません。

Macでも `just server` を使えます。Wi-Fiをsiriusなどのテザリング、有線LANをルーター側につなぎ、初回はmacOSの「一般 → 共有 → インターネット共有」でWi-Fiから有線LANへの共有をオンにしてください。Macの共有設定は自動変更せず、起動時に有線LANのIPを検出します。

ルータのAP化、学校Wi-Fiの接続・ログインは手動です。詳しくは [当日の親機・ゲームPCの手順](docs/EVENT_SERVER_SETUP.md) を参照してください。

## Windowsのコントローラ通信許可

ゲームを起動した状態で、`scripts/allow-controller-firewall.cmd` をダブルクリックし、Windowsの管理者権限の確認で「はい」を選びます。設定処理もcmd内に含まれているため、この1ファイルだけで実行できます。

起動中のKosenChanbara.exeのフルパスを取得し、そのexeへのLAN内からのUDP受信を許可します。実機のUDP42042、自動探索の応答、スマホのWebRTCの動的ポートを含みます。プライベート・パブリック両方に適用し、既存の同名ルールは更新するので繰り返しても増えません。PIDが変わっても再設定は不要ですが、exeを移動・改名した場合は再実行してください。異なる場所のゲームが複数起動している場合は、対象を特定できないため他のゲームを閉じて再実行します。

## 当日配布用のWindowsビルド

```sh
just unity-build  # 現在保存されているUnity設定からWindows x64版をビルド
just build        # unity-buildを実行し、通信許可とゲーム起動をまとめた配布物を作成
```

出力は `~/Downloads/unity/` です。Unity Editorの有効なシーン・PlayerSettings・保存済みビルドオプションを使い、Windows x64 Playerを生成します。Editorで未保存の変更は保存してから実行してください。Editorを開いたまま実行できるよう、ビルドはキャッシュ内の独立したプロジェクトコピーで行います。`UNITY_EDITOR` でEditor実行ファイルの場所を指定することもできます。

`just build` 後は次の構成になります。

```text
unity/
  ゲーム起動.cmd
  Support/StartGame.ps1
  Game/KosenChanbara.exe
  Game/…Unityの実行に必要なファイル一式
```

1. `unity` フォルダーごとUSBメモリーへコピーします。
2. WindowsのDesktopへ `unity` フォルダーごとコピーします。
3. `unity/ゲーム起動.cmd` をダブルクリックします。
4. 初回またはexeの配置場所が変わった場合、Windowsの管理者権限の確認で「はい」を選びます。通信許可の完了後、ゲームが自動で起動します。同じ場所で次回起動するときは既存の設定を確認して起動します。

ゲームは通常のユーザーで起動し、通信許可だけを管理者権限で設定します。起動用ファイルは実行時の配置場所からexeのパスを求めるため、MacやUSB内のパスは固定しません。重複起動は抑え、別の場所のゲームが動作中なら終了を案内します。Windowsの以前の許可画面でキャンセルして作成された、このexeの受信UDPブロック規則は無効化します。組織の管理ポリシーで禁止されている設定は変更できません。

各PCとコントローラを同じWi-Fiへ接続し、初回はゲーム内でP1/P2の実機登録を行います。スマホサーバー・共有ランキングサーバーは従来どおりLAN内で別途起動します。Windows側にPython・Node.js・Unity Editor・Git Bashを入れる必要はありません。

## 共有ランキング

Node.js 24以上を入れたLAN内のPCのうち1台で `just score-server` を実行します。各UnityはUDP42044でサーバーを自動検出するため、IP固定や接続先の入力は不要です。接続が切れたら再探索します。サーバー側でTCP3080とUDP42044のLAN通信を許可してください。

シングルのキャラ選択は左側に選択UI、右側に選択した難易度の上位10件を表示します。死亡後または100人クリア後、10位以内へ入る記録なら名前を入力して登録できます。同点は先着順です。数字キーによる区間移動を使ったプレイは登録対象外です。

Docker起動、接続設定、データ保存先とAPIは [スコアサーバーの手順](apps/score-server/README.md) を参照してください。
