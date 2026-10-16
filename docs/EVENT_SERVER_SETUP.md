# 当日の親機WindowsとゲームPC

親機1台でphoneサーバー・一時HTTPSトンネル・score-serverを起動し、学校Wi-Fiを有線LANへ共有します。ゲームPC4台とスマホは既存ルータのLANへ接続します。親機ではゲームの起動は不要です。

## 一度だけ準備すること

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
just server
```

初回やアダプタ・Node.jsの場所が変わったときにはWindowsの管理者確認を許可します。自動で以下を行います。

- 接続中の物理Wi-Fiと有線アダプタを検出。
- WindowsのInternet Connection Sharing（ICS）をWi-Fi→有線へ設定。親機がLANのDHCP・DNS・インターネットへの出口を担当。
- Node.jsのTCP8080・3080、UDP42045・42044の受信を、有線LANインターフェースかつLocalSubnetに限定して許可。
- phoneのnpm依存を初回／lockfile変更時に導入し、TypeScriptをビルド。
- 一時HTTPSトンネル、phoneサーバー、自動探索、score-serverを起動。

`Phone server ready` が出るまで待ちます。学校のネットワークでトンネル通信が遮断されている場合はエラーで停止します。アプリ側では学校の接続制限やログインを解除できません。

起動したPowerShellを開いたままにします。Ctrl+Cで全サーバーを停止します。共有設定とファイアウォール設定は次回のために残ります。scoreのDBは `apps/score-server/data/scores.sqlite` に保存されます。

ICS変更前の有線設定は `.server/network.json.before.json` に記録します。共有を戻す場合はWindowsの「ネットワーク接続」で学校Wi-Fiのプロパティ→共有から無効にし、必要なら記録を見て元の有線設定へ戻します。

Wi-Fiや有線が複数あって選べない場合は、PowerShellで名前を指定します。自動で別のネットワークを推測して変更しません。

```powershell
Get-NetAdapter -Physical
$env:KOSEN_WIFI_ADAPTER = 'Wi-Fi'
$env:KOSEN_LAN_ADAPTER = 'Ethernet'
just server
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
