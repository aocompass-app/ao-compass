/* index.html の中の <script> を取り出して構文だけ確かめる（使い方: node tests/syntax.mjs）
   あわせて、古いiOS Safariで動かない書き方が混ざっていないかも見ます。 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); } };

const blocks = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) blocks.push(m[1]);
ok(blocks.length > 0, '<script> ブロックが見つかる');

blocks.forEach((code, i) => {
  try { new vm.Script(code); ok(true, `script[${i}] の構文が正しい`); }
  catch (e) { ok(false, `script[${i}] の構文が正しい`, e.message); }
});

const all = blocks.join('\n');
/* 古いiOS Safariで落ちる書き方 */
ok(!/\(\?<[=!]/.test(all), '後読み正規表現 (?<=...) を使っていない');
/* 配列スプレッド [...a] は古いSafariでも動くので、オブジェクトスプレッドだけを見る */
const OBJ_SPREAD = /\{\s*\.\.\.[A-Za-z_$]|,\s*\.\.\.[A-Za-z_$][\w$.]*\s*\}/g;
ok(!OBJ_SPREAD.test(all), 'オブジェクトスプレッド {...a} を使っていない',
  (all.match(OBJ_SPREAD) || []).slice(0, 3).join(' | '));
ok(!/\?\./.test(all), 'オプショナルチェーン ?. を使っていない');
ok(!/\?\?/.test(all), 'Null合体演算子 ?? を使っていない');

/* 決まりごと */
ok(/id="root"/.test(html), 'ルート要素 #root がある');
ok(html.includes('入試情報は必ず大学公式サイトの最新の募集要項・原本を確認してください'), '免責の帯の文言が残っている');
ok(/const APP_VER='\d{4}\.\d{2}\.\d{2}(-\d+)?'/.test(all), "APP_VER が YYYY.MM.DD の形");
ok(!/['"]sk-[A-Za-z0-9_-]{20}/.test(all), '開発側のAPIキーが埋め込まれていない');

console.log(`\nsyntax: ${pass} 件成功 / ${fail} 件失敗`);
if (fail) process.exit(1);
