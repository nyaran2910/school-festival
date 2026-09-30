# Unity開発環境とスマホコントローラーのセットアップ

この手順では、このリポジトリをクローンした開発者が、Unityのゲーム画面を起動し、スマートフォンをP1/P2のコントローラーとして接続してテストするまでを説明します。

## 1. 必要なもの

- Git
- Unity Hub と Unity `6000.3.21f1`
- Docker Desktop
- `make`
- Dockerイメージをpullできるインターネット接続
- センサーを利用できるスマートフォンのブラウザ（SafariまたはChrome推奨）

Windowsでは、`make` とシェルを利用できる Git Bash または WSL で実行してください。

## 2. リポジトリを取得する

サブモジュールも同時に取得します。

```sh
git clone --recurse-submodules https://github.com/nyaran2910/school-festival.git
cd school-festival
```

すでにクローン済みでサブモジュールが未取得の場合は、リポジトリのルートで次を実行します。

```sh
git submodule update --init --recursive
```

Unityプロジェクトは `apps/unity` にあります。ルートリポジトリが指定しているサブモジュールのコミットをそのまま使えば、チームで揃えた状態を再現できます。

開発ブランチ上で作業する必要がある場合だけ、Unityサブモジュール内でブランチを作成します。

```sh
git -C apps/unity switch --track -c sanuka origin/sanuka
```

## 3. スマホコントローラーのサーバーを起動する

リポジトリのルートディレクトリで、次を実行します。ルートのMakefileがスマホ用サーバーを起動し、Unity用の接続設定を自動生成します。

```sh
make
```

Dockerイメージをpullしてコンテナを起動し、Unity用の接続設定を自動生成します。起動に成功すると、スマートフォンで開くためのHTTPS URLが表示されます。URLはUnity画面に表示されるQRコードにも埋め込まれます。UnityでPlayを押すとQRコードが表示され、PCとスマートフォンが別のWi-Fiやモバイル通信でも接続できます。

サーバーはバックグラウンドで動作します。状態確認、ログ表示、停止は次のコマンドで行えます。

```sh
make phone-controller-status
make phone-controller-logs
make phone-controller-stop
```

停止した後に再起動する場合は、ルートディレクトリで再度 `make` を実行します。

```sh
make phone-controller
```

### Windowsで環境変数を指定する場合

Git Bashでは上記のコマンドをそのまま実行できます。PowerShellからは、Git BashまたはWSLのターミナルを使ってください。

`make` はルートの `apps/phone` に正しいUnity設定パスを渡すため、個別の環境変数指定は不要です。

`controller-connection.json` には接続用の一時的なキーが書き込まれます。これはローカル実行時に自動生成されるファイルなので、コミットしないでください。

## 4. Unityプロジェクトを開く

1. Unity Hubで `school-festival/apps/unity` を開く。
2. Unity `6000.3.21f1` を選択し、初回のインポートが終わるまで待つ。
3. `Assets/Scenes/BattleGround.unity` を開く。
4. Unity EditorのPlayボタンを押す。

スマホサーバーを先に起動しておくと、Play開始時に接続設定が読み込まれ、ゲーム画面にP1/P2用のQRコードが表示されます。

QRコードが表示されない場合は、次を確認してください。

```text
school-festival/apps/unity/Assets/StreamingAssets/controller-connection.json
```

`make phone-controller` を実行したこと、Unity Consoleにエラーが出ていないことを確認します。

## 5. スマートフォンを接続する

1. スマートフォンがインターネットに接続できることを確認する。PCと同じWi-Fiである必要はありません。
2. Unity画面に表示されたP1またはP2のQRコードをスマートフォンで読み取る。
3. スマートフォン側で `センサーを使う` をタップする。
4. モーションセンサーの利用許可を求められたら許可する。
5. ニュートラルな姿勢で `リセンター` をタップする。
6. センサー値の送信が始まり、Unity側でコントローラーが操作可能になったことを確認する。

iPhoneでは、センサーの許可ダイアログを表示するためにスマートフォン上のボタンをタップする必要があります。スマートフォン側のURLはHTTPSである必要があるため、表示されたURLまたはQRコードを使用してください。

接続後は、スマートフォンを動かして武器の向きが変わることを確認します。`ガード` を押している間は、Unity画面のガード状態も変化します。2台使う場合は、1台をP1、もう1台をP2のQRコードに接続します。

QRコードを作り直す必要がある場合は、Unity画面の `NEW QR` を押してください。

## 6. テスト時の確認項目

- P1またはP2に正しいスマートフォンを接続できる
- `リセンター` 後にニュートラルな姿勢が正しく反映される
- スマートフォンの向きに合わせてUnity上の操作対象が動く
- `ガード` の押下・解放がUnity側に反映される
- 2台接続時にP1とP2が混線しない
- UnityのPlay停止後、再度Playしても接続できる

スマートフォンが未接続の場合、キーボードでも簡易テストできます。P1は矢印キー、P2はW/A/S/Dキーを使います。

## 7. 終了する

UnityのPlayを停止した後、スマホコントローラーのサーバーも停止します。

```sh
make phone-controller-stop
```

次回起動時は、新しいHTTPS URLが発行されることがあります。その場合は、前回のURLではなく、その回に表示されたQRコードを使ってください。

## トラブルシューティング

### スマートフォンでページを開けない

- `make phone-controller-status` と `make phone-controller-logs` でサーバーが動作しているか確認する。
- `make phone-controller` 実行時に表示された最新のURLを使う。
- PCとスマートフォンがインターネットに接続できるか確認する。
- VPN、ゲストWi-Fi、Wi-Fiの端末間通信遮断（AP isolation）が有効になっていないか確認する。
- PCのファイアウォールがローカル通信を遮断していないか確認する。

### センサーが使えない

- HTTPSのURLを開いているか確認する。
- `センサーを使う` をタップして、ブラウザのセンサー許可を与える。
- SafariまたはChromeの最新版で試す。
- スマートフォンの省電力設定や画面ロックでセンサー送信が止まっていないか確認する。

### QRコードを読み取っても操作できない

- UnityがPlay中であることを確認する。
- 正しいP1/P2のQRコードを読み取っているか確認する。
- スマートフォンでセンサーを有効にしてから `リセンター` を押す。
- `NEW QR` でQRコードを作り直す。
- Unity Consoleに接続エラーがないか確認する。

### UnityにQRコードが出ない

- `apps/unity/Assets/StreamingAssets/controller-connection.json` が存在するか確認する。
- ルートディレクトリで `make` を実行したか確認する。
- Unityで `Assets/Scenes/BattleGround.unity` を開いているか確認する。
- Unity Consoleの `Could not read ... controller-connection.json` などのエラーを確認する。
