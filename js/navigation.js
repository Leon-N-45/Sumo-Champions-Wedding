/**
 * navigation.js
 * 方向キー＋決定ボタンによる画面操作を担当する。
 *
 * 【なぜ必要か】
 * タイトル画面はクリック、力士選択はマウスのドラッグでしか操作できず、
 * コントローラだけではゲームを始めることができなかった。
 * 会場では来場者がコントローラしか触れないため、
 * 選択から開始まで一通りをコントローラで行えるようにする。
 *
 * 【設計】
 * キーボードもゲームパッドも、いったん「上下左右・決定」という
 * 抽象的な操作へ変換してから画面へ渡す。
 * こうすることで、当日の機材がどちらであっても同じように動く。
 */
const MenuNav = {
    // 決定ボタンに使うキー（設定画面のキーコンフィグとは別枠）
    confirmKeys: {
        p1: ['Space'],
        p2: ['Enter', 'NumpadEnter']
    },

    // 力士選択グリッドの構成（CSSの grid-template-columns と揃えること）
    gridCols: 4,
    gridSize: 20,

    cursor: { p1: 0, p2: 3 },   // 力士選択グリッド上の位置
    focus: 0,                   // ボタンが並ぶ画面での選択位置
    _repeat: {},                // 押しっぱなしの連続移動を抑えるための記録

    // ---------------------------------------------------------------
    // 画面の判定
    // ---------------------------------------------------------------
    isActive(id) {
        const el = document.getElementById(id);
        return !!(el && el.classList.contains('active'));
    },

    /** いま操作対象になっている画面を返す */
    currentScreen() {
        if (this.isActive('settings-modal')) return 'modal';
        if (document.getElementById('char-detail-overlay')) return 'modal';

        const finalBtns = document.getElementById('final-btn-container');
        if (finalBtns && finalBtns.style.display === 'flex') return 'result';

        if (this.isActive('char-select-screen')) return 'charSelect';
        if (this.isActive('start-screen')) return 'title';
        return null;
    },

    /** 画面上で押せるボタンを順番に並べて返す */
    buttonsOf(screen) {
        if (screen === 'title') {
            return [...document.querySelectorAll('#start-btn-group button')]
                .filter(b => b.offsetParent !== null);
        }
        if (screen === 'result') {
            return [...document.querySelectorAll('#final-btn-container button')]
                .filter(b => b.offsetParent !== null);
        }
        return [];
    },

    // ---------------------------------------------------------------
    // 操作の受け口
    // ---------------------------------------------------------------
    /**
     * action: 'up' | 'down' | 'left' | 'right' | 'confirm'
     * playerId: 'p1' | 'p2'
     */
    handle(playerId, action) {
        const screen = this.currentScreen();
        if (!screen || screen === 'modal') return false;

        if (screen === 'charSelect') return this.handleCharSelect(playerId, action);
        return this.handleButtons(screen, action);
    },

    // --- ボタンが並ぶ画面（タイトル・結果） ---
    handleButtons(screen, action) {
        const btns = this.buttonsOf(screen);
        if (!btns.length) return false;

        if (this.focus >= btns.length) this.focus = 0;

        if (action === 'confirm') {
            btns[this.focus].click();
            return true;
        }
        const step = (action === 'right' || action === 'down') ? 1
                   : (action === 'left' || action === 'up') ? -1 : 0;
        if (!step) return false;

        this.focus = (this.focus + step + btns.length) % btns.length;
        this.paintButtons(btns);
        return true;
    },

    paintButtons(btns) {
        btns.forEach((b, i) => b.classList.toggle('nav-focus', i === this.focus));
    },

    // --- 力士選択画面 ---
    gridCells() {
        const grid = document.querySelector('#char-select-screen #icon-grid')
                  || document.getElementById('icon-grid');
        return grid ? [...grid.children] : [];
    },

    /** その位置の力士が選べるか（空きマスや非表示は飛ばす） */
    isSelectable(cell) {
        return !!(cell && cell.hasAttribute('data-id')
            && !cell.classList.contains('inactive')
            && !cell.classList.contains('secret-hidden'));
    },

    handleCharSelect(playerId, action) {
        const cells = this.gridCells();
        if (!cells.length) return false;

        if (action === 'confirm') {
            // 両者とも選び終えていれば、決定で取組開始
            const st = game.state.chars;
            if (st.p1 !== null && st.p2 !== null) {
                game.startGame();
                return true;
            }
            const cell = cells[this.cursor[playerId]];
            if (!this.isSelectable(cell)) return false;
            game.selectChar(playerId, parseInt(cell.dataset.id));
            this.paintCursors();
            return true;
        }

        const delta = { left: -1, right: 1, up: -this.gridCols, down: this.gridCols }[action];
        if (delta === undefined) return false;

        // 選べないマスは飛ばして次の候補へ進む
        let pos = this.cursor[playerId];
        for (let i = 0; i < this.gridSize; i++) {
            pos += delta;
            if (pos < 0 || pos >= this.gridSize) return false;   // 端で止める
            if (this.isSelectable(cells[pos])) {
                this.cursor[playerId] = pos;
                this.paintCursors();
                return true;
            }
        }
        return false;
    },

    paintCursors() {
        const cells = this.gridCells();
        cells.forEach((c, i) => {
                c.classList.toggle('nav-cursor-p1', i === this.cursor.p1);
                c.classList.toggle('nav-cursor-p2', i === this.cursor.p2);
            });
    },

    /** 画面が切り替わった時に選択位置を初期化する */
    resetFor(screen) {
        if (screen === 'charSelect') {
            const cells = this.gridCells();
            const first = cells.findIndex(c => this.isSelectable(c));
            const last = cells.map((c, i) => this.isSelectable(c) ? i : -1)
                              .filter(i => i >= 0).pop();
            this.cursor.p1 = (first >= 0) ? first : 0;
            this.cursor.p2 = (last >= 0) ? last : 0;
            this.paintCursors();
        } else {
            this.focus = 0;
            this.paintButtons(this.buttonsOf(screen));
        }
    },

    // ---------------------------------------------------------------
    // 入力元との接続
    // ---------------------------------------------------------------
    start() {
        // キーボード：各プレイヤーの割り当て＋決定キー
        window.addEventListener('keydown', (e) => {
                if (typeof settings !== 'undefined' && settings.waitingForKey) return;
                if (e.repeat) return;
                if (!this.currentScreen()) return;

                for (const playerId of ['p1', 'p2']) {
                    const c = settings.current.controls[playerId];
                    let action = null;
                    if (e.code === c.l) action = 'left';
                    else if (e.code === c.r) action = 'right';
                    else if (e.code === c.u) action = 'up';
                    else if (e.code === c.d) action = 'down';
                    else if (this.confirmKeys[playerId].includes(e.code)) action = 'confirm';

                    if (action && this.handle(playerId, action)) {
                        e.preventDefault();
                        return;
                    }
                }
            });

        // 画面が変わったら選択位置を初期化する
        let lastScreen = null;
        const watch = () => {
            const s = this.currentScreen();
            if (s !== lastScreen) {
                lastScreen = s;
                if (s && s !== 'modal') this.resetFor(s);
            }
            requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
    },

    /**
     * ゲームパッドから毎フレーム呼ばれる。
     * 押しっぱなしで進み続けないよう、離すまで1回だけ反応させる。
     */
    feedFromPad(playerId, dirs, confirmPressed) {
        if (!this.currentScreen()) return;

        const fire = (key, active, action) => {
            const id = playerId + ':' + key;
            if (active && !this._repeat[id]) this.handle(playerId, action);
            this._repeat[id] = active;
        };
        fire('l', dirs.l, 'left');
        fire('r', dirs.r, 'right');
        fire('u', dirs.u, 'up');
        fire('d', dirs.d, 'down');
        fire('c', confirmPressed, 'confirm');
    }
};
