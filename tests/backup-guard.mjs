/* STORIA バックアップの安全策テスト   使い方: node tests/backup-guard.mjs
   2026.08.07-7 の変更ぶん。ファイル選択から読み込むところまで通しで確かめます。
   backup.mjs が confirmImport を直接呼ぶのに対し、こちらは実際にファイルを選ばせる経路を見ます。 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.resolve(HERE, '..', 'index.html');
const EXE = process.env.PW_CHROMIUM || '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
const errors = [];

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.addInitScript('window.__AO_NO_ONBOARD=1;');
  await p.goto(FILE);
  await p.waitForTimeout(400);
  return p;
}

const SEED = () => {
  S.schools = [{ id: 's1', name: '見本大学', faculty: '法学部', deadline: '2026-11-01', docs: '', checklist: {}, tasks: [] }];
  S.documents = [{ id: 'd1', title: '志望理由書', type: '志望理由書', body: 'あ'.repeat(60), status: '下書き', updatedAt: 1 }];
  S.activities = [{ id: 'a1', title: '生徒会' }];
  S.essays = []; S.tasks = [];
  S.profile = Object.assign({}, S.profile, { name: '見本太郎', onboarded: true });
  save();
};

/* ファイル選択ダイアログに中身を流し込む */
async function chooseFile(p, name, text) {
  const waiter = p.waitForEvent('filechooser');
  await p.evaluate(() => importData());
  const fc = await waiter;
  await fc.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
  await p.waitForTimeout(350);
}

/* 1. 関係ないJSONを選んでも、確認シートすら出ずデータは無傷 */
{
  const p = await open();
  await p.evaluate(SEED);
  await chooseFile(p, 'メモ.json', JSON.stringify({ hello: 'world', items: [1, 2, 3] }));
  const r = await p.evaluate(() => ({
    sheet: document.querySelector('#overlay').classList.contains('open'),
    n: S.schools.length + '/' + S.documents.length + '/' + S.profile.name
  }));
  ok(!r.sheet, '無関係なJSONでは確認シートが開かない');
  ok(r.n === '1/1/見本太郎', `無関係なJSONでデータが変わらない (${r.n})`);

  /* 壊れたJSONでも同じ */
  await chooseFile(p, 'こわれ.json', '{ これはJSONでは');
  const r2 = await p.evaluate(() => ({
    sheet: document.querySelector('#overlay').classList.contains('open'),
    n: S.schools.length + '/' + S.documents.length
  }));
  ok(!r2.sheet && r2.n === '1/1', `壊れたJSONでもデータが変わらない (${r2.n})`);
  await p.context().close();
}

/* 2. 正しいバックアップを選ぶと確認シートが出て、押すまでは置きかわらない */
{
  const p = await open();
  await p.evaluate(SEED);
  const back = JSON.stringify({
    schools: [{ id: 'z1', name: '別大学', checklist: {} }, { id: 'z2', name: '他大学', checklist: {} }],
    documents: [], activities: [], tasks: [], essays: [], certs: [], feedback: [],
    profile: { name: '別人', onboarded: true }, _backupAt: '2026-08-01T09:30:00.000Z', _backupVer: '2026.08.01'
  });
  await chooseFile(p, 'ao-compass-backup-2026-08-01-1830.json', back);
  const tx = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(/ao-compass-backup-2026-08-01-1830\.json/.test(tx), '選んだファイル名が確認シートに出る');
  ok(/志望校 1件/.test(tx) && /書類 1件/.test(tx) && /プロフィール（見本太郎）/.test(tx), '今のデータの内訳が出る');
  ok(/志望校 2件/.test(tx) && /プロフィール（別人）/.test(tx), '読み込むファイルの内訳が出る');
  /* 表示は端末のタイムゾーンなので、形と「その端末での 2026-08-01T09:30Z」の一致だけ見る */
  const want = await p.evaluate(() => {
    const d = new Date('2026-08-01T09:30:00.000Z'), p2 = n => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  });
  ok(new RegExp('書き出した日時：' + want).test(tx), `書き出した日時が読める形で出る (${want})`);
  ok(/バージョン 2026\.08\.01/.test(tx), '書き出したときのバージョンが出る');

  /* 「先に今のデータを書き出す」を押すと、シートは開いたまま書き出しだけ起きる */
  const [dl] = await Promise.all([
    p.waitForEvent('download'),
    p.evaluate(() => [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent === '先に今のデータを書き出す').click())
  ]);
  ok(/^ao-compass-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(dl.suggestedFilename()), `先に書き出したファイルにも日付が入る (${dl.suggestedFilename()})`);
  await p.waitForTimeout(200);
  const still = await p.evaluate(() => ({
    open: document.querySelector('#overlay').classList.contains('open'),
    n: S.schools.length + '/' + S.schools[0].name
  }));
  ok(still.open, '先に書き出しても確認シートは開いたまま');
  ok(still.n === '1/見本大学', `先に書き出してもデータは置きかわらない (${still.n})`);

  /* ✕（右上）で閉じても何も起きない */
  await p.evaluate(() => document.querySelector('#sheet .x').click());
  await p.waitForTimeout(250);
  const afterX = await p.evaluate(() => S.schools.length + '/' + S.schools[0].name + '/' + S.profile.name);
  ok(afterX === '1/見本大学/見本太郎', `✕で閉じてもデータが残る (${afterX})`);
  await p.context().close();
}

/* 3. 書き出したファイルをそのまま読み込み直すと、元どおりになる（往復できる） */
{
  const p = await open();
  await p.evaluate(SEED);
  const [dl] = await Promise.all([ p.waitForEvent('download'), p.evaluate(() => exportData()) ]);
  const stream = await dl.createReadStream();
  let raw = ''; for await (const c of stream) raw += c;
  const parsed = JSON.parse(raw);
  ok(!!parsed._backupAt && !!parsed._backupVer, '書き出したファイルに日時とバージョンが入る');
  ok(!/aoCompass_ai|sk-ant-|"key"\s*:/.test(raw), '書き出したファイルにAPIキーの入る場所が無い');

  /* いったん全部消してから読み込み直す */
  await p.evaluate(() => { S = blankState(); S.profile.onboarded = true; save(); });
  await chooseFile(p, 'modoshi.json', raw);
  const txt = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(/そのまま読み込んで大丈夫/.test(txt) && !/置きかわります/.test(txt), '空のときは上書き警告を出さない');
  await p.evaluate(() => [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent === '読み込む').click());
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({
    s: S.schools.length, nm: S.schools[0] && S.schools[0].name, d: S.documents.length,
    prof: S.profile.name, leak: ('_backupAt' in S) || ('_backupVer' in S),
    view: document.querySelector('#root').innerText.length > 50
  }));
  ok(r.s === 1 && r.nm === '見本大学' && r.d === 1 && r.prof === '見本太郎', `往復して元どおりになる (志望校${r.s}件 / ${r.nm})`);
  ok(!r.leak, '往復しても目印がデータに残らない');
  ok(r.view, '読み込んだあとホームが表示される');
  await p.context().close();
}

/* 4. 昔の形（_backupAt が無い・項目が足りない）のバックアップも読める */
{
  const p = await open();
  await p.evaluate(SEED);
  await chooseFile(p, 'old.json', JSON.stringify({ schools: [{ id: 'o1', name: '昔大学' }], documents: [] }));
  const tx = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(/書き出した日時：記録なし/.test(tx), '日時が無いファイルは「記録なし」と出る');
  ok(!/バージョン/.test(tx.split('読み込むファイルの中身')[1] || ''), 'バージョンが無ければ表示しない');
  await p.evaluate(() => [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent === '置きかえて読み込む').click());
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const views = ['home', 'schools', 'docs', 'tasks', 'self', 'settings'];
    let bad = null;
    views.forEach(v => { try { go(v); if (!document.querySelector('#root').innerHTML) bad = v; } catch (e) { bad = v + ':' + e.message; } });
    return { n: S.schools.length, nm: S.schools[0].name, cl: typeof S.schools[0].checklist, bad };
  });
  ok(r.n === 1 && r.nm === '昔大学', `昔の形でも読み込める (${r.nm})`);
  ok(r.cl === 'object', '足りない項目は migrate で埋まる');
  ok(r.bad === null, `読み込んだあと全画面が開く (${r.bad})`);
  await p.context().close();
}

/* 5. 件数の日本語化そのもの */
{
  const p = await open();
  const r = await p.evaluate(() => ({
    empty: backupCounts({}), nul: backupCounts(null),
    mix: backupCounts({ schools: [1, 2], documents: [], activities: [1], profile: { name: '花子' } }),
    noName: backupCounts({ tasks: [1, 2, 3], profile: { name: '  ' } })
  }));
  ok(r.empty === 'まだ何も入っていません' && r.nul === 'まだ何も入っていません', '空なら「まだ何も入っていません」');
  ok(r.mix === '志望校 2件／活動実績 1件／プロフィール（花子）', `件数が日本語で並ぶ (${r.mix})`);
  ok(r.noName === 'タスク 3件', `空白だけの名前はプロフィールに数えない (${r.noName})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
