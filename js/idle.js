/**
 * idle.js
 * 無操作が続いたときに、タイトル画面へ自動で戻す。
 *
 * 会場では来場者が途中で離れることがあるため、
 * 選択画面や取組の途中で止まったままにならないようにする。
 *
 * 操作とみなすもの: キー入力・マウス操作・タッチ。
 * コントローラの入力は gamepad.js がキーイベントとして発行するため、
 * キー入力と同じ経路でここに届く。
 */
const IdleReturn = {
    timeoutMs: 0,
    lastActive: Date.now(),
    _timer: null,

    start() {
        const sec = (typeof IDLE_RETURN_SECONDS === 'number') ? IDLE_RETURN_SECONDS : 0;
        if (sec <= 0) return;   // 0 なら無効
        this.timeoutMs = sec * 1000;

        // 他の処理が伝播を止めても拾えるよう、捕捉段階で監視する
        const touch = () => { this.lastActive = Date.now(); };
        ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart', 'pointerdown']
            .forEach(ev => window.addEventListener(ev, touch, { capture: true, passive: true }));

        this._timer = setInterval(() => this.check(), 1000);
    },

    isOnTitle() {
        const el = document.getElementById('start-screen');
        return !!(el && el.classList.contains('active'));
    },

    check() {
        // タイトルにいる間は計測しない（タイトルを離れた時点から数え始める）
        if (this.isOnTitle()) { this.lastActive = Date.now(); return; }

        if (Date.now() - this.lastActive < this.timeoutMs) return;

        console.log(`無操作が ${this.timeoutMs / 1000} 秒続いたため、タイトルへ戻ります`);
        clearInterval(this._timer);
        // 個人戦・団体戦・取組中など、どの状態からでも確実に初期状態へ戻すため再読み込みする。
        // オフラインモードなので通信は発生せず、すぐにタイトルが表示される。
        location.reload();
    }
};
