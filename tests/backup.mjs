/* AO Compass バックアップの書き出し・読み込みテスト   使い方: node tests/backup.mjs
   2026.08.07-2 で入れた「読み込み前の確認シート」と「日付入りファイル名」を確かめます。 */
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

/* 中身の入った状態を作る */
const SEED = () => {
  S.schools = [{ id: 's1', name: '見本大学', faculty: '法学部', deadline: '2026-11-01', docs: '志望理由書', checklist: {}, tasks: [] },
               { id: 's2', name: '手本大学', faculty: '文学部', deadline: '2026-12-01', docs: '', checklist: {}, tasks: [] }];
  S.documents = [{ id: 'd1', title: '志望理由書', type: '志望理由書', body: 'あ'.repeat(80), status: '下書き', updatedAt: 1 }];
  S.activities = [{ id: 'a1', title: '生徒会' }];
  S.tasks = [];
  S.profile = Object.assign({}, S.profile, { name: '見本太郎', onboarded: true });
  save();
};

/* 1. 書き出したファイルの名前に日付が入る／APIキーが混ざらない */
{
  const p = await open();
  await p.evaluate(SEED);
  await p.evaluate(() => { AICFG = { provider: 'anthropic', key: 'sk-ant-SECRET-TEST', model: '' }; });
  const [dl] = await Promise.all([ p.waitForEvent('download'), p.evaluate(() => exportData()) ]);
  const fn = dl.suggestedFilename();
  ok(/^ao-compass-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(fn), `ファイル名に日付が入る (${fn})`);
  const body = await p.evaluate(() => JSON.stringify(Object.assign({}, S, { _backupAt: 'x', _backupVer: APP_VER })));
  ok(!/sk-ant-SECRET-TEST/.test(body), 'バックアップの中身にAPIキーが入っていない');
  ok(/_backupVer/.test(body), 'バックアップに書き出したバージョンが入る');
  await p.context().close();
}

/* 2. 読み込みは、確認シートを出すまで今のデータに触らない */
{
  const p = await open();
  await p.evaluate(SEED);
  const before = await p.evaluate(() => S.schools.length + '/' + S.documents.length);
  await p.evaluate(() => confirmImport({ schools: [{ id: 'z1', name: '別大学' }], documents: [], activities: [], tasks: [],
                                         profile: { name: '別人' }, _backupAt: '2026-08-01T09:30:00.000Z' }, 'test.json'));
  await p.waitForTimeout(300);
  const openSheetNow = await p.evaluate(() => document.querySelector('#overlay').classList.contains('open'));
  ok(openSheetNow, '読み込みの確認シートが開く');
  const tx = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(/いまこの端末に入っているデータ/.test(tx) && /志望校 2件/.test(tx), '今のデータの件数が出る');
  ok(/読み込むファイルの中身/.test(tx) && /志望校 1件/.test(tx), '読み込むファイルの件数が出る');
  ok(/書き出した日時/.test(tx), 'バックアップを書き出した日時が出る');
  ok(/置きかわります/.test(tx), '上書きになることの警告が出る');
  ok(/先に今のデータを書き出す/.test(tx), '先にバックアップを取るボタンがある');
  const after = await p.evaluate(() => S.schools.length + '/' + S.documents.length);
  ok(before === after, `確認シートの段階ではデータが変わらない (${before} → ${after})`);

  /* キャンセルしたら何も起きない */
  await p.evaluate(() => [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent === 'キャンセル').click());
  await p.waitForTimeout(300);
  const afterCancel = await p.evaluate(() => S.schools.length + '/' + S.documents.length + '/' + S.schools[0].name);
  ok(afterCancel === '2/1/見本大学', `キャンセルでデータが残る (${afterCancel})`);
  await p.context().close();
}

/* 3. 「置きかえて読み込む」を押したときだけ入れかわる */
{
  const p = await open();
  await p.evaluate(SEED);
  await p.evaluate(() => confirmImport({ schools: [{ id: 'z1', name: '別大学' }], documents: [], activities: [], tasks: [], profile: { name: '別人' } }, 'x.json'));
  await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent === '置きかえて読み込む').click());
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({ n: S.schools.length, nm: S.schools[0].name, doc: S.documents.length,
                                      leak: ('_backupAt' in S) || ('_backupVer' in S),
                                      saved: JSON.parse(localStorage.getItem(lsKey())).schools[0].name }));
  ok(r.n === 1 && r.nm === '別大学' && r.doc === 0, `押したら読み込まれる (志望校${r.n}件 / ${r.nm})`);
  ok(!r.leak, 'バックアップ用の目印がデータに残らない');
  ok(r.saved === '別大学', '端末の保存にも反映される');
  await p.context().close();
}

/* 4. 何も入っていないときは、上書き警告ではなく普通の案内になる */
{
  const p = await open();
  await p.evaluate(() => { S = blankState(); S.profile.onboarded = true; save(); });
  await p.evaluate(() => confirmImport({ schools: [{ id: 'z1', name: '別大学' }] }, 'x.json'));
  await p.waitForTimeout(300);
  const tx = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(!/置きかわります/.test(tx) && /そのまま読み込んで大丈夫/.test(tx), '空のときは警告を出さない');
  ok(/読み込む/.test(tx) && !/置きかえて読み込む/.test(tx), '空のときのボタンは「読み込む」');
  await p.context().close();
}

/* 5. 関係ないJSONでは上書きしない */
{
  const p = await open();
  const r = await p.evaluate(() => ({
    ng1: looksLikeBackup({ hello: 'world' }), ng2: looksLikeBackup(null), ng3: looksLikeBackup([1, 2]),
    ng4: looksLikeBackup('文字列'), okOld: looksLikeBackup({ schools: [], documents: [] }),
    okProf: looksLikeBackup({ profile: { name: 'a' } })
  }));
  ok(!r.ng1 && !r.ng2 && !r.ng3 && !r.ng4, '無関係なJSONははじく');
  ok(r.okOld && r.okProf, '昔の形のバックアップは受け付ける');
  await p.context().close();
}

/* 6. 設定画面が開き、データ管理の案内が出ている */
{
  const p = await open();
  await p.evaluate(() => go('settings')); await p.waitForTimeout(400);
  const tx = await p.evaluate(() => document.querySelector('#root').innerText);
  ok(/確認画面/.test(tx), '設定に「確認画面を出してから置きかえる」案内が出る');
  ok(/APIキーは含まれません/.test(tx), 'APIキーを含まない旨の表示が残っている');
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
