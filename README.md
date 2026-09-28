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
make phone-controller
```

その後、Unity Hubで `apps/unity` を開き、Unity `6000.3.21f1` で `Assets/Scenes/BattleGround.unity` を開いてPlayします。ゲーム画面に表示されたP1/P2のQRコードをスマートフォンで読み取り、スマートフォン側で `センサーを使う` と `リセンター` を実行すると、スマホをコントローラーとして使えます。

サーバーを停止するときは、ルートディレクトリで次を実行します。

```sh
make phone-controller-stop
```

詳細は [`docs/UNITY_PHONE_CONTROLLER_SETUP.md`](docs/UNITY_PHONE_CONTROLLER_SETUP.md) を参照してください。
