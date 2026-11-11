// 브라우저 확인(선택): headless Chromium 으로 file:// 를 열어 화면마다 오류·가로 넘침·주요 동작을 봅니다.
// 실행: PLAYWRIGHT=<playwright 패키지 경로> node scripts/browser-check.cjs
//   예) PLAYWRIGHT=~/.npm/_npx/<해시>/node_modules/playwright CHROME=<chrome-headless-shell 경로(선택)> node scripts/browser-check.cjs
// 리포는 playwright 를 의존성으로 두지 않습니다(정적 도구라 설치할 것이 없게).
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const root = path.join(__dirname, '..');
const url = 'file://' + path.join(root, 'index.html');
const PAGES = ['home', 'daily', 'achieve', 'measure', 'analysis', 'loss', 'sim', 'compare', 'sop', 'report', 'process', 'settings'];
let fails = 0;
function check(ok, msg) { console.log((ok ? '  ok  ' : '  FAIL ') + msg); if (!ok) fails++; }

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  for (const width of [1280, 390, 360]) {
    console.log('— 폭 ' + width + 'px');
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // fresh-guard(index.html)는 file:// 에서 fetch 를 못 해 오류를 남깁니다 — 서버에서 열면 생기지 않으므로 뺍니다
    page.on('console', (m) => { if (m.type() === 'error' && !/URL scheme "file" is not supported/.test(m.text())) errors.push(m.text()); });
    page.on('dialog', (d) => d.accept());
    await page.goto(url + '#/settings');
    await page.getByRole('button', { name: '가상 샘플 불러오기' }).click();
    await page.waitForTimeout(400);
    check(await page.locator('#sampleBanner').isVisible(), '샘플 배너');
    for (const id of PAGES) {
      await page.goto(url + '#/' + id);
      await page.waitForTimeout(150);
      // 가로 넘침 — 안쪽 가로 스크롤 상자(table-wrap 등) 안은 의도된 것이라 뺍니다
      const over = await page.evaluate(() => {
        const W = document.documentElement.clientWidth, bad = [];
        document.querySelectorAll('.main *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width || r.right <= W + 1) return;
          for (let p = el.parentElement; p; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll') return; }
          bad.push(el.tagName + '.' + el.className + ' ' + Math.round(r.right));
        });
        return { bad: bad.slice(0, 3), scroll: document.documentElement.scrollWidth - W };
      });
      check(!over.bad.length && over.scroll <= 0, id + ' 가로 넘침 없음' + (over.bad.length ? ' ' + over.bad.join(' | ') : '') + (over.scroll > 0 ? ' scroll+' + over.scroll : ''));
    }
    // 검사기 자체 확인 — 일부러 넓은 상자를 넣으면 넘침을 잡아야 합니다
    const caught = await page.evaluate(() => {
      const d = document.createElement('div'); d.style.width = '3000px'; d.style.height = '4px'; document.querySelector('.main').appendChild(d);
      const W = document.documentElement.clientWidth; const r = d.getBoundingClientRect(); d.remove(); return r.right > W + 1;
    });
    check(caught, '넘침 검사기가 일부러 넣은 넓은 상자를 잡음');
    // 주요 내용
    await page.goto(url + '#/analysis');
    await page.getByRole('button', { name: '개선 전' }).click();
    check((await page.locator('.tiles').innerText()).includes('본용접'), '병목 분석(개선 전) — 본용접이 병목');
    await page.goto(url + '#/loss');
    await page.getByRole('button', { name: '개선 전' }).click();
    check((await page.locator('.tile').nth(2).innerText()).includes('대기'), '손실 분석(개선 전) — 대기가 1위');
    await page.goto(url + '#/sim');
    await page.getByRole('button', { name: '같은 인원으로 자동 배분 제안' }).click();
    const simTiles = await page.locator('.tiles').innerText();
    check(/현재 인원 유지/.test(simTiles), '인원 배분 — 같은 인원 유지 표시');
    await page.goto(url + '#/compare');
    const kpi = (await page.locator('.tiles .tile .v').allInnerTexts()).slice(0, 2);
    check(kpi.every((v) => v.trim() === '달성'), '개선 전·후 — 인원 유지·달성률 90% 모두 「달성」 (' + kpi.join(', ') + ')');
    check(/원/.test(await page.locator('.tiles .tile .v').nth(2).innerText()), '개선 전·후 — 대당 절감액 표시');
    await page.goto(url + '#/report');
    const prompt = await page.locator('textarea[readonly]').inputValue();
    check(!/작업자[A-I]/.test(prompt) && /작업자\d/.test(prompt), 'AI 프롬프트 — 작업자 이름이 별칭으로 바뀜');
    check(!/절감액/.test(prompt), 'AI 프롬프트 — 원가는 기본으로 빠짐');
    // 스톱워치
    await page.goto(url + '#/measure');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('data10-08.db')).measures.length);
    await page.getByRole('button', { name: '작업 시작' }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '대기' }).click();
    await page.waitForTimeout(1200);
    await page.reload(); // 새로 고쳐도 측정 중인 구간이 이어지는지
    await page.waitForTimeout(200);
    check((await page.locator('.sw-kind').innerText()).includes('대기 중'), '스톱워치 — 새로 고쳐도 측정 이어짐');
    await page.getByRole('button', { name: '멈춤(미완료)' }).click();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('data10-08.db')).measures.length);
    check(after === before + 2, '스톱워치 — 구간 2개 기록 (' + before + ' → ' + after + ')');
    // 엑셀 가져오기 — 같은 파일을 다시 넣어도 두 번 세지 않음
    await page.goto(url + '#/daily');
    await page.locator('input[type=file]').first().setInputFiles(path.join(root, 'samples', '프레임_일일실적_샘플_0831-1016.xlsx'));
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /확인한 1개 파일 반영/ }).click();
    const days = await page.evaluate(() => JSON.parse(localStorage.getItem('data10-08.db')).daily.length);
    check(days === 32, '일일 실적 엑셀 다시 가져오기 — 32일 그대로 (' + days + ')');
    // 현장 측정 → 일일 실적 · 공정 진행 (2026-11-10 요청)
    await page.goto(url + '#/home');
    check(/공정 진행 · 지연 공정/.test(await page.locator('.main').innerText()), '대시보드 — 공정 진행 · 지연 공정 카드');
    await page.goto(url + '#/process');
    check(await page.getByText('하루 CAPA(대/일)').first().isVisible(), '공정 설정 — 하루 CAPA 칸');
    await page.goto(url + '#/measure');
    const mtext = await page.locator('.main').innerText();
    check(/공정별 진행 현황/.test(mtext) && /날짜별 공정 진행/.test(mtext), '현장 측정 — 공정별 진행 현황 · 날짜별 표');
    await page.goto(url + '#/daily');
    const conflicts = await page.getByRole('button', { name: '측정값 쓰기' }).count();
    check(conflicts === 5, '일일 실적 — 샘플 측정일 5일은 손 입력과 달라 고르기로 남음 (' + conflicts + ')');
    await page.getByRole('button', { name: '입력값 유지' }).first().click();
    await page.getByRole('button', { name: '측정값 쓰기' }).first().click();
    const picked = await page.evaluate(() => JSON.parse(localStorage.getItem('data10-08.db')).daily.filter((r) => r.actualSrc === 'measure' || r.measureAck != null).length);
    check(picked === 2 && (await page.getByRole('button', { name: '측정값 쓰기' }).count()) === 3, '일일 실적 — 측정값 쓰기 · 입력값 유지 (' + picked + ')');
    // 일일 실적 입력란 정리 (2026-11-10 v2.3 요청) — 입력란 없음, 날짜 더하기 → 고치기
    const DD = () => page.evaluate(() => JSON.parse(localStorage.getItem('data10-08.db')).daily);
    const dtext = await page.locator('.main').innerText();
    check(!/현장 실적 입력/.test(dtext) && !(await page.locator('#dailyEdit').count()) && !(await page.locator('.main form').count()), '일일 실적 — 새 실적 입력란 없음(고치기 양식은 닫혀 있음)');
    check(await page.getByRole('button', { name: '엑셀로 내려받기' }).isVisible() && (await page.getByRole('button', { name: '고치기' }).count()) >= 32 && (await page.getByRole('button', { name: '지우기' }).count()) >= 32 && (await page.locator('input[type=file]').count()) >= 1, '일일 실적 — 고치기 · 지우기 · 엑셀 가져오기 · 내려받기는 그대로');
    const nDays = (await DD()).length;
    await page.locator('.daily-add input[type=date]').fill('2026-12-24');
    await page.getByRole('button', { name: '날짜 더하기' }).click(); await page.waitForTimeout(150);
    const added1 = (await DD()).find((r) => r.date === '2026-12-24');
    check(await page.locator('#dailyEdit').isVisible() && /2026-12-24 실적 고치기/.test(await page.locator('#dailyEdit h2').innerText()) && added1 && added1.actual == null, '날짜 더하기 — 그날 줄이 생기고 바로 고치기 화면이 열림');
    await page.screenshot({ path: path.join(process.env.SHOTS || require('os').tmpdir(), 'data10-08_' + width + '_daily-add.png'), fullPage: false });
    await page.getByRole('button', { name: '고치기 취소' }).click();
    check((await DD()).length === nDays && !(await page.locator('#dailyEdit').count()), '날짜 더하기 → 저장하지 않고 닫으면 빈 줄을 지움');
    await page.locator('.daily-add input[type=date]').fill('2026-12-24');
    await page.getByRole('button', { name: '날짜 더하기' }).click(); await page.waitForTimeout(150);
    await page.locator('#dailyEdit input[type=number]').nth(1).fill('7');   // 실제 생산 대수
    await page.locator('#dailyEdit').getByRole('button', { name: '저장' }).click(); await page.waitForTimeout(150);
    const saved = (await DD()).find((r) => r.date === '2026-12-24');
    check(saved && saved.actual === 7 && (await DD()).length === nDays + 1 && !(await page.locator('#dailyEdit').count()), '날짜 더하기 → 고치기에서 저장 (' + JSON.stringify(saved) + ')');
    await page.locator('.daily-add input[type=date]').fill('2026-12-24');
    await page.getByRole('button', { name: '날짜 더하기' }).click(); await page.waitForTimeout(150);
    check((await DD()).length === nDays + 1 && await page.locator('#dailyEdit').isVisible(), '이미 있는 날짜 — 새 줄 없이 그 줄의 고치기를 엶');
    await page.getByRole('button', { name: '고치기 취소' }).click();
    check((await DD()).find((r) => r.date === '2026-12-24').actual === 7, '있는 날을 열고 닫아도 지우지 않음');
    await page.getByRole('button', { name: '고치기' }).first().click(); await page.waitForTimeout(150);
    check(await page.locator('#dailyEdit').isVisible(), '표의 「고치기」 — 고치기 화면이 열림');
    await page.getByRole('button', { name: '고치기 취소' }).click();
    await page.goto(url + '#/measure');
    const procSel = page.locator('.main select').first(); // 스톱워치 카드의 공정 고르기
    await procSel.selectOption(await procSel.locator('option').last().getAttribute('value')); // 라인 끝 공정
    await page.getByRole('button', { name: '작업 시작' }).click(); await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '다음 대' }).click(); await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '완료하고 멈춤' }).click();
    const td = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('data10-08.db')); const t = new Date(); const iso = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); return d.daily.filter((r) => r.date === iso)[0] || null; });
    check(td && td.actual === 2 && td.actualSrc === 'measure', '스톱워치 — 마지막 공정 2대 완료가 오늘 일일 실적에 자동 기록 (' + JSON.stringify(td) + ')');
    // 측정 항목 편집 · 일시정지 (2026-11-10 v2.1 요청)
    const DB = () => page.evaluate(() => JSON.parse(localStorage.getItem('data10-08.db')));
    await page.goto(url + '#/home');
    check(/비작업 시간/.test(await page.locator('.main').innerText()), '대시보드 — 비작업 시간(세팅 · 휴식 · 일시정지) 카드');
    await page.goto(url + '#/process');
    const kindInputs = page.locator('.kind-row .kr-name input');
    check((await kindInputs.count()) === 8, '공정 설정 — 측정 항목 8개(작업 · 세팅 · 손실 5 · 휴식)');
    await kindInputs.nth(4).fill('설비 대기');                                   // 「대기」 이름 바꾸기
    await page.getByRole('button', { name: '항목 더하기' }).click();
    await page.locator('.kind-row .kr-name input').last().fill('설비 고장');
    await page.locator('.kind-row').nth(5).locator('input[type=checkbox]').check();   // 「재작업」 숨기기
    await page.getByRole('button', { name: '측정 항목 저장' }).click();
    const kd = await DB();
    check(kd.kinds.length === 9 && kd.kinds[4].name === '설비 대기' && kd.kinds[4].id === '대기' && kd.kinds[5].hidden === true && kd.kinds[8].name === '설비 고장',
      '측정 항목 저장 — 이름 · 더하기 · 숨기기, id 는 그대로');
    check(kd.measures.some((m) => m.kind === '대기'), '측정 기록은 id 로 남음(이름을 바꿔도 기록 그대로)');
    await page.goto(url + '#/loss');
    await page.getByRole('button', { name: '개선 전' }).click();
    check((await page.locator('.tile').nth(2).innerText()).includes('설비 대기'), '손실 분석 — 바꾼 이름(설비 대기)이 1위로 보임 · 계산 그대로');
    check(/비작업 시간/.test(await page.locator('.main').innerText()), '손실 분석 — 비작업 시간 카드');
    await page.goto(url + '#/measure');
    const swText = await page.locator('.sw-grid').innerText();
    check(/설비 대기/.test(swText) && /설비 고장/.test(swText) && !/재작업/.test(swText) && /세팅/.test(swText) && /휴식/.test(swText), '스톱워치 — 새 항목 목록(숨긴 재작업은 빠짐)');
    check(/설비 대기/.test(await page.locator('table.list').last().innerText()), '측정 기록 표 — 지난 기록이 새 이름으로 보임');
    const n0 = (await DB()).measures.length;
    await page.getByRole('button', { name: '작업 시작' }).click(); await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '일시정지' }).click(); await page.waitForTimeout(300);
    await page.reload(); await page.waitForTimeout(300);
    check((await page.locator('.sw-kind').innerText()).includes('일시정지 중'), '일시정지 — 새로 고쳐도 일시정지 상태가 이어짐');
    const t1 = await page.locator('#swTime').innerText(); await page.waitForTimeout(1300); const t2 = await page.locator('#swTime').innerText();
    check(t1 === t2 && /일시정지 \d/.test(await page.locator('#swPause').innerText()), '일시정지 — 작업 시간은 멈추고(' + t1 + ' = ' + t2 + ') 일시정지 시간이 흐름');
    await page.getByRole('button', { name: /다시 시작/ }).click(); await page.waitForTimeout(1200);
    check((await page.locator('.sw-kind').innerText()).includes('작업 중'), '다시 시작 — 멈췄던 작업으로 이어짐');
    await page.getByRole('button', { name: '멈춤(미완료)' }).click();
    const pd = await DB();
    const added = pd.measures.slice().filter((m) => !kd.measures.some((x) => x.date === m.date && x.worker === m.worker && x.start === m.start && x.process === m.process && x.unit === m.unit));
    check(pd.measures.length === n0 + 3 && added.map((m) => m.kind).sort().join(',') === '일시정지,작업,작업', '일시정지 — 작업 · 일시정지 · 작업 3구간 기록 (' + added.map((m) => m.kind).join(',') + ')');
    await page.goto(url + '#/process');
    await page.locator('.check-line input[type=checkbox]').check();
    await page.getByRole('button', { name: '측정 항목 저장' }).click();
    await page.goto(url + '#/analysis');
    check((await DB()).settings.ctSetup === true && /세팅\(준비\)/.test(await page.locator('.main').innerText()), '설정 — 사이클타임에 세팅 넣기 · 화면 안내에 계산 정의');
    // 좁은 화면: 메뉴 단추로 왼쪽 메뉴 열기
    for (const id of ['home', 'daily', 'measure', 'analysis', 'loss', 'process']) { await page.goto(url + '#/' + id); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS || require('os').tmpdir(), 'data10-08_' + width + '_' + id + '.png'), fullPage: false }); }
    if (width < 1024) {
      await page.locator('#menuBtn').click();
      check(await page.locator('#sidebar').isVisible(), '좁은 화면 — 메뉴 단추로 왼쪽 메뉴 열림');
    }
    check(!errors.length, '콘솔 오류 없음' + (errors.length ? ': ' + errors.slice(0, 3).join(' / ') : ''));
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? '\n실패 ' + fails + '개' : '\n모두 통과');
  process.exitCode = fails ? 1 : 0;
})();
