/**
 * ai.js
 * AIController（思考×タイプ×レベル＋個体差）
 *
 * 重要な実装方針：このゲームは「溜めキー(d)を離すとチャージが即0に戻る」。
 * そのため、ぶちかまし(charge≥50で前進)や投げ(組み合いでcharge必要)を出すには、
 * 発動するまで d を握り続ける必要がある。AIは「プラン」を保持し、
 * プランが続く間は毎フレーム必要なキーを握り続けてチャージを維持する。
 *
 *   思考(aiType) : 力押し / 技狙い / 素直 / 変則
 *   タイプ(playType): パワー(ぶちかまし多) / テクニック(掴み投げ多) / スピード(いなし多) / バランス
 *   レベル(cpuLevel): 1=幕下 〜 7=横綱
 */
class AIController {
    constructor() {
        this.aiKeys = new Set();
        this.thinkTimer = 0;
        this.effectiveType = null;
        this.tacticState = null;
        this.tacticTimer = 0;
        this.plan = null;
        this.inashiCooldown = 0;
        this.persona = null;
        this.rollPersona();
    }

    reset() {
        this.effectiveType = null;
        this.tacticState = null;
        this.tacticTimer = 0;
        this.plan = null;
        this.thinkTimer = 0;
        this.inashiCooldown = 0;
        this.aiKeys.clear();
        this.rollPersona();
    }

    rollPersona() {
        this.persona = {
            aggro: Math.random(),
            inashiSkill: Math.random(),
            patience: Math.random(),
            feint: Math.random(),
            tempo: Math.random()
        };
    }

    getAIParam(level, paramName) {
        const key = `LV${level}_${paramName.toUpperCase()}`;
        if (CONFIG.AI && CONFIG.AI[key] !== undefined) return CONFIG.AI[key];
        const defaults = { REACTION: 38, MISTAKE: 0.3, ACCURACY: 0.5, INASHIRATE: 0.15 };
        return defaults[paramName.toUpperCase()] || 0;
    }

    determineType(baseType) {
        if (this.effectiveType) return this.effectiveType;
        const valid = ['力押し', '技狙い', '素直'];
        if (baseType === '変則') this.effectiveType = valid[Math.floor(Math.random() * valid.length)];
        else this.effectiveType = valid.includes(baseType) ? baseType : '素直';
        return this.effectiveType;
    }

    clampLevel(lv) { return Math.max(1, Math.min(7, lv || 3)); }

    think(me, opp, grapple) {
        if (this.inashiCooldown > 0) this.inashiCooldown--;

        if (me.stun > 0 || me.isThrown || me.isDefeated || me.miss > 0) {
            this.aiKeys.clear();
            this.plan = null;
            this.tacticState = null;
            return this.aiKeys;
        }

        const think = this.determineType(me.baseStats.aiType);
        const ptype = me.baseStats.playType || 'バランス';
        const level = this.clampLevel(me.cpuLevel);

        // 組み合い中は専用処理（d を握り続けてチャージを溜め、閾値で投げ/押し）
        if (grapple.active) {
            this.plan = null;
            this.tacticState = null;
            this.thinkGrapple(me, opp, grapple, level, think, ptype);
            return this.aiKeys;
        }

        // 反応いなし（相手の「溜めた突進」に対してのみ）。単独 u・クールダウン付き。
        if (this.tryInashi(me, opp, level, think, ptype)) return this.aiKeys;

        // 進行中プランを継続（毎フレーム必要キーを握り続ける＝チャージが切れない）
        if (this.plan) {
            const done = this.runPlan(me, opp);
            if (!done) return this.aiKeys;
            this.plan = null;
        }

        // 戦術（前後ステップ等）
        if (this.tacticState && this.tacticTimer > 0) { this.executeTactic(me, opp); return this.aiKeys; }

        // 思考ウェイト（レベルが高いほど速い・個体差で揺らぐ）
        if (this.thinkTimer > 0) { this.thinkTimer--; this.aiKeys.clear(); return this.aiKeys; }
        const reaction = this.getAIParam(level, 'REACTION');
        this.thinkTimer = Math.max(1, Math.round(reaction * (0.7 + this.persona.tempo * 0.6)) - level * 2 + Math.floor(Math.random() * 5));

        this.aiKeys.clear();
        this.decide(me, opp, level, think, ptype);
        return this.aiKeys;
    }

    // 相手の溜めた突進（ぶちかまし）に反応していなす
    tryInashi(me, opp, level, think, ptype) {
        if (this.inashiCooldown > 0) return false;
        const dist = Math.abs(me.x - opp.x);
        if (!(opp.isPushing && opp.charge >= 38 && dist < 150)) return false;
        const base = this.getAIParam(level, 'INASHIRATE');
        let prob = base * 0.9;
        if (think === '技狙い') prob += 0.12;
        else if (think === '力押し') prob -= 0.05;
        if (ptype === 'スピード') prob += 0.2;       // スピードはいなし多め
        else if (ptype === 'テクニック') prob += 0.06;
        if (opp.charge > 75) prob += 0.12;
        prob *= (0.6 + this.persona.inashiSkill * 0.7);
        prob = Math.min(prob, 0.7);
        if (Math.random() < prob) {
            this.plan = null;
            this.tacticState = null;
            this.aiKeys.clear();
            this.aiKeys.add(me.controls.u); // いなしは単独入力（押し・溜めと同時不可）
            this.inashiCooldown = 26;
            return true;
        }
        return false;
    }

    startPlan(type, timer) { this.plan = { type: type, timer: timer, peaked: false }; }

    // プラン実行：プランが終わるまで毎フレーム必要キーを握り続ける
    runPlan(me, opp) {
        const pl = this.plan;
        const k = me.controls;
        const facingRight = me.x < opp.x;
        const keyFwd = facingRight ? k.r : k.l;
        const keyBack = facingRight ? k.l : k.r;
        const dist = Math.abs(me.x - opp.x);
        const hitDist = cfg('GAME_RULES.HIT_DIST', 100);
        const isTouching = dist <= hitDist + 25;

        this.aiKeys.clear();
        pl.timer--;
        if (me.stun > 0 || me.miss > 0) return true;

        if (pl.type === 'attack') {
            // まず d で溜め、55%以上になってから前進してぶちかまし発動（溜め切る前の突進を防ぐ）
            this.aiKeys.add(k.d);
            if (me.charge >= 55) {
                this.aiKeys.add(keyFwd); // 溜め十分→前進してぶちかまし(50%)発動
                pl.peaked = true;
            } else if (!isTouching && me.charge >= 30 && dist > 220) {
                // 遠い時はじわ寄りしつつ溜める（離れすぎ防止。接近中は誤発進しないよう前進しない）
                this.aiKeys.add(keyFwd);
            }
            if (pl.peaked && me.charge < 25) return true; // ぶちかまし発動でチャージ消費→終了
            if (pl.timer <= 0 || me.stamina < 6) return true;
            return false;
        }
        if (pl.type === 'build') {
            // その場で溜める（はっきり溜めモード）。溜まったら攻撃プランへ移行。
            this.aiKeys.add(k.d);
            if (me.charge >= (pl.target || 60) || me.stamina < 10) { this.plan = { type: 'attack', timer: 45, peaked: false }; return false; }
            if (pl.timer <= 0) return true;
            return false;
        }
        if (pl.type === 'dash') {
            // 溜めず速い前進（詰め・組み狙い・軽い攻め）。溜めない＝速い。
            this.aiKeys.add(keyFwd);
            if (pl.timer <= 0) return true;
            return false;
        }
        if (pl.type === 'retreat') {
            this.aiKeys.add(keyBack);
            if (pl.timer <= 0) return true;
            return false;
        }
        // hold（じっと様子見）
        if (pl.timer <= 0) return true;
        return false;
    }

    executeTactic(me, opp) {
        this.tacticTimer--;
        this.aiKeys.clear();
        const k = me.controls;
        const facingRight = me.x < opp.x;
        const keyFwd = facingRight ? k.r : k.l;
        const keyBack = facingRight ? k.l : k.r;

        if (this.tacticState === 'step') {
            // 前後ステップ（揺さぶり。溜めず素早く）
            if (Math.floor(this.tacticTimer / 3) % 2 === 0) this.aiKeys.add(keyFwd);
            else this.aiKeys.add(keyBack);
            if (this.tacticTimer <= 0) {
                this._stepCount = (this._stepCount || 1) - 1;
                if (this._stepCount > 0) this.tacticTimer = 6 + Math.floor(Math.random() * 5);
                else this.tacticState = null;
            }
        } else {
            if (this.tacticTimer <= 0) this.tacticState = null;
        }
    }

    decide(me, opp, level, think, ptype) {
        const dist = Math.abs(me.x - opp.x);
        const P = this.persona;
        const mistake = this.getAIParam(level, 'MISTAKE');
        const ringL = cfg('GAME_RULES.RING_EDGE_LEFT', 115);
        const ringR = cfg('GAME_RULES.RING_EDGE_RIGHT', 1085);
        const facingRight = me.x < opp.x;
        const backEdgeDist = facingRight ? (me.x - ringL) : (ringR - me.x);
        const frontEdgeDist = facingRight ? (ringR - me.x) : (me.x - ringL);
        const nearMyEdge = backEdgeDist < 130;
        const overrunRisk = frontEdgeDist < 160;

        // ミス・無駄行動（低レベルほど多い）
        if (Math.random() < mistake) {
            const r = Math.random();
            if (r < 0.5) this.startPlan('build', 10 + Math.floor(Math.random() * 10));
            else if (r < 0.78) this.startPlan('retreat', 7);
            else this.startPlan('hold', 14);
            return;
        }

        // 行動の重み
        //  attack=溜めながら前進してぶちかまし / build=その場溜め→攻撃 / dash=溜めず速攻(詰め・組み狙い)
        //  retreat=後退 / step=前後ステップ / hold=様子見
        let wAttack = 0, wBuild = 0, wDash = 0, wRetreat = 0, wStep = 0, wHold = 0;
        if (think === '力押し') { wAttack = 0.46; wBuild = 0.13; wDash = 0.22; wRetreat = 0.03; wStep = 0.05; wHold = 0.04; }
        else if (think === '技狙い') { wAttack = 0.1; wBuild = 0.1; wDash = 0.4; wRetreat = 0.12; wStep = 0.13; wHold = 0.08; }
        else { wAttack = 0.27; wBuild = 0.12; wDash = 0.32; wRetreat = 0.07; wStep = 0.1; wHold = 0.05; }

        if (ptype === 'パワー') { wAttack += 0.2; wBuild += 0.05; }        // ぶちかまし多め
        else if (ptype === 'テクニック') { wDash += 0.18; wStep += 0.06; } // 組みに行って投げる
        else if (ptype === 'スピード') { wDash += 0.16; wStep += 0.1; wRetreat += 0.05; }

        // 個体差
        wAttack *= (0.75 + P.aggro * 0.5);
        wDash *= (0.7 + P.aggro * 0.6);
        wRetreat *= (0.7 + (1 - P.aggro) * 0.6);
        wStep *= (0.6 + P.feint * 0.8);
        wBuild *= (0.7 + P.patience * 0.6);

        // 距離・疲労
        if (dist > 240) { wDash *= 1.25; wBuild *= 1.15; wRetreat *= 0.5; }
        if (me.stamina < 22) { wAttack *= 0.6; wDash *= 0.6; wBuild *= 1.3; wRetreat *= 1.3; }

        // 土俵際の自滅防止
        if (nearMyEdge) { wRetreat = 0; wAttack *= 1.4; wDash *= 1.2; wBuild *= 0.5; wHold *= 0.3; }
        if (overrunRisk) { wAttack *= 0.5; wDash *= 0.4; wBuild *= 1.2; wStep += 0.08; }

        // 大関以上(Lv6+)はアグレッシブ：基本は動き続け、止め(hold)は控えめ
        const aggressive = level >= 6;
        if (aggressive && me.stamina > 18) { wAttack *= 1.3; wDash *= 1.5; wStep *= 1.2; wHold *= 0.4; wBuild *= 0.8; }

        const total = wAttack + wBuild + wDash + wRetreat + wStep + wHold;
        let pick = Math.random() * total;

        if ((pick -= wAttack) < 0) { this.startPlan('attack', 50 + Math.floor(Math.random() * 25)); return; }
        if ((pick -= wBuild) < 0) { this.startPlan('build', 18 + Math.floor(Math.random() * 14)); return; }
        if ((pick -= wDash) < 0) { this.startPlan('dash', 8 + Math.floor(Math.random() * 6)); return; }
        if ((pick -= wRetreat) < 0) { this.startPlan('retreat', 7 + Math.floor(Math.random() * 6)); return; }
        if ((pick -= wStep) < 0) {
            this.tacticState = 'step';
            this.tacticTimer = 6 + Math.floor(Math.random() * 5);
            this._stepCount = 2 + Math.floor(Math.random() * 3);
            return;
        }
        this.startPlan('hold', 10 + Math.floor(Math.random() * 10));
    }

    // 組み合い（寄り）中：投げ(掴み投げ)は charge=100 必須。投げ狙いは前進せず溜め切ってu。
    thinkGrapple(me, opp, grapple, level, think, ptype) {
        const k = me.controls;
        const facingRight = me.x < opp.x;
        const keyFwd = facingRight ? k.r : k.l;

        this.aiKeys.clear();

        // 決着間際は押し切る
        if (me.stamina <= 1.1 || opp.stamina <= 1.1) { this.aiKeys.add(keyFwd); return; }

        // 常にチャージを握る（投げ・ぶちかましの威力源。離すと0に戻るため握り続ける）
        this.aiKeys.add(k.d);
        if (me.stamina < 6) return; // 力尽き気味は溜めて耐える

        const likesThrow = (think === '技狙い' || ptype === 'テクニック');
        const likesBuchi = (think === '力押し' || ptype === 'パワー');

        // 投げ（掴み投げ）は charge=100 必須。100到達なら必ず投げる。
        if (me.charge >= 100) { this.aiKeys.add(k.u); return; }

        if (likesBuchi) {
            // 力押し/パワー：前進してぶちかまし(50%)で押し込む（投げは狙わない）
            if (me.charge >= 50) this.aiKeys.add(keyFwd);
            return;
        }
        if (likesThrow) {
            // 技狙い/テク：前進しない（前進=50%で押しが出て100に届かなくなる）。dのみで100まで溜めて投げる。
            return;
        }
        // 素直/バランス：基本は溜め切って投げを狙う。たまに押して揺さぶる程度。
        if (Math.random() < 0.18) this.aiKeys.add(keyFwd);
    }
}