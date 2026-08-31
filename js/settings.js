/**
 * settings.js
 * 環境設定（音量・キーコンフィグ等）の保存・読込・適用を担当するクラス
 */
class SettingsManager {
    constructor() {
        this.defaultSettings = {
            volume: { bgm: 100, se: 100, voice: 100 },
            display: { screenSize: 'responsive' },
            dreamUnlocked: false,
            controls: {
                p1: { l: 'KeyA', r: 'KeyD', u: 'KeyW', d: 'KeyS' },
                p2: { l: 'ArrowLeft', r: 'ArrowRight', u: 'ArrowUp', d: 'ArrowDown' }
            }
        };
        this.current = JSON.parse(JSON.stringify(this.defaultSettings));
        this.waitingForKey = null;
        this.saveKey = 'sumo_cham_settings_v2';
        this.load();
        this.backup = null;
    }

    load() {
        const saved = localStorage.getItem(this.saveKey);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.current = { ...this.defaultSettings, ...parsed,
                    volume: { ...this.defaultSettings.volume, ...parsed.volume },
                    display: { ...this.defaultSettings.display, ...parsed.display },
                    dreamUnlocked: parsed.dreamUnlocked || false,
                    controls: {
                        p1: { ...this.defaultSettings.controls.p1, ...parsed.controls?.p1 },
                        p2: { ...this.defaultSettings.controls.p2, ...parsed.controls?.p2 }
                    }
                };
            } catch(e) { console.error(e); }
        }

        // 読み込んだ音量データを設定画面のスライダーへ反映してから適用する
        this.syncVolumeUI();
        this.apply();
    }

    save() {
        localStorage.setItem(this.saveKey, JSON.stringify(this.current));
        this.showToast("設定を保存しました");
    }

    // 設定をデフォルトへ戻し、反映のためにページをリロードする
    resetDefaults() {
        if(!confirm("設定を初期化しますか？\n※ページが再読み込みされます")) return;
        this.current = JSON.parse(JSON.stringify(this.defaultSettings));
        this.save();
        location.reload();
    }

    // 現在の設定値を実環境（SoundFXの音量等）へ反映する
    apply() {
        if (typeof SoundFX !== 'undefined') {
            // 3つの音量をそれぞれ 0.0〜1.0 に変換して audio.js に渡す
            SoundFX.bgmVolume = this.current.volume.bgm / 100;
            SoundFX.seVolume = this.current.volume.se / 100;
            SoundFX.voiceVolume = this.current.volume.voice / 100;

            // BGMがすでに鳴っている場合は即座に音量を更新
            if (typeof SoundFX.updateBGMVolume === 'function') {
                SoundFX.updateBGMVolume();
            }
        }
    }

    // 設定モーダルを開く（開いた瞬間の状態をバックアップし、キャンセル時に復元できるようにする）
    openMenu() {
        const s = document.getElementById('settings-modal');
        if(s) {
            this.backup = JSON.parse(JSON.stringify(this.current));
            s.classList.add('active');
            this.updateUI();
        }
    }

    // 設定モーダルを閉じる（保存はしない）
    closeMenu() {
        const s = document.getElementById('settings-modal');
        if(s) s.classList.remove('active');
    }

    // キャンセル：バックアップから元の値を復元して閉じる
    cancelMenu() {
        if (this.backup) {
            this.current = JSON.parse(JSON.stringify(this.backup));
            this.apply();
            this.updateUI();
        }
        this.closeMenu();
    }
    // 音量スライダー3種（BGM/SE/VOICE）を現在値に同期する共通処理
    syncVolumeUI() {
        const rows = [
            ['setting-bgm', 'setting-bgm-val', 'bgm'],
            ['setting-se', 'setting-se-val', 'se'],
            ['setting-voice', 'setting-voice-val', 'voice']
        ];
        rows.forEach(([sliderId, valId, key]) => {
                const slider = document.getElementById(sliderId);
                const val = document.getElementById(valId);
                if (slider && val) {
                    slider.value = this.current.volume[key];
                    val.textContent = this.current.volume[key];
                }
            });
    }

    updateUI() {
        this.syncVolumeUI();

        this.updateKeyBtn('p1', 'u'); this.updateKeyBtn('p1', 'd'); this.updateKeyBtn('p1', 'l'); this.updateKeyBtn('p1', 'r');
        this.updateKeyBtn('p2', 'u'); this.updateKeyBtn('p2', 'd'); this.updateKeyBtn('p2', 'l'); this.updateKeyBtn('p2', 'r');

        ['p1','p2'].forEach(p => {
                ['u','d','l','r'].forEach(k => {
                        const btn = document.getElementById(`key-${p}-${k}`);
                        if(btn) btn.onclick = () => this.startKeyConfig(p, k, btn);
                    });
            });
    }

    updateKeyBtn(p, k) {
        const btn = document.getElementById(`key-${p}-${k}`);
        if(btn) {
            let code = this.current.controls[p][k];
            code = code.replace('Key', '');
            if (code === 'ArrowUp') code = '↑';
            if (code === 'ArrowDown') code = '↓';
            if (code === 'ArrowLeft') code = '←';
            if (code === 'ArrowRight') code = '→';
            btn.textContent = code;
            btn.classList.remove('waiting');
        }
    }

    startKeyConfig(p, k, btnElement) {
        if(this.waitingForKey) return;
        this.waitingForKey = { p, k, btn: btnElement };
        btnElement.textContent = "押してください...";
        btnElement.classList.add('waiting');
    }

    handleKeyDown(e) {
        if (!this.waitingForKey) return false;
        e.preventDefault(); e.stopPropagation();
        const { p, k } = this.waitingForKey;
        this.current.controls[p][k] = e.code;
        this.waitingForKey = null;
        this.updateUI();
        return true;
    }

    showToast(msg) {
        const t = document.getElementById('toast');
        if(t) {
            t.textContent = msg; t.classList.add('visible');
            setTimeout(()=>t.classList.remove('visible'), 2000);
        }
    }
    // HTMLの「保存して戻る」ボタン用
    saveAndClose() {
        this.save();
        this.closeMenu();
    }

    // HTMLの「設定を初期化」ボタン用
    confirmReset() {
        this.resetDefaults();
    }
}

const settings = new SettingsManager();
