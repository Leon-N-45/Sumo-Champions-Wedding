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
        if (this.isActive('settings-modal')) return 'modal';
        if (document.getElementById('char-detail-overlay')) return 'modal';

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
        if (screen === 'teamSelect') return this.handleTeamSelect(playerId, action);
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
            teamGame.selectTeamChar(playerId, empty, parseInt(cell.dataset.id));
            this.paintCursors();
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

    /** 設定変更時など、カーソルや枠の表示を今の操作方法に合わせ直す */
    refreshCursors() {
        const screen = this.currentScreen();
        if (this.isGridScreen(screen)) {
            this.paintCursors();
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
        } else {
            this.hideCursors();
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

    // ゲームパッドの入力は gamepad.js がキーイベントとして発行するため、
    // 上の keydown 監視がそのまま拾う。専用の受け口は不要。
};
