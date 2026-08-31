/**
 * gamepad.js
 * ゲームパッド／アーケードコントローラの入力を担当する。
 *
 * 【なぜ必要か】
 * アーケード用のUSBエンコーダは、多くがキーボードではなく
 * ゲームパッド(HID)として認識される。このゲームは元々キーボード
 * 入力しか受け付けないため、そのままでは一切反応しない。
 *
 * 【仕組み】
 * 毎フレーム接続中のパッドを読み、設定画面で割り当てた「キーコード」に
 * 変換してゲーム本体へ渡す。こうすることでキーコンフィグの設定が
 * そのまま効き、ゲーム側のロジックには一切手を入れずに済む。
 *
 * 割り当て（1台目=1P、2台目=2P）:
 *   左右      … スティック左右 / 十字キー左右          → 移動
 *   上/ボタン … スティック上・十字上・ボタン0,2        → いなし
 *   下/ボタン … スティック下・十字下・ボタン1,3        → 溜め
 */
const GamepadInput = {
    // スティックがどれだけ倒れたら入力とみなすか（誤検知を防ぐ）
    deadzone: 0.5,

    // 何台目のパッドをどのプレイヤーに割り当てるか
    playerOrder: ['p1', 'p2'],

    // 押しっぱなし状態の記録（離した瞬間を検出するために保持する）
    _held: { p1: {}, p2: {} },
    _running: false,
    _connected: 0,

    start() {
        if (this._running) return;
        this._running = true;

        window.addEventListener('gamepadconnected', (e) => {
            console.log(`コントローラを認識しました: ${e.gamepad.id}`);
            this._refreshCount();
        });
        window.addEventListener('gamepaddisconnected', (e) => {
            console.log(`コントローラが外れました: ${e.gamepad.id}`);
            this._releaseAll();
            this._refreshCount();
        });

        const loop = () => {
            try { this.poll(); } catch (e) { /* 1フレームの失敗で停止させない */ }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    },

    _refreshCount() {
        this._connected = this.getPads().length;
    },

    /** 接続中のパッドだけを配列で返す */
    getPads() {
        if (!navigator.getGamepads) return [];
        return Array.from(navigator.getGamepads()).filter(p => p);
    },

    _btn(pad, index) {
        const b = pad.buttons[index];
        if (!b) return false;
        return (typeof b === 'object') ? b.pressed : b > 0.5;
    },

    /** パッド1台の状態を、方向ごとの押下有無へ変換する */
    readDirections(pad) {
        const dz = this.deadzone;
        const ax = pad.axes[0] || 0;
        const ay = pad.axes[1] || 0;

        return {
            l: ax <= -dz || this._btn(pad, 14),
            r: ax >= dz || this._btn(pad, 15),
            // いなし・溜めはスティック上下でも、face ボタンでも出せるようにする
            u: ay <= -dz || this._btn(pad, 12) || this._btn(pad, 0) || this._btn(pad, 2),
            d: ay >= dz || this._btn(pad, 13) || this._btn(pad, 1) || this._btn(pad, 3)
        };
    },

    poll() {
        if (typeof game === 'undefined' || !game) return;
        // キーコンフィグの入力待ち中は、パッドで誤って上書きしない
        if (typeof settings !== 'undefined' && settings.waitingForKey) return;

        const pads = this.getPads();

        this.playerOrder.forEach((playerId, i) => {
            const pad = pads[i];
            const controls = settings.current.controls[playerId];
            if (!controls) return;

            // パッドが繋がっていない場合は、押しっぱなしの状態だけ解除しておく
            const dirs = pad ? this.readDirections(pad) : { l: false, r: false, u: false, d: false };
            const held = this._held[playerId];

            ['l', 'r', 'u', 'd'].forEach(dir => {
                    const now = dirs[dir];
                    if (now === !!held[dir]) return;   // 変化なし
                    held[dir] = now;
                    game.setVirtualKey(controls[dir], now);
                });
        });
    },

    /** 接続が切れた時などに、押しっぱなし状態を全て解除する */
    _releaseAll() {
        this.playerOrder.forEach(playerId => {
                const controls = settings.current.controls[playerId];
                const held = this._held[playerId];
                ['l', 'r', 'u', 'd'].forEach(dir => {
                        if (held[dir] && controls) game.setVirtualKey(controls[dir], false);
                        held[dir] = false;
                    });
            });
    },

    /** 動作確認用：接続中のコントローラ一覧を返す */
    status() {
        return this.getPads().map((p, i) => ({
                番号: i,
                割当: this.playerOrder[i] || '(未割当)',
                名称: p.id,
                ボタン数: p.buttons.length,
                軸数: p.axes.length
            }));
    }
};
