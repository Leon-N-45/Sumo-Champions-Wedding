/**
 * tools/build_fonts.js
 *
 * index.html が参照している Google Fonts を取得し、
 * フォント本体を assets/fonts/google/ へ、@font-face定義を css/webfonts.css へ書き出す。
 * これによりネット接続なしでも本来の書体で表示できるようになる。
 *
 *   実行:  node tools/build_fonts.js
 *
 * 日本語フォントは文字範囲ごとに細かく分割配信されるため、ファイル数が多くなる。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'fonts', 'google');
const OUT_CSS = path.join(ROOT, 'css', 'webfonts.css');

const CSS_URL = 'https://fonts.googleapis.com/css2'
    + '?family=M+PLUS+Rounded+1c:wght@400;500;700;800;900'
    + '&family=Shippori+Mincho:wght@400;800'
    + '&family=Yuji+Syuku'
    + '&display=swap';

// woff2で受け取るためモダンブラウザのUAを名乗る
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(url, asBuffer = false) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} : ${url}`);
    return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text();
}

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    console.log('CSS定義を取得中...');
    let css = await get(CSS_URL);

    const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map(m => m[1]))];
    console.log(`フォントファイル ${urls.length} 件を取得します`);

    let done = 0;
    for (const url of urls) {
        // URLからそのままでは名前が衝突するため、末尾2階層を繋げて一意な名前にする
        const parts = url.split('/');
        const name = (parts.slice(-2).join('_')).replace(/[^\w.\-]/g, '_');
        const dest = path.join(OUT_DIR, name);

        if (!fs.existsSync(dest)) {
            fs.writeFileSync(dest, await get(url, true));
            await sleep(40); // 連続取得で絞られないよう間隔を空ける
        }
        css = css.split(url).join(`../assets/fonts/google/${name}`);

        done++;
        if (done % 40 === 0 || done === urls.length) {
            process.stdout.write(`  ${done}/${urls.length}\n`);
        }
    }

    const header = `/* webfonts.css  ※自動生成ファイル - 直接編集しないこと\n`
        + ` * 生成: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}\n`
        + ` * 更新: node tools/build_fonts.js\n */\n`;
    fs.writeFileSync(OUT_CSS, header + css, 'utf8');

    const total = fs.readdirSync(OUT_DIR)
        .reduce((sum, f) => sum + fs.statSync(path.join(OUT_DIR, f)).size, 0);
    console.log(`\n完了: ${urls.length} ファイル / ${(total / 1024 / 1024).toFixed(1)} MB`);
    console.log('css/webfonts.css を生成しました。');
})().catch(e => {
    console.error('\n失敗:', e.message);
    process.exit(1);
});
