/**
 * Player Class
 * 力士のデータ、ステータス、状態管理を行うクラス
 */
class Player {
    constructor(id, x, keys) {
        this.id = id;
        this.initialX = x;
        this.controls = keys;
        this.x = x;
        this.baseStats = {};

        // --- 1. ステータスとスタミナ管理 ---
        this.stamina = cfg('STAMINA.INIT', 100);
        this.maxStamina = this.stamina;          // 現在の回復上限（かち合いで減る）
        this.initialMaxStamina = this.stamina;     // 試合開始時の最大値（リセット用）
        this.recoveryDelay = 0;                 // 回復が始まるまでの待ち時間

        // --- 2. アクション状態 ---
        this.charge = 0;
        this.chargeLock = 0;   // スタミナ切れ時のチャージ禁止タイマー
        this.stun = 0;         // スタン（硬直）時間
        this.lastParry = 0;    // パリィ成功フラグ等
        this.miss = 0;         // 空振りペナルティ

        // --- 3. 物理・移動 ---
        this.rebound = 0;      // はじき飛ばされる速度
        this.cooldown = 0;     // 再衝突・操作不能時間
        this.wantsFwd = false; // 前進しようとしている意志（いなし判定に使用）

        // --- 4. フラグ管理 ---
        this.isDefeated = false;
        this.isThrown = false;
        this.isPushing = false;
        this.isCharging = false;
        this.isCPU = false;    // CPUかどうか
        this.cpuLevel = 3;     // CPUの強さ

        // --- 5. いなし・特殊行動 ---
        this.inashiTimer = 0;    // いなし受付時間
        this.inashiStumble = 0;  // いなされた時のよろけ時間
        this.stumbleDir = 0;     // よろける方向

        // --- 6. 表示 ---
        // DOM要素の生成
        this.el = document.createElement('div');
        this.el.className = 'rikishi';
        this.el.id = id;

        this.elBody = document.createElement('div');
        this.elBody.className = 'rikishi-body';

        this.imgBody = document.createElement('img');
        this.imgBody.src = `assets/img/rikishi${id}.png`;
        this.imgBody.className = 'body-img';

        this.elHead = document.createElement('div');
        this.elHead.className = 'head';

        this.elBody.appendChild(this.imgBody);
        this.elBody.appendChild(this.elHead);
        this.el.appendChild(this.elBody);

        const stage = document.getElementById('stage');
        if(stage) stage.appendChild(this.el);

        // DOM要素の紐付け
        this.initDOM();
    }

    // UI要素を探してキャッシュする
    initDOM() {
        const id = this.id;
        const getEl = (ids) => {
            for (const i of ids) {
                const el = document.getElementById(i);
                if (el) return el;
            }
            return null;
        };

        this.dom = {
            bar: getEl([`${id}-hp-bar`, `${id}-bar`, `${id}_hp`]),
            charge: getEl([`${id}-charge-bar`, `${id}-charge`]),
            chargeOuter: getEl([`${id}-charge-container`, `${id}-charge-outer`]),
            stunMark: getEl([`${id}-stun-mark`])
        };
    }

    get name() {
        return this.baseStats.name || "Unknown";
    }

    setData(data) {
        this.baseStats = data;
        if(this.elHead) {
            this.elHead.style.backgroundImage = `url('${data.img}')`;
        }
        this.updateSize();
    }

    updateSize() {
        const scale = this.getPhysiqueScale();
        let scaleY = 1.0;
        if (scale <= 0.75) scaleY = 0.8;
        else if (scale <= 0.88) scaleY = 0.85;
        else if (scale <= 1.0) scaleY = 0.9;
        else if (scale <= 1.2) scaleY = 0.95;
        else scaleY = 1.0;

        this.imgBody.style.transform = `scale(${scale}, ${scaleY})`;
        this.imgBody.style.transformOrigin = "bottom center";

        const baseHeight = 160;
        const baseTop = -45;
        const gap = baseHeight * (1 - scaleY);
        this.elHead.style.top = (baseTop + gap) + 'px';
    }

    // 現在の状況補正（キモチ・ギャクテン）を反映したステータスを返す
    getStats(opponent) {
        let pwr = this.baseStats.power || 5;
        let tech = this.baseStats.tech || 5;
        let spd = this.baseStats.speed || 5;

        // --- 1. キモチ (Spirit) の修正 ---
        // 条件: 回復不可HP(maxStamina)が半分以下
        const maxHpRate = this.maxStamina / this.initialMaxStamina;

        if (maxHpRate <= 0.33) {
            this.spiritActive = true;
            const spirit = this.baseStats.spirit || 5;
            const spiritDiff = spirit - 5; // 5より高いほどプラス、低いほどマイナス

            const rate = cfg('STATUS.SPIRIT_BUFF_RATE', 1.0);
            // HP5割以下なら、HP率に関係なく 1.0倍（フルパワー）のバフを適用
            const buff = spiritDiff * rate;

            // 全能力に加算
            pwr += buff;
            tech += buff;
            spd += buff;
        } else {
            this.spiritActive = false;
        }

        // 条件: 自分が土俵際、かつ相手が土俵の内側（一方的なピンチ時のみ）
        const leftLimit = cfg('GAME_RULES.RING_EDGE_LEFT', 115);
        const rightLimit = cfg('GAME_RULES.RING_EDGE_RIGHT', 1085);
        const edgeWidth = cfg('GAME_RULES.EDGE_ZONE_WIDTH', 150);
        const rikishiW = cfg('SYSTEM.RIKISHI_WIDTH', 130);

        // 各端までの「実際の距離」を計算（マイナスは土俵外）
        const myDistL = this.x - leftLimit;
        const myDistR = rightLimit - (this.x + rikishiW);
        const oppDistL = opponent.x - leftLimit;
        const oppDistR = rightLimit - (opponent.x + rikishiW);

        // ピンチ判定：自分が片方のゾーンにいて、かつ「その同じ側の端」に対して相手より近いこと
        // これにより、相手が逆側の端にいても邪魔されなくなります
        const isPinch = (myDistL < edgeWidth && myDistL < oppDistL) ||
        (myDistR < edgeWidth && myDistR < oppDistR);

        if (isPinch) {
            this.reversalActive = true;
            const rev = this.baseStats.reversal || 5;
            const revDiff = rev - 5;

            // レートのデフォルトも 1.0 に合わせておきます
            const rate = cfg('STATUS.REV_BUFF_RATE', 1.0);
            const buff = revDiff * rate;

            pwr += buff;
            tech += buff;
            spd += buff;
        } else {
            this.reversalActive = false;
        }

        // 下限ガード（ステータスが1未満にならないように）
        pwr = Math.max(1, pwr);
        tech = Math.max(1, tech);
        spd = Math.max(1, spd);

        return { power: pwr, tech: tech, speed: spd };
    }
    getPhysiqueScale() {
        const h = this.baseStats.height || 3;
        const w = this.baseStats.weight || 3;

        return {
            // 基準値0.6 に対して、1ポイントにつき 12%（0.12）大きくなる
            // 例: w=1 なら 0.72倍。 w=3 なら 0.96倍。 w=5 なら 1.2倍（超巨大）
            x: 0.6 + (w * 0.12),
            y: 0.6 + (h * 0.12)
        };
    }

    resetState(){
        this.x = this.initialX;

        // スタミナ計算: 基準100 + (ステータス差分 * 係数)
        const baseS = this.baseStats.stamina || 5;
        const bonus = (baseS - 5) * CONFIG.STATUS.HP_PER_STAMINA;
        this.maxStamina = CONFIG.STAMINA.INIT + bonus;

        this.initialMaxStamina = this.maxStamina;
        this.stamina = this.maxStamina;

        this.charge = 0;
        this.isDefeated = false;
        this.isThrown = false;
        this.isPushing = false;
        this.isCharging = false;
        this.rebound = 0;
        this.cooldown = 0;
        this.miss = 0;
        this.stun = 0;
        this.chargeLock = 0;
        this.el.classList.remove('stunned');
        this.elBody.style.transform = 'rotate(0deg)';

        this.updateSize();
    }
}
