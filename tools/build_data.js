/**
 * tools/build_data.js
 *
 * スプレッドシートの4シートを取得し、js/data_local.js へ焼き込む。
 * 生成後はネット接続なしでゲームが起動できるようになる。
 *
 *   実行:  node tools/build_data.js
 *
 * スプシの内容を変更したら、このスクリプトを再実行して焼き直すこと。
 * 参照先IDは js/config.js の SHEET_ID / SHEET_GID をそのまま読み取る。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_JS = path.join(ROOT, 'js', 'config.js');
const OUT = path.join(ROOT, 'js', 'data_local.js');

const TIMEOUT_MS = 20000;

// config.js から SHEET_ID と SHEET_GID を読み出す（重複管理を避けるため）
function readSheetSettings() {
    const src = fs.readFileSync(CONFIG_JS, 'utf8');

    const idMatch = src.match(/const\s+SHEET_ID\s*=\s*'([^']+)'/);
    if (!idMatch) throw new Error('js/config.js から SHEET_ID を読み取れませんでした。');

    const gidBlock = src.match(/const\s+SHEET_GID\s*=\s*\{([\s\S]*?)\}/);
    if (!gidBlock) throw new Error('js/config.js から SHEET_GID を読み取れませんでした。');

    const gids = {};
    for (const m of gidBlock[1].matchAll(/(\w+)\s*:\s*'(\d+)'/g)) gids[m[1]] = m[2];

    return { sheetId: idMatch[1], gids };
}

function csvUrl(sheetId, gid) {
    return `https://docs.google.com/spreadsheets/d/e/${sheetId}/pub?gid=${gid}&single=true&output=csv&_t=${Date.now()}`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchOnce(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

// Googleが短時間の連続要求を絞ることがあるため、間隔を空けて数回試す
async function fetchCsv(makeUrl, attempts = 4) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await fetchOnce(makeUrl());
        } catch (e) {
            lastErr = e;
            if (i < attempts) {
                const waitMs = 3000 * i;
                process.stdout.write(`再試行(${i}/${attempts - 1}) `);
                await sleep(waitMs);
            }
        }
    }
    throw lastErr;
}

(async () => {
    const { sheetId, gids } = readSheetSettings();
    console.log(`参照スプシ: ${sheetId.slice(0, 24)}...`);

    const keys = ['CONFIG', 'CHARS', 'BGM', 'ALBUMS'];
    const data = {};

    for (const key of keys) {
        const gid = gids[key];
        if (!gid) throw new Error(`SHEET_GID に ${key} がありません。`);

        process.stdout.write(`  ${key.padEnd(7)} (gid=${gid}) ... `);
        const text = await fetchCsv(() => csvUrl(sheetId, gid));

        // 中身が空、またはHTMLが返ってきた場合は公開設定の不備を疑う
        if (!text.trim()) throw new Error(`${key} が空でした。ウェブ公開の設定を確認してください。`);
        if (/^\s*<(!doctype|html)/i.test(text)) {
            throw new Error(`${key} でHTMLが返りました。CSVとして公開されているか確認してください。`);
        }

        data[key] = text;
        const rows = text.trim().split('\n').length;
        console.log(`OK  ${text.length} bytes / ${rows} 行`);
    }

    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const body = `/**
 * data_local.js  ※自動生成ファイル - 直接編集しないこと
 *
 * 生成: ${stamp}
 * 元:   スプレッドシート ${sheetId.slice(0, 24)}...
 *
 * 内容を更新するには、スプシを編集してから次を実行:
 *     node tools/build_data.js
 */
const LOCAL_CSV = ${JSON.stringify(data, null, 2)};
`;

    fs.writeFileSync(OUT, body, 'utf8');
    const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
    console.log(`\n生成しました: js/data_local.js (${kb} KB)`);
})().catch(err => {
    console.error('\n失敗:', err.message);
    process.exit(1);
});
