# R8 5IE2 チャンバラゲーム

令和8年の文化祭出し物の総合管理レポジトリ

## アプリ

- `apps/kojo_HW/`: 古城作のハードウェア管理レポジトリ
- `apps/unity/`: 小林作のUnityゲーム本体
- `apps/phone/`: ハードウェア完成前にunityでテストプレイができるよう、スマホのセンサを用いてコントローラの動きを再現したやつ

## Unityをスマホでテストする

```sh
git clone --recurse-submodules https://github.com/nyaran2910/school-festival.git
cd school-festival
make
```

Docker Desktopが起動していれば、`make` でコントローラー用Dockerイメージをpullしてサーバーを起動し、Unityの接続設定を自動生成します。ローカルのソースからDockerを使わずに起動する場合は、Node.js 22以上を用意して次を実行します。

```sh
make local
```

どちらの方法でもUnity Hubで `apps/unity` を開き、Unity `6000.3.21f1` で `Assets/Scenes/BattleGround.unity` を開いてPlayするとQRコードが表示されます。QRコードをスマートフォンで読み取り、`センサーを使う` と `リセンター` を実行してください。別のWi-FiからはSTUNを使って直接接続を試みます。ネットワーク制限によってはTURNサーバーが必要です。

ゲームは接続用のポーズ画面から始まります。接続後は `RESUME` またはEscで対戦を開始します。対戦中にQRや接続設定を開くときもEscを押してください。

`make local` は `make phone-controller-local` と同じです。起動済みでも `apps/unity` の接続設定を同期します。UnityでPlay中に設定を更新した場合は、Playを一度停止して再開してください。

サーバーを停止するときは、ルートディレクトリで次を実行します。

```sh
make phone-controller-stop
```

ローカルソースから起動した場合は `make phone-controller-local-stop` で停止します。状態確認とログ表示には、それぞれ `make phone-controller-local-status` と `make phone-controller-local-logs` を使います。

詳細は [`docs/UNITY_PHONE_CONTROLLER_SETUP.md`](docs/UNITY_PHONE_CONTROLLER_SETUP.md) を参照してください。
