# 当日の親機とゲームPC

親機1台でphoneサーバー・一時HTTPSトンネル・score-serverを起動し、学校Wi-Fiを有線LANへ共有します。ゲームPC4台とスマホは既存ルータのLANへ接続します。親機ではゲームの起動は不要です。


## Macを親機にする場合

`just server-start` はmacOSでもphone・HTTPSトンネル・score-serverをまとめて起動します。Node.js 24以上とjustを用意してください。

1. MacのWi-Fiを上流のテザリング（sirius）へ接続します。
2. USB有線LANアダプターをMacへ接続し、ルーターのLANポートへつなぎます。アダプターがmacOSのネットワーク設定に現れることを確認します。AX88179など別途ドライバーが必要な機器は先に導入します。
3. ルーターをAP／ブリッジモード、DHCPオフにします。
4. macOSの「システム設定 → 一般 → 共有 → インターネット共有」で、共有元をWi-Fi、共有先を接続した有線LANにしてオンにします。macOSがLAN側のIP配布とインターネット共有を担当します。この初回設定は`just server-start`では変更しません。
5. 他のPC・スマホ・実機コントローラをルーター側へ接続し、Macで`just server-start`を実行します。実機はルーターのSSIDを書き込んで使います。

起動時に有線LANのIPv4を選び、phoneの探索応答に使います。共有用のbridgeインターフェースにも対応します。有線が未接続・IP未取得、候補が複数、上流とLANのIP帯が重複している場合は停止して理由を表示します。複数アダプターがある場合は`KOSEN_WIFI_ADAPTER=en0 KOSEN_LAN_ADAPTER=en7 just server-start`のようにデバイス名で指定できます。

Macのネットワークサービス順序はWi-Fiを有線LANより上にします。上流への通信はテザリング、有線側はゲーム用LANとして使います。共有のオン／オフやLANアドレスの変更後は`just server-start`を起動し直してください。他のPCもIPを取得し直すためルーターへ再接続します。

macOSがNode.jsの受信通信やローカルネットワークの許可を求めた場合は許可してください。Ctrl+Cでサーバーとトンネルを停止し、インターネット共有の設定は残します。ルーターが独自にDHCPを提供する既存LANでもサーバーは起動できますが、他のPCのインターネット接続をMac経由にするには上記の共有構成を使います。

テザリングのDNSが新しいtrycloudflare.comのURLを名前解決できず、HTTPS起動がタイムアウトする場合があります。公開DNSでは解決できることを確認したうえで、MacのWi-FiのDNSを1.1.1.1／1.0.0.1へ変更します。自動取得へ戻す場合は`networksetup -setdnsservers Wi-Fi Empty`を実行します。

Appleの手順: https://support.apple.com/guide/mac-help/mchlp1540/mac

## Windowsで一度だけ準備すること

1. 既存ルータを **AP／ブリッジモード** にします。ルータ側のDHCPサーバーはオフにします。親機はLANポートへ接続します。APモード時のポートの用途は機種の説明書を確認してください。Windowsから機種不明のルータの設定は変更できません。
2. 親機にGit、**Node.js 24以上（npm付属）**、**just**を導入します。Unity・Python・tmux・WSLは不要です。
3. PowerShellでリポジトリをサブモジュール込みで取得します。

```powershell
git clone --recurse-submodules https://github.com/nyaran2910/school-festival.git
cd school-festival
```

既に取得した場合は `git submodule update --init --recursive` で必要なアプリを揃えます。

## 親機で毎回行うこと

1. Wi-Fiを学校Wi-Fiへ接続し、学校のログイン画面があればログインします。
2. 有線LANをAPモードのルータへ接続します。
3. リポジトリのフォルダーで実行します。

```powershell
just server-start
```

初回やアダプタ・Node.jsの場所が変わったときにはWindowsの管理者確認を許可します。自動で以下を行います。

- 接続中の物理Wi-Fiと有線アダプタを検出。
- WindowsのInternet Connection Sharing（ICS）をWi-Fi→有線へ設定。親機がLANのDHCP・DNS・インターネットへの出口を担当。
- Node.jsのTCP8080・3080、UDP42045・42044の受信を、有線LANインターフェースかつLocalSubnetに限定して許可。
- phoneのnpm依存を初回／lockfile変更時に導入し、TypeScriptをビルド。
- 一時HTTPSトンネル、phoneサーバー、自動探索、score-serverを起動。

`Phone server ready` が出るまで待ちます。学校のネットワークでトンネル通信が遮断されている場合はエラーで停止します。アプリ側では学校の接続制限やログインを解除できません。

HTTPSトンネルは、`CLOUDFLARED_PATH` の指定、PATH上のインストール済みcloudflared（MacではHomebrewの標準パスも検索）、Wranglerの保存済みcloudflaredの順に利用します。保存済みはバージョンが新しく、`--version` が正常に動くものを選びます。ローカルの実行ファイルがあれば更新サービスへの問い合わせを省略するため、`Failed to determine the latest cloudflared version` を回避できます。見つからない初回はWranglerがダウンロードします。Macでは先に `brew install cloudflared` で導入することもできます。トンネル自体にはインターネット接続が必要です。

起動したPowerShellを開いたままにします。Ctrl+Cで全サーバーを停止します。共有設定とファイアウォール設定は次回のために残ります。scoreのDBは `apps/score-server/data/scores.sqlite` に保存されます。

ICS変更前の有線設定は `.server/network.json.before.json` に記録します。共有を戻す場合はWindowsの「ネットワーク接続」で学校Wi-Fiのプロパティ→共有から無効にし、必要なら記録を見て元の有線設定へ戻します。

Wi-Fiや有線が複数あって選べない場合は、PowerShellで名前を指定します。自動で別のネットワークを推測して変更しません。

```powershell
Get-NetAdapter -Physical
$env:KOSEN_WIFI_ADAPTER = 'Wi-Fi'
$env:KOSEN_LAN_ADAPTER = 'Ethernet'
just server-start
```

学校Wi-FiとICSのLANのIP帯が重なる場合や、学校の管理ポリシーで共有が禁止される場合は自動設定できません。ICSは通常192.168.137.0/24を使いますが、ゲーム側でこのIPを固定しているわけではありません。

## ゲーム用Windows PC4台

1. 更新した `just build` の出力 `~/Downloads/unity/` を、フォルダーごと各PCのDesktopへ配置します。
2. 既存ルータのWi-FiまたはLANポートへ接続します。IPアドレス・DNSは自動取得のままにします。設定変更前から接続していた端末はWi-Fiへ接続し直します。
3. **「ゲーム起動.cmd」**をダブルクリックします。初回の通信許可で管理者確認を許可します。`Game/KosenChanbara.exe` の直接起動では初回の通信許可を設定できません。
4. スマホも同じルータのWi-Fiへ接続し、ゲームのEsc→コントローラ→P1/P2のQRから登録します。

各ゲームはUDP42045でphone、UDP42044でscoreを自動探索します。親機のIP、phoneのキー、HTTPS URLを配布し直す必要はありません。親機を後から起動しても再探索します。phoneのキーは起動ごとに生成し、信頼するLAN内の探索要求にだけ配布します。HTTPS経由でキーを取得するAPIはありません。LAN上の端末を信頼する方式です。

phoneの接続先ファイル・環境変数は使用しません。古い配布物では自動探索できないため、今回の変更を含むビルドで4台を揃えてください。各Unityには別セッションとP1/P2のQRが割り当てられ、スマホのセンサーデータは各ゲームPCへWebRTCで直接届きます。

ゲームのファイアウォール許可は、そのexeに対するLAN内UDPです。実機のUDP42042だけでなく、探索応答とWebRTCの動的UDPポートも通します。ファイアウォール全体は無効にしません。

## 動かない場合

- ゲームPC・スマホが親機の有線側と同じLANにいること、ルータのゲストWi-Fiや端末間通信制限が無効であることを確認。
- スマホで一般のHTTPSサイトを開けない場合は、APモード・DHCPオフ・学校Wi-Fiのログインを確認。
- 別PCから `http://親機の有線IP:3080/health` と `http://親機の有線IP:8080/healthz` を確認。前者はJSON、後者はokを返す。
- HTTPだけ通って自動探索しない場合はUDPの遮断、ゲームの通信許可、APの端末間通信制限を確認。
- 親機は1台だけ起動。異なる親機が複数応答した場合は接続先を勝手に選ばない。
- 親機やphoneを再起動した場合は、新しいQRでスマホを開き直す。一時HTTPS URLは以前のものを使い続けない。

WindowsのICSの仕組み: https://learn.microsoft.com/en-us/windows/win32/nativewifi/using-hosted-network-and-internet-connection-sharing

ゲーム内のEsc→コントローラ→P1/P2には「① Wi-Fi接続」「② ゲーム接続」のQRを表示します。親機のルート `.env` の `WIFI_SSID1` / `WIFI_PASS1`（既存実機用のAP設定、番号なしも可）を使い、`just server-start` を再起動すると各ゲームPCへ自動配信します。上流の学校Wi-Fiではなく、スマホ・子機が接続するAPの情報を設定してください。未設定時はWi-Fi QRを表示せず未設定と案内します。Wi-Fi接続済みのスマホは②だけ読み取ります。

起動は `just server-start`、停止は別ターミナルで `just server-stop` を使います。停止は親機と記録済みのphone・score・HTTPSトンネルの残存プロセスを終了し、起動していなければ何もせず成功します。インターネット共有・APの設定は維持します。`.env` の変更後は停止してから起動し直してください。

WindowsでQRが表示されない場合、配布フォルダーの「ゲーム起動.cmd」から起動して通信許可を適用してください。既にゲームが起動中なら「LAN通信修復.cmd」でも同じexeへのLAN内UDP通信許可を修復できます。phone探索はブロードキャストと、同一LANのゲートウェイへの直接問い合わせを併用します。


## MacのAX88179共有LAN

AX88179のUSB有線アダプターをMacのインターネット共有に使う場合、共有ブリッジのMAC宛てのユニキャストだけが届かないことがあります。今回の実機では、本来のアダプターMAC宛てのARP応答は受信でき、共有ブリッジMAC宛ての応答は受信できませんでした。

`just server-start` は、選択した共有ブリッジの有線メンバーがAX88179の1台だけであることを確認し、ブリッジのMACをそのアダプターのMACに合わせます。名前・IP・MACは起動時に検出します。一致済みなら変更せず、メンバーが複数なら補正せずエラーで停止します。macOSは一般ユーザーへMACをマスクするため、実MACの確認と補正にだけ `sudo /sbin/ifconfig` を使います。必要な場合はターミナルで管理者パスワードを入力してください。phone・scoreは元のユーザー権限で起動します。

変更前のMACは `.server/mac-bridge-backups.jsonl` へ追記します。補正後にMACとLANのIPv4を確認できなければ元のMACへ戻して起動を中止します。復元も失敗した場合はその理由を表示します。手動で戻す場合は記録中の `bridge` と `originalMac` を使い、`sudo /sbin/ifconfig <bridge> ether <originalMac>` を実行してください。

補正直後は端末の古いARP情報が残ることがあります。Windowsは管理者PowerShellで `arp -d 192.168.2.1`（現在の親機LANアドレスに合わせる）、スマホは会場Wi-Fiへ接続し直してください。`just server-stop` はMAC補正やインターネット共有を解除しません。共有の作り直しでMACが戻った場合も、次回の `server-start` で再確認・補正します。Wi-Fi共有元、DHCP、上流の経路はこの補正では変更しません。

Cloudflareの一時HTTPS発行が429で制限された場合、phoneは60秒→120秒→最大300秒間隔で自動再試行します。待機期限は `apps/phone/.local/tunnel-retry.json` に保存し、再起動しても待機を引き継ぎます。起動コマンドを繰り返す必要はありません。待機中、およびphoneだけが終了した場合もスコアは継続します。スコア自体の起動失敗は親機全体のエラーとして扱います。`server-stop` は待機中のphoneも終了します。


## 固定Cloudflare Tunnel

Cloudflare側で固定トンネルを作り、公開ホスト名の転送先を `http://127.0.0.1:8080` に設定します。親機のルート `.env` に `CLOUDFLARE_TUNNEL_TOKEN` と `PUBLIC_BASE_URL=https://公開ホスト名` を両方追加すると、`just server-start` はQuick Tunnelの発行を行わず固定トンネルへ接続します。片方だけの指定、HTTP、パス付きURLは設定エラーにします。設定なしの場合は従来のQuick Tunnelです。

固定モードにはローカルのcloudflaredが必要です。トークンを一時的に `apps/phone/.local/fixed-tunnel-token`（所有者のみ読み書き可）へ保存し、`--token-file` で渡します。トークン本体は起動引数やプロセス記録へ書かず、停止時にこの生成ファイルを削除します。元の `.env` は維持します。`just server-stop` は固定トンネルも停止します。公開URLのhealthz応答を確認してからphoneの起動完了を表示します。
