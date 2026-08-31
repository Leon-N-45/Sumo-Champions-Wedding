/**
 * team_game.js
 * 団体戦の進行管理（編成・シークレット選出・勝ち抜き・チーム勝敗）を担当するクラス
 */
class TeamGameManager {
    constructor() {
        this.state = {
            teams: { p1: [null, null, null], p2: [null, null, null] },
            currentIndex: { p1: 0, p2: 0 },
            isPlaying: false,
            isTransitioning: false,

            // シークレット選出画面用の状態管理
            round: 1,
            usedChars: { p1: [false, false, false], p2: [false, false, false] },
            secretReady: { p1: false, p2: false },
            secretSelection: { p1: null, p2: null },
            isSecretPhase: false,

            // 追加：チームの勝星（スコア）を管理
            teamWins: { p1: 0, p2: 0 },

            // 各取組の結果（勝者と両者の力士ID）。勝利画面のMVP（金星）算出に使用
            boutHistory: [],

            // 取り組み形式: 'nihon'(二本先取) / 'kachinuki'(勝ち抜き)。既定は二本先取
            rule: 'nihon',

            // 勝ち抜き用：各プレイヤーの出場順（スロット番号の配列）
            orderPick: { p1: [], p2: [] },
            // 勝ち抜き用：連戦の進行（現在の出場者index・並び順の力士ID・HP引き継ぎ）
            kachinuki: { p1cur: 0, p2cur: 0, lineup: { p1: [], p2: [] }, carrySide: null, carryStamina: 0, carryMaxStamina: 0 },

            // スロット単位のCPU設定（各チーム3枠を個別に人間/CPU指定。レベルは段位値）
            slotCPU: { p1: [false, false, false], p2: [false, false, false] },
            slotLevel: { p1: [3, 3, 3], p2: [3, 3, 3] }
        };
        this.init();

        this.handleKeyDown = this.handleKeyDown.bind(this);
        document.addEventListener('keydown', this.handleKeyDown);

        this.finalAdvanceTimer = null;
    }

    async init() {
        this.ui = new TeamUIManager(this);
        document.body.classList.add('loaded');
    }

    selectTeamChar(player, index, charId) {
        this.state.teams[player][index] = charId;
        this.ui.updateTeamDisplay();
    }

    goToTeamSelect(seType = 'random') {
        if (typeof SoundFX !== 'undefined') SoundFX.unlockSelectBGM();

        if (this.state.isTransitioning) return;
        this.state.isTransitioning = true;

        // 勝ち抜きの順番発表などが進行中でも確実に止める：中断フラグ・発表オーバーレイ・ボイスを処理
        if (typeof game !== 'undefined' && game.state) game.state.aborted = true;
        if (typeof SoundFX !== 'undefined' && SoundFX.stopVoices) SoundFX.stopVoices();
        const introOverlay = document.getElementById('day-overlay');
        if (introOverlay) { introOverlay.classList.remove('visible', 'instant'); introOverlay.innerHTML = ''; }

        const curtain = document.getElementById('transition-curtain');
        const gameWrapper = document.getElementById('game-wrapper');
        const isReturningFromGame = gameWrapper && gameWrapper.style.display !== 'none';

        if (seType !== 'none' && !isReturningFromGame) {
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

        if (curtain) {
            curtain.classList.add('active');
            setTimeout(() => {
                    document.getElementById('start-screen').classList.remove('active');
                    if (gameWrapper) gameWrapper.style.display = 'none';
                    const resOverlay = document.getElementById('result-overlay');
                    if (resOverlay) { resOverlay.classList.remove('final-mode', 'visible'); resOverlay.style.background = ''; }

                    const secretScreen = document.getElementById('team-secret-screen');
                    if (secretScreen) secretScreen.classList.remove('active');

                    // 発表オーバーレイが残っていないよう再度クリア
                    const ov2 = document.getElementById('day-overlay');
                    if (ov2) { ov2.classList.remove('visible', 'instant'); ov2.innerHTML = ''; }

                    // 個人戦と同じ優勝画面(result-overlay)の後始末：match-info を消し next-btn を戻す
                    const matchInfo = document.getElementById('match-info');
                    if (matchInfo) matchInfo.innerHTML = '';
                    const nextBtn = document.getElementById('next-btn');
                    if (nextBtn) nextBtn.style.display = '';

                    if (isReturningFromGame) {
                        const teamPopover = document.getElementById('team-format-popover');
                        if (teamPopover) teamPopover.classList.remove('active');
                        const soloPopover = document.getElementById('format-popover');
                        if (soloPopover) soloPopover.classList.remove('active');
                        if (typeof settings !== 'undefined' && typeof settings.closeMenu === 'function') settings.closeMenu();
                    }

                    const teamScreen = document.getElementById('team-select-screen');
                    if (teamScreen) {
                        teamScreen.classList.add('active');
                        if (isReturningFromGame) {
                            const fastForward = () => {
                                const anims = teamScreen.getAnimations({ subtree: true });
                                anims.forEach(anim => {
                                        if (anim.effect && anim.effect.getTiming().iterations === Infinity) return;
                                        try { anim.finish(); } catch(e) {}
                                    });
                            };
                            requestAnimationFrame(() => {
                                    fastForward();
                                    setTimeout(fastForward, 50);
                                    setTimeout(fastForward, 150);
                                    setTimeout(fastForward, 300);
                                    setTimeout(fastForward, 500);
                                });
                        }
                    }
                }, 400);

            setTimeout(() => {
                    curtain.classList.remove('active');
                    this.state.isTransitioning = false;
                    if (typeof SoundFX !== 'undefined') SoundFX.playRandomSelectBGM();
                }, 1500);
        } else {
            document.getElementById('start-screen').classList.remove('active');
            document.getElementById('team-select-screen').classList.add('active');
            this.state.isTransitioning = false;
            if (typeof SoundFX !== 'undefined') SoundFX.playRandomSelectBGM();
        }
    }

    startTeamMatch() {
        document.getElementById('team-select-screen').classList.remove('active');

        // 取り組み形式を取得（既定は二本先取）
        const ruleSel = document.getElementById('team-rule-select');
        this.state.rule = (ruleSel && ruleSel.value) ? ruleSel.value : 'nihon';

        this.state.round = 1;
        this.state.usedChars = { p1: [false, false, false], p2: [false, false, false] };

        // 追加：チームの勝星をリセット
        this.state.teamWins = { p1: 0, p2: 0 };
        this.state.boutHistory = [];

        // 勝ち抜き状態のリセット
        this.state.orderPick = { p1: [], p2: [] };
        this.state.kachinuki = { p1cur: 0, p2cur: 0, lineup: { p1: [], p2: [] }, carrySide: null, carryStamina: 0, carryMaxStamina: 0 };

        this.showSecretScreen();
    }

    showSecretScreen() {
        // 出場力士の選出中はBGMを止める（無音）
        if (typeof SoundFX !== 'undefined') SoundFX.stopBGM();

        this.state.isSecretPhase = true;
        this.state.secretReady = { p1: false, p2: false };
        this.state.secretSelection = { p1: null, p2: null };
        this.state.orderPick = { p1: [], p2: [] };

        const secretScreen = document.getElementById('team-secret-screen');
        if (secretScreen) secretScreen.classList.add('active');

        const roundNameEl = document.getElementById('secret-round-name');
        const subEl = document.getElementById('secret-instruction-sub');
        if (this.state.rule === 'kachinuki') {
            if (roundNameEl) roundNameEl.textContent = '勝ち抜き';
            if (subEl) subEl.textContent = '三人の出場順をキー入力で決めろ！';
        } else {
            const roundNames = ["", "先鋒戦", "中堅戦", "大将戦"];
            if (roundNameEl) roundNameEl.textContent = roundNames[this.state.round] || "延長戦";
            if (subEl) subEl.textContent = '出場させる力士をこっそりキー入力しろ！';
        }

        document.getElementById('secret-p1-ready').classList.remove('active');
        document.getElementById('secret-p2-ready').classList.remove('active');

        this.buildSecretPanel('p1');
        this.buildSecretPanel('p2');

        if (this.state.rule === 'kachinuki') {
            this.buildKachinukiCircles('p1');
            this.buildKachinukiCircles('p2');
        } else {
            ['p1', 'p2'].forEach(pl => { const c = document.getElementById(`secret-${pl}-circles`); if (c) c.remove(); });
        }

        const checkCPU = (player) => {
            const allCPU = this.state.slotCPU[player] && this.state.slotCPU[player].every(Boolean);
            if (allCPU) {
                if (this.state.rule === 'kachinuki') {
                    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
                    setTimeout(() => {
                            this.state.orderPick[player] = order;
                            this.state.secretReady[player] = true;
                            document.getElementById(`secret-${player}-ready`).classList.add('active');
                            if (typeof SoundFX !== 'undefined') SoundFX.playTone('parry');
                            this.checkSecretReady();
                        }, 500 + Math.random() * 1000);
                    return;
                }
                const unusedIndexes = [0, 1, 2].filter(idx => !this.state.usedChars[player][idx]);
                if (unusedIndexes.length > 0) {
                    const randomIdx = unusedIndexes[Math.floor(Math.random() * unusedIndexes.length)];
                    setTimeout(() => {
                            this.state.secretSelection[player] = randomIdx;
                            this.state.secretReady[player] = true;
                            document.getElementById(`secret-${player}-ready`).classList.add('active');
                            if (typeof SoundFX !== 'undefined') SoundFX.playTone('parry');
                            this.checkSecretReady();
                        }, 500 + Math.random() * 1000);
                }
            }
        };
        checkCPU('p1');
        checkCPU('p2');
    }

    buildSecretPanel(player) {
        const listEl = document.getElementById(`secret-${player}-list`);
        if (!listEl) return;
        listEl.innerHTML = '';

        const team = this.state.teams[player];
        const used = this.state.usedChars[player];
        const controls = typeof settings !== 'undefined' ? settings.current.controls[player] : null;

        const keys = controls ? [controls.l, controls.u, controls.r] : ['A', 'W', 'D'];
        const formatKey = (k) => {
            let name = k.replace('Key', '');
            if(name === 'ArrowLeft') return '←';
            if(name === 'ArrowUp') return '↑';
            if(name === 'ArrowRight') return '→';
            return name;
        };

        team.forEach((charId, index) => {
                const charData = RIKISHI_DATA.find(d => d.id === charId);
                if (!charData) return;

                const isUsed = used[index];
                const row = document.createElement('div');
                row.className = `secret-char-row ${isUsed ? 'used-char' : ''}`;

                const imgSrc = charData.img.includes('/') ? charData.img : `assets/img/${charData.img}`;

                row.innerHTML = `
                <div class="secret-char-icon" style="background-image: url('${imgSrc}')"></div>
                <div class="secret-char-info">${charData.name}</div>
                <div class="secret-key-hint">${formatKey(keys[index])}</div>
            `;
                listEl.appendChild(row);
            });
    }

    handleKeyDown(e) {
        if (!this.state.isSecretPhase) return;
        const controls = typeof settings !== 'undefined' ? settings.current.controls : null;
        if (!controls) return;

        ['p1', 'p2'].forEach(player => {
                if (this.state.secretReady[player]) return;
                const k = controls[player];
                let idx = -1;
                if (e.code === k.l) idx = 0;
                else if (e.code === k.u) idx = 1;
                else if (e.code === k.r) idx = 2;
                if (idx === -1) return;

                if (this.state.rule === 'kachinuki') {
                    // 勝ち抜き：同じスロットは一度だけ。押した順に出場順（先鋒→中堅→大将）を作る。
                    if (this.state.orderPick[player].includes(idx)) return;
                    this.state.orderPick[player].push(idx);
                    if (typeof SoundFX !== 'undefined') SoundFX.playTone('parry');
                    this.updateKachinukiCircles(player);
                    if (this.state.orderPick[player].length >= 3) {
                        this.state.secretReady[player] = true;
                        document.getElementById(`secret-${player}-ready`).classList.add('active');
                        this.checkSecretReady();
                    }
                    return;
                }

                if (!this.state.usedChars[player][idx]) {
                    this.state.secretSelection[player] = idx;
                    this.state.secretReady[player] = true;
                    document.getElementById(`secret-${player}-ready`).classList.add('active');
                    if (typeof SoundFX !== 'undefined') SoundFX.playTone('parry');
                    this.checkSecretReady();
                }
            });
    }

    // 勝ち抜きの選出インジケータ（各チーム下の〇×3）を生成。どの力士を選んだかは伏せる。
    buildKachinukiCircles(player) {
        const listEl = document.getElementById(`secret-${player}-list`);
        if (!listEl) return;
        const panel = listEl.parentElement;
        if (!panel) return;
        let circ = document.getElementById(`secret-${player}-circles`);
        if (!circ) {
            circ = document.createElement('div');
            circ.id = `secret-${player}-circles`;
            circ.className = 'secret-order-circles';
            circ.style.cssText = 'display:flex; justify-content:center; gap:18px; margin-top:18px;';
            for (let i = 0; i < 3; i++) {
                const dot = document.createElement('div');
                dot.className = 'order-dot';
                circ.appendChild(dot);
            }
            panel.appendChild(circ);
        }
        this.updateKachinukiCircles(player);
    }

    // 選んだ数だけ〇を点灯（どの力士を選んだかは分からないようにする）
    updateKachinukiCircles(player) {
        const circ = document.getElementById(`secret-${player}-circles`);
        if (!circ) return;
        const count = this.state.orderPick[player].length;
        Array.from(circ.children).forEach((d, i) => {
            if (i < count) d.classList.add('lit'); else d.classList.remove('lit');
        });
    }

    checkSecretReady() {
        if (this.state.secretReady.p1 && this.state.secretReady.p2) {
            this.state.isSecretPhase = false;
            if (this.state.rule === 'kachinuki') {
                setTimeout(() => { this.startKachinuki(); }, 1200);
            } else {
                setTimeout(() => {
                        this.transitionToTeamBattle();
                    }, 1500);
            }
        }
    }

    // 出場中の力士のスロット設定(人間/CPU・段位)を game に渡す
    _applyBoutCPU(p1SlotIdx, p2SlotIdx) {
        if (typeof game === 'undefined' || !game.state) return;
        const cp = this.state.slotCPU, lv = this.state.slotLevel;
        const get = (pl, idx) => ({
            isCPU: !!(cp[pl] && cp[pl][idx]),
            level: (lv[pl] && lv[pl][idx]) ? lv[pl][idx] : 3
        });
        game.state.teamCPUOverride = { p1: get('p1', p1SlotIdx), p2: get('p2', p2SlotIdx) };
    }

    // 勝ち抜き：出場順を確定し、先鋒→中堅→大将を一括発表してから初戦を開始
    startKachinuki() {
        const k = this.state.kachinuki;
        k.lineup.p1 = this.state.orderPick.p1.map(slot => this.state.teams.p1[slot]);
        k.lineup.p2 = this.state.orderPick.p2.map(slot => this.state.teams.p2[slot]);
        k.p1cur = 0;
        k.p2cur = 0;
        k.carrySide = null;
        k.carryStamina = 0;
        k.carryMaxStamina = 0;

        if (typeof game !== 'undefined') {
            game.state.isTeamMode = true;
            game.state.matches = 1;
            game.state.aborted = false;
        }

        // 暗転をキープしたまま発表へ：ステージ＋day-overlay(不透明)で覆い、暗幕が描画されてから選出画面を外す
        const gameWrapper = document.getElementById('game-wrapper');
        if (gameWrapper) gameWrapper.style.display = 'flex';
        const dayOverlay = document.getElementById('day-overlay');
        if (dayOverlay) { dayOverlay.innerHTML = ''; dayOverlay.classList.add('visible', 'instant'); }

        requestAnimationFrame(() => requestAnimationFrame(() => {
                document.getElementById('team-secret-screen').classList.remove('active');
                if (typeof game !== 'undefined' && game.ui && typeof game.ui.playKachinukiIntro === 'function') {
                    game.ui.playKachinukiIntro().then(() => this.startKachinukiBout());
                } else {
                    this.startKachinukiBout();
                }
            }));
    }

    // 勝ち抜き：現在の出場者どうしの取組を開始（発表は挟まない）
    startKachinukiBout() {
        if (typeof game !== 'undefined' && game.state && game.state.aborted) return;
        const k = this.state.kachinuki;
        const charP1 = k.lineup.p1[k.p1cur];
        const charP2 = k.lineup.p2[k.p2cur];
        if (typeof game !== 'undefined') {
            this._applyBoutCPU(this.state.orderPick.p1[k.p1cur], this.state.orderPick.p2[k.p2cur]);
            game.state.chars.p1 = charP1;
            game.state.chars.p2 = charP2;
            game.state.isTeamMode = true;
            game.teamRound = this.state.round;
            game.state.matches = 1;
            game.startGame(true);
        }
    }

    // 勝ち抜き：1取組の決着処理（勝者は残留しHPを引き継ぐ／敗者側は次の力士へ）
    onKachinukiBoutEnd(wId, stamina, maxStamina) {
        // 結果記録（勝利画面のMVP=金星算出に使用）
        if ((wId === 'p1' || wId === 'p2') && typeof game !== 'undefined' && game.state && game.state.chars) {
            this.state.boutHistory.push({ winner: wId, p1Id: game.state.chars.p1, p2Id: game.state.chars.p2 });
        }

        const k = this.state.kachinuki;
        const loserSide = (wId === 'p1') ? 'p2' : 'p1';

        // 相手を1人倒すごとにチームの勝星を加算（HUDの「○勝」表示に反映。3勝で優勝）
        if (this.state.teamWins && (wId === 'p1' || wId === 'p2')) this.state.teamWins[wId]++;

        // 勝者は残留し、残りHP（現在値）と体力上限値の両方を次戦へ引き継ぐ
        k.carrySide = wId;
        k.carryStamina = stamina;
        k.carryMaxStamina = maxStamina;

        // 敗者側は次の力士へ
        if (loserSide === 'p1') k.p1cur++; else k.p2cur++;

        // 敗者側が3人とも負けたら決着（最後の一人が負けた側の負け）
        const loserCur = (loserSide === 'p1') ? k.p1cur : k.p2cur;
        if (loserCur > 2) {
            this.showTeamResult(wId);
            return;
        }

        // 暗幕を流して次の取組（発表なし・開始前のキー待ち状態）へ
        const curtain = document.getElementById('transition-curtain');
        if (curtain) curtain.classList.add('active');
        setTimeout(() => {
                const gameWrapper = document.getElementById('game-wrapper');
                if (gameWrapper) gameWrapper.style.display = 'none';
                const resOverlay = document.getElementById('result-overlay');
                if (resOverlay) { resOverlay.classList.remove('final-mode', 'visible'); resOverlay.style.background = ''; }
                this.startKachinukiBout();
            }, 400);
        setTimeout(() => { if (curtain) curtain.classList.remove('active'); }, 1500);
    }

    // 残り1名（未使用の力士）を自動選出する（3戦目で選択肢が無いとき用）
    autoSelectRemaining() {
        ['p1', 'p2'].forEach(pl => {
            const idx = this.state.usedChars[pl].findIndex(used => !used);
            this.state.secretSelection[pl] = (idx === -1 ? 0 : idx);
        });
    }

    transitionToTeamBattle() {
        // ⑤ 切替の瞬間に裏のステージが覗かないよう、先にステージ＋day-overlay(不透明)で覆ってから選出画面を外す
        const gameWrapper = document.getElementById('game-wrapper');
        if (gameWrapper) gameWrapper.style.display = 'flex';
        const dayOverlay = document.getElementById('day-overlay');
        if (dayOverlay) { dayOverlay.innerHTML = ''; dayOverlay.classList.add('visible', 'instant'); }

        document.getElementById('team-secret-screen').classList.remove('active');

        requestAnimationFrame(() => requestAnimationFrame(() => {
                const p1Idx = this.state.secretSelection.p1;
                const p2Idx = this.state.secretSelection.p2;

                // ここで「使用済み」を確実に記録
                this.state.usedChars.p1[p1Idx] = true;
                this.state.usedChars.p2[p2Idx] = true;

                const charP1 = this.state.teams.p1[p1Idx];
                const charP2 = this.state.teams.p2[p2Idx];

                if (typeof game !== 'undefined') {
                    this._applyBoutCPU(p1Idx, p2Idx);
                    game.state.chars.p1 = charP1;
                    game.state.chars.p2 = charP2;

                    // フラグを game.state 内に確実にセット
                    game.state.isTeamMode = true;
                    game.teamRound = this.state.round;

                    game.state.matches = 1; // 個人戦リザルトを出さないよう調整
                    game.startGame(true);
                }
            }));
    }

    // 追加：試合終了時のループと団体戦リザルト
    onRoundEnd(winner) {
        // この取組の結果を記録（勝利画面のMVP=金星算出に使用）。game.state.chars は今の取組の力士ID。
        if ((winner === 'p1' || winner === 'p2') && typeof game !== 'undefined' && game.state && game.state.chars) {
            this.state.boutHistory.push({ winner, p1Id: game.state.chars.p1, p2Id: game.state.chars.p2 });
        }

        // 1. 勝った方に1勝をプラス
        if (winner === 'p1' || winner === 'p2') {
            this.state.teamWins[winner]++;
        }

        // 2. 勝敗判定（2勝したチームがあれば優勝！）
        if (this.state.teamWins.p1 >= 2) {
            this.showTeamResult('p1');
        } else if (this.state.teamWins.p2 >= 2) {
            this.showTeamResult('p2');
        } else if (this.state.round >= 3) {
            // 万が一、3戦終わっても2勝していない場合（引き分けなど）
            if (this.state.teamWins.p1 > this.state.teamWins.p2) this.showTeamResult('p1');
            else if (this.state.teamWins.p2 > this.state.teamWins.p1) this.showTeamResult('p2');
            else this.showTeamResult('draw');
        } else {
            // 3. まだ決着がついていない場合は、ラウンドを進める
            this.state.round++;

            if (this.state.round >= 3) {
                // ④3戦目は選択不要。sweep暗幕は使わず day-overlay(不透明) で覆ったまま「明かし」へ。
                //   これで「大将戦」が即表示され、ひと呼吸おいてから1P力士が出る（早すぎ解消）。
                this.autoSelectRemaining();
                setTimeout(() => {
                    const gameWrapper = document.getElementById('game-wrapper');
                    if (gameWrapper) gameWrapper.style.display = 'none';
                    const resOverlay = document.getElementById('result-overlay');
                    if (resOverlay) { resOverlay.classList.remove('final-mode', 'visible'); resOverlay.style.background = ''; }
                    this.transitionToTeamBattle();
                }, 400);
            } else {
                // 通常：暗幕カーテンで覆ってシークレット選出画面へ戻る
                const curtain = document.getElementById('transition-curtain');
                if (curtain) curtain.classList.add('active');

                setTimeout(() => {
                        const gameWrapper = document.getElementById('game-wrapper');
                        if (gameWrapper) gameWrapper.style.display = 'none';

                        // バトルのリザルトを消す
                        const resOverlay = document.getElementById('result-overlay');
                        if (resOverlay) { resOverlay.classList.remove('final-mode', 'visible'); resOverlay.style.background = ''; }

                        this.showSecretScreen();
                    }, 400);

                setTimeout(() => {
                        if (curtain) curtain.classList.remove('active');
                    }, 1500);
            }
        }
    }

    showTeamResult(winner) {
        // 個人戦の優勝画面とUI・実装を統一（result-overlay を final-mode で使用）
        const nextBtn = document.getElementById('next-btn');
        if (nextBtn) nextBtn.style.display = 'none';

        const resOverlay = document.getElementById('result-overlay');
        if (resOverlay) { resOverlay.classList.add('final-mode', 'visible'); resOverlay.style.background = '#000'; }
        const kd = document.getElementById('kimarite-display'); if (kd) kd.textContent = '';
        const wm = document.getElementById('win-message'); if (wm) wm.textContent = '';

        let titleText = '引き分け';
        let html = '';

        if (winner === 'p1' || winner === 'p2') {
            titleText = (winner === 'p1' ? '東組' : '西組') + ' 優勝！';

            const costOf = (id) => {
                const c = (typeof RIKISHI_DATA !== 'undefined') ? RIKISHI_DATA.find(d => d.id === id) : null;
                return c ? (c['コスト'] || 0) : 0;
            };
            const imgOf = (id) => {
                const c = (typeof RIKISHI_DATA !== 'undefined') ? RIKISHI_DATA.find(d => d.id === id) : null;
                if (!c || !c.img) return '';
                return (typeof game !== 'undefined' && game.ui) ? game.ui.getImagePath(c.img) : c.img;
            };

            // MVP（金星）：勝利チームが勝った取組のうち「相手コスト − 自分コスト」が最大の力士。
            // 同値が複数いる場合は、その中で自分のコストが最も大きい力士を採用。
            let mvpId = null, bestDiff = -Infinity, bestOwnCost = -Infinity;
            (this.state.boutHistory || []).forEach(b => {
                if (b.winner !== winner) return;
                const ownId = (winner === 'p1') ? b.p1Id : b.p2Id;
                const oppId = (winner === 'p1') ? b.p2Id : b.p1Id;
                const diff = costOf(oppId) - costOf(ownId);
                const ownCost = costOf(ownId);
                if (diff > bestDiff || (diff === bestDiff && ownCost > bestOwnCost)) {
                    bestDiff = diff; bestOwnCost = ownCost; mvpId = ownId;
                }
            });
            const roster = (this.state.teams[winner] || []).filter(id => id != null);
            if (mvpId == null) mvpId = roster[0];

            // MVP は個人戦の優勝画面と全く同じ仕様で超ズーム
            const mvpImg = imgOf(mvpId);
            if (mvpImg) {
                html += `<div class="bg-anim" style="position:absolute; top:50%; left:50%; width:1500px; height:1500px; border-radius:50%; background:url('${mvpImg}') center/cover; pointer-events:none;"></div>`;
            }

            // その他の力士（MVP以外）を戦闘時の見た目（顔＋体・同サイズ）で左下／右下に暗めに表示
            const isCPU = (() => { const t = document.getElementById(`cpu-toggle-${winner}`); return !!(t && t.checked); })();
            // MVPは「1体だけ」除外する（同じ力士が複数いても残りはきちんと表示するため、id一致での全削除はしない）
            const mvpIdx = roster.indexOf(mvpId);
            const others = roster.filter((id, idx) => idx !== mvpIdx).slice(0, 2);
            const corners = ['left:3%;', 'right:3%;'];
            others.forEach((id, i) => {
                const sprite = (typeof game !== 'undefined' && game.ui && game.ui.buildBattleSprite) ? game.ui.buildBattleSprite(id, winner, isCPU) : '';
                if (sprite) {
                    html += `<div style="position:absolute; bottom:4%; ${corners[i]} z-index:5; opacity:0.92; filter:brightness(0.42); pointer-events:none;">${sprite}</div>`;
                }
            });
        }

        const teamColor = (winner === 'p1') ? 'var(--p1-color)' : ((winner === 'p2') ? 'var(--p2-color)' : null);
        const titleHtml = teamColor
            ? `<span style="color:${teamColor};">${winner === 'p1' ? '東組' : '西組'}</span> 優勝！`
            : titleText;
        html += `<div class="winner-anim" style="position:relative; z-index:10; font-size:4rem; color:gold; font-weight:900; text-shadow:4px 4px 0 #000; font-family: 'Shippori Mincho', serif;">${titleHtml}</div>`;
        html += `<div id="final-btn-container"><button class="btn" onclick="window.teamGame.teamRematch()">同じ条件で再戦</button><button id="auto-top-btn" class="btn">力士選択へ (5)</button></div>`;
        const matchInfo = document.getElementById('match-info');
        if (matchInfo) matchInfo.innerHTML = html;

        // ズーム演出の後半で appare.mp3 → 再生終了でボタン表示＋カウントダウン（個人戦と同一）
        setTimeout(() => {
            const reveal = () => {
                const container = document.getElementById('final-btn-container');
                if (container) container.style.display = 'flex';
                const autoBtn = document.getElementById('auto-top-btn');
                let count = 5;
                const executeReturn = () => {
                    if (this.finalAdvanceTimer) clearInterval(this.finalAdvanceTimer);
                    this.finalAdvanceTimer = null;
                    this.goToTeamSelect('random');
                };
                if (autoBtn) autoBtn.onclick = executeReturn;
                if (this.finalAdvanceTimer) clearInterval(this.finalAdvanceTimer);
                this.finalAdvanceTimer = setInterval(() => {
                    if (typeof game !== 'undefined' && game.state && game.state.paused) return;
                    count--;
                    if (count > 0) {
                        if (autoBtn) autoBtn.textContent = `力士選択へ (${count})`;
                    } else {
                        executeReturn();
                    }
                }, 1000);
            };
            const audio = new Audio('assets/se/appare.mp3');
            audio.play().then(() => { audio.onended = reveal; }).catch(() => reveal());
        }, 2000);
    }

    // 「同じ条件で再戦」：チーム編成はそのままに、選出画面から団体戦を再開する
    teamRematch() {
        if (this.finalAdvanceTimer) { clearInterval(this.finalAdvanceTimer); this.finalAdvanceTimer = null; }
        if (typeof SoundFX !== 'undefined') { SoundFX.stopBGM(); SoundFX.currentRandomBgm = null; }

        const nextBtn = document.getElementById('next-btn');
        if (nextBtn) nextBtn.style.display = '';

        // 編成は維持し、スコア・使用済み・選出状態をリセット
        this.state.teamWins = { p1: 0, p2: 0 };
        this.state.boutHistory = [];
        this.state.round = 1;
        this.state.usedChars = { p1: [false, false, false], p2: [false, false, false] };
        this.state.secretReady = { p1: false, p2: false };
        this.state.secretSelection = { p1: null, p2: null };
        this.state.isTransitioning = false;

        // 勝ち抜き状態のリセット
        this.state.orderPick = { p1: [], p2: [] };
        this.state.kachinuki = { p1cur: 0, p2cur: 0, lineup: { p1: [], p2: [] }, carrySide: null, carryStamina: 0, carryMaxStamina: 0 };

        const curtain = document.getElementById('transition-curtain');
        if (curtain) curtain.classList.add('active');
        setTimeout(() => {
            const gameWrapper = document.getElementById('game-wrapper');
            if (gameWrapper) gameWrapper.style.display = 'none';
            const ro = document.getElementById('result-overlay');
            if (ro) { ro.classList.remove('final-mode', 'visible'); ro.style.background = ''; }
            const mi = document.getElementById('match-info');
            if (mi) mi.innerHTML = '';
            this.showSecretScreen();
        }, 400);
        setTimeout(() => {
            if (curtain) curtain.classList.remove('active');
        }, 1500);
    }
}

window.addEventListener('load', () => {
    window.teamGame = new TeamGameManager();
});