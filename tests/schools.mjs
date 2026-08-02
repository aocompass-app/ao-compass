/* 今回変えた挙動そのものの確認（志望校）
   使い方: node tests/schools.mjs

   1) 志望校カードが「次にやってくる日」を出す
      出願締切を過ぎても、試験日・合格発表がまだ先ならそれを表示する
   2) 志望校の詳細シートに「この大学に出す書類」の進み具合が出て、
      その場で書きはじめられる */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.join(HERE, '..', 'index.html');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      → ' + detail : '')); }
};

async function open(browser, state) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { window.__AO_NO_ONBOARD = 1; });
  await page.addInitScript((s) => { try { localStorage.setItem('aoCompass_v1', JSON.stringify(s)); } catch (e) {} }, state);
  await page.goto(FILE);
  await page.waitForSelector('#root');
  await page.waitForTimeout(200);
  return { ctx, page, errors };
}

/* 今日を基準に「n日後」の日付を作る（テストが何年経っても腐らないように） */
function inDays(n) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function stateWith(schools, documents) {
  return {
    meta: { primarySchoolId: null, demoLoaded: true },
    profile: { name: 'テスト', onboarded: true },
    schools: schools, documents: documents || [],
    activities: [], interview: [], essays: [], tasks: [], feedback: [], certs: []
  };
}

async function main() {
  const browser = await chromium.launch();

  /* ================= 1. 次にやってくる日 ================= */
  console.log('\n[1] 志望校カードが「次にやってくる日」を出す');
  {
    const schools = [
      /* まだエントリーも始まっていない */
      { id: 'a', name: 'A大学', docs: '志望理由書', checklist: {},
        entryStart: inDays(10), deadline: inDays(40), examDate: inDays(60), resultDate: inDays(80) },
      /* エントリーは始まった。次は出願締切 */
      { id: 'b', name: 'B大学', docs: '志望理由書', checklist: {},
        entryStart: inDays(-5), deadline: inDays(12), examDate: inDays(30), resultDate: inDays(50) },
      /* 出願は終わった。次は試験日（ここが今回の要） */
      { id: 'c', name: 'C大学', docs: '志望理由書', checklist: {},
        entryStart: inDays(-40), deadline: inDays(-3), examDate: inDays(9), resultDate: inDays(35) },
      /* 試験も終わった。次は合格発表 */
      { id: 'd', name: 'D大学', docs: '志望理由書', checklist: {},
        entryStart: inDays(-60), deadline: inDays(-30), examDate: inDays(-6), resultDate: inDays(4) },
      /* すべて終わった */
      { id: 'e', name: 'E大学', docs: '志望理由書', checklist: {},
        deadline: inDays(-90), examDate: inDays(-70), resultDate: inDays(-50) },
      /* 日程を何も入れていない */
      { id: 'f', name: 'F大学', docs: '志望理由書', checklist: {} }
    ];
    const { ctx, page, errors } = await open(browser, stateWith(schools));

    const ms = await page.evaluate(() => {
      const out = {};
      S.schools.forEach((s) => {
        const m = nextMilestone(s);
        out[s.id] = m ? { label: m.label, days: m.days, key: m.key } : null;
      });
      return out;
    });
    check('A: 次はエントリー開始（あと10日）', ms.a && ms.a.key === 'entryStart' && ms.a.days === 10, JSON.stringify(ms.a));
    check('B: 次は出願締切（あと12日）', ms.b && ms.b.key === 'deadline' && ms.b.days === 12, JSON.stringify(ms.b));
    check('C: 締切を過ぎたら次は試験日（あと9日）', ms.c && ms.c.key === 'examDate' && ms.c.days === 9, JSON.stringify(ms.c));
    check('D: 試験も終われば次は合格発表（あと4日）', ms.d && ms.d.key === 'resultDate' && ms.d.days === 4, JSON.stringify(ms.d));
    check('E: すべて終わったら null', ms.e === null, JSON.stringify(ms.e));
    check('F: 日程が無ければ null', ms.f === null, JSON.stringify(ms.f));

    await page.evaluate(() => go('schools'));
    await page.waitForTimeout(250);

    /* 画面に実際に出ている文字で確かめる */
    const cards = await page.evaluate(() => {
      const out = {};
      [...document.querySelectorAll('#root .card')].forEach((c) => {
        const t = c.innerText || '';
        const m = t.match(/([A-F])大学/);
        if (m) out[m[1]] = t.replace(/\s+/g, ' ');
      });
      return out;
    });
    check('C大学のカードに「試験日まで9日」が出る',
      cards.C && cards.C.includes('試験日まで9日'), cards.C);
    check('C大学のカードが「締切済」の灰色バッジで終わらない',
      cards.C && !cards.C.includes('締切まで') , cards.C);
    check('C大学のカードに出願締切の日付が小さく残る',
      cards.C && cards.C.includes('出願締切') && cards.C.includes('受付終了'), cards.C);
    check('D大学のカードに「合格発表まで4日」が出る',
      cards.D && cards.D.includes('合格発表まで4日'), cards.D);
    check('A大学のカードに「エントリー開始まで10日」が出る',
      cards.A && cards.A.includes('エントリー開始まで10日'), cards.A);
    check('B大学のカードに「出願締切まで12日」が出る',
      cards.B && cards.B.includes('出願締切まで12日'), cards.B);
    check('E大学は「締切済」のまま', cards.E && cards.E.includes('締切済'), cards.E);
    check('F大学は「締切未設定」のまま', cards.F && cards.F.includes('締切未設定'), cards.F);

    /* 締切が14日以内は赤、それ以上は控えめ。合格発表は急かさない */
    const badges = await page.evaluate(() => {
      const out = {};
      [...document.querySelectorAll('#root .card')].forEach((c) => {
        const m = (c.innerText || '').match(/([A-F])大学/);
        if (!m) return;
        const b = c.querySelector('.badge:not(.pill-priority)');
        out[m[1]] = b ? b.className : null;
      });
      return out;
    });
    check('B（あと12日）は赤で知らせる', /alert/.test(badges.B || ''), badges.B);
    check('A（あと10日・エントリー）も赤で知らせる', /alert/.test(badges.A || ''), badges.A);
    check('D（合格発表）は赤くしない', !/alert|warn/.test(badges.D || ''), badges.D);

    check('JSエラーが出ない', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ================= 2. 詳細シートの「この大学に出す書類」 ================= */
  console.log('\n[2] 詳細シートに書類の進み具合が出る');
  {
    const schools = [{
      id: 's1', name: 'テスト大学', faculty: '総合政策学部', method: '総合型選抜',
      docs: '志望理由書、活動報告書、学習計画書', checklist: {},
      deadline: inDays(20), examDate: inDays(45)
    }];
    const documents = [
      /* 完成させたもの */
      { id: 'd1', schoolId: 's1', type: '志望理由書', title: 'テスト大学 志望理由書',
        status: '完成', body: 'あ'.repeat(600), feedbacks: [], versions: [], paragraphNotes: {}, scoreHistory: [] },
      /* 書きかけ */
      { id: 'd2', schoolId: 's1', type: '活動報告書', title: 'テスト大学 活動報告書',
        status: '下書き', body: 'い'.repeat(120), feedbacks: [], versions: [], paragraphNotes: {}, scoreHistory: [] }
      /* 学習計画書はまだ作っていない */
    ];
    const { ctx, page, errors } = await open(browser, stateWith(schools, documents));
    await page.evaluate(() => go('schools'));
    await page.waitForTimeout(200);
    await page.evaluate(() => openSchool('s1'));
    await page.waitForTimeout(250);

    const sheet = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#sheet [data-reqdocs] .list-row')];
      return {
        open: document.querySelector('#overlay').classList.contains('open'),
        text: (document.querySelector('#sheet').innerText || '').replace(/\s+/g, ' '),
        rows: rows.map((r) => ({
          label: r.getAttribute('data-reqdoc'),
          body: (r.innerText || '').replace(/\s+/g, ' '),
          btn: r.querySelector('button') ? r.querySelector('button').textContent : null
        }))
      };
    });

    check('シートが開いている', sheet.open === true);
    check('「この大学に出す書類」の見出しが出る', sheet.text.includes('この大学に出す書類'), sheet.text.slice(0, 200));
    check('必要書類3件が並ぶ', sheet.rows.length === 3, JSON.stringify(sheet.rows.map((r) => r.label)));
    check('志望理由書 / 活動報告書 / 学習計画書 が並ぶ',
      sheet.rows.map((r) => r.label).join() === '志望理由書,活動報告書,学習計画書',
      JSON.stringify(sheet.rows.map((r) => r.label)));

    const byLabel = {};
    sheet.rows.forEach((r) => { byLabel[r.label] = r; });
    check('完成した書類は「完成」と出る',
      byLabel['志望理由書'] && byLabel['志望理由書'].body.includes('完成'), JSON.stringify(byLabel['志望理由書']));
    check('完成した書類の文字数が出る（600字）',
      byLabel['志望理由書'] && byLabel['志望理由書'].body.includes('600字'), JSON.stringify(byLabel['志望理由書']));
    check('書きかけは「書き途中」と出る',
      byLabel['活動報告書'] && byLabel['活動報告書'].body.includes('書き途中'), JSON.stringify(byLabel['活動報告書']));
    check('書きかけの下書き文字数が出る（120字）',
      byLabel['活動報告書'] && byLabel['活動報告書'].body.includes('下書き 120字'), JSON.stringify(byLabel['活動報告書']));
    check('未着手は「まだ作っていません」と出る',
      byLabel['学習計画書'] && byLabel['学習計画書'].body.includes('まだ作っていません'), JSON.stringify(byLabel['学習計画書']));
    check('できている書類のボタンは「開く」',
      byLabel['志望理由書'].btn === '開く' && byLabel['活動報告書'].btn === '開く',
      byLabel['志望理由書'].btn + ' / ' + byLabel['活動報告書'].btn);
    check('未着手のボタンは「作る」', byLabel['学習計画書'].btn === '作る', byLabel['学習計画書'].btn);
    check('「1/3 完成」の集計が出る', sheet.text.includes('1/3 完成'), sheet.text.slice(0, 300));
    check('原本を確認する注意書きが残っている', sheet.text.includes('募集要項の原本'), sheet.text.slice(0, 400));
    check('日付に残り日数が付く（あと20日）', sheet.text.includes('あと20日'), sheet.text.slice(0, 400));
    check('出願チェックリストは今までどおり残っている', sheet.text.includes('出願チェックリスト'));

    /* 「作る」を押すと、その書類が実際に作られてエディターが開く */
    const before = await page.evaluate(() => S.documents.length);
    await page.evaluate(() => {
      const r = document.querySelector('#sheet [data-reqdoc="学習計画書"] button');
      r.click();
    });
    await page.waitForTimeout(400);
    const made = await page.evaluate(() => ({
      n: S.documents.length,
      last: S.documents[S.documents.length - 1],
      view: view
    }));
    check('「作る」で書類が1件増える', made.n === before + 1, before + ' → ' + made.n);
    check('作られた書類が学習計画書で、志望校にひもづく',
      made.last && made.last.type === '学習計画書' && made.last.schoolId === 's1', JSON.stringify(made.last));
    check('書類の画面に移動する', made.view === 'documents', made.view);

    check('JSエラーが出ない', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ================= 3. 既存データを壊していないか ================= */
  console.log('\n[3] 昔のデータ（日程が欠けている志望校）でも壊れない');
  {
    const old = {
      schools: [
        { id: 'o1', name: '昔の大学' },                          /* 日程も docs も無い */
        { id: 'o2', name: '昔の大学2', deadline: '' },            /* 空文字 */
        { id: 'o3', name: '昔の大学3', deadline: 'これは日付ではない' } /* 壊れた値 */
      ],
      documents: [], tasks: []
    };
    const { ctx, page, errors } = await open(browser, old);
    await page.evaluate(() => go('schools'));
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({
      ms: S.schools.map((s) => nextMilestone(s)),
      cards: document.querySelectorAll('#root .card').length,
      text: (document.querySelector('#root').innerText || '').replace(/\s+/g, ' ')
    }));
    check('日程が無い・壊れていても nextMilestone が落ちない',
      r.ms.every((m) => m === null), JSON.stringify(r.ms));
    check('カードは3件とも描画される', r.cards >= 3, String(r.cards));
    check('「締切未設定」と出る', r.text.includes('締切未設定'), r.text.slice(0, 200));

    /* 詳細シートも開ける */
    for (const id of ['o1', 'o2', 'o3']) {
      await page.evaluate((x) => openSchool(x), id);
      await page.waitForTimeout(200);
      const t = await page.evaluate(() => (document.querySelector('#sheet').innerText || '').replace(/\s+/g, ' '));
      check(`${id} の詳細シートが開く`, t.includes('出願チェックリスト') && t.includes('この大学に出す書類'), t.slice(0, 150));
      await page.evaluate(() => closeSheet());
      await page.waitForTimeout(100);
    }
    check('JSエラーが出ない', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(`\n===== 合計 ${pass + fail} 件 / 成功 ${pass} / 失敗 ${fail} =====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
