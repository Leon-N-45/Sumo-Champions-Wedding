/**
 * GameManager Class
 * ゲーム進行、物理演算、入力管理を担当
 */
class GameManager {
    constructor() {
        this.state = {
            active: false,
            matches: 2,
            current: 1,
            wins: {p1:0, p2:0},
            chars: {p1:null, p2:null},
            deuce: true,
            inDecider: false,
            deciderRound: 0,
            tachiai: false,
            processingEnd: false,
            paused: false,
            isTransitioning: false
        };
        this.transitionTimer = 0;
        this.grapple = { active: false, master: null, slave: null };
        this.lastHit = null;
        this.deciderVoicePlayed = false;

        // 重複対策
        document.querySelectorAll('.rikishi').forEach(el => el.remove());

        if (typeof Player === 'undefined' || typeof AIController === 'undefined' || typeof UIManager === 'undefined') {
            alert("エラー: 必要なファイル(player.js, ai.js, ui.js)が読み込まれていません。");
            return;
        }

        this.ui = new UIManager(this);
        const controls = settings.current.controls;

        // SYSTEM_START_POS を適用
        const centerX = cfg('SYSTEM.CENTER_X', 600);
        const offset = cfg('SYSTEM.START_OFFSET', 250);

        const startP1 = centerX - offset;
        const startP2 = centerX + (offset - 130);

        this.p1 = new Player('p1', startP1, settings.current.controls.p1);
        this.p2 = new Player('p2', startP2, settings.current.controls.p2);

        this.aiP1 = new AIController();
        this.aiP2 = new AIController();
        this.keys = new Set();
        this.autoAdvanceTimer = null;
        this.finalAdvanceTimer = null;

        // フレームレート制御用変数
        this.lastTime = 0;
        this.accumulator = 0;

        this.setupInputListeners();
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    setupInputListeners() {
        window.addEventListener('keydown', e=>{
                if (settings.handleKeyDown(e)) return;
                if (e.code === 'Escape') { this.togglePauseMenu(); }
                if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
                this.keys.add(e.code);
                if (!e.repeat) this.handleActionPress(e.code);
            });
        window.addEventListener('keyup', e=>this.keys.delete(e.code));
        window.addEventListener('blur', () => {
                this.keys.clear();
                this.p1.isCharging = false; this.p2.isCharging = false;
                SoundFX.updateCharge('p1', false, 0); SoundFX.updateCharge('p2', false, 0);
                SoundFX.updateInashi('p1', false); SoundFX.updateInashi('p2', false);
            });
        window.addEventListener('resize', ()=>this.ui.resize());
    }

    /**
     * 「押した瞬間」に発生する操作（いなし・組み合い中の入力）を処理する。
     * キーボードのkeydownと、ゲームパッドのボタンが押された瞬間の
     * 両方から呼ばれるため、判定をここに集約している。
     */
    handleActionPress(code) {
        if (!this.state.active || this.state.paused) return;

        if (this.grapple.active) {
            this.handleGrappleInput(code);
            return;
        }
        if (code === this.p1.controls.u) this.handleInashi(this.p1, this.p2);
        if (code === this.p2.controls.u) this.handleInashi(this.p2, this.p1);
    }

    /** ゲームパッド側から押しっぱなし状態を反映するための入口 */
    setVirtualKey(code, pressed) {
        if (!code) return;
        if (pressed) {
            if (!this.keys.has(code)) {
                this.keys.add(code);
                this.handleActionPress(code);
            }
        } else {
            this.keys.delete(code);
        }
    }

    togglePauseMenu() {
        // 力士選出画面〜取組結果画面の一連でのみ開ける。タイトルや各選択画面では開かない。
        const isActive = (id) => { const el = document.getElementById(id); return !!(el && el.classList.contains('active')); };
        if (isActive('start-screen') || isActive('char-select-screen') || isActive('team-select-screen')) return;

        const wrapper = document.getElementById('game-wrapper');
        const wrapperShown = !!(wrapper && wrapper.style.display && wrapper.style.display !== 'none');
        const secretActive = isActive('team-secret-screen');
        if (!wrapperShown && !secretActive) return;

        const menu = document.getElementById('pause-menu');
        this.state.paused = !this.state.paused;

        if(this.state.paused) {
            menu.classList.add('active');
            // 音を止める
            SoundFX.updateCharge('p1', false, 0); SoundFX.updateCharge('p2', false, 0);
            SoundFX.updateInashi('p1', false); SoundFX.updateInashi('p2', false);
        } else {
            menu.classList.remove('active');
        }
    }
    async waitForPause() {
        if (!this.state.paused) return;
        while (this.state.paused) await new Promise(r => setTimeout(r, 100));
    }

    goToCharSelect(m, seType = 'random'){
        if (typeof SoundFX !== 'undefined') SoundFX.unlockSelectBGM();

        if(this.state.isTransitioning) return;
        this.state.isTransitioning = true;

        // トップ画面以外からの遷移ならアニメをオフにするフラグ
        const skipAnim = (seType !== 'random');

        if (seType !== 'none') {
            let soundFile = 'dosukoi';
            if (seType === 'random') {
                const sounds = ['dosukoi', 'gottyan', 'maninonrei'];
                soundFile = sounds[Math.floor(Math.random() * sounds.length)];
            } else {
                soundFile = seType;
            }
            const audio = new Audio(`assets/se/${soundFile}.mp3`);
            if (typeof SoundFX !== 'undefined') audio.volume = SoundFX.voiceVolume;
            audio.play().catch(()=>{});
        }

        const curtain = document.getElementById('transition-curtain');

        if(curtain) {
            curtain.classList.add('active');

            // 幕が閉まりきった暗闇の中(400ms)で画面を切り替え
            setTimeout(() => { this.ui.showCharSelect(m, skipAnim); }, 400);

            // 幕を開ける時間は通常の1500に戻す
            setTimeout(() => {
                    curtain.classList.remove('active');
                    this.state.isTransitioning = false;
                    if (typeof SoundFX !== 'undefined') SoundFX.playRandomSelectBGM();
                }, 1500);
        } else {
            this.ui.showCharSelect(m, skipAnim);
            this.state.isTransitioning = false;
            if (typeof SoundFX !== 'undefined') SoundFX.playRandomSelectBGM();
        }
    }

    selectChar(playerId, charId) {
        this.state.chars[playerId] = charId;

        // アイコンの選択状態更新
        document.querySelectorAll('.char-select-icon').forEach(icon => {
                if (playerId === 'p1') icon.classList.remove('p1-active');
                if (playerId === 'p2') icon.classList.remove('p2-active');
            });
        document.querySelectorAll('.char-select-icon').forEach(icon => {
                const id = parseInt(icon.dataset.id);
                if (this.state.chars.p1 === id) icon.classList.add('p1-active');
                if (this.state.chars.p2 === id) icon.classList.add('p2-active');
            });

        // 音声再生 (キャラ選択時)
        if (charId !== null) {
            const data = RIKISHI_DATA.find(d => d.id === charId);
            if (data && data.voice) SoundFX.playVoice(data.voice);
        }

        this.ui.updatePreview(playerId, charId);

        const p1Ready = this.state.chars.p1 !== null;
        const p2Ready = this.state.chars.p2 !== null;

        const container = document.getElementById('char-title-container'); // 親コンテナ
        const headerImg = document.getElementById('select-header-img');    // 画像
        const instrText = document.getElementById('select-instruction-text'); // テキスト
        const oldBtnContainer = document.getElementById('start-btn-container'); // 旧ボタン

        if (p1Ready && p2Ready) {
            // --- 【準備完了】 ---

            // 1. 親コンテナにクラス付与（これでCSSの黒帯などが発動）
            if (container) container.classList.add('torikumi-obi-mode');

            // 2. 画像変更 & エフェクトクラス付与 & クリックイベント
            if (headerImg) {
                headerImg.src = "assets/img/torikumikaishi.png";
                headerImg.classList.add('ready-aura'); // CSSで定義したオーラアニメーション

                // クリックイベント
                headerImg.onclick = () => {
                    this.startGame();
                };
            }

            // 3. テキスト変更
            if (instrText) {
                instrText.textContent = "↑ をクリックしてゲーム開始だ！";
                instrText.style = "";
            }

            // 4. 旧ボタンは非表示
            if (oldBtnContainer) oldBtnContainer.style.display = 'none';

        } else {
            // --- 【選択中】 ---

            // 1. クラス削除
            if (container) container.classList.remove('torikumi-obi-mode');

            // 2. 画像リセット
            if (headerImg) {
                headerImg.src = "assets/img/rikishisentaku.png";
                headerImg.classList.remove('ready-aura');
                headerImg.onclick = null;
            }

            // 3. テキストリセット
            if (instrText) {
                instrText.textContent = "顔をドラッグして体にドッキングさせろ！";
                instrText.style = "";
            }

            // 旧ボタン非表示のまま
            if (oldBtnContainer) oldBtnContainer.style.display = 'none';
        }
    }

    // 個人戦プレビューの CPU トグル切替（p1/p2 共通）
    toggleCPU(playerId, isCPU) {
        const container = document.getElementById(`preview-${playerId}`);
        if (isCPU) container.classList.add('cpu-active'); else container.classList.remove('cpu-active');
        this.ui.updatePreview(playerId, this.state.chars[playerId]);
    }

    kyujo() {
        if (typeof SoundFX !== 'undefined') { SoundFX.stopBGM(); if (SoundFX.stopVoices) SoundFX.stopVoices(); }
        if(this.autoAdvanceTimer) clearInterval(this.autoAdvanceTimer);
        if(this.finalAdvanceTimer) clearInterval(this.finalAdvanceTimer);

        if (this.currentRoundAudio) {
            this.currentRoundAudio.pause();
            this.currentRoundAudio = null;
        }

        this.state.active = false;
        this.state.tachiai = false;
        this.state.processingEnd = false;
        this.transitionTimer = 0;
        this.transitionAction = null;
        this.state.aborted = true;
        if (this.callHideTimer) clearTimeout(this.callHideTimer);

        if (this.ui && this.ui.els) {
            if (this.ui.els.dayOverlay) this.ui.els.dayOverlay.classList.remove('visible', 'instant');
            if (this.ui.els.res) this.ui.els.res.classList.remove('visible');
        }

        if(this.state.paused) {
            setTimeout(() => {
                    const menu = document.getElementById('pause-menu');
                    if(menu) menu.classList.remove('active');
                    this.state.paused = false;
                }, 400);
        }

        const inTeamFlow = this.state.isTeamMode
            || (typeof window.teamGame !== 'undefined' && window.teamGame.state && window.teamGame.state.isSecretPhase);
        if (inTeamFlow) {
            // 休場を押した瞬間にボイスを鳴らす
            const audio = new Audio(`assets/se/denaoshitekoi.mp3`);
            if (typeof SoundFX !== 'undefined' && SoundFX.voiceVolume !== undefined) audio.volume = SoundFX.voiceVolume;
            audio.play().catch(()=>{});

            // 団体戦は団体戦の力士選択画面へ戻す（denaoshitekoiと重複しないよう選択音は鳴らさない）
            if (window.teamGame && typeof window.teamGame.goToTeamSelect === 'function') {
                window.teamGame.state.isTransitioning = false;
                window.teamGame.state.isSecretPhase = false;
                window.teamGame.goToTeamSelect('none');
            } else {
                console.error("teamGame.goToTeamSelectメソッドが未実装です！");
            }
        } else {
            // 個人戦の場合
            this.goToCharSelect('init', 'denaoshitekoi');
        }
    }

    rematch(){
        if(this.finalAdvanceTimer) clearInterval(this.finalAdvanceTimer);
        if(this.autoAdvanceTimer) clearInterval(this.autoAdvanceTimer);

        // 再戦時にBGMを停止し、ランダム抽選の履歴をリセットする
        if (typeof SoundFX !== 'undefined') {
            SoundFX.stopBGM();
            SoundFX.currentRandomBgm = null;
        }

        this.startGame();
    }

    startGame(){
        if (this.state.chars.p1 === null || this.state.chars.p2 === null) return;
        // 勝ち抜きの2取組目以降（勝ち残りがいる）はBGMを止めず、1曲を流しっぱなしにする
        const isKachinukiContinue = (this.state.isTeamMode && typeof window.teamGame !== 'undefined'
            && window.teamGame.state.rule === 'kachinuki' && !!window.teamGame.state.kachinuki.carrySide);
        if (typeof SoundFX !== 'undefined' && !isKachinukiContinue) SoundFX.stopBGM();

        // 追加：最強のモーダル強制非表示ロジック
        const matchSelect = document.getElementById('match-count-select');
        if (matchSelect) {
            // パターン1: <dialog> タグなら正規の方法で閉じる
            const dialog = matchSelect.closest('dialog');
            if (dialog && typeof dialog.close === 'function') {
                dialog.close();
            } else {
                // パターン2: 右上の「×」ボタンを自動で探して疑似クリックする
                let p = matchSelect.parentElement;
                let closed = false;
                while(p && p.tagName !== 'BODY') {
                    const closeBtn = Array.from(p.querySelectorAll('button, .close-btn')).find(b => b.textContent.includes('×') || b.innerHTML.includes('×'));
                    if (closeBtn) {
                        closeBtn.click();
                        closed = true;
                        break;
                    }
                    p = p.parentElement;
                }
                // パターン3: それでもダメなら、画面に浮いている親枠を強制的に透明にする
                if (!closed) {
                    let parent = matchSelect.parentElement;
                    while (parent && parent.tagName !== 'BODY') {
                        const style = window.getComputedStyle(parent);
                        if (style.position === 'fixed' || style.position === 'absolute' || parent.classList.contains('modal-overlay')) {
                            parent.classList.remove('active', 'show', 'visible');
                            if (parent.style.display !== '') parent.style.display = 'none';
                            break;
                        }
                        parent = parent.parentElement;
                    }
                }
            }
        }
        this.p1.controls = settings.current.controls.p1;
        this.p2.controls = settings.current.controls.p2;
        this.ui.updateControlsDisplay();
        this.state.matches = parseInt(document.getElementById('match-count-select').value);
        this.state.deuce = document.getElementById('deuce-check').checked;
        if (this.state.isTeamMode) {
            this.state.matches = 1; // 団体戦は1取組ずつ進行する
            this.state.deuce = false;
        }
        let p1IsCPU = document.getElementById('cpu-toggle-p1')?.checked || false;
        let p2IsCPU = document.getElementById('cpu-toggle-p2')?.checked || false;
        let p1Level = parseInt(document.getElementById('cpu-level-p1')?.value || 3);
        let p2Level = parseInt(document.getElementById('cpu-level-p2')?.value || 3);
        // 団体戦：出場中の力士のスロット設定（人間/CPU・段位）で上書き
        if (this.state.isTeamMode && this.state.teamCPUOverride) {
            p1IsCPU = this.state.teamCPUOverride.p1.isCPU;
            p2IsCPU = this.state.teamCPUOverride.p2.isCPU;
            p1Level = this.state.teamCPUOverride.p1.level;
            p2Level = this.state.teamCPUOverride.p2.level;
        }
        const p1Data = RIKISHI_DATA.find(d=>d.id===this.state.chars.p1);
        const p2Data = RIKISHI_DATA.find(d=>d.id===this.state.chars.p2);
        // 画像パスの補正
        const getImg = (img) => this.ui.getImagePath(img);
        const p1DataFixed = { ...p1Data, img: getImg(p1Data.img) };
        const p2DataFixed = { ...p2Data, img: getImg(p2Data.img) };

        this.p1.setData(p1DataFixed);
        this.p2.setData(p2DataFixed);
        this.p1.isCPU = p1IsCPU;
        this.p2.isCPU = p2IsCPU;
        this.p1.cpuLevel = p1Level;
        this.p2.cpuLevel = p2Level;
        this.state.current=1; this.state.wins={p1:0,p2:0}; this.state.inDecider = false;
        this.state.deciderRound = 0;
        this.state.aborted = false;
        this.deciderVoicePlayed = false;
        document.getElementById('p1-cpu-badge').style.display = p1IsCPU ? 'inline-block' : 'none';
        document.getElementById('p2-cpu-badge').style.display = p2IsCPU ? 'inline-block' : 'none';
        document.getElementById('p1-controls').style.opacity = p1IsCPU ? '0.3' : '1';
        document.getElementById('p2-controls').style.opacity = p2IsCPU ? '0.3' : '1';
        document.querySelector('#p1 .body-img').src = `assets/img/${bodyImageFile('p1', p1IsCPU, p1Data)}`;
        document.querySelector('#p2 .body-img').src = `assets/img/${bodyImageFile('p2', p2IsCPU, p2Data)}`;

        // 追加：操作説明エリアに選択した顔画像を表示
        const p1FaceEl = document.getElementById('p1-control-face');
        if (p1FaceEl) p1FaceEl.style.backgroundImage = `url('${p1DataFixed.img}')`;

        const p2FaceEl = document.getElementById('p2-control-face');
        if (p2FaceEl) p2FaceEl.style.backgroundImage = `url('${p2DataFixed.img}')`;

        this.ui.showGameScreen();
        SoundFX.init();
        // 団体戦は「先鋒戦」画面で 1P→2P の順に顔・名前・ボイスを紹介してから開始する
        if (this.state.isTeamMode && typeof window.teamGame !== 'undefined' && window.teamGame.state.rule === 'kachinuki') {
            // 勝ち抜きは冒頭で全ポジションを発表済みのため、取組ごとの紹介は挟まずすぐ開始
            this.startMatch(true);
        } else if (this.state.isTeamMode && this.ui && typeof this.ui.playTeamIntro === 'function') {
            this.ui.playTeamIntro().then(() => this.startMatch(true));
        } else {
            this.startMatch(true);
        }
    }

    async startMatch(skipFadeIn = false){
        if(this.autoAdvanceTimer) { clearInterval(this.autoAdvanceTimer); this.autoAdvanceTimer = null; }

        // エフェクト削除
        const stage = document.getElementById('stage');
        if(stage) stage.classList.remove('danger-left', 'danger-right');

        [this.p1, this.p2].forEach(p => {
                if(p.el) p.el.classList.remove('aura-yellow', 'aura-blue', 'stunned', 'is-defeated', 'fall-left', 'fall-right');
                const body = p.el.querySelector('.rikishi-body');
                if(body) { body.style.filter = ''; body.style.transform = ''; }
            });

        this.ui.resetVisuals(this.p1, this.p2);
        this.p1.resetState(); this.p2.resetState();

        // 勝ち抜き：勝ち残った側は前の取組の「体力上限値」と「残HP」を引き継ぐ（残HPが20未満で勝った場合は20まで回復）
        if (this.state.isTeamMode && typeof window.teamGame !== 'undefined' && window.teamGame.state.rule === 'kachinuki') {
            const k = window.teamGame.state.kachinuki;
            if (k && k.carrySide) {
                const p = (k.carrySide === 'p1') ? this.p1 : this.p2;
                // 体力上限値（減った値）を引き継ぐ。initialMaxStamina（バー基準）は満タンのまま残す。
                if (k.carryMaxStamina && k.carryMaxStamina > 0) p.maxStamina = k.carryMaxStamina;
                let s = k.carryStamina;
                if (s < 20) s = 20;                       // 残HP20未満で勝ったら20まで回復
                if (p.maxStamina < s) p.maxStamina = s;    // 上限が回復値を下回らないように引き上げる
                p.stamina = s;
            }
        }

        const centerX = cfg('SYSTEM.CENTER_X', 600);
        const offset = cfg('SYSTEM.START_OFFSET', 250);
        this.p1.x = centerX - offset;
        this.p2.x = centerX + (offset - 130);

        this.p1.reversalActive = false;
        this.p2.reversalActive = false;

        // ロックフラグのリセット
        this.p1.uLock = false;
        this.p2.uLock = false;

        this.p1.inashiStumble = 0; this.p1.stumbleDir = 0;
        this.p2.inashiStumble = 0; this.p2.stumbleDir = 0;
        this.p1.inashiTimer = 0; this.p2.inashiTimer = 0;
        SoundFX.updateInashi('p1', false); SoundFX.updateInashi('p2', false);

        this.grapple = { active: false, master: null, slave: null };
        this.state.processingEnd = false;
        this.lastHit = null;
        this.keys.clear();

        this.aiP1.reset(); this.aiP2.reset();
        this.aiP1.aiKeys.clear(); this.aiP2.aiKeys.clear();

        this.ui.els.grappleInd.style.display = 'none';

        // 勝星表示（団体戦はチームの勝星、個人戦は個人の勝星）
        if (this.state.isTeamMode && typeof window.teamGame !== 'undefined') {
            this.ui.els.p1Wins.textContent = window.teamGame.state.teamWins.p1 + '勝';
            this.ui.els.p2Wins.textContent = window.teamGame.state.teamWins.p2 + '勝';
        } else {
            this.ui.els.p1Wins.textContent = this.state.wins.p1 + '勝';
            this.ui.els.p2Wins.textContent = this.state.wins.p2 + '勝';
        }

        const resOverlay = document.getElementById('result-overlay');
        resOverlay.classList.remove('final-mode', 'visible');
        document.getElementById('match-info').innerHTML = '';
        document.getElementById('kimarite-display').textContent = '';
        document.getElementById('win-message').textContent = '';

        const nextBtn = document.getElementById('next-btn');
        nextBtn.style.display = 'inline-block'; nextBtn.disabled = false;

        this.ui.els.call.style.display='block'; this.ui.els.call.textContent = '';
        this.ui.setGyojiImage('hakkeyoi');
        this.ui.els.gyoji.classList.remove('flipped');
        this.ui.els.gyoji.style.transform = 'scaleX(1)';

        const roundName = this.getRoundName();
        const isKachinuki = (this.state.isTeamMode && typeof window.teamGame !== 'undefined' && window.teamGame.state.rule === 'kachinuki');
        if (isKachinuki) {
            // 勝ち抜きは発表を冒頭で済ませているため、ラウンド表示や演出待機を挟まず、暗転を解いてすぐ試合開始する
            if (this.state.aborted) return;
            this.ui.els.dayOverlay.classList.remove('visible');
            await this.waitForPause();
            if (this.state.aborted) return;
        } else {
        if (!skipFadeIn) {
            this.ui.els.dayOverlay.textContent = roundName;
            this.ui.els.dayOverlay.classList.add('visible');
        }

        // 修正: 最初の試合ならラウンド名に関わらず必ず拍子木を鳴らす
        const isFirstMatch = (roundName === "初日" || (this.state.current === 1 && !this.state.isTeamMode && !this.state.inDecider));

        if (isFirstMatch) {
            this.currentRoundAudio = new Audio('assets/se/hyoshigi.mp3');
            if (typeof SoundFX !== 'undefined') this.currentRoundAudio.volume = SoundFX.seVolume !== undefined ? SoundFX.seVolume : 1.0;
            this.currentRoundAudio.play().catch(()=>{});

            // 一戦設定（千秋楽）は拍子木の終了を待たず、表示と同時にボイスを再生（ラグ解消）
            if (roundName === "千秋楽") {
                await this.playRoundVoice('sennsyuuraku.mp3', 2000);
            } else {
                await wait(2500);
            }
        }
        else if (roundName === "中日" || roundName === "中堅戦") {
            if (roundName === "中日") await this.playRoundVoice('nakabi.mp3', 2000);
            else await wait(2000);
        }
        else if (roundName.startsWith("優勝決定戦") || roundName === "代表戦") {
            if (!this.deciderVoicePlayed && roundName.startsWith("優勝決定戦")) {
                await this.playRoundVoice('yuusyouketteisen.mp3', 2000);
                this.deciderVoicePlayed = true;
            }
            else { await wait(2000); }
        }
        else if (roundName === "千秋楽" || roundName === "大将戦") {
            if (roundName === "千秋楽") await this.playRoundVoice('sennsyuuraku.mp3', 2000);
            else await wait(2000);
        }
        else { await wait(2000); }

        // 追加: 演出待機中に休場されていたら処理を消滅
        if (this.state.aborted) return;

        await this.waitForPause();
        if (this.state.aborted) return; // 休場チェック

        this.ui.els.dayOverlay.classList.remove('visible'); await wait(500);

        await this.waitForPause();
        if (this.state.aborted) return; // 休場チェック
        }

        if (typeof SoundFX !== 'undefined') {
            SoundFX.playRandomBGM();
        }
        const startCalls = [ { id: 'mattanashi', text: '待ったなし！' }, { id: 'kamaete', text: '構えて！' }, { id: 'tewotuite', text: '手を着いて！' }, { id: 'koshiwooroshite', text: '腰を下ろして！' } ];
        const selectedCall = startCalls[Math.floor(Math.random() * startCalls.length)];
        // 団体戦の暗幕(maku)演出中は、幕が引け切ってから開始コールを出す
        await this.waitForCurtain();
        if (this.state.aborted) return;
        // 団体戦では幕の裏でトーストが出てしまうため、幕が引けてから曲名表示を出し直す
        if (this.state.isTeamMode && typeof SoundFX !== 'undefined' && SoundFX.currentTrackName && this.ui.showBGMToast) {
            this.ui.showBGMToast(SoundFX.currentTrackName);
        }
        this.ui.els.call.innerHTML = selectedCall.text;
        this.keys.clear();
        await SoundFX.playVoice(selectedCall.id);

        // 追加: 音声再生後にも休場チェック
        if (this.state.aborted) return;

        await this.waitForPause();
        if (this.state.aborted) return;

        this.state.tachiai = true;
        this.state.active = false;
        this.ui.draw(this.p1, this.p2);
    }
    waitForCurtain() {
        return new Promise((resolve) => {
                const curtain = document.getElementById('transition-curtain');
                if (!curtain || !curtain.classList.contains('active')) { resolve(); return; }
                let waited = 0;
                const iv = setInterval(() => {
                        waited += 50;
                        if (!curtain.classList.contains('active') || waited > 2000) { clearInterval(iv); resolve(); }
                    }, 50);
            });
    }
    async playRoundVoice(file, waitTime) {
        // 再生するAudioを変数に保持する
        this.currentRoundAudio = new Audio(`assets/se/${file}`);
        try {
            await new Promise((resolve) => {
                    this.currentRoundAudio.onended = resolve;
                    this.currentRoundAudio.onerror = resolve;
                    this.currentRoundAudio.play().catch(resolve);
                });
        } catch (e) { await wait(waitTime); }
    }

    loop(timestamp){
        requestAnimationFrame(this.loop);

        // 初回呼び出し時の初期化
        if (!this.lastTime) this.lastTime = timestamp;
        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;

        // ポーズ中はここでリターン（時間が進まない）
        if (this.state.paused) {
            this.accumulator = 0;
            this.ui.draw(this.p1, this.p2);
            if (this.p1.animClass) this.p1.el.classList.add(this.p1.animClass);
            if (this.p2.animClass) this.p2.el.classList.add(this.p2.animClass);
            return;
        }

        // 修正：タイマー＆アクション実行処理
        if (this.state.processingEnd && this.transitionTimer > 0) {
            this.transitionTimer--; // 1フレーム減らす

            // 時間が来たら...
            if (this.transitionTimer <= 0) {

                // 予約されたアクションがあれば実行（例：endRound）
                if (this.transitionAction) {
                    this.transitionAction();
                    this.transitionAction = null; // 実行したら空にする
                }
                // アクションがない場合はデフォルトで次へ（念のため）
                else {
                    this.nextMatch();
                }
                return;
            }
        }

        // 固定タイムステップ (150FPS = 6.66ms) 高リフレッシュレートの挙動を再現
        const FIXED_STEP = 1000 / 60;

        // 経過時間を蓄積（最大100msでキャップして、タブ切り替え復帰時などの「死の螺旋」を防ぐ）
        this.accumulator += Math.min(deltaTime, 100);

        // 蓄積した時間が固定ステップ以上ある限り、ロジックを回す
        let steps = 0;
        while (this.accumulator >= FIXED_STEP) {
            this.updatePhysics(); // ロジック更新メソッドを分離
            this.accumulator -= FIXED_STEP;

            steps++;
            if (steps >= 20) { // 安全装置: ステップ数が増えるため上限を緩和
                this.accumulator = 0;
                break;
            }
        }

        // 描画処理 (Render)
        // ロジックの状態に関わらず、現在の状態を描画する
        if (this.state.active) {
            this.ui.draw(this.p1, this.p2);
            this.updateVisualEffects();
            if (this.p1.animClass) this.p1.el.classList.add(this.p1.animClass);
            if (this.p2.animClass) this.p2.el.classList.add(this.p2.animClass);
        } else if (!this.state.tachiai) {
            // 試合終了後など（立ち合い待機中以外）
            SoundFX.updateCharge('p1',0); SoundFX.updateCharge('p2',0);
            this.ui.draw(this.p1, this.p2);
            this.updateVisualEffects();
            if (this.p1.animClass) this.p1.el.classList.add(this.p1.animClass);
            if (this.p2.animClass) this.p2.el.classList.add(this.p2.animClass);
        }
        // 立ち合い中(tachiai=true)は入力待ちで画面更新の必要がないため描画スキップ（元の挙動準拠）
    }

    // 物理・ゲームロジックのみを行うメソッド（1フレーム分の処理）
    updatePhysics() {
        if (this.ui.els.wrapper.style.display === 'none') return;
        if (this.state.tachiai) {
            let p1Ready = [...this.keys].some(k => Object.values(this.p1.controls).includes(k));
            if(this.p1.isCPU) p1Ready = true;
            let p2Ready = [...this.keys].some(k => Object.values(this.p2.controls).includes(k));
            if(this.p2.isCPU) p2Ready = true;

            if (p1Ready && p2Ready) {
                this.state.tachiai = false;
                this.state.active = true;
                this.ui.setGyojiImage('nokotta');
                this.ui.els.call.textContent = 'のこった！';
                SoundFX.playVoice('nokotta');
                this.ui.startGyojiCalls(() => this.state.active && !this.state.paused);

                // 変更: 非表示タイマーを変数に保存する
                if (this.callHideTimer) clearTimeout(this.callHideTimer);
                this.callHideTimer = setTimeout(() => this.ui.els.call.style.display = 'none', 800);
            } else return;
        }

        if(!this.state.active) return;

        const staminaMaxDecay = cfg('STAMINA.MAX_DECAY', 0.02);

        const getDecayMod = (p) => {
            if (!p.spiritActive) return 1.0;
            const spirit = p.baseStats.spirit || 5;
            return Math.max(0.1, 1.5 - (spirit * 0.1));
        };

        this.p1.maxStamina = Math.max(1, this.p1.maxStamina - (staminaMaxDecay * getDecayMod(this.p1)));
        this.p2.maxStamina = Math.max(1, this.p2.maxStamina - (staminaMaxDecay * getDecayMod(this.p2)));
        this.p1.stamina = Math.min(this.p1.stamina, this.p1.maxStamina);
        this.p2.stamina = Math.min(this.p2.stamina, this.p2.maxStamina);

        let p1AIKeys = null;
        let p2AIKeys = null;
        if(this.p1.isCPU) p1AIKeys = this.aiP1.think(this.p1, this.p2, this.grapple);
        if(this.p2.isCPU) p2AIKeys = this.aiP2.think(this.p2, this.p1, this.grapple);

        if (this.grapple.active) {
            this.updateGrappleState(p1AIKeys, p2AIKeys);
        } else {
            this.updatePlayer(this.p1, this.p2, this.p1.controls, p1AIKeys);
            this.updatePlayer(this.p2, this.p1, this.p2.controls, p2AIKeys);
            this.physics();
        }

        this.checkStaminaEvents();
        this.checkWin();
    }

    checkStaminaEvents() {
        if (this.p1.recoveryDelay > 0) this.p1.recoveryDelay--;
        if (this.p2.recoveryDelay > 0) this.p2.recoveryDelay--;
        if (this.p1.chargeLock > 0) this.p1.chargeLock--;
        if (this.p2.chargeLock > 0) this.p2.chargeLock--;
    }

    // game.js の updatePlayer メソッド

    updatePlayer(p, opp, k, aiKeys) {
        // --- 1. スタン（気絶）のカウント処理 ---
        if (p.stun > 0) {
            p.stun--;
            p.el.classList.add('stunned');
            SoundFX.updateCharge(p.id, 0);

            // 追加: スタン中は「いなし音」を確実に止める
            SoundFX.updateInashi(p.id, false);

            // フラグはオフにする
            p.isPushing = false;
            p.isCharging = false;
            p.wantsFwd = false;

            // 修正: ここで return せず、下の「クールタイム処理」へ進ませます！
            // これにより、気絶中もクールタイムが正しく消化されます。
        } else {
            p.el.classList.remove('stunned');
        }

        // ミス硬直（操作不能）の処理
        if (p.miss > 0) {
            p.miss--;
            // 操作不能なので、フラグ類はオフにする
            p.isPushing = false;
            p.isCharging = false;
            p.wantsFwd = false;
            SoundFX.updateCharge(p.id, false, 0);

            // ※ここではreturnせず、下の入力監視を通してから return するように変更！
        }

        const press = code => p.isCPU ? aiKeys?.has(code) : this.keys.has(code);

        const stats = p.getStats(opp);
        const hitDist = cfg('GAME_RULES.HIT_DIST', 100);
        const isTouching = Math.abs(p.x - opp.x) <= hitDist;
        const facingRight = p.x < opp.x;
        const dir = facingRight ? 1 : -1;

        // --- 2. クールタイム・物理リバウンド処理 (気絶中も実行される必要がある) ---
        if (p.cooldown > 0) {
            const friction = cfg('PHYSICS.FRICTION', 0.85);
            p.x += p.rebound;
            p.rebound *= friction;
            p.cooldown--;
            SoundFX.updateCharge(p.id, 0);
            if (Math.abs(p.rebound) < 0.1) p.rebound = 0;
            return; // 物理挙動中なので、ここで入力処理は打ち切り
        }

        // 【重要】入力状態の監視とロック更新を「硬直チェックの前」に行う
        // これにより、硬直中であっても「キーが押され続けている」状態を追跡し続けられるため、
        // 硬直明けに「新規の入力」と誤認して暴発するのを防ぐことができる。

        const rawInputU = p.isCPU ? false : press(k.u);
        let triggerU = false;

        if (rawInputU) {
            if (!p.uLock) {
                triggerU = true; // 押した瞬間だけ true
                p.uLock = true;
            }
        } else {
            p.uLock = false; // 離したらロック解除
        }

        // --- 3. 気絶・ミス硬直中の入力ブロック ---
        // ここで初めてリターンする
        if (p.stun > 0 || p.miss > 0) {
            return;
        }

        if (p.isCPU && p.inashiStumble > 0) {
            p.inashiStumble--;
            p.x += (2.8 * 1.5) * p.stumbleDir;
            p.el.classList.add('stunned'); return;
        }

        if (p.inashiTimer > 0) {
            if (p.inashiTimer === 1) {
                const missPenalty = cfg('STAMINA.MISS_PENALTY', 20);

                // 修正: HPが1より大きい時のみダメージ計算・表示を行う
                if (p.stamina > 1) {
                    p.stamina = Math.max(1, p.stamina - missPenalty);
                    this.ui.showDamage(p, missPenalty);
                }

                const recoveryWait = cfg('STAMINA.RECOVERY_DELAY', 200);
                p.recoveryDelay = recoveryWait;

                // 修正: メッセージ削除 & スタン適用
                if (p.pendingStun > 0) {
                    p.stun = p.pendingStun;
                    p.pendingStun = 0;
                    // メッセージ表示 (this.ui.msg) は削除
                }
            }
            p.inashiTimer--;
            SoundFX.updateInashi(p.id, true);
            return;
        } else {
            SoundFX.updateInashi(p.id, false);
        }

        let wantsFwd = false; let wantsBack = false;
        if (p.isCPU) {
            const keyFwd = facingRight ? k.r : k.l; const keyBack = facingRight ? k.l : k.r;
            wantsFwd = press(keyFwd); wantsBack = press(keyBack);
        } else {
            const inputR = press(k.r); const inputL = press(k.l);
            if (facingRight) { wantsFwd = inputR; wantsBack = inputL; } else { wantsFwd = inputL; wantsBack = inputR; }
        }
        p.wantsFwd = wantsFwd;

        // --- プレイヤーのいなし入力 (スタミナ不足ならミス) ---
        // 上キー入力があり、かつ動ける状態なら

        if (triggerU && p.cooldown <= 0 && !p.isPushing && !p.isCharging) {
            // ミスになるスタミナ閾値（設定値またはデフォルト15）
            const missThresh = 15;

            // スタミナ不足でミスになる場合
            if (p.stamina < missThresh) {
                const missPenalty = cfg('STAMINA.MISS_PENALTY', 20);

                p.miss = 60; // 長期間の操作不能（灰色になる）
                p.stamina = Math.max(0, p.stamina - 10); // スタミナも少し減る

                // いなし音を「即座に停止(true)」し、ミス音を鳴らす
                SoundFX.updateInashi(p.id, false, true);
                SoundFX.playTone('miss');

                return; // ここで処理を終わらせる（いなし状態にはならない）
            }

            // スタミナ充分で成功（いなし開始）
            p.inashiTimer = cfg('ACTION.INASHI_DURATION_BASE', 20);

            // いなし音を開始
            SoundFX.updateInashi(p.id, true);
            return;
        }

        if (p.isCPU && press(k.u)) {
            this.handleInashi(p, opp);
            if (p.inashiTimer > 0) return;
        }

        const chargeThreshold = p.isCharging ? 0.0 : 3.0;
        const canCharge = p.stamina > chargeThreshold && p.chargeLock === 0;
        let charging = press(k.d) && canCharge;

        if (charging) {
            const techRate = cfg('STATUS.TECH_CHARGE_RATE', 0.25);
            const gain = (cfg('CHARGE.BASE_GAIN', 0.3)) * (1 + (stats.tech - 5) * techRate);
            p.charge = Math.min(100, p.charge + gain);

            const costVal = cfg('STAMINA.CHARGE_COST', 0.5);
            p.stamina = Math.max(0, p.stamina - (isTouching ? costVal : costVal * 0.5));

            if (p.stamina <= 0.0) {
                p.stamina = 0; p.charge = 0; p.chargeLock = 40; charging = false;
            }
        } else {
            p.charge = 0;
        }
        p.isCharging = charging;
        SoundFX.updateCharge(p.id, charging, p.charge);

        const speedBase = cfg('ACTION.SPEED_BASE', 2.8);
        const recoverMove = cfg('STAMINA.RECOVER_MOVE', 0.1);
        const recoverIdle = cfg('STAMINA.RECOVER_IDLE', 0.3);

        p.isPushing = false;
        if (wantsFwd && !wantsBack) {
            p.isPushing = true;
            const spd = (charging ? speedBase * 0.3 : speedBase) * (1 + (stats.speed - 5) * 0.15);
            if (!isTouching) {
                p.x += spd * dir;
                if (!charging && p.recoveryDelay <= 0) {
                    p.stamina = Math.min(p.maxStamina, p.stamina + recoverMove);
                }
            } else {
                p.stamina = Math.max(0, p.stamina - (cfg('STAMINA.PUSH_COST', 0.3)));
            }
        } else if (wantsBack) {
            const spd = (speedBase * 0.8) * (1 + (stats.speed - 5) * 0.15);
            p.x -= spd * dir;
            if (!isTouching && !charging && p.recoveryDelay <= 0) {
                p.stamina = Math.min(p.maxStamina, p.stamina + recoverMove);
            }
        } else if (!charging && p.recoveryDelay <= 0) {
            p.stamina = Math.min(p.maxStamina, p.stamina + recoverIdle);
        }
    }

    physics() {
        if (this.grapple.active || this.state.processingEnd) return;

        const d = Math.abs(this.p1.x - this.p2.x);
        const hitDist = cfg('GAME_RULES.HIT_DIST', 100);

        if (d <= hitDist + 30) {
            if (this.p1.inashiTimer > 0 && this.p2.wantsFwd) {
                this.triggerInashiSuccess(this.p1, this.p2);
                this.checkWin(); return;
            }
            if (this.p2.inashiTimer > 0 && this.p1.wantsFwd) {
                this.triggerInashiSuccess(this.p2, this.p1);
                this.checkWin(); return;
            }
        }

        if (d <= hitDist) {
            // 追加: 立ち合いでの「ぶちかまし」判定
            const buchiThresh = cfg('CHARGE.THRESHOLDS.SUPER_PUSH', 50);

            // 【修正点】: チャージ量に加え、isPushing（相手方向への移動入力）がある場合のみ発動
            const p1Buchi = this.p1.charge >= buchiThresh && this.p1.isPushing && this.p1.cooldown <= 0 && this.p1.stun <= 0;
            const p2Buchi = this.p2.charge >= buchiThresh && this.p2.isPushing && this.p2.cooldown <= 0 && this.p2.stun <= 0;

            if (p1Buchi && p2Buchi) {
                // ■ パターン1: 両者とも条件達成 -> 相打ち（大激突）
                this.p1.charge -= buchiThresh;
                this.p2.charge -= buchiThresh;

                this.ui.fx(this.p1, this.p2, 'super'); // ド派手なエフェクト
                SoundFX.playHit(true);

                this.ui.msg(this.p1, "ぶちかまし！");
                this.ui.msg(this.p2, "ぶちかまし！");

                // ダメージ計算（superPushの計算式を流用して両者に適用）
                const s1 = this.p1.getStats(this.p2);
                const s2 = this.p2.getStats(this.p1);
                const baseDmg = cfg('DAMAGE.BASE_THRUST', 5);
                const pwrRate = cfg('DAMAGE.THRUST_PWR_RATE', 1.0);

                const dmgToP2 = baseDmg + (s1.power * pwrRate);
                const dmgToP1 = baseDmg + (s2.power * pwrRate);

                this.p1.maxStamina -= dmgToP1; this.p1.stamina -= dmgToP1;
                this.p2.maxStamina -= dmgToP2; this.p2.stamina -= dmgToP2;

                this.ui.showDamage(this.p1, dmgToP1, 'crit');
                this.ui.showDamage(this.p2, dmgToP2, 'crit');

                // 強烈なリバウンド（相打ちなので両方弾き飛ぶ）
                const rbVel = 20; // 通常の衝突より強い
                this.p1.rebound = -1 * rbVel; // P1は左へ
                this.p2.rebound = 1 * rbVel;  // P2は右へ
                // 相打ちのダウンタイムも各力士のハヤサに応じて変動（基準フレームは通常より長い）
                const clashBase = cfg('ACTION.BUCHI_CLASH_DOWNTIME_BASE', 40);
                this.p1.cooldown = this.getBuchiDowntime(s1.speed, clashBase);
                this.p2.cooldown = this.getBuchiDowntime(s2.speed, clashBase);

                this.checkWin();
                return;
            }
            else if (p1Buchi) {
                // ■ パターン2: P1だけ発動
                const dir = (this.p1.x < this.p2.x) ? 1 : -1;
                this.superPush(this.p1, this.p2, dir);
                return;
            }
            else if (p2Buchi) {
                // ■ パターン3: P2だけ発動
                const dir = (this.p2.x < this.p1.x) ? 1 : -1;
                this.superPush(this.p2, this.p1, dir);
                return;
            }

            // 【最優先】相手がスタン中なら、接触した瞬間に「寄り（Grapple）」に移行する
            // ※自分のクールタイムだけチェックし、相手のクールタイム(被弾硬直など)は無視して掴む
            if (this.p2.stun > 0 && this.p1.isPushing && this.p1.cooldown <= 0) {
                this.startGrapple(this.p1, this.p2);
                return;
            }
            if (this.p1.stun > 0 && this.p2.isPushing && this.p2.cooldown <= 0) {
                this.startGrapple(this.p2, this.p1);
                return;
            }

            const s1 = this.p1.getStats(this.p2);
            const s2 = this.p2.getStats(this.p1);
            const k = 3;

            const recoveryWait = cfg('STAMINA.RECOVERY_DELAY', 200);

            if (this.p1.isPushing && this.p2.isPushing && this.p1.cooldown <= 0) {
                const rbVel = cfg('ACTION.REBOUND_VELOCITY', 8);
                const dir = (this.p1.x < this.p2.x) ? 1 : -1;

                this.p1.rebound = -dir * ((s2.power + k) / (s1.power + k)) * rbVel;
                this.p2.rebound =  dir * ((s1.power + k) / (s2.power + k)) * rbVel;

                // スプシから倍率を取得（設定がない場合はデフォルト0.5）
                const rate = cfg('DAMAGE.CLASH_POWER_RATE', 0.5);

                // スプシの倍率を使って計算（10のチカラなら 10 * 0.5 = 5ダメージ）
                let p1Dmg = s2.power * rate;
                let p2Dmg = s1.power * rate;
                if (this.p1.stamina <= 1 && this.p2.stamina <= 1) {
                    p1Dmg = 0; p2Dmg = 0;
                }

                if (p1Dmg > 0) {
                    this.p1.stamina -= p1Dmg;
                    this.p1.maxStamina -= p1Dmg;
                    this.p1.recoveryDelay = recoveryWait;
                }
                if (p2Dmg > 0) {
                    this.p2.stamina -= p2Dmg;
                    this.p2.maxStamina -= p2Dmg;
                    this.p2.recoveryDelay = recoveryWait;
                }

                if (p1Dmg > 0) this.ui.showDamage(this.p1, p1Dmg);
                if (p2Dmg > 0) this.ui.showDamage(this.p2, p2Dmg);

                this.p1.cooldown = cfg('ACTION.COOLDOWN_TIME', 10);
                this.p2.cooldown = cfg('ACTION.COOLDOWN_TIME', 10);

                this.ui.fx(this.p1, this.p2, 'col');
                SoundFX.playHit(false);
                this.checkWin(); return;
            }

            if (this.p1.isPushing && !this.p2.isPushing && this.p1.cooldown <= 0 && this.p2.cooldown <= 0) {
                this.startGrapple(this.p1, this.p2);
                return;
            } else if (this.p2.isPushing && !this.p1.isPushing && this.p1.cooldown <= 0 && this.p2.cooldown <= 0) {
                this.startGrapple(this.p2, this.p1);
                return;
            }

            const overlap = (hitDist - d) / 2;
            if (this.p1.x < this.p2.x) { this.p1.x -= overlap; this.p2.x += overlap; }
            else { this.p1.x += overlap; this.p2.x -= overlap; }

            const ST = CONFIG.STATUS || {};
            const pushBase = ST.PUSH_BASE_RATE || 0.1;
            const distConv = ST.PUSH_DIST_CONVERT || 1.0;

            let moveForce = (s1.power - s2.power) * pushBase * distConv;
            if (moveForce > 0 && this.p2.isCharging) moveForce /= (ST.PUSH_VS_CHARGE || 1.5);
            else if (moveForce < 0 && this.p1.isCharging) moveForce /= (ST.PUSH_VS_CHARGE || 1.5);

            this.p1.x += moveForce;
            this.p2.x += moveForce;

            const moveCost = cfg('STAMINA.MOVE_COST', 0.15);
            const pwrDmgRate = ST.PWR_DMG_RATE || 0.1;

            if (moveForce > 0) {
                // P1が押している（P2にダメージ）
                const pwrBonus = Math.max(0, (s1.power - 5) * pwrDmgRate);
                let finalDmg = moveCost + pwrBonus;

                // 修正: 相手がスタン中は、接触ダメージを 0 にする
                // これでマシンガンダメージが止まります。
                // (ダメージは入りませんが、相手は抵抗できないので一方的に土俵外へ運べます)
                if (this.p2.stun > 0) {
                    finalDmg = 0;
                }

                if (finalDmg > 0) {
                    this.p2.stamina -= finalDmg;
                    this.p2.recoveryDelay = recoveryWait;
                    // ダメージがある時だけ表示
                    if(Math.random() < 0.1 || finalDmg > 1.0) this.ui.showDamage(this.p2, finalDmg);
                }

                this.checkWin();
            } else if (moveForce < 0) {
                // P2が押している（P1にダメージ）
                const pwrBonus = Math.max(0, (s2.power - 5) * pwrDmgRate);
                let finalDmg = moveCost + pwrBonus;

                // 修正: こちらも同様にスタン中はダメージ 0
                if (this.p1.stun > 0) {
                    finalDmg = 0;
                }

                if (finalDmg > 0) {
                    this.p1.stamina -= finalDmg;
                    this.p1.recoveryDelay = recoveryWait;
                    if(Math.random() < 0.1 || finalDmg > 1.0) this.ui.showDamage(this.p1, finalDmg);
                }

                this.checkWin();
            }
        }
    }

    triggerInashiSuccess(p, opp) {
        SoundFX.updateInashi(p.id, false, true);
        p.inashiTimer = 0;
        p.lastParry = Date.now();
        this.ui.fx(p, opp, 'parry');
        SoundFX.playTone('parry');
        this.ui.msg(p, "いなし！", false, true);

        // 追加: いなされた側はチャージリセット
        opp.charge = 0;
        opp.isCharging = false;
        SoundFX.updateCharge(opp.id, false, 0);

        const swapDist = cfg('ACTION.SWAP_DIST_NORMAL', 80);

        const oppStats = opp.getStats(p);
        const rate = (CONFIG.DAMAGE && CONFIG.DAMAGE.INASHI_RATE !== undefined) ? CONFIG.DAMAGE.INASHI_RATE : 1.0;
        const inashiDamage = oppStats.power * rate;

        opp.maxStamina = Math.max(0, opp.maxStamina - inashiDamage);
        opp.stamina = Math.min(opp.stamina, opp.maxStamina);

        const recoveryWait = cfg('STAMINA.RECOVERY_DELAY', 200);
        opp.recoveryDelay = recoveryWait;

        this.swap(opp, p, swapDist);

        this.ui.showDamage(opp, inashiDamage);

        if (opp.isCPU) {
            const stumbleDur = cfg('ACTION.STUMBLE_DURATION', 40);
            opp.inashiStumble = stumbleDur;
            opp.stumbleDir = (opp.x < p.x) ? -1 : 1;
        }
    }

    updateGrappleState(p1AIKeys, p2AIKeys) {
        const m = this.grapple.master; const s = this.grapple.slave;
        const mStats = m.getStats(s); const sStats = s.getStats(m);

        const moveCost = cfg('STAMINA.MOVE_COST', 0.15);
        const grappleCostRate = cfg('STATUS.GRAPPLE_COST_RATE', 0.2);

        m.stamina = Math.max(1, m.stamina - moveCost * grappleCostRate);
        s.stamina = Math.max(1, s.stamina - moveCost * grappleCostRate);

        const mFacing = (m.x < s.x) ? 1 : -1;
        const getInput = (p, keys, isAI, aiKeys) => {
            const source = isAI ? aiKeys : this.keys;
            const facing = (p.x < (p===m?s.x:m.x)) ? 1 : -1;
            return {
                wantsFwd: facing===1 ? source.has(keys.r) : source.has(keys.l),
                wantsCharge: source.has(keys.d),
                wantsTech: source.has(keys.u)
            };
        };

        const mInput = getInput(m, m.controls, m.isCPU, m === this.p1 ? p1AIKeys : p2AIKeys);
        const sInput = getInput(s, s.controls, s.isCPU, s === this.p1 ? p1AIKeys : p2AIKeys);

        // master/slave 共通のチャージ処理（挙動は従来と完全に同一）
        const applyGrappleCharge = (p, pStats, input) => {
            const thresh = p.isCharging ? 0.0 : 3.0;
            if (input.wantsCharge && p.stamina > thresh && p.chargeLock === 0) {
                const baseGain = cfg('CHARGE.BASE_GAIN', 0.3);
                const techRate = cfg('STATUS.TECH_CHARGE_RATE', 0.25);
                const gain = baseGain * (1 + (pStats.tech - 5) * techRate);
                p.charge = Math.min(100, p.charge + gain);
                const chgCost = cfg('STAMINA.CHARGE_COST', 0.1);

                p.stamina = Math.max(0, p.stamina - chgCost);
                p.isCharging = true;

                if (p.stamina <= 0.0) {
                    p.charge = 0; p.chargeLock = 40; p.isCharging = false;
                }
            } else {
                p.charge = 0; p.isCharging = false;
            }
        };
        applyGrappleCharge(m, mStats, mInput);
        applyGrappleCharge(s, sStats, sInput);

        SoundFX.updateCharge(m.id, m.isCharging, m.charge);
        SoundFX.updateCharge(s.id, s.isCharging, s.charge);

        // 修正: HP1ならダメージ非表示、スタン予約のみ発動
        [m, s].forEach(p => {
                if (p.inashiTimer > 0) {
                    // タイマー切れ（失敗）の瞬間にペナルティ
                    if (p.inashiTimer === 1) {
                        const missPenalty = cfg('STAMINA.MISS_PENALTY', 20);

                        // HPが残っている時だけ減算＆表示
                        if (p.stamina > 1) {
                            p.stamina = Math.max(1, p.stamina - missPenalty);
                            this.ui.showDamage(p, missPenalty);
                        }

                        const recoveryWait = cfg('STAMINA.RECOVERY_DELAY', 200);
                        p.recoveryDelay = recoveryWait;

                        // 予約されていたスタンを発動（メッセージなし）
                        if (p.pendingStun > 0) {
                            p.stun = p.pendingStun;
                            p.pendingStun = 0;
                        }
                    }
                    p.inashiTimer--;
                    SoundFX.updateInashi(p.id, true);
                }
                else { SoundFX.updateInashi(p.id, false); }
            });

        if (m.isCPU && mInput.wantsTech) {
            if (m.charge >= 100) { this.handleGrappleCounter(m, s, 'throw'); return; }
        }

        if (mInput.wantsFwd) {
            const spdBase = cfg('ACTION.SPEED_BASE', 2.8);
            const grpSpdRate = cfg('STATUS.GRAPPLE_SPD_RATE', 0.5);
            const baseSpeed = m.isCharging ? spdBase * 0.3 : spdBase * grpSpdRate;

            let pushSpeed = baseSpeed * Math.max(0.2, (1 + (mStats.power - 5) * 0.6));

            if (s.isCharging) { pushSpeed *= 0.5; }

            if (m.maxStamina <= 20 && !m.isCharging && s.maxStamina <= 20 && !s.isCharging) {
                pushSpeed *= 3.0;
                pushSpeed = Math.max(pushSpeed, 2.5);
            }

            const hitDist = cfg('GAME_RULES.HIT_DIST', 100);
            m.x += pushSpeed * mFacing; s.x = m.x + (hitDist * mFacing);
        }

        if (s.isCPU) {
            const k = s === this.p1 ? p1AIKeys : p2AIKeys;

            // ■ 上キー (Tech) は「投げ (100%)」専用
            if (k.has(s.controls.u)) {
                if(s.charge >= 100) {
                    this.handleGrappleCounter(s, m, 'throw');
                }
                // チャージ50%のぶちかまし判定はここじゃないので削除！
                // いなし(else)も削除済みなので、100%未満で上キーを押しても何も起きない（正解）
            }
            // ■ 前キー (Forward) で「ぶちかまし (50%)」または「押し返し」
            else if (s.x < m.x ? k.has(s.controls.r) : k.has(s.controls.l)) {
                // ここで handleGrappleCounter が呼ばれ、チャージが50%あれば
                // 内部で自動的に superPush (ぶちかまし) になるはずです
                this.handleGrappleCounter(s, m, 'push');
            }
        }
    }
    handleGrappleInput(code) {
        const s = this.grapple.slave; const m = this.grapple.master;
        if(!m.isCPU) {
            if (this.isPlayerControl(m, code, 'u')) { if (m.charge >= 100) this.handleGrappleCounter(m, s, 'throw'); }
            if (this.isPlayerControl(m, code, 'fwd')) { if (m.charge >= 50) this.handleGrappleCounter(m, s, 'push'); }
        }
        if (s && !s.isCPU) {
            if (this.isPlayerControl(s, code, 'u')) {
                if (s.charge >= 100) this.handleGrappleCounter(s, m, 'throw');
                else this.handleInashi(s, m);
            }
            if (this.isPlayerControl(s, code, 'fwd')) { if (s.charge >= 50) this.handleGrappleCounter(s, m, 'push'); }
        }
    }

    handleInashi(p, opp) {
        if(p.isDefeated || p.cooldown>0 || p.stun > 0 || p.inashiTimer > 0) return;

        // 修正: スタミナ1以下の時は「後でスタン」する予約を入れる
        p.pendingStun = 0; // リセット
        if (p.stamina <= 1) {
            p.pendingStun = 120; // いなし終了後に120フレーム（約2秒）動けなくする
        }

        const superSwapThresh = cfg('CHARGE.THRESHOLDS.SUPER_SWAP', 100);

        if(p.charge >= superSwapThresh) {
            // ... (スーパー入れ替えの処理はそのまま) ...
            const swapCost = cfg('STAMINA.SUPER_SWAP_COST', 50);
            if(p.stamina < swapCost) return;

            p.stamina = Math.max(0, p.stamina - swapCost);
            p.charge = 0;

            const recoveryWait = cfg('STAMINA.RECOVERY_DELAY', 200);
            p.recoveryDelay = recoveryWait;

            SoundFX.updateCharge(p.id, false, 0);
            p.chargeLock = 60;

            const throwRange = cfg('GAME_RULES.THROW_RANGE', 110);
            const currentDist = Math.abs(p.x - opp.x);

            SoundFX.playVoice('dosukoi');
            SoundFX.playHit(true);

            p.animClass = (p.x < opp.x) ? 'throw-posture-left' : 'throw-posture-right';

            if (currentDist <= throwRange + 30) {
                this.superSwap(p, opp);
                p.cooldown = 20;
                opp.cooldown = 20;
            } else {
                p.cooldown = 40;
            }

            setTimeout(() => {
                    p.animClass = null;
                    p.el.classList.remove('throw-posture-left', 'throw-posture-right');
                    p.el.classList.add('throw-finish-motion');
                    setTimeout(() => p.el.classList.remove('throw-finish-motion'), 200);
                }, 300);

            return;
        }

        const stats = p.getStats(opp);
        const baseDur = cfg('ACTION.INASHI_DURATION_BASE', 15);
        const techMod = cfg('ACTION.INASHI_TECH_MOD', 3);
        p.inashiTimer = baseDur + (stats.tech * techMod);

        // 発動コスト（PARRY_COST）の消費処理は削除済み（0コスト）

        const recoveryWait = cfg('STAMINA.RECOVERY_DELAY', 200);
        p.recoveryDelay = recoveryWait;

        p.el.classList.add('inashi-active');

        p.actionType = 'inashi';
        setTimeout(() => p.actionType = null, p.inashiTimer * 16);
    }

    normalPush(atk, def, dir){
        const aStats = atk.getStats(def); const dStats = def.getStats(atk);
        const pushPowerBase = cfg('PHYSICS.PUSH_POWER_BASE', 2.0);
        const pushDistConv = cfg('STATUS.PUSH_DIST_CONVERT', 0.4);
        const basePwr = (aStats.power * 0.5) + pushPowerBase;
        let pwr = basePwr * pushDistConv;

        const weakPenalty = cfg('STATUS.PUSH_WEAK_PENALTY', 0.7);
        if (aStats.power < 5) pwr *= weakPenalty;

        const advBonus = cfg('STATUS.PUSH_ADV_BONUS', 0.4);
        const disadvPenalty = cfg('STATUS.PUSH_DISADV_PENALTY', 0.5);
        if (aStats.power > dStats.power) pwr *= (1 + (aStats.power - dStats.power) * advBonus);
        else pwr *= disadvPenalty;

        const vsCharge = cfg('STATUS.PUSH_VS_CHARGE', 1.5);
        if (def.isCharging) pwr *= vsCharge;

        this.p1.x += pwr * dir; this.p2.x += pwr * dir;

        const pwrDmgRate = cfg('STATUS.PWR_DMG_RATE', 0.1);
        const basePushDmg = cfg('DAMAGE.BASE_PUSH', 1.5);
        const dmgMult = 1.0 + ((aStats.power - 5) * pwrDmgRate);
        const damage = basePushDmg * dmgMult;

        def.maxStamina -= damage;
        this.ui.showDamage(def, damage);
        def.stamina = Math.min(def.stamina, def.maxStamina);
        this.lastHit = 'push';
        if(def.stamina<=0) { this.resolveMatch(atk, def, 'ko_push'); }
    }

    // ぶちかまし後のダウンタイム（操作不能時間）をハヤサから算出する。
    // ハヤサに反比例し、基準ハヤサのとき基準フレーム。ハヤサが低いほど長くなる。
    getBuchiDowntime(speed, base){
        const baseFrames = (typeof base === 'number') ? base : cfg('ACTION.BUCHI_DOWNTIME_BASE', 20);
        const refSpeed = cfg('ACTION.BUCHI_DOWNTIME_REF_SPEED', 10);
        const maxFrames = cfg('ACTION.BUCHI_DOWNTIME_MAX', 120);
        const spd = Math.max(1, speed || 1);
        return Math.min(maxFrames, Math.round(baseFrames * refSpeed / spd));
    }

    superPush(atk, def, dir){
        const aStats = atk.getStats(def);
        this.ui.fx(atk, def, 'super');
        SoundFX.playHit(true);

        const baseDist = cfg('STATUS.SP_PUSH_BASE', 50);
        const rateDist = cfg('STATUS.SP_PUSH_RATE', 20);
        const backRate = cfg('STATUS.SP_SELF_BACK_RATE', 0.2);
        const dist = baseDist + (aStats.power * rateDist);

        def.x += dist * dir; atk.x += (dist * backRate) * dir;

        const cost = cfg('STAMINA.SUPER_PUSH_COST', 5);
        const thresh = cfg('CHARGE.THRESHOLDS.SUPER_PUSH', 50);
        atk.stamina = Math.max(1, atk.stamina - cost);
        atk.charge -= thresh;

        const recoveryWait = cfg('STAMINA.RECOVERY_DELAY', 200);
        atk.recoveryDelay = recoveryWait;

        // ぶちかまし後の操作不能ダウンタイムをハヤサに応じて設定（遅い力士ほど長い）
        atk.cooldown = this.getBuchiDowntime(aStats.speed);

        this.ui.msg(atk,"ぶちかまし！");
        this.lastHit = 'thrust';

        const baseDmg = cfg('DAMAGE.BASE_THRUST', 5);
        const pwrRate = cfg('DAMAGE.THRUST_PWR_RATE', 1.0);
        const damage = baseDmg + (aStats.power * pwrRate);

        def.maxStamina -= damage;
        // 追加: 現在HPもしっかり減らす
        def.stamina -= damage;

        this.ui.showDamage(def, damage, 'crit');
        def.stamina = Math.min(def.stamina, def.maxStamina);
        def.stun = cfg('ACTION.STUN_TIME_PUSH', 100);
        atk.chargeLock = def.stun;
        if(def.stamina<=0) { this.resolveMatch(atk, def, 'ko_thrust'); }
    }

    swap(def, atk, dist){
        const ax=atk.x; atk.x=def.x; def.x=ax; const dir = (atk.x > def.x) ? 1 : -1;
        atk.x += dist*dir; def.x -= (dist/2)*dir;
        this.lastHit = 'throw';
        const cost = cfg('STAMINA.SWAP_COST_NORMAL', 10);
        atk.stamina = Math.max(1, atk.stamina - cost);
    }

    superSwap(thrower, victim){
        this.ui.fx(thrower, victim, 'super');
        SoundFX.playHit(true);

        const tStats = thrower.getStats(victim);
        const dir = (thrower.x < victim.x) ? 1 : -1;

        const baseDist = cfg('ACTION.SWAP_DIST_SUPER', 220);
        const distRate = cfg('ACTION.THROW_DIST_RATE', 4.0);
        const dist = baseDist + (tStats.power * distRate);

        victim.x = thrower.x - (dist * dir);

        const cost = cfg('STAMINA.SUPER_SWAP_COST', 10);
        thrower.stamina = Math.max(1, thrower.stamina - cost);

        const recoveryWait = cfg('STAMINA.RECOVERY_DELAY', 200);
        thrower.recoveryDelay = recoveryWait;

        thrower.charge=0; this.ui.msg(thrower,"掴み投げ！");
        this.lastHit = 'throw';

        const baseDmg = cfg('DAMAGE.BASE_THROW', 5);
        const pwrRate = cfg('DAMAGE.THROW_PWR_RATE', 2.0);
        const damage = baseDmg + (tStats.power * pwrRate);

        victim.maxStamina -= damage;
        // 追加: 現在HPもしっかり減らす
        victim.stamina -= damage;

        this.ui.showDamage(victim, damage, 'crit');
        victim.stamina = Math.min(victim.stamina, victim.maxStamina);
        victim.stun = cfg('ACTION.STUN_TIME_THROW', 150);
        thrower.chargeLock = victim.stun;
        if(victim.stamina<=0) { this.resolveMatch(thrower, victim, 'ko_throw'); }
    }
    isPlayerControl(p, code, action) {
        if (p.isCPU) return false;
        if (action === 'u') return code === p.controls.u;
        if (action === 'fwd') { const opp = (p === this.p1 ? this.p2 : this.p1); const facingRight = p.x < opp.x; if (facingRight) return code === p.controls.r; else return code === p.controls.l; }
        return false;
    }

    handleGrappleCounter(atk, def, type) {
        if (type === 'push' && def.inashiTimer > 0) {
            this.endGrapple();
            this.triggerInashiSuccess(def, atk);
            return;
        }

        if (type === 'throw') {
            this.endGrapple();
            this.superSwap(atk, def);

            SoundFX.playVoice('dosukoi');
            SoundFX.playHit(true);

            atk.animClass = (atk.x < def.x) ? 'throw-posture-right' : 'throw-posture-left';

            atk.cooldown = 20;
            def.cooldown = 20;
            atk.chargeLock = 60;

            setTimeout(() => {
                    atk.animClass = null;
                    atk.el.classList.remove('throw-posture-left', 'throw-posture-right');
                    atk.el.classList.add('throw-finish-motion');
                    setTimeout(() => atk.el.classList.remove('throw-finish-motion'), 300);
                }, 400);

            return;
        }

        this.endGrapple();
        const dir = (atk.x < def.x) ? 1 : -1;
        this.superPush(atk, def, dir);

        atk.x -= 20 * dir;

        atk.animClass = (dir === 1) ? 'thrust-attack-right' : 'thrust-attack-left';

        // atk.cooldown は superPush 内でハヤサに応じて設定済み（ここでは上書きしない）
        def.cooldown = 20;
        atk.chargeLock = 40;

        setTimeout(() => {
                atk.animClass = null;
                atk.el.classList.remove('thrust-attack-right', 'thrust-attack-left');
                atk.el.classList.add('thrust-finish-motion');
                setTimeout(() => {
                        atk.el.classList.remove('thrust-finish-motion');
                    }, 200);
            }, 150);
    }
    startGrapple(master, slave) {
        this.grapple.active = true; this.grapple.master = master; this.grapple.slave = slave;
        this.ui.els.grappleInd.style.display = 'block'; SoundFX.playHit(false);

        // 追加: 組み止められた側はチャージリセット
        slave.charge = 0;
        slave.isCharging = false;
        SoundFX.updateCharge(slave.id, false, 0);

        const dir = (master.x < slave.x) ? 1 : -1; const mid = (master.x + slave.x) / 2;
        const hitDist = cfg('GAME_RULES.HIT_DIST', 100);
        master.x = mid - (hitDist/2 * dir); slave.x = mid + (hitDist/2 * dir);
    }
    endGrapple() {
        this.grapple.active = false; this.grapple.master = null; this.grapple.slave = null;
        this.ui.els.grappleInd.style.display = 'none';
    }

    checkWin(){
        if(this.state.processingEnd) return;

        // --- スタミナ判定 ---
        const p1Dead = this.p1.stamina <= 0;
        const p2Dead = this.p2.stamina <= 0;

        // 両者スタミナ切れ（同体）
        if (p1Dead && p2Dead) {
            this.p1.stamina = 0;
            this.p2.stamina = 0;
            this.resolveDraw();
            this.stopInashiSound();
            return;
        }

        if (p1Dead) {
            this.p1.stamina = 0;
            this.resolveMatch(this.p2, this.p1, 'exhaustion');
            this.stopInashiSound();
            return;
        }
        if (p2Dead) {
            this.p2.stamina = 0;
            this.resolveMatch(this.p1, this.p2, 'exhaustion');
            this.stopInashiSound();
            return;
        }

        // --- 土俵際判定 ---
        const leftLimit = cfg('GAME_RULES.RING_EDGE_LEFT', 115);
        const rightLimit = cfg('GAME_RULES.RING_EDGE_RIGHT', 1085);

        const isOut = (p) => {
            // オブジェクトとして受け取るように変更
            const scaleObj = p.getPhysiqueScale ? p.getPhysiqueScale() : {x: 1.0, y: 1.0};
            const centerX = p.x + 65;

            // 足元の広さ（当たり判定）は「横幅（体重: scaleObj.x）」を使う
            const footSpread = 40 * scaleObj.x;

            return (centerX - footSpread < leftLimit || centerX + footSpread > rightLimit);
        };

        const p1Out = isOut(this.p1);
        const p2Out = isOut(this.p2);

        // 両者リングアウト（同体）
        if (p1Out && p2Out) {
            this.resolveDraw();
            this.stopInashiSound();
            return;
        }

        if(p1Out) {
            this.resolveMatch(this.p2, this.p1, 'ringout');
            this.stopInashiSound();
        }
        else if(p2Out) {
            this.resolveMatch(this.p1, this.p2, 'ringout');
            this.stopInashiSound();
        }
    }

    resolveDraw() {
        if(this.state.processingEnd) return;
        this.state.processingEnd = true;

        // 追加: 試合が早すぎた場合の非表示タイマーをキャンセル
        if (this.callHideTimer) clearTimeout(this.callHideTimer);

        this.p1.spiritActive = false;
        this.p2.spiritActive = false;
        this.p1.reversalActive = false;
        this.p2.reversalActive = false;

        this.stopInashiSound();
        this.state.active = false;

        this.endGrapple();

        this.ui.triggerDoubleSlowMotion(this.p1, this.p2);

        this.transitionAction = () => { this.endRoundDraw(); };
        this.transitionTimer = 90;
    }

    // 取り直し画面進行
    async endRoundDraw() {
        SoundFX.playVoice('monoii'); // ここで monoii.mp3 を再生
        SoundFX.updateCharge('p1',0); SoundFX.updateCharge('p2',0);
        // 削除: ここにあった classList.remove('gyoji-confused') を削除！
        // これにより、暗転してリセットされるまで回転し続けます
        this.ui.setGyojiImage('syoubuari');
        // ① 行司「ものいい！」
        this.ui.els.call.style.display = 'block';
        this.ui.els.call.textContent = 'ものいい！';
        // ※回転中なので反転などは気にしなくてOK
        this.ui.startGyojiConfusion();
        await wait(1800);
        if (this.state.aborted) return;
        this.ui.els.call.style.display = 'none';
        this.ui.els.res.classList.add('visible');
        document.getElementById('kimarite-display').textContent = "同体";
        document.getElementById('win-message').textContent = "取り直し";

        const btn = document.getElementById('next-btn');
        const btnText = "再戦する";
        btn.textContent = `${btnText} (3)`;
        btn.style.display = 'inline-block';
        btn.disabled = false;

        let count = 3;
        if (this.autoAdvanceTimer) clearInterval(this.autoAdvanceTimer);

        const proceed = async () => {
            if (this.state.paused) return;
            if (this.autoAdvanceTimer) { clearInterval(this.autoAdvanceTimer); this.autoAdvanceTimer = null; }
            if(btn.disabled) return;

            btn.disabled = true;

            // 暗転演出
            this.ui.els.dayOverlay.classList.add('visible', 'instant');
            this.ui.els.dayOverlay.textContent = this.getRoundName();

            await wait(100); await this.waitForPause();

            requestAnimationFrame(() => {
                    this.ui.els.dayOverlay.classList.remove('instant');
                    this.startMatch(true);
                });
        };

        btn.onclick = proceed;
        this.autoAdvanceTimer = setInterval(() => {
                if(!this.state.paused) {
                    count--;
                    if (count > 0) { btn.textContent = `${btnText} (${count})`; } else { proceed(); }
                }
            }, 1000);
    }

    updateVisualEffects() {
        // 試合中以外は完全に消す
        if (!this.state.active && !this.state.processingEnd) {
            [this.p1, this.p2].forEach(p => {
                    const targets = [p.el];
                    if (p.dom && p.dom.bar) targets.push(p.dom.bar);
                    if (p.dom && p.dom.chargeOuter) targets.push(p.dom.chargeOuter);

                    targets.forEach(t => {
                            if(t) {
                                t.classList.remove('aura-yellow', 'aura-blue', 'spirit-high', 'spirit-low');
                                // 削除: t.style.flexDirection = '';
                            }
                        });
                });
            return;
        }

        [this.p1, this.p2].forEach(p => {
                const targets = [p.el];
                if (p.dom && p.dom.bar) targets.push(p.dom.bar);
                if (p.dom && p.dom.chargeOuter) targets.push(p.dom.chargeOuter);

                if (p.isDefeated) {
                    targets.forEach(t => {
                            if(t) {
                                t.classList.remove('aura-yellow', 'aura-blue', 'spirit-high', 'spirit-low');
                                // 削除: t.style.flexDirection = '';
                            }
                        });
                    return;
                }

                // --- ギャクテン (Reversal) のエフェクト解除 ---
                if (!p.reversalActive || p.stamina <= 0 || p.miss > 0 || p.stun > 0) {
                    targets.forEach(t => { if(t) t.classList.remove('aura-yellow', 'aura-blue'); });
                }

                // --- キモチ (Spirit) ---
                if (p.spiritActive && p.stamina > 0 && p.miss <= 0 && p.stun <= 0) {
                    let spiritVal = p.baseStats.spirit || 5;
                    let baseClass = null;

                    if (spiritVal >= 8) {
                        baseClass = 'spirit-high';
                    } else if (spiritVal <= 3) {
                        baseClass = 'spirit-low';
                    }

                    if (baseClass) {
                        targets.forEach(t => {
                                if (!t) return;

                                // クラス適用
                                if (!t.classList.contains(baseClass)) {
                                    t.classList.remove('spirit-high', 'spirit-low');
                                    t.classList.add(baseClass);
                                }

                                // 修正: P2の row-reverse 強制処理を削除
                                // ui.js の scaleX(-1) と競合して表示がおかしくなるのを防ぐため
                                // if (p.id === 'p2') { t.style.flexDirection = 'row-reverse'; } ... は削除
                            });
                    } else {
                        // 4～7の範囲に入った場合はクラスを削除
                        targets.forEach(t => {
                                if(t) {
                                    t.classList.remove('spirit-high', 'spirit-low');
                                    // 削除: t.style.flexDirection = '';
                                }
                            });
                    }
                } else {
                    // 非アクティブ時
                    targets.forEach(t => {
                            if(t) {
                                t.classList.remove('spirit-high', 'spirit-low');
                                // 削除: t.style.flexDirection = '';
                            }
                        });
                }
            });
    }

    stopInashiSound() {
        SoundFX.updateInashi('p1', false);
        SoundFX.updateInashi('p2', false);
    }

    resolveMatch(winner, loser, reason) {
        if(this.state.processingEnd) return;
        this.state.processingEnd = true;
        this.p1.spiritActive = false;
        this.p2.spiritActive = false;
        this.p1.reversalActive = false;
        this.p2.reversalActive = false;
        let kimarite = "決まり手不明";

        const hitDist = cfg('GAME_RULES.HIT_DIST', 100);
        const isContact = Math.abs(this.p1.x - this.p2.x) <= (hitDist + 20);

        if (winner.actionType === 'inashi') {
            kimarite = "突き落とし";
        } else {
            if (reason === 'ringout') {
                // 修正: 攻撃の影響下（スタン中 or 吹っ飛び中）にあるかチェック
                // スタンが残っている、または 弾かれ速度(rebound)がまだ残っている場合は「攻撃による決着」とみなす
                const isUnderInfluence = (loser.stun > 0 || Math.abs(loser.rebound) > 0.5);

                // 接触しておらず、かつ「攻撃の影響」がもう無ければ、過去に被弾していても「勇み足」にする
                if (!isContact && (!this.lastHit || !isUnderInfluence)) {
                    kimarite = "勇み足";
                }
                else if (this.lastHit === 'throw') kimarite = "上手出し投げ";
                else if (this.lastHit === 'thrust') kimarite = "突き出し";
                else kimarite = "寄り切り";
            }
            else {
                switch(reason) {
                    case 'ko_throw':    kimarite = "上手投げ"; break;
                    case 'ko_thrust':   kimarite = "突き倒し"; break;
                    case 'ko_push':     kimarite = "押し倒し"; break;
                    default:            kimarite = "押し倒し"; break;
                }
            }
        }

        this.stopInashiSound();
        this.startSlowMotion(winner.name, loser, kimarite);
    }

    startSlowMotion(wName, loser, kimarite) {
        this.state.active = false;
        this.ui.stopGyojiCalls();
        this.endGrapple();
        loser.isDefeated = true;
        if(kimarite.includes('投げ')) loser.isThrown = true;
        const winner = (loser === this.p1) ? this.p2 : this.p1;
        this.ui.triggerSlowMotion(loser, winner);
        this.transitionAction = () => { this.endRound(wName, loser, kimarite); };
        this.transitionTimer = 90; // 1.5秒 (60fps × 1.5)

    }

    async endRound(wName, loser, kimarite){
        SoundFX.playVoice('syoubuari');
        SoundFX.updateCharge('p1',0); SoundFX.updateCharge('p2',0);
        const wId = loser.id==='p1' ? 'p2' : 'p1';
        this.state.wins[wId]++;

        // 修正：決着時も団体戦の勝星を参照する
        if (this.state.isTeamMode && typeof window.teamGame !== 'undefined') {
            const p1TempWin = window.teamGame.state.teamWins.p1 + (wId === 'p1' ? 1 : 0);
            const p2TempWin = window.teamGame.state.teamWins.p2 + (wId === 'p2' ? 1 : 0);
            this.ui.els.p1Wins.textContent = p1TempWin + '勝';
            this.ui.els.p2Wins.textContent = p2TempWin + '勝';
        } else {
            this.ui.els.p1Wins.textContent = this.state.wins.p1 + '勝';
            this.ui.els.p2Wins.textContent = this.state.wins.p2 + '勝';
        }
        this.ui.draw(this.p1, this.p2);
        this.ui.setGyojiImage('syoubuari');

        if(wId === 'p1') {
            this.ui.els.gyoji.style.transform = 'scaleX(-1)';
            this.ui.els.gyoji.classList.add('flipped');
        } else {
            this.ui.els.gyoji.style.transform = 'scaleX(1)';
            this.ui.els.gyoji.classList.remove('flipped');
        }

        const matchStatus = this.checkMatchStatus();
        await wait(1000);
        if (this.state.aborted) return;
        this.ui.els.res.classList.add('visible');
        document.getElementById('kimarite-display').textContent=`決まり手：${kimarite}`; document.getElementById('win-message').textContent=`${wName}の勝ち！`;

        const btn = document.getElementById('next-btn');

        // 勝ち抜き：「次の取り組みへ」ボタンは出さず、勝者の残HPを引き継いで連戦。敗者側が全滅したら結果画面へ。
        if (this.state.isTeamMode && typeof window.teamGame !== 'undefined' && window.teamGame.state.rule === 'kachinuki') {
            const winnerObj = (loser === this.p1) ? this.p2 : this.p1;
            if (btn) btn.style.display = 'none';
            await wait(1500);
            if (this.state.aborted) return;
            window.teamGame.onKachinukiBoutEnd(wId, winnerObj.stamina, winnerObj.maxStamina);
            return;
        }

        // 1. 優勝演出の分岐（団体戦のときは個別の優勝画面を出さない）
        if(matchStatus.isTournamentOver && !this.state.isTeamMode) {
            const winner = matchStatus.winnerName; const winnerObj = matchStatus.winnerObj; btn.style.display = 'none';
            await wait(1500);
            if (this.state.aborted) return;

            document.getElementById('result-overlay').classList.add('final-mode'); document.getElementById('kimarite-display').textContent = ""; document.getElementById('win-message').textContent = "";
            const btnLabel = "力士選択へ";

            let winImg = (winnerObj && winnerObj.baseStats && winnerObj.baseStats.img) ? this.ui.getImagePath(winnerObj.baseStats.img) : "";
            let html = ``; if(winImg) { html += `<div class="bg-anim" style="position:absolute; top:50%; left:50%; width:1500px; height:1500px; border-radius:50%; background:url('${winImg}') center/cover; pointer-events:none;"></div>`; }

            html += `<div class="winner-anim" style="position:relative; z-index:10; font-size:4rem; color:gold; font-weight:900; text-shadow:4px 4px 0 #000; font-family: 'Shippori Mincho', serif;">${winner} 優勝！</div><div id="final-btn-container"><button class="btn" onclick="game.rematch()">同じ条件で再戦</button><button id="auto-top-btn" class="btn">${btnLabel} (5)</button></div>`;
            document.getElementById('match-info').innerHTML = html;

            setTimeout(() => {
                    if (this.state.aborted) return;
                    const audio = new Audio('assets/se/appare.mp3'); audio.play().then(() => { audio.onended = () => {
                                if (this.state.aborted) return;
                                const container = document.getElementById('final-btn-container'); if(container) container.style.display = 'flex';
                                const autoBtn = document.getElementById('auto-top-btn');
                                let count = 5;
                                const executeReturn = () => {
                                    clearInterval(this.finalAdvanceTimer);
                                    this.goToCharSelect('init', 'none');
                                };
                                autoBtn.onclick = executeReturn;
                                this.finalAdvanceTimer = setInterval(()=>{
                                        if (!this.state.paused) {
                                            count--;
                                            if(count>0) autoBtn.textContent = `${btnLabel} (${count})`;
                                            else executeReturn();
                                        }
                                    }, 1000);
                            }; }).catch(e => {
                            if (this.state.aborted) return;
                            const container = document.getElementById('final-btn-container'); if(container) container.style.display = 'flex';
                        });
                }, 2000);
        } else {
            // 2. 「次の取り組みへ」の分岐（団体戦は team_game.js に戻す）
            // 団体戦は「決着済み(どちらか2勝 or 3戦目)」なら「次へ」、未決着なら「次の取り組みへ」
            let teamDecided = false;
            if (this.state.isTeamMode && typeof window.teamGame !== 'undefined') {
                const tw = window.teamGame.state.teamWins;
                const p1w = tw.p1 + (wId === 'p1' ? 1 : 0);
                const p2w = tw.p2 + (wId === 'p2' ? 1 : 0);
                teamDecided = (p1w >= 2 || p2w >= 2 || window.teamGame.state.round >= 3);
            }

            // 団体戦として決着がついたら「次へ」ボタンは出さず、自動でチーム結果画面へ進む
            if (this.state.isTeamMode && teamDecided) {
                btn.style.display = 'none';
                if (this.autoAdvanceTimer) { clearInterval(this.autoAdvanceTimer); this.autoAdvanceTimer = null; }
                await wait(1500);
                if (this.state.aborted) return;
                if (window.teamGame && typeof window.teamGame.onRoundEnd === 'function') {
                    window.teamGame.onRoundEnd(wId);
                }
                return;
            }

            const btnText = this.state.isTeamMode
                ? "次の取り組みへ"
                : (matchStatus.enteringDecider ? "優勝決定戦へ" : "次の取り組みへ");
            btn.textContent = `${btnText} (3)`;
            btn.style.display = 'inline-block';
            btn.disabled = false;
            let count = 3;

            if (this.autoAdvanceTimer) clearInterval(this.autoAdvanceTimer);

            const proceed = async () => {
                if (this.state.paused) return;
                if (this.autoAdvanceTimer) { clearInterval(this.autoAdvanceTimer); this.autoAdvanceTimer = null; }
                if(btn.disabled) return;
                btn.disabled = true;

                // 【団体戦】シークレット選出画面（team_game.js）に制御を戻す
                if (this.state.isTeamMode) {
                    if (window.teamGame && typeof window.teamGame.onRoundEnd === 'function') {
                        window.teamGame.onRoundEnd(wId);
                    }
                    return; // 団体戦の処理はここで終了
                }

                // 【個人戦】通常の次戦処理
                this.ui.els.dayOverlay.classList.add('visible', 'instant');
                if (!matchStatus.nextIsDecider && !this.state.inDecider) { this.state.current++; }
                if (matchStatus.enteringDecider) { this.state.inDecider = true; this.state.deciderRound = 1; }
                else if (this.state.inDecider) { this.state.deciderRound++; }

                this.ui.els.dayOverlay.textContent = this.getRoundName();
                await wait(100); await this.waitForPause();
                requestAnimationFrame(() => { this.ui.els.dayOverlay.classList.remove('instant'); this.startMatch(false); });
            };

            btn.onclick = proceed;
            this.autoAdvanceTimer = setInterval(() => {
                    if(!this.state.paused) {
                        count--;
                        if (count > 0) { btn.textContent = `${btnText} (${count})`; } else { proceed(); }
                    }
                }, 1000);
        }
    }
    checkMatchStatus() {
        const wins1 = this.state.wins.p1;
        const wins2 = this.state.wins.p2;
        const current = this.state.current;
        const max = this.state.matches;

        // 団体戦ルールの勝敗判定（2本先取）
        if (this.state.isTeamMode) {
            if (wins1 >= 2 || wins2 >= 2) {
                // 「1P組」「2P組」に変更
                const winnerName = wins1 > wins2 ? "1 P 組" : (wins2 > wins1 ? "2 P 組" : "引き分け");
                const winnerObj = wins1 > wins2 ? this.p1 : this.p2;
                return { isTournamentOver: true, winnerName, winnerObj };
            }
            return { isTournamentOver: false };
        }

        // ここから下は個人戦用の既存ロジック
        if (this.state.deuce) {
            const diff = Math.abs(wins1 - wins2);
            if (this.state.inDecider) {
                if (diff >= 2) { return { isTournamentOver: true, winnerName: wins1 > wins2 ? this.p1.name : this.p2.name, winnerObj: wins1 > wins2 ? this.p1 : this.p2 }; }
                else { return { isTournamentOver: false, nextIsDecider: true }; }
            }
            if (current === max && wins1 === wins2) { return { isTournamentOver: false, nextIsDecider: true, enteringDecider: true }; }
        }
        if (current < max) return { isTournamentOver: false };
        const winnerName = wins1 > wins2 ? this.p1.name : (wins2 > wins1 ? this.p2.name : "引き分け");
        const winnerObj = wins1 > wins2 ? this.p1 : this.p2;
        return { isTournamentOver: true, winnerName, winnerObj };
    }
    getRoundName() {
        if (this.state.inDecider) {
            if (this.state.deciderRound > 1) {
                return `優勝決定戦：${this.state.deciderRound}戦目`;
            }
            return "優勝決定戦";
        }

        // ここを修正：team_game.js が送ってくる teamRound を参照する
        if (this.state.isTeamMode) {
            if (typeof window.teamGame !== 'undefined' && window.teamGame.state.rule === 'kachinuki') return "";
            if (this.teamRound === 1) return "先鋒戦";
            if (this.teamRound === 2) return "中堅戦";
            if (this.teamRound === 3) return "大将戦";
            return "代表戦";
        }

        const cur = this.state.current;
        const max = this.state.matches;

        // 元々あった素晴らしいルールを復活
        if (max === 1) return "千秋楽";
        if (cur === max) return "千秋楽";
        if (cur === 1) return "初日";
        if (max >= 3 && max % 2 !== 0 && cur === Math.ceil(max / 2)) return "中日";

        return `${cur}日目`;
    }
}
// Global Initialization
let game;
document.fonts.ready.then(()=>document.body.classList.add('loaded'));

window.onload = async () => {
    if (typeof loadExternalData === 'undefined') {
        alert("エラー: data.js が読み込まれていません。");
        return;
    }

    await loadExternalData();
    const loadingMsg = document.getElementById('network-loading-msg');
    if(loadingMsg) loadingMsg.style.display = 'none';

    const btnGroup = document.getElementById('start-btn-group');
    if(btnGroup) {
        btnGroup.style.display = 'flex';
        btnGroup.classList.add('fade-in-up');
    }

    try {
        game = new GameManager();
    } catch(e) {
        console.error("Game Init Error:", e);
        alert("ゲームの初期化に失敗しました: " + e.message);
    }

    // ゲームパッド／アーケードコントローラの読み取りを開始する
    if (typeof GamepadInput !== 'undefined') {
        GamepadInput.start();
    }

    // 音楽の即時再生を削除し、裏読み（プリロード）だけに修正
    if (typeof SoundFX !== 'undefined') {
        SoundFX.preloadSelectBGMs();
    }
}