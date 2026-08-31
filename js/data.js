/**
 * data.js
 * 外部データ（CSV）の読み込みと適用を担当するファイル
 */

let RIKISHI_DATA = [];
let BGM_DATA = [];
let ALBUM_DATA = [];

// ユーティリティ: 待機関数
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// CSVパース関数
function parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
            const values = line.split(',');
            return headers.reduce((obj, header, index) => {
                    obj[header] = values[index] ? values[index].trim() : "";
                    return obj;
                }, {});
        });
}

/**
 * スプシのキー（例: "ACTION_SPEED_BASE"）を
 * CONFIGオブジェクト（例: CONFIG.ACTION.SPEED_BASE）にマッピングして適用する
 */
function applyConfigValue(key, value) {
    if (!key || value === "" || isNaN(value)) return;
    const numVal = parseFloat(value);

    // AIパラメータの特別処理 (AI_LV1_REACTION -> CONFIG.AI.LV1_REACTION)
    if (key.startsWith("AI_LV")) {
        const prop = key.replace("AI_", "");
        if (CONFIG.AI) CONFIG.AI[prop] = numVal;
        return;
    }

    // カテゴリマッチング
    for (const cat in CONFIG) {
        if (key.startsWith(cat + '_')) {
            const propName = key.replace(cat + '_', '');

            if (typeof CONFIG[cat] === 'object') {
                // 3階層目チェック (例: CHARGE_THRESHOLDS_SUPER_PUSH)
                for (const subCat in CONFIG[cat]) {
                    if (propName.startsWith(subCat + '_')) {
                        const subProp = propName.replace(subCat + '_', '');
                        if (CONFIG[cat][subCat] !== undefined) {
                            CONFIG[cat][subCat][subProp] = numVal;
                            return;
                        }
                    }
                }
                // 2階層目 (通常)
                CONFIG[cat][propName] = numVal;
                return;
            }
        }
    }
}

async function loadExternalData() {
    try {
        const ts = Date.now();
        console.log("データの読み込みを開始します...");

        // 1. Configデータの取得
        if (DATA_URLS.CONFIG) {
            const res = await fetch(DATA_URLS.CONFIG + `&_t=${ts}`);
            if (res.ok) {
                const text = await res.text();
                // ヘッダーなし、D列(idx 3)がKey, G列(idx 6)がValue
                const lines = text.trim().split('\n');
                lines.forEach(line => {
                        const cols = line.split(',');
                        if (cols.length >= 6) {
                            applyConfigValue(cols[3]?.trim(), cols[6]?.trim());
                        }
                    });
                console.log("Configデータを適用しました。");
            }
        }

        // 2. キャラクターデータの取得
        if (DATA_URLS.CHARS) {
            const res = await fetch(DATA_URLS.CHARS + `&_t=${ts}`);
            if (res.ok) {
                const text = await res.text();
                const rows = parseCSV(text);

                RIKISHI_DATA = rows.map((row, i) => {
                        if (!row['名前'] && !row['Name']) return null;
                        return {
                            id: parseInt(row['ID'] || i),
                            name: row['名前'] || "Unknown",
                            img: row['画像ファイル'] || "",
                            desc: (row['タイプ'] || "バランス").replace("ギジュツ", "テクニック") + "タイプ",
                            playType: (row['タイプ'] || "バランス").replace("ギジュツ", "テクニック"),
                            aiType: row['思考'] || "素直",
                            power: parseInt(row['チカラ'] || 5),
                            tech: parseInt(row['ギジュツ'] || row['テクニック'] || 5),
                            speed: parseInt(row['ハヤサ'] || 5),
                            stamina: parseInt(row['タイリョク'] || 5),
                            spirit: parseInt(row['キモチ'] || 5),
                            reversal: parseInt(row['ギャクテン'] || 5),
                            voice: row['音声ファイル'] || "",
                            slot: parseInt(row['Slot'] || row['配置']),
                            total: parseInt(row['どすこいパワー'] || 0),
                            height: parseInt(row['身長スコア'] || 3),
                            weight: parseInt(row['体重スコア'] || 3),
                            category: row['カテゴリ'] || "現役",
                            'コスト': parseInt(row['コスト'] || 0) // 団体戦の編成コスト
                        };
                    }).filter(d => d !== null);

                RIKISHI_DATA.sort((a, b) => (a.slot || 999) - (b.slot || 999));
                console.log("キャラクターデータを読み込みました:", RIKISHI_DATA.length + "件");
            }
        }
        // 3. アルバムデータの取得
        if (DATA_URLS.ALBUMS) {
            const res = await fetch(DATA_URLS.ALBUMS + `&_t=${ts}`);
            if (res.ok) {
                const text = await res.text();
                const rows = parseCSV(text);

                ALBUM_DATA = rows.map(row => {
                        if (!row['ID']) return null;
                        return {
                            id: row['ID'],
                            name: row['アルバム名'] || "Unknown Album",
                            img: row['ジャケット画像ファイル名'] || "",
                            category: row['カテゴリ'] || "その他",
                            categoryId: parseInt(row['カテゴリID'], 10) || 999
                        };
                    }).filter(d => d !== null);

                console.log("アルバムデータを読み込みました:", ALBUM_DATA.length + "件");
            }
        }

        // 4. BGMデータの取得
        if (DATA_URLS.BGM) {
            const res = await fetch(DATA_URLS.BGM + `&_t=${ts}`);
            if (res.ok) {
                const text = await res.text();
                const rows = parseCSV(text);

                BGM_DATA = rows.map(row => {
                        return {
                            file: row['ファイル名'],
                            name: row['曲名'] || "Unknown Track",
                            albumId: row['アルバムID'] || "" // アルバム別フィルタリングに使用
                        };
                    }).filter(data => data.file);

                console.log("BGMデータを読み込みました:", BGM_DATA.length + "件");
            }
        }

    } catch (e) {
        console.error("データ読み込みエラー:", e);
    }
}