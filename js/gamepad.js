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
 *   上/ボタン … スティック上・十字上・ボタン            → いなし
 *   下/ボタン … スティック下・十字下・ボタン            → 溜め
 * どのボタンが何になるかはパッドの配置で変わる（buttonRoles を参照）。
 * SFCコントローラ（任天堂配置）は 決定=A キャンセル=B 溜める=A/Y いなし=X/B。
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
            this._notifyChange();
        });
        window.addEventListener('gamepaddisconnected', (e) => {
            console.log(`コントローラが外れました: ${e.gamepad.id}`);
            this._releaseAll();
            this._refreshCount();
            this._notifyChange();
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

    /** 抜き差しを設定画面と選択カーソルへ反映する */
    _notifyChange() {
        if (typeof settings !== 'undefined' && settings.updateInputModeUI) settings.updateInputModeUI();
        if (typeof MenuNav !== 'undefined' && MenuNav.refreshCursors) MenuNav.refreshCursors();
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

    /**
     * パッド1台の状態を、方向ごとの押下有無へ変換する。
     *
     * menuMode が true のときは face ボタンを方向として扱わない。
     * 画面操作中は face ボタンが「決定」を兼ねるため、両方に反応すると
     * 決定を押した瞬間に選択が1つ動いてしまう。
     */
    readDirections(pad, menuMode = false) {
        const dz = this.deadzone;
        const ax = pad.axes[0] || 0;
        const ay = pad.axes[1] || 0;
        const hat = this.readHat(pad);
        const roles = this.buttonRoles(pad);

        // 取組中は、いなし・溜めを face ボタンでも出せるようにする
        const faceU = !menuMode && this._any(pad, roles.up);
        const faceD = !menuMode && this._any(pad, roles.down);

        // 十字キー・スティックの上は、画面操作のカーソル移動にだけ使う。
        // 取組中に上でいなしが暴発しないよう、いなしは face ボタンだけで出す。
        const stickU = menuMode && (ay <= -dz || this._btn(pad, 12) || hat.u);

        return {
            l: ax <= -dz || this._btn(pad, 14) || hat.l,
            r: ax >= dz || this._btn(pad, 15) || hat.r,
            u: stickU || faceU,
            d: ay >= dz || this._btn(pad, 13) || hat.d || faceD
        };
    },

    /** face ボタンの刻印（ボタン番号 → 表示名）。番号は位置で決まる（0=下、1=右、2=左、3=上） */
    faceLabels(pad) {
        const id = (pad && pad.id) || '';
        if (this.isNintendo(pad))                                              return ['B', 'A', 'Y', 'X'];
        if (/xbox|xinput|045e/i.test(id))                                      return ['A', 'B', 'X', 'Y'];
        if (/dualshock|dualsense|playstation|054c|wireless controller/i.test(id)) return ['×', '○', '□', '△'];
        return ['1', '2', '3', '4'];
    },

    // 取組画面の操作説明で光らせている face ボタンの状態
    _faceLit: { p1: [], p2: [] },

    /** 取組中に押している face ボタンを、操作説明の図で光らせる */
    _highlightFace(playerId, pad) {
        const active = !!(game && game.state.active && !game.state.paused);
        for (let i = 0; i < 4; i++) {
            const on = !!(pad && active && this._btn(pad, i));
            if (on === !!this._faceLit[playerId][i]) continue;
            this._faceLit[playerId][i] = on;
            document.querySelectorAll(`.pad-face[data-pad="${playerId}"][data-btn="${i}"]`)
                .forEach(el => el.classList.toggle('key-pressed', on));
        }
    },

    _any(pad, indexes) {
        return indexes.some(i => this._btn(pad, i));
    },

    /** 任天堂配置（右がA・下がB）のパッドかどうか */
    isNintendo(pad) {
        return /nintendo|057e|pro controller|joy-?con/i.test((pad && pad.id) || '');
    },

    /**
     * face ボタンの役割を、ボタン番号の配列で返す。
     * 番号は位置で決まる（0=下、1=右、2=左、3=上）。
     *
     * 任天堂配置（SFCコントローラなど）は 右=A・下=B・左=Y・上=X なので、
     *   決定=A　キャンセル=B　溜める=AかY　いなし=XかB
     * それ以外は従来どおり 下・左で決定／いなし、右・上でキャンセル／溜める。
     */
    buttonRoles(pad) {
        if (this.isNintendo(pad)) {
            return { confirm: [1], cancel: [0], up: [3, 0], down: [1, 2] };
        }
        return { confirm: [0, 2], cancel: [1, 3], up: [0, 2], down: [1, 3] };
    },

    // 十字キーが「ハットスイッチ」として1本の軸（9番）に出るパッドの記録。
    // 普通のスティックの軸と見分けるため、中立時に±1を超える値が出たパッドだけを対象にする。
    _hatPads: {},

    /**
     * ハットスイッチの十字キーを読み取る（SFCコントローラなど標準配置でないパッド）。
     * 値は 上=-1 から時計回りに 2/7 ずつ増え、何も押していない時は±1を超える（1.29 など）。
     */
    readHat(pad) {
        const none = { l: false, r: false, u: false, d: false };
        if (pad.mapping === 'standard') return none;
        const v = pad.axes[9];
        if (typeof v !== 'number') return none;
        if (Math.abs(v) > 1.05) {
            this._hatPads[pad.id] = true;
            return none;
        }
        if (!this._hatPads[pad.id]) return none;

        const dir = Math.round((v + 1) * 7 / 2);   // 0=上、1=右上、2=右 … 6=左、7=左上
        return {
            u: dir === 7 || dir === 0 || dir === 1,
            r: dir >= 1 && dir <= 3,
            d: dir >= 3 && dir <= 5,
            l: dir >= 5 && dir <= 7
        };
    },

    /** そのプレイヤーに割り当てられているパッドを返す（無ければ null） */
    padFor(playerId) {
        const padPlayers = this.playerOrder.filter(p => settings.inputModeOf(p) === 'gamepad');
        const slot = padPlayers.indexOf(playerId);
        return (slot >= 0) ? (this.getPads()[slot] || null) : null;
    },

    /**
     * 決定・キャンセルに使うボタンの表示名を返す。
     * パッドの種類によってボタンの刻印が違うため、名前から見分ける。
     * 標準の並びでは 0=下、1=右 のボタン（決定=0、キャンセル=1）。
     */
    buttonLabels(pad) {
        const id = (pad && pad.id) || '';
        if (/xbox|xinput|045e/i.test(id))                                return { confirm: 'A', cancel: 'B' };
        if (/dualshock|dualsense|playstation|054c|wireless controller/i.test(id)) return { confirm: '×', cancel: '○' };
        if (this.isNintendo(pad))                                        return { confirm: 'A', cancel: 'B' };
        // アーケードスティックなど刻印が分からないものは番号で示す
        return { confirm: 'ボタン1', cancel: 'ボタン2' };
    },

    /** 決定として扱うボタン（画面操作時のみ使用） */
    isConfirm(pad) {
        return this._any(pad, this.buttonRoles(pad).confirm);
    },

    /** 取消（選出のやり直し）として扱うボタン */
    isCancel(pad) {
        return this._any(pad, this.buttonRoles(pad).cancel);
    },

    /**
     * パッドの入力を、実際のキーイベントとして発行する。
     *
     * ゲーム側には keys 集合を見る処理と、keydown を直接listenする処理
     * （団体戦の出場者選択など）の両方がある。イベントとして流すことで
     * どちらの経路も特別扱いせずに動かせる。
     * document から発行して window まで伝播させる。
     */
    _send(code, type) {
        if (!code) return;
        document.dispatchEvent(new KeyboardEvent(type, {
                code, bubbles: true, cancelable: true
            }));
    },

    /** 状態が変わった時だけキーイベントを発行する */
    _apply(held, key, now, code) {
        if (now === !!held[key]) return;
        held[key] = now;
        this._send(code, now ? 'keydown' : 'keyup');
    },

    poll() {
        if (typeof game === 'undefined' || !game) return;
        // キーコンフィグの入力待ち中は、パッドで誤って上書きしない
        if (typeof settings !== 'undefined' && settings.waitingForKey) return;

        const pads = this.getPads();

        // 選択画面などを操作中は、face ボタンを決定・取消として扱う
        const onMenu = (typeof MenuNav !== 'undefined') && !!MenuNav.currentScreen();

        // 設定で「コントローラ」を選んでいるプレイヤーにだけ、順にパッドを割り当てる。
        // 1人だけがコントローラなら、その人が1台目を使う。
        const padPlayers = this.playerOrder.filter(p => settings.inputModeOf(p) === 'gamepad');

        this.playerOrder.forEach((playerId) => {
            const slot = padPlayers.indexOf(playerId);
            const pad = (slot >= 0) ? pads[slot] : null;
            const controls = settings.current.controls[playerId];
            if (!controls) return;

            // パッドが繋がっていない場合は、押しっぱなしの状態だけ解除する
            const dirs = pad ? this.readDirections(pad, onMenu) : { l: false, r: false, u: false, d: false };
            const held = this._held[playerId];

            ['l', 'r', 'u', 'd'].forEach(dir => this._apply(held, dir, dirs[dir], controls[dir]));
            this._highlightFace(playerId, pad);

            // 決定・取消は画面操作中のみ。取組中は face ボタンをいなし・溜めに使う
            const confirmOn = onMenu && pad ? this.isConfirm(pad) : false;
            const cancelOn  = onMenu && pad ? this.isCancel(pad)  : false;
            this._apply(held, 'confirm', confirmOn, MenuNav.confirmKeys[playerId][0]);
            this._apply(held, 'cancel',  cancelOn,  MenuNav.cancelKeys[playerId][0]);
        });
    },

    /** 接続が切れた時などに、押しっぱなし状態を全て解除する */
    _releaseAll() {
        this.playerOrder.forEach(playerId => {
                const controls = settings.current.controls[playerId];
                const held = this._held[playerId];
                if (!controls) return;
                ['l', 'r', 'u', 'd'].forEach(dir => this._apply(held, dir, false, controls[dir]));
                this._apply(held, 'confirm', false, MenuNav.confirmKeys[playerId][0]);
                this._apply(held, 'cancel',  false, MenuNav.cancelKeys[playerId][0]);
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
