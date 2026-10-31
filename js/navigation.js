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
    // 決定・取消に使うキー（設定画面のキーコンフィグとは別枠）。
    // P1は移動キー(WASD)の近くに、P2はEnter/Backspaceに合わせている。
    confirmKeys: {
        p1: ['KeyE'],
        p2: ['Enter', 'NumpadEnter']
    },
    cancelKeys: {
        p1: ['KeyR'],
        p2: ['Backspace']
    },

    // 力士選択グリッドの構成（CSSの grid-template-columns と揃えること）
    gridCols: 4,
    gridSize: 20,

    cursor: { p1: 0, p2: 3 },   // 力士選択グリッド上の位置
    focus: 0,                   // ボタンが並ぶ画面での選択位置

    // ---------------------------------------------------------------
    // 画面の判定
    // ---------------------------------------------------------------
    isActive(id) {
        const el = document.getElementById(id);
        return !!(el && el.classList.contains('active'));
    },

    /** いま操作対象になっている画面を返す */
    currentScreen() {
        if (this.isActive('settings-modal')) return 'settings';
        if (document.getElementById('char-detail-overlay')) return 'modal';
        if (this.isActive('pause-menu')) return 'pause';

        // 力士選択へ戻っても結果画面のボタンは要素として残るため、
        // style だけでなく実際に画面に出ているかで判定する。
        // （offsetParent は非表示の親の中にあると null になる）
        const finalBtns = document.getElementById('final-btn-container');
        if (finalBtns && finalBtns.style.display === 'flex' && finalBtns.offsetParent !== null) return 'result';

        if (this.isActive('char-select-screen')) return 'charSelect';
        if (this.isActive('team-select-screen')) return 'teamSelect';
        if (this.isActive('start-screen')) return 'title';
        return null;
    },

    /** グリッドを持つ画面かどうか（個人戦・団体戦の力士選択） */
    isGridScreen(screen) {
        return screen === 'charSelect' || screen === 'teamSelect';
    },

    /** 画面上で押せるボタンを順番に並べて返す */
    buttonsOf(screen) {
        if (screen === 'title') {
            // 押せないボタン（座学など）はカーソルで止まらないよう飛ばす
            return [...document.querySelectorAll('#start-btn-group button')]
                .filter(b => b.offsetParent !== null && !b.disabled);
        }
        if (screen === 'pause') {
            return [...document.querySelectorAll('#pause-menu .pause-btn-list button')]
                .filter(b => b.offsetParent !== null && !b.disabled);
        }
        if (screen === 'settings') {
            // 設定画面は下の「保存して戻る」「キャンセル」だけを選ぶ
            return [...document.querySelectorAll('#settings-modal .settings-actions button')]
                .filter(b => b.offsetParent !== null && !b.disabled);
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
        if (screen === 'teamSelect') return this.handleTeamSelect(playerId, action);
        // 中断メニューは取消でも取組に戻る。設定画面は取消でキャンセルと同じ
        if (screen === 'pause' && action === 'cancel') { game.togglePauseMenu(); return true; }
        if (screen === 'settings' && action === 'cancel') { settings.cancelMenu(); return true; }
        return this.handleButtons(screen, action);
    },

    /**
     * 団体戦の選択画面。
     * 決定で空いている枠へ先鋒から順に入れ、3人揃うと取組開始できる。
     * 取消で最後に入れた1人を外す（枠を個別に選ばせると操作が複雑になるため）。
     */
    handleTeamSelect(playerId, action) {
        const team = teamGame.state.teams[playerId];

        if (action === 'cancel') {
            for (let i = team.length - 1; i >= 0; i--) {
                if (team[i] !== null) { teamGame.selectTeamChar(playerId, i, null); return true; }
            }
            return false;
        }

        if (action === 'confirm') {
            const empty = team.indexOf(null);

            // 両者3人ずつ揃っていれば、決定で取組開始
            if (empty < 0) {
                const other = teamGame.state.teams[playerId === 'p1' ? 'p2' : 'p1'];
                if (other.indexOf(null) < 0) this.startTeamIfReady();
                return true;
            }

            const cell = this.gridCells()[this.cursor[playerId]];
            if (!this.isSelectable(cell)) return false;
            const charId = parseInt(cell.dataset.id);
            teamGame.selectTeamChar(playerId, empty, charId);
            this.paintCursors();
            // マウスで枠へ入れた時と同じく、力士名を読み上げる
            const charData = RIKISHI_DATA.find(d => d.id === charId);
            if (charData && charData.voice && typeof SoundFX !== 'undefined') SoundFX.playVoice(charData.voice);
            return true;
        }

        return this.moveCursor(playerId, action);
    },

    /** 取組開始の条件（人数・コスト）が満たされていれば開始する */
    startTeamIfReady() {
        const headerImg = document.getElementById('team-select-header-img');
        // 条件を満たした時だけ checkStartCondition が onclick を設定する
        if (headerImg && typeof headerImg.onclick === 'function') headerImg.onclick();
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

    /** キーやコントローラで画面を操作するプレイヤーがいるか */
    anyCursorPlayer() {
        return ['p1', 'p2'].some(p => settings.usesCursor(p));
    },

    paintButtons(btns) {
        // 両者ともマウスで操作する場合、選択中を示す枠は不要
        const show = this.anyCursorPlayer();
        btns.forEach((b, i) => b.classList.toggle('nav-focus', show && i === this.focus));
    },

    // --- 力士選択画面 ---
    /** いま操作している画面のアイコングリッドを返す（個人戦と団体戦で別物） */
    gridEl() {
        const screenId = (this.currentScreen() === 'teamSelect')
            ? '#team-select-screen' : '#char-select-screen';
        return document.querySelector(`${screenId} #icon-grid`);
    },

    gridCells() {
        const grid = this.gridEl();
        if (!grid) return [];
        // カーソル自身もグリッドの子になるため、マスの数え上げからは除く
        return [...grid.children].filter(c => !c.classList.contains('nav-cursor'));
    },

    /** その位置の力士が選べるか（空きマスや非表示は飛ばす） */
    isSelectable(cell) {
        return !!(cell && cell.hasAttribute('data-id')
            && !cell.classList.contains('inactive')
            && !cell.classList.contains('secret-hidden'));
    },

    /** グリッド上のカーソルを1マス動かす（個人戦・団体戦で共通） */
    moveCursor(playerId, action) {
        const cells = this.gridCells();
        if (!cells.length) return false;

        const delta = { left: -1, right: 1, up: -this.gridCols, down: this.gridCols }[action];
        if (delta === undefined) return false;

        // 選べないマスは飛ばして次の候補へ進む
        let pos = this.cursor[playerId];
        for (let i = 0; i < this.gridSize; i++) {
            pos += delta;
            if (pos < 0 || pos >= cells.length) return false;   // 端で止める
            if (this.isSelectable(cells[pos])) {
                this.cursor[playerId] = pos;
                this.paintCursors();
                this.previewUnderCursor(playerId);
                return true;
            }
        }
        return false;
    },

    handleCharSelect(playerId, action) {
        const cells = this.gridCells();
        if (!cells.length) return false;

        if (action === 'cancel') {
            if (game.state.chars[playerId] === null) return false;
            game.selectChar(playerId, null);
            return true;
        }

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

        // 選び終えた後はカーソルを止める（取消で選び直せる）
        if (game.state.chars[playerId] !== null) return false;
        return this.moveCursor(playerId, action);
    },

    /** カーソル本体を用意する（グリッド内に1P・2P分を1つずつ置く） */
    ensureCursorEls() {
        const grid = this.gridEl();
        if (!grid) return null;

        ['p1', 'p2'].forEach(pid => {
                if (grid.querySelector(`.nav-cursor.${pid}`)) return;
                const el = document.createElement('div');
                el.className = `nav-cursor ${pid}`;
                el.innerHTML =
                    `<span class="nav-cursor-tag">${pid === 'p1' ? '1P' : '2P'}</span>`
                    + '<i class="corner tl"></i><i class="corner tr"></i>'
                    + '<i class="corner bl"></i><i class="corner br"></i>';
                grid.appendChild(el);
            });
        return grid;
    },

    // ---------------------------------------------------------------
    // 力士選択画面の操作案内
    // ---------------------------------------------------------------
    /** キーコードを画面表示用の名前にする（KeyE → E など） */
    keyLabel(code) {
        if (!code) return '';
        const arrows = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
        if (arrows[code]) return arrows[code];
        if (code.startsWith('Key')) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        return code;
    },

    /** そのプレイヤーの決定・キャンセルの表示名（マウス操作の人は null） */
    keysOf(playerId) {
        if (!settings.usesCursor(playerId)) return null;
        if (settings.inputModeOf(playerId) === 'gamepad' && typeof GamepadInput !== 'undefined') {
            return GamepadInput.buttonLabels(GamepadInput.padFor(playerId));
        }
        return {
            confirm: this.keyLabel(this.confirmKeys[playerId][0]),
            cancel:  this.keyLabel(this.cancelKeys[playerId][0])
        };
    },

    /** そのプレイヤーの移動方法の案内（マウス操作の人は空文字） */
    moveGuideFor(playerId) {
        if (!settings.usesCursor(playerId)) return '';
        // コントローラはキー割り当てではなく十字キー・スティックで動かす
        if (settings.inputModeOf(playerId) === 'gamepad') return '移動：十字キー';
        const c = settings.current.controls[playerId];
        // 上下左右の順に並べる（例：W S A D、↑ ↓ ← →）
        return `移動：${[c.u, c.d, c.l, c.r].map(k => this.keyLabel(k)).join(' ')}`;
    },

    /** 1人分の案内文（1P/2Pの表記は付けない）。移動・決定の2行 */
    guideFor(playerId) {
        const k = this.keysOf(playerId);
        if (!k) return '顔をドラッグして体にドッキングさせろ！';
        return `${this.moveGuideFor(playerId)}\n決定：${k.confirm}　キャンセル：${k.cancel}`;
    },

    /** 両者が選び終えた後の案内（1P側の決定で案内する。2P側の決定でも始められる） */
    readyText() {
        const k = this.keysOf('p1');
        return k ? `${k.confirm}を押してゲーム開始だ！` : '↑ をクリックしてゲーム開始だ！';
    },

    /**
     * 操作の案内を出す。
     *   2人の案内が同じ … 「顔をドラッグして〜」の位置に1行
     *   2人の案内が違う … 1Pの案内は1Pカードの上、2Pの案内は2Pカードの上
     *   両者が選び終えた … 「（1Pの決定）を押してゲーム開始だ！」
     */
    updateSelectGuide() {
        const el = document.getElementById('select-instruction-text');
        if (!el || typeof game === 'undefined' || !game) return;
        const st = game.state.chars;
        const cardGuide = {
            p1: document.getElementById('select-guide-p1'),
            p2: document.getElementById('select-guide-p2')
        };
        const setCards = (t1, t2) => {
            if (cardGuide.p1) cardGuide.p1.textContent = t1;
            if (cardGuide.p2) cardGuide.p2.textContent = t2;
        };

        el.classList.remove('key-guide');
        if (st.p1 !== null && st.p2 !== null) {
            el.textContent = this.readyText();
            setCards('', '');
            return;
        }

        const g1 = this.guideFor('p1');
        const g2 = this.guideFor('p2');
        if (g1 === g2) {
            el.textContent = g1;
            // キー・ボタンの案内は小さめの2行で出す（ドラッグの説明は元の大きさ）
            el.classList.toggle('key-guide', !!this.keysOf('p1'));
            setCards('', '');
        } else {
            el.textContent = '';
            setCards(g1, g2);
        }
    },

    /** 設定変更時など、カーソルや枠の表示を今の操作方法に合わせ直す */
    refreshCursors() {
        const screen = this.currentScreen();
        if (this.isGridScreen(screen)) {
            this.paintCursors();
            if (screen === 'charSelect') {
                ['p1', 'p2'].forEach(pid => {
                        if (game.state.chars[pid] !== null) return;   // 選出済みのカードは触らない
                        if (settings.usesCursor(pid)) this.previewUnderCursor(pid);
                        else game.ui.updatePreview(pid, null);        // マウス操作に切り替えたら空に戻す
                    });
                this.updateSelectGuide();
            }
            if (screen === 'teamSelect') this.updateDetailHint();
        } else {
            this.hideCursors();
            if (screen) this.paintButtons(this.buttonsOf(screen));
        }
    },

    /** カーソルを今の位置のマスへ移動させる */
    paintCursors() {
        const grid = this.ensureCursorEls();
        if (!grid) return;

        const cells = this.gridCells();

        // カーソルが乗っているマスは、マウスのホバーと同じように拡大させる
        cells.forEach(c => c.classList.remove('nav-hover'));

        ['p1', 'p2'].forEach(pid => {
                const el = grid.querySelector(`.nav-cursor.${pid}`);
                const cell = cells[this.cursor[pid]];
                if (!el) return;
                // マウスで選ぶ設定のプレイヤーには枠を出さない
                if (!cell || !settings.usesCursor(pid)) { el.style.display = 'none'; return; }

                cell.classList.add('nav-hover');

                el.style.display = 'block';
                el.style.left   = cell.offsetLeft + 'px';
                el.style.top    = cell.offsetTop + 'px';
                el.style.width  = cell.offsetWidth + 'px';
                el.style.height = cell.offsetHeight + 'px';
            });

        // 普段はマスへぴったり重ね、同じ力士を指している時だけ左右へ振り分ける
        const same = this.cursor.p1 === this.cursor.p2;
        ['p1', 'p2'].forEach(pid => {
                const el = grid.querySelector(`.nav-cursor.${pid}`);
                if (el) el.classList.toggle('same-cell', same);
            });
    },

    /**
     * カーソルを合わせている力士をカードに表示する。
     * 誰を選ぼうとしているのか分かるようにするための下見表示なので、
     * すでに選出を確定しているプレイヤーには行わない。
     */
    previewUnderCursor(playerId) {
        // 団体戦は3人分の枠に直接表示されるため、下見表示は個人戦のみ
        if (this.currentScreen() !== 'charSelect') return;
        if (game.state.chars[playerId] !== null) return;
        // マウスで選ぶ人にはカーソルが無いので、下見を出すと選び済みに見えてしまう
        if (!settings.usesCursor(playerId)) return;

        const cell = this.gridCells()[this.cursor[playerId]];
        if (!this.isSelectable(cell)) return;
        game.ui.updatePreview(playerId, parseInt(cell.dataset.id));
    },

    /**
     * 指定した力士のマスへカーソルを移動させる。
     * マウスで選出された場合にも呼ばれ、カーソルと選出先を一致させる。
     */
    syncCursorTo(playerId, charId) {
        if (charId === null || charId === undefined) return;
        if (this.currentScreen() !== 'charSelect') return;

        const idx = this.gridCells().findIndex(
            c => c.hasAttribute('data-id') && parseInt(c.dataset.id) === charId);
        if (idx < 0) return;

        this.cursor[playerId] = idx;
        this.paintCursors();
    },

    /** 力士選択画面以外ではカーソルを隠す */
    hideCursors() {
        document.querySelectorAll('.nav-cursor').forEach(el => { el.style.display = 'none'; });
        // カーソルによる拡大が残らないように消す
        document.querySelectorAll('.char-select-icon.nav-hover')
            .forEach(c => c.classList.remove('nav-hover'));
    },

    /** 画面が切り替わった時に選択位置を初期化する */
    resetFor(screen) {
        if (this.isGridScreen(screen)) {
            const cells = this.gridCells();
            const first = cells.findIndex(c => this.isSelectable(c));
            const last = cells.map((c, i) => this.isSelectable(c) ? i : -1)
                              .filter(i => i >= 0).pop();
            this.cursor.p1 = (first >= 0) ? first : 0;
            this.cursor.p2 = (last >= 0) ? last : 0;

            // 取組後に戻ってきた場合は、すでに選ばれている力士へカーソルを合わせる
            if (screen === 'charSelect') {
                ['p1', 'p2'].forEach(pid => {
                        const charId = game.state.chars[pid];
                        if (charId === null || charId === undefined) return;
                        const idx = cells.findIndex(
                            c => c.hasAttribute('data-id') && parseInt(c.dataset.id) === charId);
                        if (idx >= 0) this.cursor[pid] = idx;
                    });
            }

            this.paintCursors();
            this.previewUnderCursor('p1');
            this.previewUnderCursor('p2');
            if (screen === 'charSelect') this.updateSelectGuide();
            if (screen === 'teamSelect') this.updateDetailHint();
        } else {
            this.hideCursors();
            const btns = this.buttonsOf(screen);
            // 設定画面は、うっかり保存しないよう「キャンセル」を選んだ状態で開く
            this.focus = (screen === 'settings') ? Math.max(0, btns.length - 1) : 0;
            this.paintButtons(btns);
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
                if (this.handleDetailCard(e)) { e.preventDefault(); return; }
                if (!this.currentScreen()) return;

                for (const playerId of ['p1', 'p2']) {
                    // マウスで選ぶ設定のプレイヤーは、キーで画面を動かさない
                    // （枠を出していないため、見えないカーソルが動いてしまう）
                    if (!settings.usesCursor(playerId)) continue;

                    const c = settings.current.controls[playerId];
                    let action = null;
                    if (e.code === c.l) action = 'left';
                    else if (e.code === c.r) action = 'right';
                    else if (e.code === c.u) action = 'up';
                    else if (e.code === c.d) action = 'down';
                    else if (this.confirmKeys[playerId].includes(e.code)) action = 'confirm';
                    else if (this.cancelKeys[playerId].includes(e.code)) action = 'cancel';

                    // 力士選択画面では、選んだ力士がいなければ取消の長押しでタイトルへ戻る
                    // （選んでいる時の取消は選び直しだけにして、戻る操作と重ならないようにする）
                    if (action === 'cancel' && this.isGridScreen(this.currentScreen())
                        && !this.hasPicked(playerId)) this.startBackHold(playerId);

                    if (action && this.handle(playerId, action)) {
                        e.preventDefault();
                        return;
                    }
                }
            });
        window.addEventListener('keyup', (e) => {
                for (const playerId of ['p1', 'p2']) {
                    if (this.cancelKeys[playerId].includes(e.code)) this.stopBackHold(playerId);
                }
            });
        window.addEventListener('blur', () => { this.stopBackHold('p1'); this.stopBackHold('p2'); });

        // 画面が変わったら選択位置を初期化する
        let lastScreen = null;
        let lastOverlay = null;
        let focusBeforeSettings = 0;
        const watch = () => {
            const s = this.currentScreen();
            // 詳細カード・設定は元の画面に重なるだけなので、閉じた時はカーソル位置・選択位置を元に戻す
            const overlay = (s === 'modal' || s === 'settings') ? s : null;
            if (overlay !== lastOverlay) {
                if (lastOverlay === 'settings') {
                    this.focus = focusBeforeSettings;
                    if (lastScreen && !this.isGridScreen(lastScreen)) this.paintButtons(this.buttonsOf(lastScreen));
                }
                if (overlay === 'settings') {
                    focusBeforeSettings = this.focus;
                    this.resetFor('settings');
                }
                lastOverlay = overlay;
            }
            if (!overlay && s !== lastScreen) {
                lastScreen = s;
                if (s) this.resetFor(s);
            }
            requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
    },

    // ゲームパッドの入力は gamepad.js がキーイベントとして発行するため、
    // 上の keydown 監視がそのまま拾う。専用の受け口は不要。

    // ---------------------------------------------------------------
    // 団体戦の詳細カード（スタートボタン／Escで開閉）
    // ---------------------------------------------------------------
    /**
     * 団体戦のアイコン欄の上に、詳細カードを開くボタンを案内する。
     * コントローラの人がいれば START、キーボードだけなら Esc。
     * マウスだけの場合は軍配ボタンが出るので案内しない。
     */
    updateDetailHint() {
        const el = document.getElementById('team-detail-hint');
        if (!el) return;
        const cursorPlayers = ['p1', 'p2'].filter(p => settings.usesCursor(p));
        if (!cursorPlayers.length) { el.textContent = ''; return; }
        const usesPad = cursorPlayers.some(p => settings.inputModeOf(p) === 'gamepad');
        el.textContent = `力士の詳細を見る：${usesPad ? 'START' : 'Esc'}`;
    },

    /**
     * 団体戦の力士選択で、カーソルを合わせた力士の詳細カードを開く。
     * 開いている間は、スタート・決定・取消のどれでも閉じる。
     * 処理した場合は true を返す。
     */
    handleDetailCard(e) {
        const overlay = document.getElementById('char-detail-overlay');
        if (overlay) {
            const closeKeys = ['Escape', ...this.confirmKeys.p1, ...this.confirmKeys.p2,
                               ...this.cancelKeys.p1, ...this.cancelKeys.p2];
            if (!closeKeys.includes(e.code)) return false;
            overlay.remove();
            return true;
        }

        if (e.code !== 'Escape' || this.currentScreen() !== 'teamSelect') return false;
        // コントローラのスタートは押した人のカーソル、キーボードの Esc は1Pのカーソルを使う
        const playerId = e.padPlayer
            || ['p1', 'p2'].find(p => settings.usesCursor(p));
        if (!playerId || !settings.usesCursor(playerId)) return false;

        const cell = this.gridCells()[this.cursor[playerId]];
        if (!this.isSelectable(cell)) return false;
        teamGame.ui.showCharDetail(parseInt(cell.dataset.id));
        return true;
    },

    // ---------------------------------------------------------------
    // 取消の長押しでタイトルへ戻る（力士選択画面のみ）
    // ---------------------------------------------------------------
    backHoldMs: 1500,
    _backHold: { p1: null, p2: null },   // 押し始めた時刻
    _backHoldRaf: null,

    /** そのプレイヤーが力士を選んでいるか（団体戦は枠に1人でも入っていれば） */
    hasPicked(playerId) {
        if (this.currentScreen() === 'teamSelect') {
            return teamGame.state.teams[playerId].some(id => id !== null);
        }
        return game.state.chars[playerId] !== null;
    },

    /** いま表示中の力士選択画面の「戻る」ボタン */
    backButton() {
        const screenId = (this.currentScreen() === 'teamSelect') ? 'team-select-screen' : 'char-select-screen';
        return document.querySelector(`#${screenId} .back-to-top-btn:not(.format-btn)`);
    },

    startBackHold(playerId) {
        if (this._backHold[playerId] !== null) return;
        this._backHold[playerId] = performance.now();
        if (!this._backHoldRaf) this._backHoldRaf = requestAnimationFrame(() => this._tickBackHold());
    },

    stopBackHold(playerId) {
        this._backHold[playerId] = null;
    },

    /** 長押しの進み具合を「戻る」ボタンに紫で塗り、満ちたらタイトルへ戻る */
    _tickBackHold() {
        this._backHoldRaf = null;
        const starts = ['p1', 'p2'].map(p => this._backHold[p]).filter(t => t !== null);
        const btn = this.backButton();
        const onGrid = this.isGridScreen(this.currentScreen());

        // 離した・画面が変わった場合は塗りを消して終わる
        if (!starts.length || !btn || !onGrid) {
            if (!onGrid) { this._backHold.p1 = null; this._backHold.p2 = null; }
            document.querySelectorAll('.back-to-top-btn.holding').forEach(b => {
                b.classList.remove('holding', 'hold-dark');
                b.style.removeProperty('--hold');
            });
            return;
        }

        const ratio = Math.min(1, (performance.now() - Math.min(...starts)) / this.backHoldMs);
        btn.classList.add('holding');
        btn.classList.toggle('hold-dark', ratio >= 0.5);   // 半分を超えたら文字を白くして読めるようにする
        btn.style.setProperty('--hold', `${(ratio * 100).toFixed(1)}%`);

        if (ratio >= 1) {
            this._backHold.p1 = null; this._backHold.p2 = null;
            btn.click();
            return;
        }
        this._backHoldRaf = requestAnimationFrame(() => this._tickBackHold());
    },
};
