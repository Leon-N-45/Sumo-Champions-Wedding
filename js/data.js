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

/**
 * シート1枚分のCSVを取得する。
 *
 * OFFLINE_MODE が true のときは通信せず data_local.js の内容だけを使う。
 * false のときはスプシを取りに行き、失敗・遅延した場合は data_local.js へ退避する。
 * いずれの場合も戻り値はCSVのテキスト（取得できなければ null）。
 */
async function getSheetCsv(key) {
    const local = (typeof LOCAL_CSV !== 'undefined') ? LOCAL_CSV[key] : null;

    if (typeof OFFLINE_MODE !== 'undefined' && OFFLINE_MODE) {
        if (!local) console.warn(`[offline] ${key} がdata_local.jsにありません。`);
        return local || null;
    }

    const url = DATA_URLS[key];
    if (!url) return local || null;

    // 応答が返らないまま起動が止まるのを防ぐため、必ず時間で打ち切る
    const limitMs = (typeof FETCH_TIMEOUT_MS !== 'undefined') ? FETCH_TIMEOUT_MS : 5000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), limitMs);
    try {
        const res = await fetch(url + `&_t=${Date.now()}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } catch (e) {
        console.warn(`[${key}] 取得に失敗したためローカルデータを使用します:`, e.message);
        return local || null;
    } finally {
        clearTimeout(timer);
    }
}

async function loadExternalData() {
    try {
        console.log(
            (typeof OFFLINE_MODE !== 'undefined' && OFFLINE_MODE)
                ? "データの読み込みを開始します...(オフライン)"
                : "データの読み込みを開始します...(スプシ参照)"
        );

        // 1. Configデータの取得
        {
            const text = await getSheetCsv('CONFIG');
            if (text) {
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
        {
            const text = await getSheetCsv('CHARS');
            if (text) {
                const rows = parseCSV(text);

                // 身長スコア／体重スコアは1〜5を想定している。
                // 実寸(184cmなど)が入ると体が十数倍に引き伸ばされて表示が壊れるため、
                // 範囲内へ収めたうえで、どの力士が範囲外だったかを記録する。
                const outOfRange = [];
                const toScore = (raw, label, charName) => {
                    const n = parseInt(raw);
                    if (!Number.isFinite(n)) return 3;
                    if (n < 1 || n > 5) {
                        outOfRange.push(`${charName}の${label}=${n}`);
                        return Math.min(5, Math.max(1, n));
                    }
                    return n;
                };

                RIKISHI_DATA = rows.map((row, i) => {
                        if (!row['名前'] && !row['Name']) return null;
                        return {
                            id: parseInt(row['ID'] || i),
                            name: row['名前'] || "Unknown",
                            nickname: (row['二つ名'] || row['通り名'] || "").trim(), // 名前に添える二つ名
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
                            height: toScore(row['身長スコア'], '身長スコア', row['名前']),
                            weight: toScore(row['体重スコア'], '体重スコア', row['名前']),
                            category: row['カテゴリ'] || "現役",
                            costume: (row['衣装'] || "").trim(), // 体画像の出し分け（例: ドレス）
                            'コスト': parseInt(row['コスト'] || 0) // 団体戦の編成コスト
                        };
                    }).filter(d => d !== null);

                // Slot未設定(NaN)は末尾へ。0は有効な値なので || で弾かないこと
                const slotOf = (d) => Number.isFinite(d.slot) ? d.slot : 999;
                RIKISHI_DATA.sort((a, b) => slotOf(a) - slotOf(b));
                console.log("キャラクターデータを読み込みました:", RIKISHI_DATA.length + "件");

                if (outOfRange.length) {
                    console.warn(
                        '身長スコア／体重スコアが想定範囲(1〜5)を外れています。\n'
                        + '  実寸(cm/kg)が入っていると体が極端に伸びるため、1〜5へ丸めて表示しています。\n'
                        + '  該当: ' + outOfRange.join(' / ') + '\n'
                        + '  Charactersシートの「身長スコア」「体重スコア」列を見直してください。'
                    );
                }
            }
        }
        // 3. アルバムデータの取得
        {
            const text = await getSheetCsv('ALBUMS');
            if (text) {
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
        {
            const text = await getSheetCsv('BGM');
            if (text) {
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