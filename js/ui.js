/**
 * ui.js
 * 個人戦の画面表示（選択画面・戦闘HUD・演出・BGMモーダル）を担当するクラス
 */
class UIManager {
    constructor(game) {
        this.game = game;
        this.els = {
            start: document.getElementById('start-screen'),
            select: document.getElementById('char-select-screen'),
            wrapper: document.getElementById('game-wrapper'),
            stage: document.getElementById('stage-container'),
            ui: document.getElementById('ui-layer'),
            call: document.getElementById('call-display'),
            res: document.getElementById('result-overlay'),
            grappleInd: document.getElementById('grapple-indicator'),
            dayOverlay: document.getElementById('day-overlay'),
            gyoji: document.getElementById('gyoji-img'),
            p1Name: document.getElementById('p1-name-disp'),
            p2Name: document.getElementById('p2-name-disp'),
            p1Wins: document.getElementById('p1-wins'),
            p2Wins: document.getElementById('p2-wins')
        };
        this.gyojiTimer = null;
        this.animTimer = null;
        this.bgmToastTimer = null; // BGMトースト用タイマー

        this.initSelectScreen();

        // ドリーム力士の隠しコマンド(H,I,N,O)は結婚式Verでは廃止。
        // ゲストが偶然入力して演出が暴発するのを防ぐため、判定ごと削除している。

        document.addEventListener('keydown', (e) => this.highlightKey(e.code, true));
        document.addEventListener('keyup', (e) => this.highlightKey(e.code, false));
        this.resize();
    }

    showGameScreen() {
        // 引数に頼らず、game本体にセットされた「団体戦フラグ」を直接確認する！
        const isTeamMode = !!(this.game.state && this.game.state.isTeamMode);

        // 団体戦の場合は、team_game.js からラウンド名を取得、個人戦は game.js から
        let roundNameStr = "";
        if (isTeamMode && typeof window.teamGame !== 'undefined') {
            if (window.teamGame.state.rule === 'kachinuki') {
                roundNameStr = "";
            } else {
                const roundNames = ["", "先鋒戦", "中堅戦", "大将戦", "延長戦"];
                roundNameStr = roundNames[window.teamGame.state.round] || "延長戦";
            }
        } else {
            roundNameStr = this.game.getRoundName();
        }

        // ベースのテキスト（〇日目など）をセット
        if (isTeamMode) {
            const p1Data = RIKISHI_DATA.find(d => d.id === this.game.state.chars.p1);
            const p2Data = RIKISHI_DATA.find(d => d.id === this.game.state.chars.p2);

            if (p1Data && p2Data) {
                const img1 = this.getImagePath(p1Data.img);
                const img2 = this.getImagePath(p2Data.img);

                // ⑥「○○戦」を上段、その下に「○○ VS ○○」を縦に並べる
                // ②顔は丸枠で切らず全体を表示（object-fit:contain）。1P→2P の順に出すため初期は非表示。
                this.els.dayOverlay.innerHTML = `
                    <img id="team-face-p1" src="${img1}" style="position:absolute; left:0; top:50%; height:115%; transform:translate(-50%, -50%); opacity:0; transition:opacity 0.5s ease; pointer-events:none; z-index:1;">
                    <img id="team-face-p2" src="${img2}" style="position:absolute; right:0; top:50%; height:115%; transform:translate(50%, -50%); opacity:0; transition:opacity 0.5s ease; pointer-events:none; z-index:1;">
                    <div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; gap:55px;">
                        <div>${roundNameStr}</div>
                        <div style="display:flex; align-items:flex-end; justify-content:center; gap:120px;">
                            <div id="team-intro-p1" style="display:flex; flex-direction:column; align-items:center; opacity:0; transition:opacity 0.4s ease;">
                                <span style="font-size:2.8rem; color:#fff;">${p1Data.name}</span>
                                <span style="font-size:1.8rem; color:#fff; margin-top:14px;">コスト：${p1Data['コスト'] || 0}</span>
                            </div>
                            <div id="team-intro-vs" style="font-size:5.5rem; color:#745399; text-shadow:4px 4px 0 #000; font-style:italic; opacity:0; transition:opacity 0.4s ease;">VS</div>
                            <div id="team-intro-p2" style="display:flex; flex-direction:column; align-items:center; opacity:0; transition:opacity 0.4s ease;">
                                <span style="font-size:2.8rem; color:#fff;">${p2Data.name}</span>
                                <span style="font-size:1.8rem; color:#fff; margin-top:14px;">コスト：${p2Data['コスト'] || 0}</span>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                this.els.dayOverlay.innerHTML = `<div>${roundNameStr}</div>`;
            }
        } else {
            this.els.dayOverlay.innerHTML = `<div>${roundNameStr}</div>`;
        }

        this.els.dayOverlay.classList.add('visible', 'instant');
        this.els.select.classList.remove('active');
        this.els.start.classList.remove('active');
        this.els.wrapper.style.display = 'flex';

        const p1 = this.game.p1 ? this.game.p1.baseStats : null;
        const p2 = this.game.p2 ? this.game.p2.baseStats : null;

        if (this.els.p1Name) this.els.p1Name.textContent = p1 ? p1.name : "P1";
        if (this.els.p2Name) this.els.p2Name.textContent = p2 ? p2.name : "P2";

        const p1CtrlName = document.getElementById('p1-control-name');
        if (p1CtrlName) p1CtrlName.textContent = p1 ? p1.name : "P1";

        const p2CtrlName = document.getElementById('p2-control-name');
        if (p2CtrlName) p2CtrlName.textContent = p2 ? p2.name : "P2";

        this.resize();
        requestAnimationFrame(() => { this.els.dayOverlay.classList.remove('instant'); });
    }

    // 団体戦の開始前演出：1P→2P の順に顔・名前を表示し、各力士のボイスを鳴らしてから戦闘へ
    async playTeamIntro() {
        const reveal = (id, op = '1') => { const el = document.getElementById(id); if (el) el.style.opacity = op; };
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const playVoice = (v) => (v && typeof SoundFX !== 'undefined' && SoundFX.playVoice) ? SoundFX.playVoice(v) : sleep(700);

        const p1 = this.game.p1 ? this.game.p1.baseStats : null;
        const p2 = this.game.p2 ? this.game.p2.baseStats : null;

        // ③「先鋒戦」表示と同時に拍子木を鳴らす（1戦目のみ）。鳴り終わりは待たずに紹介へ進む。
        const round = (typeof window.teamGame !== 'undefined') ? window.teamGame.state.round : 1;
        if (round === 1) {
            try {
                const hyoshigi = new Audio('assets/se/hyoshigi.mp3');
                if (typeof SoundFX !== 'undefined' && SoundFX.seVolume !== undefined) hyoshigi.volume = SoundFX.seVolume;
                if (typeof SoundFX !== 'undefined') SoundFX._hyoshigi = hyoshigi;
                hyoshigi.play().catch(() => {});
            } catch (e) {}
        }

        // 1P → VS → 2P の順に1つずつ表示する
        const aborted = () => (this.game && this.game.state && this.game.state.aborted);
        await sleep(700);
        if (aborted()) return;
        reveal('team-face-p1', '0.22');
        reveal('team-intro-p1');
        await sleep(300);
        if (aborted()) return;
        await playVoice(p1 ? p1.voice : null);
        if (aborted()) return;

        // VS を単独で表示
        reveal('team-intro-vs');
        await sleep(500);
        if (aborted()) return;

        // 2P を表示し、その力士のボイスを再生
        reveal('team-face-p2', '0.22');
        reveal('team-intro-p2');
        await sleep(300);
        if (aborted()) return;
        await playVoice(p2 ? p2.voice : null);

        await sleep(200);
    }

    // 勝ち抜きの開始前演出：先鋒→中堅→大将を順に、各組1P→2Pで顔・名前・ボイスを発表（「戦」は付けない）
    async playKachinukiIntro() {
        const reveal = (id, op = '1') => { const el = document.getElementById(id); if (el) el.style.opacity = op; };
        const isAborted = () => (this.game && this.game.state && this.game.state.aborted);

        // スキップ制御：Spaceで紹介を飛ばして開始前状態へ
        this._introSkip = false;
        let skipWaiters = [];
        const onSkip = () => { const w = skipWaiters; skipWaiters = []; w.forEach(fn => { try { fn(); } catch (e) {} }); };
        const skipHandler = (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this._introSkip = true;
                if (typeof SoundFX !== 'undefined' && SoundFX.stopVoices) SoundFX.stopVoices();
                onSkip();
            }
        };
        document.addEventListener('keydown', skipHandler);
        // Space／中断(aborted)で即解除されるsleep・playVoice
        const sleep = (ms) => new Promise(r => {
                if (this._introSkip || isAborted()) { r(); return; }
                let done = false;
                const finish = () => { if (done) return; done = true; clearTimeout(t); clearInterval(iv); r(); };
                const t = setTimeout(finish, ms);
                const iv = setInterval(() => { if (this._introSkip || isAborted()) finish(); }, 50);
                skipWaiters.push(finish);
            });
        const playVoice = (v) => {
                if (!v || this._introSkip || isAborted() || typeof SoundFX === 'undefined' || !SoundFX.playVoice) return Promise.resolve();
                return new Promise(r => {
                        let done = false;
                        const fin = () => { if (done) return; done = true; clearInterval(iv); r(); };
                        const iv = setInterval(() => { if (this._introSkip || isAborted()) fin(); }, 50);
                        skipWaiters.push(fin);
                        SoundFX.playVoice(v).then(fin);
                    });
            };

        const tg = (typeof window.teamGame !== 'undefined') ? window.teamGame : null;
        if (!tg) { document.removeEventListener('keydown', skipHandler); return; }
        const lp1 = tg.state.kachinuki.lineup.p1;
        const lp2 = tg.state.kachinuki.lineup.p2;
        const labels = ['先鋒', '中堅', '大将'];
        const skipHintHtml = `<div style="position:absolute; top:34px; right:50px; color:#fff; font-size:1.5rem; z-index:6; opacity:0.9;">Space：スキップ</div>`;

        // ステージへ切替（裏が覗かないよう day-overlay は不透明のまま）
        this.els.select.classList.remove('active');
        this.els.start.classList.remove('active');
        this.els.wrapper.style.display = 'flex';
        this.els.dayOverlay.classList.add('visible', 'instant');

        // 拍子木（冒頭1回。中断時に止められるよう登録）
        try {
            const hyoshigi = new Audio('assets/se/hyoshigi.mp3');
            if (typeof SoundFX !== 'undefined' && SoundFX.seVolume !== undefined) hyoshigi.volume = SoundFX.seVolume;
            if (typeof SoundFX !== 'undefined') SoundFX._hyoshigi = hyoshigi;
            hyoshigi.play().catch(() => {});
        } catch (e) {}

        for (let i = 0; i < 3; i++) {
            if (this._introSkip || isAborted()) break;
            const p1Data = RIKISHI_DATA.find(d => d.id === lp1[i]);
            const p2Data = RIKISHI_DATA.find(d => d.id === lp2[i]);
            if (!p1Data || !p2Data) continue;
            const img1 = this.getImagePath(p1Data.img);
            const img2 = this.getImagePath(p2Data.img);

            this.els.dayOverlay.innerHTML = `
                ${skipHintHtml}
                <img id="team-face-p1" src="${img1}" style="position:absolute; left:0; top:50%; height:115%; transform:translate(-50%, -50%); opacity:0; transition:opacity 0.5s ease; pointer-events:none; z-index:1;">
                <img id="team-face-p2" src="${img2}" style="position:absolute; right:0; top:50%; height:115%; transform:translate(50%, -50%); opacity:0; transition:opacity 0.5s ease; pointer-events:none; z-index:1;">
                <div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; gap:55px;">
                    <div>${labels[i]}</div>
                    <div style="display:flex; align-items:flex-end; justify-content:center; gap:120px;">
                        <div id="team-intro-p1" style="display:flex; flex-direction:column; align-items:center; opacity:0; transition:opacity 0.4s ease;">
                            <span style="font-size:2.8rem; color:#fff;">${p1Data.name}</span>
                            <span style="font-size:1.8rem; color:#fff; margin-top:14px;">コスト：${p1Data['コスト'] || 0}</span>
                        </div>
                        <div id="team-intro-vs" style="font-size:5.5rem; color:#745399; text-shadow:4px 4px 0 #000; font-style:italic; opacity:0; transition:opacity 0.4s ease;">VS</div>
                        <div id="team-intro-p2" style="display:flex; flex-direction:column; align-items:center; opacity:0; transition:opacity 0.4s ease;">
                            <span style="font-size:2.8rem; color:#fff;">${p2Data.name}</span>
                            <span style="font-size:1.8rem; color:#fff; margin-top:14px;">コスト：${p2Data['コスト'] || 0}</span>
                        </div>
                    </div>
                </div>
            `;
            requestAnimationFrame(() => { this.els.dayOverlay.classList.remove('instant'); });

            await sleep(450);
            if (this._introSkip || isAborted()) break;
            reveal('team-face-p1', '0.22');
            reveal('team-intro-p1');
            await sleep(250);
            if (this._introSkip || isAborted()) break;
            await playVoice(p1Data.voice);
            reveal('team-intro-vs');
            await sleep(350);
            if (this._introSkip || isAborted()) break;
            reveal('team-face-p2', '0.22');
            reveal('team-intro-p2');
            await sleep(250);
            if (this._introSkip || isAborted()) break;
            await playVoice(p2Data.voice);
            await sleep(450);
        }
        document.removeEventListener('keydown', skipHandler);
        // 中断（休場など）で抜けた場合は発表オーバーレイを消す（裏の選択画面に演出が残らないように）
        if (isAborted()) {
            if (typeof SoundFX !== 'undefined' && SoundFX.stopVoices) SoundFX.stopVoices();
            this.els.dayOverlay.classList.remove('visible', 'instant');
            this.els.dayOverlay.innerHTML = '';
        }
    }

    // 戦闘画面と同じ見た目（顔＋体・同サイズ）の力士スプライトHTMLを生成（結果画面コーナー用）
    buildBattleSprite(charId, side, isCPU = false) {
        const c = (typeof RIKISHI_DATA !== 'undefined') ? RIKISHI_DATA.find(d => d.id === charId) : null;
        if (!c) return '';
        const bodyImg = `assets/img/${bodyImageFile(side === 'p1' ? 'p1' : 'p2', isCPU, c)}`;
        const faceSrc = this.getImagePath(c.img);
        const w = c.weight || 3;
        const h = c.height || 3;
        const scaleX = 0.6 + w * 0.12;   // 体重→横幅（戦闘と同じ）
        const scaleY = 0.6 + h * 0.12;   // 身長→縦幅（戦闘と同じ）
        let headTop = -35;               // 顔の位置（戦闘と同じ）
        if (h === 1) headTop = -5;
        else if (h === 2) headTop = -25;
        else if (h === 3) headTop = -35;
        else if (h === 4) headTop = -60;
        else if (h === 5) headTop = -75;
        const breathDur = (typeof speedAnimDuration === 'function') ? speedAnimDuration(c.speed) : 1.2;
        return `<div class="rikishi" style="position:relative; bottom:auto; left:auto; width:130px; height:160px;">
            <div class="rikishi-body" style="animation: idleBreath ${breathDur}s infinite ease-in-out;">
                <img src="${bodyImg}" class="body-img" style="transform: scale(${scaleX}, ${scaleY}); transform-origin: bottom center;">
                <div class="head" style="background-image:url('${faceSrc}'); top:${headTop}px; transform:translateX(-50%);"></div>
            </div>
        </div>`;
    }

    showCharSelect(mode, skipAnim = false) {
        if (typeof settings !== 'undefined') {
            settings.current.bgmFile = 'random';
            settings.save();
        }
        if (typeof SoundFX !== 'undefined') {
            SoundFX.selectedBgmFile = 'random';
        }

        if (mode === 'init') {
            this.game.state.wins = { p1: 0, p2: 0 };
            this.game.state.current = 1;
        }
        this.els.res.classList.remove('visible');
        this.els.wrapper.style.display = 'none';
        this.els.start.classList.remove('active');

        // 追加：力士選択画面に戻る際、設定モーダル類が開いていれば強制的に閉じる
        const matchSelect = document.getElementById('match-count-select');
        if (matchSelect) {
            const modal = matchSelect.closest('.modal-overlay, .modal-window, [id*="modal"], [class*="modal"]');
            if (modal) {
                modal.classList.remove('active');
                if (modal.style.display === 'flex' || modal.style.display === 'block') {
                    modal.style.display = 'none';
                }
            }
        }
        this.els.select.classList.add('active');

        // 究極の解決策：Web Animations API を使って一瞬でアニメを完了させる
        if (skipAnim) {
            const fastForward = () => {
                if (!this.els.select) return;
                // 画面内のすべてのアニメーションを検知
                const anims = this.els.select.getAnimations({ subtree: true });
                anims.forEach(anim => {
                        // 呼吸(idleBreath)のような「無限ループ」のものはスキップしない
                        if (anim.effect && anim.effect.getTiming().iterations === Infinity) return;

                        // 登場アニメーション（1回限りのもの）を一瞬で100%の状態まで終わらせる
                        try { anim.finish(); } catch(e) {}
                    });
            };

            // 画面が描画された直後に発動
            requestAnimationFrame(() => {
                    fastForward();
                    // 念のため、少し遅れて生成された要素も確実に仕留める
                    setTimeout(fastForward, 50);
                    setTimeout(fastForward, 150);
                });
        }
    }

    resize() {
        const baseW = 1260; const baseH = 900;
        const winW = window.innerWidth - 60;
        const winH = window.innerHeight - 60;
        const scale = Math.min(winW / baseW, winH / baseH);
        const uiScale = Math.min(scale, 1.0);

        this.els.wrapper.style.transform = `scale(${scale})`;

        const startWrapper = document.getElementById('start-content-wrapper');
        if (startWrapper) startWrapper.style.transform = `translate(-50%, -50%) scale(${scale})`;

        const selectWrapper = document.getElementById('select-scaling-wrapper');
        if (selectWrapper) selectWrapper.style.transform = `translate(-50%, -50%) scale(${scale})`;

        document.querySelectorAll('.pause-box, .settings-scale-wrapper, .modal-window').forEach(box => {
                box.style.transform = `scale(${uiScale})`;
            });

        if (this.els.dayOverlay) this.els.dayOverlay.style.fontSize = `calc(8rem * ${scale})`;

        const footer = document.querySelector('.version-info');
        if (footer) {
            footer.style.transform = `scale(${uiScale})`;
            footer.style.transformOrigin = 'bottom center';
        }
    }

    getImagePath(filename) {
        if (!filename) return '';
        if (filename.startsWith('http') || filename.startsWith('data:')) return filename;
        return filename.includes('/') ? filename : `assets/img/${filename}`;
    }

    updateControlsDisplay() {
        if (typeof settings === 'undefined') return;
        const p1 = settings.current.controls.p1;
        const p2 = settings.current.controls.p2;
        const fmt = k => {
            const code = k.replace('Key', '');
            if (code === 'ArrowUp' || code === 'Up') return '↑';
            if (code === 'ArrowDown' || code === 'Down') return '↓';
            if (code === 'ArrowLeft' || code === 'Left') return '←';
            if (code === 'ArrowRight' || code === 'Right') return '→';
            return code;
        };
        const p1Container = document.getElementById('p1-controls');
        const p2Container = document.getElementById('p2-controls');

        if (p1Container) p1Container.innerHTML = `
            <div class="control-layout p1-layout">
                <div class="key-visual-grid">
                    <div class="key-row-top"><span class="key block-key" data-code="${p1.u}">${fmt(p1.u)}</span></div>
                    <div class="key-row-bottom">
                        <span class="key block-key" data-code="${p1.l}">${fmt(p1.l)}</span>
                        <span class="key block-key" data-code="${p1.d}">${fmt(p1.d)}</span>
                        <span class="key block-key" data-code="${p1.r}">${fmt(p1.r)}</span>
                    </div>
                </div>
                <div class="key-desc-list">
                    <div><span class="key-area"><span class="key mini-key">${fmt(p1.u)}</span></span> いなし</div>
                    <div><span class="key-area"><span class="key mini-key">${fmt(p1.d)}</span></span> 溜め</div>
                    <div><span class="key-area"><span class="key mini-key">${fmt(p1.l)}</span><span class="key mini-key">${fmt(p1.r)}</span></span> 移動</div>
                </div>
            </div>
        `;

        if (p2Container) p2Container.innerHTML = `
            <div class="control-layout p2-layout">
                <div class="key-desc-list">
                    <div><span class="key-area"><span class="key mini-key">${fmt(p2.u)}</span></span> いなし</div>
                    <div><span class="key-area"><span class="key mini-key">${fmt(p2.d)}</span></span> 溜め</div>
                    <div><span class="key-area"><span class="key mini-key">${fmt(p2.l)}</span><span class="key mini-key">${fmt(p2.r)}</span></span> 移動</div>
                </div>
                <div class="key-visual-grid">
                    <div class="key-row-top"><span class="key block-key" data-code="${p2.u}">${fmt(p2.u)}</span></div>
                    <div class="key-row-bottom">
                        <span class="key block-key" data-code="${p2.l}">${fmt(p2.l)}</span>
                        <span class="key block-key" data-code="${p2.d}">${fmt(p2.d)}</span>
                        <span class="key block-key" data-code="${p2.r}">${fmt(p2.r)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    resetVisuals(p1, p2) {
        if (this.animTimer) { clearTimeout(this.animTimer); this.animTimer = null; }
        document.querySelectorAll('.damage-popup').forEach(e => e.remove());

        [p1, p2].forEach(p => {
                p.el.className = 'rikishi'; p.fallDir = null;
                p.el.style.left = `${p.initialX}px`; p.el.style.transform = '';
                p.el.classList.remove('reversal-glow', 'stunned');
                // 本体の回転（転倒ポーズ等）はトランジション無しで即リセットし、起き上がりアニメを起こさない
                const bodyEl = p.el.querySelector('.rikishi-body');
                if (bodyEl) { bodyEl.style.transition = 'none'; bodyEl.style.transform = 'rotate(0deg)'; }
                if (p.dom && p.dom.bar) {
                    const hpFrame = p.dom.bar.parentElement;
                    if (hpFrame) {
                        hpFrame.classList.remove('spirit-burning', 'spirit-depressed');
                    }
                }
                const bodyImg = p.el.querySelector('.body-img');
                if (bodyImg) bodyImg.style.transform = '';
                if (p.elHead) p.elHead.style.top = '-45px';
                if (p.initDOM) p.initDOM();
                if (p.updateSize) p.updateSize();
            });

        this.setGyojiImage('hakkeyoi');
        this.els.gyoji.classList.remove('flipped', 'gyoji-confused');
        this.els.gyoji.style.transform = 'scaleX(1)';
        this.els.call.style.display = 'none';
        this.els.grappleInd.style.display = 'none';
        void this.els.stage.offsetWidth;
        // 即リセットを確定させたのちトランジションを元に戻す（取組中の転倒アニメは通常通り効かせる）
        [p1, p2].forEach(p => {
                const bodyEl = p.el.querySelector('.rikishi-body');
                if (bodyEl) bodyEl.style.transition = '';
            });
    }

    draw(p1, p2) {
        this.updateBar(p1, 'p1');
        this.updateBar(p2, 'p2');
        this.updateRikishi(p1);
        this.updateRikishi(p2);
        if (this.els.p1Name) this.els.p1Name.textContent = p1.name;
        if (this.els.p2Name) this.els.p2Name.textContent = p2.name;

        const p1HpText = document.getElementById('p1-hp-text');
        const p2HpText = document.getElementById('p2-hp-text');

        if (p1HpText) {
            const cur = Math.max(0, Math.ceil(p1.stamina));
            const max = Math.ceil(p1.initialMaxStamina);
            p1HpText.textContent = `${cur} / ${max}`;
        }
        if (p2HpText) {
            const cur = Math.max(0, Math.ceil(p2.stamina));
            const max = Math.ceil(p2.initialMaxStamina);
            p2HpText.textContent = `${cur} / ${max}`;
        }
    }

    updateBar(p, id) {
        const hpBar = (p.dom && p.dom.bar) ? p.dom.bar : document.getElementById(`${id}-hp-bar`);
        const chBar = (p.dom && p.dom.charge) ? p.dom.charge : document.getElementById(`${id}-charge-bar`);
        if (!hpBar || !chBar) return;

        const hpFrame = hpBar.parentElement;
        if (hpFrame && p.initialMaxStamina) {
            const MAX_POSSIBLE_HP = 200;
            const widthPct = Math.min(100, (p.initialMaxStamina / MAX_POSSIBLE_HP) * 100);
            hpFrame.style.width = `${widthPct}%`;
            hpFrame.style.maxWidth = '100%';
            hpFrame.style.display = 'flex';
            hpFrame.style.justifyContent = 'flex-start';
            hpFrame.style.backgroundColor = '#3f3f46';

            if (id === 'p2') {
                hpFrame.style.transform = 'scaleX(-1)';
                hpFrame.style.marginLeft = 'auto';
            } else {
                hpFrame.style.transform = 'none';
                hpFrame.style.marginLeft = '0';
            }

            hpFrame.classList.remove('spirit-burning', 'spirit-depressed', 'spirit-burning-p2', 'spirit-depressed-p2');

            if (p.spiritActive) {
                const spiritVal = p.baseStats.spirit || 5;
                let baseClass = null;

                if (spiritVal >= 8) baseClass = 'spirit-burning';
                else if (spiritVal <= 3) baseClass = 'spirit-depressed';

                if (baseClass) {
                    const finalClass = (id === 'p2') ? `${baseClass}-p2` : baseClass;
                    hpFrame.classList.add(finalClass);
                }
            }
        }

        const hpPct = (p.stamina / p.initialMaxStamina) * 100;
        const chPct = p.charge;
        const maxPct = (p.maxStamina / p.initialMaxStamina) * 100;

        hpBar.style.width = `${Math.max(0, hpPct)}%`;

        if (hpPct < 30) hpBar.style.background = '#ef4444';
        else hpBar.style.background = (id === 'p1' ? '#3b82f6' : '#ef4444');

        if (hpFrame) {
            const colorRecoverable = '#e4e4e7';
            hpFrame.style.backgroundImage = `linear-gradient(to right, ${colorRecoverable} ${maxPct.toFixed(1)}%, transparent ${maxPct.toFixed(1)}%)`;
        }

        const chFrame = chBar.parentElement;
        if (chFrame) {
            chFrame.style.display = 'flex';
            chFrame.style.justifyContent = 'flex-start';
            if (id === 'p2') chFrame.style.transform = 'scaleX(-1)';
            else chFrame.style.transform = 'none';
        }

        chBar.style.width = `${Math.max(0, chPct)}%`;

        const setClass = (el, cls, on) => { if (el) on ? el.classList.add(cls) : el.classList.remove(cls); };
        const isMax = chPct >= 100;
        const isLock = p.chargeLock > 0;
        const outer = p.dom && p.dom.chargeOuter;

        setClass(chBar, 'max-charge', isMax);
        setClass(outer, 'max-charge', isMax);
        setClass(chBar, 'locked', isLock);
        setClass(outer, 'locked', isLock);
    }

    updateRikishi(p) {
        p.el.style.left = `${p.x}px`;

        const s = p.getPhysiqueScale ? p.getPhysiqueScale() : {x: 1.0, y: 1.0};

        // 実際の身長の数値(1〜5)を取得する
        const hVal = p.baseStats ? (p.baseStats.height || 3) : 3;

        const b = p.el.querySelector('.body-img');
        const h = p.el.querySelector('.head');

        if (b) {
            b.style.transform = `scale(${s.x}, ${s.y})`;
            b.style.transformOrigin = 'bottom center';
        }
        if (h) {
            h.style.transform = `translateX(-50%)`;
            h.style.transformOrigin = 'center center';

            // 修正: 試合画面もプレビューと全く同じ数値を直接指定する
            let headTop = -30;
            if (hVal === 1) headTop = -5;   // 首が詰まりすぎたので上に（マイナス寄りに）逃がす
            if (hVal === 2) headTop = -25;
            if (hVal === 3) headTop = -35;  // 平均身長
            if (hVal === 4) headTop = -60;
            if (hVal === 5) headTop = -75;  // 先ほど良い感じだった高身長の位置

            h.style.top = `${headTop}px`;
        }

        let classStr = 'rikishi';

        if (p.isDefeated) {
            classStr += ' is-defeated';
            if (p.fallDir === 'left') classStr += ' fall-left';
            if (p.fallDir === 'right') classStr += ' fall-right';
        } else {
            if (p.charge >= 100) classStr += ' charge-max';
            else if (p.charge >= 50) classStr += ' charge-mid';
            else if (p.isCharging) classStr += ' charge-active';

            if (p.inashiTimer > 0) classStr += ' inashi-active';
            if (p.miss > 0) classStr += ' miss-active';

            if (p.reversalActive && p.inashiTimer <= 0 && p.miss <= 0 && p.stun <= 0) {
                const revVal = p.baseStats.reversal || 5;
                if (revVal >= 8) classStr += ' aura-yellow';
                else if (revVal <= 3) classStr += ' aura-blue';
            }
        }

        p.el.className = classStr;

        if (p.stun > 0 && !p.isDefeated) {
            p.el.classList.add('stunned');
            if (p.dom && p.dom.stunMark) p.dom.stunMark.style.display = 'block';
        } else {
            p.el.classList.remove('stunned');
            if (p.dom && p.dom.stunMark) p.dom.stunMark.style.display = 'none';
        }
    }

    triggerSlowMotion(loser, winner) {
        if (this.animTimer) clearTimeout(this.animTimer);
        loser.el.classList.remove('charge-active', 'charge-mid', 'charge-max', 'parry-active', 'miss-active', 'stunned');
        loser.isDefeated = true;
        loser.fallDir = null;
        this.draw(this.game.p1, this.game.p2);
        void loser.el.offsetWidth;
        this.animTimer = setTimeout(() => {
                if (loser.x < winner.x) loser.fallDir = 'left';
                else loser.fallDir = 'right';
                this.draw(this.game.p1, this.game.p2);
                this.animTimer = null;
            }, 50);
    }

    triggerDoubleSlowMotion(p1, p2) {
        if (this.animTimer) clearTimeout(this.animTimer);

        [p1, p2].forEach(p => {
                p.el.classList.remove('charge-active', 'charge-mid', 'charge-max', 'parry-active', 'miss-active', 'stunned');
                p.isDefeated = true;
                p.fallDir = null;
            });

        this.draw(this.game.p1, this.game.p2);
        void p1.el.offsetWidth;

        this.animTimer = setTimeout(() => {
                if (p1.x < p2.x) {
                    p1.fallDir = 'left';
                    p2.fallDir = 'right';
                } else {
                    p1.fallDir = 'right';
                    p2.fallDir = 'left';
                }
                this.draw(this.game.p1, this.game.p2);
                this.animTimer = null;
            }, 50);
    }

    fx(a, b, type) {
        const cx = (a.x + b.x) / 2 + 55;
        const y = 300;
        if (type !== 'parry') {
            const st = document.getElementById('stage');
            st.classList.remove('shake');
            void st.offsetWidth;
            st.classList.add('shake');

            const toast = document.getElementById('bgm-toast');
            if (toast && toast.classList.contains('show')) {
                toast.classList.remove('shake');
                void toast.offsetWidth;
                toast.classList.add('shake');
            }
        }
        for (let i = 0; i < (type === 'super' ? 40 : 15); i++) {
            const p = document.createElement('div'); p.style.position = 'absolute'; p.style.width = (Math.random() * 8 + 2) + 'px'; p.style.height = p.style.width; p.style.borderRadius = '50%';
            p.style.background = type === 'parry' ? '#22d3ee' : (type === 'super' ? '#ff4500' : 'gold');
            p.style.left = cx + 'px'; p.style.top = (y - 50) + 'px';
            p.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${(Math.random() - 0.5) * 300}px, ${(Math.random() - 0.5) * 300}px) scale(0)`, opacity: 0 }], { duration: 600, easing: 'ease-out' }).onfinish = () => p.remove();
            document.getElementById('stage').appendChild(p);
        }
    }

    startGyojiConfusion() {
        this.stopGyojiCalls();
        if (this.els.gyoji) {
            this.els.gyoji.classList.add('gyoji-confused');
        }
    }

    showDamage(target, amount, type = 'normal') {
        if (amount <= 0) return;

        const el = document.createElement('div');
        el.className = `damage-popup ${type}`;

        el.textContent = amount < 1 ? amount.toFixed(1) : Math.floor(amount);

        const randX = (Math.random() * 40) - 20;
        const randY = (Math.random() * 20) - 10;
        const x = target.x + 65 + randX;
        const y = 200 + randY;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        this.els.stage.appendChild(el);

        const durationFrames = cfg('UI.DMG_DURATION', 60);
        const durationMs = durationFrames * 16.6;

        setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(-20px)';
                setTimeout(() => el.remove(), 300);
            }, durationMs);
    }

    showBGMToast(trackName) {
        const toast = document.getElementById('bgm-toast');
        const nameSpan = document.getElementById('bgm-name');
        if (!toast || !nameSpan) return;

        nameSpan.textContent = trackName;
        if (this.bgmToastTimer) clearTimeout(this.bgmToastTimer);

        // 1) トランジション無効で右外(translateX(100%))へ瞬時リセット（表示中でも確実に戻す）
        toast.style.transition = 'none';
        toast.classList.remove('show');
        void toast.offsetWidth; // リフローで即反映
        // 2) トランジションをCSS(1.5s)に戻し、次フレームでスライドイン
        toast.style.transition = '';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add('show');
            });
        });

        this.bgmToastTimer = setTimeout(() => {
                toast.classList.remove('show'); // 右へスライドアウト
                this.bgmToastTimer = null;
            }, 5000);
    }

    msg(p, txt, miss, parry, reversal) {
        const d = document.createElement('div'); d.className = 'combo-call'; d.textContent = txt;
        if (miss) d.classList.add('miss-call'); if (parry) d.classList.add('parry-call'); if (reversal) d.classList.add('reversal-call');
        p.el.appendChild(d); setTimeout(() => d.remove(), 800);
    }

    startGyojiCalls(activeStateChecker) {
        this.stopGyojiCalls();
        const randInterval = () => {
            const minInt = cfg('UI.GYOJI_INTERVAL_MIN', 800);
            const maxInt = cfg('UI.GYOJI_INTERVAL_MAX', 2500);
            return Math.floor(Math.random() * (maxInt - minInt + 1)) + minInt;
        };
        let lastType = 'nokotta';
        let sideToggle = false;
        const runLoop = () => {
            if (!activeStateChecker()) return;
            let type;
            if (lastType === 'hakkeyoi') { type = 'nokotta'; }
            else { type = Math.random() < 0.5 ? 'hakkeyoi' : 'nokotta'; }
            lastType = type;
            const text = type === 'hakkeyoi' ? 'はっけよい！' : 'のこった！';
            SoundFX.playVoice(type, 0.66);
            this.showGyojiCall(text, sideToggle ? 'right' : 'left');
            if (this.els.gyoji) {
                this.els.gyoji.style.transform = sideToggle ? 'scaleX(-1)' : 'scaleX(1)';
            }
            sideToggle = !sideToggle;
            this.gyojiTimer = setTimeout(runLoop, randInterval());
        };
        this.gyojiTimer = setTimeout(runLoop, randInterval());
    }

    stopGyojiCalls() {
        if (this.gyojiTimer) { clearTimeout(this.gyojiTimer); this.gyojiTimer = null; }
        document.querySelectorAll('.gyoji-shout').forEach(el => el.remove());
        if (this.els.gyoji) {
            this.els.gyoji.style.transform = 'scaleX(1)';
        }
    }

    showGyojiCall(text, side) {
        if (!this.els.gyoji) return;
        const el = document.createElement('div');
        el.className = `gyoji-shout shout-${side}`;
        el.textContent = text;
        this.els.gyoji.parentElement.appendChild(el);
        setTimeout(() => el.remove(), 1200);
    }

    setGyojiImage(type) {
        if (!this.els.gyoji) return;
        if (type === 'hakkeyoi') this.els.gyoji.src = 'assets/img/gyouzi_hakkeyoi.png';
        if (type === 'nokotta') this.els.gyoji.src = 'assets/img/gyouzi_nokotta.png';
        if (type === 'syoubuari') this.els.gyoji.src = 'assets/img/gyouzi_syoubuari.png';
    }

    initSelectScreen() {
        if (typeof RIKISHI_DATA === 'undefined' || RIKISHI_DATA.length === 0) {
            setTimeout(() => this.initSelectScreen(), 500);
            return;
        }
        const sel = document.getElementById('match-count-select');
        if (sel) {
            sel.innerHTML = '';
            for (let i = 1; i <= 15; i++) { const o = document.createElement('option'); o.text = i; if (i === 2) o.selected = true; sel.add(o); }
        }

        const iconGrid = document.querySelector('#char-select-screen #icon-grid') || document.getElementById('icon-grid');
        if (!iconGrid) return;
        iconGrid.innerHTML = '';
        const gridSlots = buildCharGridSlots();
        for (let i = 0; i < 20; i++) {
            const icon = document.createElement('div');
            const charData = gridSlots[i];
            let classes = ['char-select-icon'];
            if (charData) {
                icon.dataset.id = charData.id;
                const bgFile = charTypeAssets(charData).bg;

                if (bgFile) {
                    const faceImg = this.getImagePath(charData.img);
                    const bgImg = `assets/img/${bgFile}`;
                    icon.style.backgroundImage = `url('${faceImg}'), url('${bgImg}')`;
                    icon.style.backgroundPosition = 'center, center';
                    icon.style.backgroundSize = 'contain, cover';
                    icon.style.backgroundRepeat = 'no-repeat, no-repeat';
                } else {
                    icon.style.backgroundImage = `url('${this.getImagePath(charData.img)}')`;
                }

                if (charData.category === "レジェンド") {
                    classes.push('cat-legend');
                    icon.style.backgroundColor = '#ffffff';
                }
                else if (charData.category === "ドリーム") {
                    // 結婚式Verでは隠し力士の仕組みを廃止したため、常に表示する。
                    // （カテゴリは紫ピンクのオーラを出すための見た目の指定として残している）
                    classes.push('cat-dream');
                    icon.style.backgroundColor = '#ffffff';
                }
                else if (charData.category === "空きスロット") {
                    classes.push('cat-empty', 'inactive');
                }

            } else {
                classes.push('inactive');
            }
            icon.className = classes.join(' ');
            iconGrid.appendChild(icon);
        }
        this.updatePreview('p1', null); this.updatePreview('p2', null);
        this.initDraggableIcons();
    }

    initDraggableIcons() {
        const ghost = document.getElementById('drag-ghost');
        let isDragging = false; let dragId = null; let dragSource = null;

        document.addEventListener('mousedown', (e) => {
                const icon = e.target.closest('.char-select-icon');
                if (icon) {
                    if (icon.classList.contains('inactive') || icon.classList.contains('secret-hidden') || !icon.hasAttribute('data-id')) return;
                    e.preventDefault(); isDragging = true; dragId = parseInt(icon.dataset.id); dragSource = 'icon';
                    const charData = RIKISHI_DATA.find(d => d.id === dragId);
                    ghost.style.backgroundImage = `url('${charData ? this.getImagePath(charData.img) : ""}')`;
                    ghost.style.display = 'block';
                    this.moveGhost(ghost, e.clientX, e.clientY); return;
                }
                const head = e.target.closest('.preview-char-img .head');
                if (head) {
                    const box = head.closest('.preview-box'); if (!box) return;
                    const pId = box.id === 'preview-p1' ? 'p1' : 'p2';
                    const charId = this.game.state.chars[pId]; if (charId === null) return;
                    e.preventDefault(); isDragging = true; dragId = charId; dragSource = pId;
                    const charData = RIKISHI_DATA.find(d => d.id === charId);
                    ghost.style.backgroundImage = `url('${charData ? this.getImagePath(charData.img) : ""}')`;
                    ghost.style.display = 'block';
                    head.classList.add('dragging-source'); this.moveGhost(ghost, e.clientX, e.clientY);
                }
            });
        document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                e.preventDefault(); this.moveGhost(ghost, e.clientX, e.clientY);
                const p1Box = document.getElementById('preview-p1'); const p2Box = document.getElementById('preview-p2');
                const rect1 = p1Box.getBoundingClientRect(); const rect2 = p2Box.getBoundingClientRect();
                p1Box.classList.remove('drag-hover'); p2Box.classList.remove('drag-hover');
                if (this.isHit(e.clientX, e.clientY, rect1)) p1Box.classList.add('drag-hover');
                else if (this.isHit(e.clientX, e.clientY, rect2)) p2Box.classList.add('drag-hover');
            });
        document.addEventListener('mouseup', (e) => {
                if (!isDragging) return;
                isDragging = false; ghost.style.display = 'none';
                document.querySelectorAll('.preview-char-img .head').forEach(el => el.classList.remove('dragging-source'));
                const p1Box = document.getElementById('preview-p1'); const p2Box = document.getElementById('preview-p2');
                p1Box.classList.remove('drag-hover'); p2Box.classList.remove('drag-hover');
                const rect1 = p1Box.getBoundingClientRect(); const rect2 = p2Box.getBoundingClientRect();
                const hitP1 = this.isHit(e.clientX, e.clientY, rect1); const hitP2 = this.isHit(e.clientX, e.clientY, rect2);
                let hitIconID = null;
                const icons = document.querySelectorAll('.char-select-icon:not(.inactive):not(.secret-hidden)');

                for (let ic of icons) { const r = ic.getBoundingClientRect(); if (this.isHit(e.clientX, e.clientY, r)) { hitIconID = parseInt(ic.dataset.id); break; } }
                if (hitP1) {
                    this.game.selectChar('p1', dragId);
                    if (dragSource === 'p2') this.game.selectChar('p2', null);
                }
                else if (hitP2) {
                    this.game.selectChar('p2', dragId);
                    if (dragSource === 'p1') this.game.selectChar('p1', null);
                }
                else if (hitIconID !== null && (dragSource === 'p1' || dragSource === 'p2')) {
                    this.game.selectChar(dragSource, hitIconID);
                }
                else if (dragSource === 'p1' || dragSource === 'p2') {
                    this.game.selectChar(dragSource, null);
                }
            });
    }
    moveGhost(ghost, x, y) { ghost.style.left = x + 'px'; ghost.style.top = y + 'px'; }
    isHit(x, y, rect) { return (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom); }

    updatePreview(playerId, charId) {
        const container = document.getElementById(`preview-${playerId}`);
        if (!container) return;

        container.classList.remove('cat-legend', 'cat-dream');

        let isCPU = false;
        let cpuLevel = 3;
        const toggleEl = document.getElementById(`cpu-toggle-${playerId}`);
        const levelEl = document.getElementById(`cpu-level-${playerId}`);
        if (toggleEl) isCPU = toggleEl.checked;
        if (levelEl) cpuLevel = parseInt(levelEl.value);

        const previewChar = (charId !== null && typeof RIKISHI_DATA !== 'undefined')
            ? RIKISHI_DATA.find(d => d.id === charId) : null;
        const imgName = `assets/img/${bodyImageFile(playerId, isCPU, previewChar)}`;

        const checked = isCPU ? 'checked' : '';
        const levelStyle = isCPU ? 'display:block;' : 'display:none;';

        const levels = [
            { v: 7, l: "横綱" }, { v: 6, l: "大関" }, { v: 5, l: "関脇" },
            { v: 4, l: "小結" }, { v: 3, l: "前頭" }, { v: 2, l: "十両" }, { v: 1, l: "幕下" }
        ];
        let options = levels.map(L => `<option value="${L.v}" ${L.v === cpuLevel ? 'selected' : ''}>${L.l}</option>`).join('');

        let switchHtml = `
            <div class="cpu-switch-container ${playerId}-switch">
                <div class="switch-wrapper">
                    <span class="player-label-text">Player</span>
                    <label class="switch">
                        <input type="checkbox" id="cpu-toggle-${playerId}" onchange="game.toggleCPU('${playerId}', this.checked)" ${checked}>
                        <span class="slider round"></span>
                    </label>
                    <span class="cpu-label-text">CPU</span>
                </div>
                <select id="cpu-level-${playerId}" class="custom-select" style="${levelStyle}">
                    ${options}
                </select>
            </div>`;

        const controlText = isCPU ? 'CPU' : playerId.toUpperCase();

        const typeMap = { "バランスタイプ": "dock-balance", "テクニックタイプ": "dock-tech", "パワータイプ": "dock-power", "スピードタイプ": "dock-speed" };
        let dockClass = '';
        let charData = null;
        let bgHtml = '';
        let typeIconHtml = '';
        let dockFaceHtml = '';

        if (charId !== null) {
            charData = RIKISHI_DATA.find(d => d.id === charId);
            if (charData) {
                if (charData.category === "レジェンド") container.classList.add('cat-legend');
                else if (charData.category === "ドリーム") container.classList.add('cat-dream');

                const type = charData.desc;
                dockClass = typeMap[type] || 'dock-balance';

                const assets = charTypeAssets(charData);
                const bgFile = assets.bg;
                const typeImgFile = assets.typeImg;

                typeIconHtml = `<img src="assets/img/${typeImgFile}" class="type-kanji-icon" alt="${type}">`;
                if (bgFile) bgHtml = `<div class="char-background" style="background-image: url('assets/img/${bgFile}');"></div>`;
            }
        } else {
            const syncOffset = (performance.now() % 2000) / 1000;
            dockFaceHtml = `<div class="empty-dock-face" style="animation: dock-blink 2s ease-in-out -${syncOffset}s infinite;"></div>`;
        }

        const selectedClass = (charId !== null) ? 'is-selected' : '';

        let headStyle = 'display:none;';
        if (charId !== null && charData) {
            const src = this.getImagePath ? this.getImagePath(charData.img) : `assets/img/${charData.img}`;
            headStyle = `background-image:url('${src}');`;
        }

        let bodyAnimStyle = '';
        let bodyImgStyle = '';
        if (charId !== null && charData) {
            bodyAnimStyle = `style="animation-duration: ${speedAnimDuration(charData.speed)}s;"`;
            let scaleX = 1.0; let scaleY = 1.0;
            const wVal = charData.weight || 3;
            const hVal = charData.height || 3;

            // 身長(height)による縦幅の計算（12%刻み）
            if (hVal === 1) { scaleY = 0.72; }
            else if (hVal === 2) { scaleY = 0.84; }
            else if (hVal === 3) { scaleY = 0.96; }
            else if (hVal === 4) { scaleY = 1.08; }
            else if (hVal === 5) { scaleY = 1.20; }

            // 体重(weight)による横幅の計算（12%刻み）
            if (wVal === 1) { scaleX = 0.72; }
            else if (wVal === 2) { scaleX = 0.84; }
            else if (wVal === 3) { scaleX = 0.96; }
            else if (wVal === 4) { scaleX = 1.08; }
            else if (wVal === 5) { scaleX = 1.20; }

            let headTop = -30;
            if (hVal === 1) headTop = 25;   // 首が詰まりすぎたので上に（マイナス寄りに）逃がす
            if (hVal === 2) headTop = -5;
            if (hVal === 3) headTop = -30;  // 平均身長
            if (hVal === 4) headTop = -55;
            if (hVal === 5) headTop = -75;  // 先ほど良い感じだった高身長の位置

            bodyImgStyle = `style="transform: scale(${scaleX}, ${scaleY}); transform-origin: bottom center;"`;
            headStyle += `top: ${headTop}px;`;
        }
        const size = 100; const center = size / 2; const maxR = 40;
        let points = [0, 1, 2, 3, 4, 5].map(() => `${center},${center}`).join(' ');

        if (charData) {
            const stats = [charData.power, charData.tech, charData.speed, charData.stamina, charData.spirit, charData.reversal];
            points = stats.map((val, i) => {
                    const angle = (Math.PI * 2 / 6) * i - (Math.PI / 2);
                    const r = (val / 10) * maxR;
                    const x = center + r * Math.cos(angle);
                    const y = center + r * Math.sin(angle);
                    return `${x},${y}`;
                }).join(' ');
        }

        let radarHtml = `
            <div class="radar-chart-container">
                <svg viewBox="0 0 ${size} ${size}" class="radar-svg">
                    <polygon points="${this._getHexPoints(center, maxR)}" class="radar-guide" />
                    ${[0, 1, 2, 3, 4, 5].map(i => {
            const angle = (Math.PI * 2 / 6) * i - (Math.PI / 2);
            return `<line x1="${center}" y1="${center}" x2="${center + maxR * Math.cos(angle)}" y2="${center + maxR * Math.sin(angle)}" class="radar-axis" />`;
        }).join('')}
                    <polygon points="${points}" class="radar-poly" />
                    <polygon points="${this._getHexPoints(center, maxR * 0.5)}" class="radar-guide-mid" />
                </svg>
            </div>`;

        let html = `${switchHtml}
        ${dockFaceHtml}
        <div class="preview-char-img ${selectedClass}">
            ${typeIconHtml}
            ${bgHtml}
            <div class="anim-wrapper ${dockClass}">
                <div class="rikishi-body" ${bodyAnimStyle}>
                    <img src="${imgName}" class="body-img" ${bodyImgStyle}>
                    <div class="head" style="${headStyle}"></div>
                </div>
            </div>
        </div>`;

        if (charData) {
            const d = charData;
            const colorVal = (v) => {
                if (v >= 8) return `<span class="stat-high">${v}</span>`;
                if (v <= 3) return `<span class="stat-low">${v}</span>`;
                return `<span>${v}</span>`;
            };
            const typeName = d.desc.replace('タイプ', '');
            const aiName = d.aiType || '素直';

            html += `
            <div class="preview-info">
                ${radarHtml} 
                <div class="preview-name">${d.name}${d.nickname ? `<span class="preview-nickname">${d.nickname}</span>` : ''}</div>
                <div class="preview-badge-type">${typeName}</div>
                <div class="preview-badge-ai">${aiName}</div>
                <div class="preview-stat-grid">
                    <div class="stat-row"><span></span>${colorVal(d.power)}</div>
                    <div class="stat-row"><span></span>${colorVal(d.tech)}</div>
                    <div class="stat-row"><span></span>${colorVal(d.speed)}</div>
                    <div class="stat-row"><span></span>${colorVal(d.stamina)}</div>
                    <div class="stat-row"><span></span>${colorVal(d.spirit)}</div>
                    <div class="stat-row"><span></span>${colorVal(d.reversal)}</div>
                </div>
                <div class="preview-badge-control">${controlText}</div>
                <div class="dosukoi-power-container">
                    <span class="dosukoi-value">${d.total || 0}</span>
                </div>
            </div>`;
        } else {
            html += `
            <div class="preview-info">
                ${radarHtml}
                <div class="preview-badge-control">${controlText}</div>
            </div>`;
        }
        container.innerHTML = html;
    }

    _getHexPoints(center, r) {
        let p = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI * 2 / 6) * i - (Math.PI / 2);
            p.push(`${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`);
        }
        return p.join(' ');
    }

    highlightKey(code, isPressed) {
        if (isPressed && this.game && (!this.game.state.active || this.game.state.paused)) {
            return;
        }
        const keyEls = document.querySelectorAll(`.block-key[data-code="${code}"]`);
        keyEls.forEach(el => {
                if (isPressed) el.classList.add('key-pressed');
                else el.classList.remove('key-pressed');
            });
    }

    // BGMモーダル (無音維持 & フェードイン復帰 対応版)

    openBgmModal() {
        const modal = document.getElementById('bgm-modal');
        if (modal) {
            modal.classList.add('active');

            this.savedBgmFile = (typeof settings !== 'undefined' && settings.current && settings.current.bgmFile) ? settings.current.bgmFile : 'random';
            this.tempSelectedFile = this.savedBgmFile;
            this.tempSelectedName = this.getBgmName(this.tempSelectedFile);

            this.isPreviewing = false;
            this.isMutedForPreview = false; // メインテーマをミュートしたかどうかのフラグ

            if (this.previewAudio) {
                this.previewAudio.pause();
                this.previewAudio = null;
            }

            this.showAlbumView();
            this.updateFixedControls();
        }
    }

    getBgmName(file) {
        if (!file || file === 'random') return 'ランダム (試合ごとにランダム再生)';
        if (typeof BGM_DATA !== 'undefined') {
            const track = BGM_DATA.find(b => b.file === file);
            if (track) return track.name;
        }
        return '未設定';
    }

    closeBgmModal() {
        const modal = document.getElementById('bgm-modal');
        if (modal) modal.classList.remove('active');

        // 視聴中だった場合は視聴音声を止める
        if (this.previewAudio) {
            this.previewAudio.pause();
            this.previewAudio = null;
        }
        this.isPreviewing = false;

        // 視聴のためにメインテーマをミュートしていた場合、フェードインで復帰させる
        if (this.isMutedForPreview && typeof SoundFX !== 'undefined') {
            this.fadeInMainTheme();
            this.isMutedForPreview = false;
        }
    }

    // メインテーマを徐々にフェードインさせる処理
    fadeInMainTheme() {
        // 元の再生時と同じく bgmVolume * 0.66 を上限（ターゲット）にする
        const targetVol = SoundFX.bgmVolume * 0.66;
        const fadeStep = targetVol / 20; // 20段階で音量を上げる

        const doFade = (audio) => {
            if (!audio || audio.paused) return;
            let currentVol = audio.volume;

            const interval = setInterval(() => {
                    currentVol += fadeStep;
                    if (currentVol >= targetVol) {
                        audio.volume = targetVol;
                        clearInterval(interval);
                    } else {
                        audio.volume = currentVol;
                    }
                }, 50); // 50msごとに音量を上げる (約1秒で元の音量に)
        };

        if (SoundFX.openingAudio) doFade(SoundFX.openingAudio);
        if (SoundFX.charSelectAudio) doFade(SoundFX.charSelectAudio);
    }
    showAlbumView() {
        const albumView = document.getElementById('album-view');
        const trackView = document.getElementById('track-view');
        const subtitle = document.getElementById('bgm-modal-subtitle');

        if (!albumView || !trackView) return;

        albumView.style.display = 'block';
        trackView.style.display = 'none';

        if (subtitle) subtitle.textContent = '-ALBUM-';

        this.renderAlbums();
    }

    renderAlbums() {
        const albumContainer = document.getElementById('album-grid');
        if (!albumContainer) return;

        albumContainer.classList.remove('album-grid');

        let activeAlbumId = 'random';
        if (this.tempSelectedFile && this.tempSelectedFile !== 'random' && typeof BGM_DATA !== 'undefined') {
            const track = BGM_DATA.find(b => b.file === this.tempSelectedFile);
            if (track) activeAlbumId = track.albumId;
        }

        // 1. 特別なアルバム（ランダム、曲一覧）ボーダー・見出しなし
        const isRandomSelected = (activeAlbumId === 'random');
        let html = `
            <div class="album-grid">
                <div class="album-item ${isRandomSelected ? 'selected-album' : ''}" onclick="game.ui.selectRandomAlbum()">
                    <img src="assets/img/random.png" onerror="this.src='assets/img/rikishiflame.png'">
                    <div>ランダム</div>
                </div>
                <div class="album-item" onclick="game.ui.renderTracks('all')">
                    <img src="assets/img/allmusic.png" onerror="this.src='assets/img/rikishiflame.png'">
                    <div>曲一覧</div>
                </div>
            </div>
        `;

        if (typeof ALBUM_DATA !== 'undefined' && ALBUM_DATA.length > 0) {
            const categoriesMap = new Map();

            ALBUM_DATA.forEach(alb => {
                    const catName = alb.category || 'その他';
                    if (!categoriesMap.has(catName)) {
                        categoriesMap.set(catName, { id: alb.categoryId, name: catName, albums: [] });
                    }
                    categoriesMap.get(catName).albums.push(alb);
                });

            const sortedCategories = Array.from(categoriesMap.values()).sort((a, b) => a.id - b.id);

            sortedCategories.forEach(cat => {
                    html += `<div class="album-category-title">${cat.name}</div>`;
                    html += `<div class="album-grid">`;

                    cat.albums.forEach(alb => {
                            const isSelected = (alb.id === activeAlbumId);
                            const highlightClass = isSelected ? 'selected-album' : '';
                            const imgSrc = alb.img.includes('/') ? alb.img : `assets/img/${alb.img}`;

                            html += `
                    <div class="album-item ${highlightClass}" onclick="game.ui.renderTracks('${alb.id}')">
                        <img src="${imgSrc}" onerror="this.src='assets/img/rikishiflame.png'">
                        <div>${alb.name}</div>
                    </div>`;
                        });
                    html += `</div>`;
                });
        }

        albumContainer.innerHTML = html;
    }

    selectRandomAlbum() {
        // ランダム選択時は視聴を止めるが、メインテーマの復帰は行わない
        if (this.tempSelectedFile !== 'random' && this.isPreviewing) {
            if (this.previewAudio) {
                this.previewAudio.pause();
                this.previewAudio = null;
            }
            this.isPreviewing = false;
        }

        this.tempSelectedFile = 'random';
        this.tempSelectedName = 'ランダム (試合ごとにランダム再生)';

        this.renderAlbums();
        this.updateFixedControls();
    }

    renderTracks(albumId) {
        this.currentAlbumId = albumId;
        const albumView = document.getElementById('album-view');
        const trackView = document.getElementById('track-view');
        const trackList = document.getElementById('track-list');
        const titleDisplay = document.getElementById('current-album-title');
        const subtitle = document.getElementById('bgm-modal-subtitle');

        if (!albumView || !trackView || !trackList) return;

        albumView.style.display = 'none';
        trackView.style.display = 'block';

        if (subtitle) subtitle.textContent = '-MUSIC-';

        let albumName = "曲一覧";
        if (albumId !== 'all' && typeof ALBUM_DATA !== 'undefined') {
            const target = ALBUM_DATA.find(a => a.id === albumId);
            if (target) albumName = target.name;
        }

        if (titleDisplay) {
            // アルバムタイトルに「」を付ける
            titleDisplay.textContent = `「${albumName}」`;
        }

        let tracks = [];
        if (albumId === 'all') {
            tracks = BGM_DATA || [];
        } else {
            tracks = (BGM_DATA || []).filter(bgm => bgm.albumId === albumId);
        }

        if (tracks.length === 0) {
            trackList.innerHTML = '<li class="track-item">曲がありません</li>';
        } else {
            trackList.innerHTML = tracks.map(bgm => {
                    const isSelected = (this.tempSelectedFile === bgm.file);
                    return `
                <li class="track-item ${isSelected ? 'selected' : ''}" onclick="game.ui.selectTempTrack('${bgm.file}', '${bgm.name}')">
                    <span class="track-name">${bgm.name}</span>
                </li>
                `;
                }).join('');
        }

        this.updateFixedControls();
    }

    selectTempTrack(file, name) {
        // 別の曲を選んだ時は視聴を止めるが、メインテーマの復帰は行わない
        if (this.tempSelectedFile !== file && this.isPreviewing) {
            if (this.previewAudio) {
                this.previewAudio.pause();
                this.previewAudio = null;
            }
            this.isPreviewing = false;
        }

        this.tempSelectedFile = file;
        this.tempSelectedName = name;
        this.renderTracks(this.currentAlbumId);
    }

    updateFixedControls() {
        const footer = document.querySelector('#bgm-modal .modal-footer');
        if (!footer) return;

        const isRandom = this.tempSelectedFile === 'random';
        const previewText = this.isPreviewing ? '■ 停止' : '▶ 視聴';
        const previewClass = this.isPreviewing ? 'is-playing' : '';
        const displayName = this.tempSelectedName ? this.tempSelectedName.replace(' (試合ごとにランダム再生)', '') : '未設定';

        // ランダムが選ばれている時は、視聴ボタンのHTML自体を出力しない
        const previewBtnHtml = isRandom ? '' : `<button class="btn preview-btn ${previewClass}" onclick="game.ui.togglePreview()">${previewText}</button>`;

        footer.innerHTML = `
            <div id="bgm-status-text">選択中：${displayName}</div>
            <div class="track-btn-group">
                ${previewBtnHtml}
                <button class="btn confirm-btn" onclick="game.ui.confirmBgm()">決定</button>
            </div>
        `;
    }

    togglePreview() {
        if (this.tempSelectedFile === 'random') return;

        if (this.isPreviewing) {
            // ■ 停止処理（視聴を止めるだけで、メインテーマの音量は0のまま）
            if (this.previewAudio) {
                this.previewAudio.pause();
                this.previewAudio = null;
            }
            this.isPreviewing = false;
        } else {
            // ▶ 視聴開始処理
            if (typeof SoundFX !== 'undefined') {
                if (SoundFX.openingAudio) SoundFX.openingAudio.volume = 0;
                if (SoundFX.charSelectAudio) SoundFX.charSelectAudio.volume = 0;
                this.isMutedForPreview = true; // ミュートフラグをONにする

                this.previewAudio = new Audio(`assets/bgm/${this.tempSelectedFile}`);
                this.previewAudio.volume = SoundFX.bgmVolume * 0.66;
                this.previewAudio.loop = true;
                this.previewAudio.play().catch(e => console.warn(e));
            }
            this.isPreviewing = true;
        }
        this.updateFixedControls();
    }
    confirmBgm() {
        if (typeof settings !== 'undefined') {
            settings.current.bgmFile = this.tempSelectedFile;
            settings.save();
        }

        this.savedBgmFile = this.tempSelectedFile;

        if (typeof SoundFX !== 'undefined') {
            SoundFX.selectedBgmFile = this.tempSelectedFile;
        }

        this.showBGMToast(`${this.tempSelectedName.replace(' (試合ごとにランダム再生)', '')} をセットしました`);

        this.closeBgmModal();
        this.renderAlbums();
    }
}