// 판(版) 올리기 — index.html 의 ?v= · js/logic.js VERSION · js/app.js APP_VERSION 을 한 번에 같은 값으로.
//   node scripts/bump-version.mjs 2026-10-28.1   (값을 주지 않으면 오늘 날짜 + .1)
//   node scripts/bump-version.mjs --check        (세 곳이 같은지만 봄 — test/logic.test.mjs 도 같은 검사를 함)
// 왜: GitHub Pages 는 js·css 를 10분 캐시하므로 같은 주소면 브라우저가 옛 logic.js 와 새 app.js 를 섞어 쓸 수 있습니다.
//     ?v= 가 바뀌면 새 주소라 반드시 새로 받고, 그래도 섞이면 app.js 가 판이 다르다고 멈춥니다.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = {
  html: [path.join(ROOT, 'index.html'), /(src|href)="((?:js|css|vendor)\/[^"?]+)(\?v=[^"]*)?"/g],
  logic: [path.join(ROOT, 'js/logic.js'), /var VERSION = '([^']*)';/],
  app: [path.join(ROOT, 'js/app.js'), /var APP_VERSION = '([^']*)';/]
};
export function versions() {
  const read = k => fs.readFileSync(F[k][0], 'utf8');
  const html = [...read('html').matchAll(F.html[1])].map(m => (m[3] || '').replace('?v=', ''));
  return { html, logic: (read('logic').match(F.logic[1]) || [])[1], app: (read('app').match(F.app[1]) || [])[1] };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = process.argv[2];
  if (arg === '--check') {
    const v = versions(), all = [v.logic, v.app, ...v.html];
    const same = all.every(x => x && x === all[0]);
    console.log(same ? '판 같음: ' + all[0] + ' (index.html ' + v.html.length + '곳)' : '판 다름: ' + JSON.stringify(v));
    process.exitCode = same ? 0 : 1;
  } else {
    const d = new Date(), V = arg || d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.1';
    let s = fs.readFileSync(F.html[0], 'utf8').replace(F.html[1], (m, a, p) => a + '="' + p + '?v=' + V + '"'); fs.writeFileSync(F.html[0], s);
    s = fs.readFileSync(F.logic[0], 'utf8').replace(F.logic[1], "var VERSION = '" + V + "';"); fs.writeFileSync(F.logic[0], s);
    s = fs.readFileSync(F.app[0], 'utf8').replace(F.app[1], "var APP_VERSION = '" + V + "';"); fs.writeFileSync(F.app[0], s);
    console.log('판 ' + V + ' 로 올림');
  }
}
