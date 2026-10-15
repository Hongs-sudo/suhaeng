// 부모님 리포트: 데이터 만들기 + 화면 그리기 + 이미지 만들기 (앱과 공유 링크 페이지가 함께 사용)
import { UNITS, UNIT_LINES } from "./rubric.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = n => n == null || isNaN(n) ? "–" : (Math.round(n * 10) / 10).toString();
const md = d => d ? d.slice(5).replace("-", ".") : "";
export const unitBr = (g, r) => esc((UNIT_LINES[g] || [])[r - 1] || "").replace(/\n/g, "<br>");

// 응시한 순서(날짜순)로 회차를 정렬 — 1~10회를 순서대로 진행하지 않아도 그대로 반영
export function takenRounds(rounds) {
  return Object.entries(rounds || {})
    .filter(([, x]) => x && x.status !== "결시" && typeof x.score === "number")
    .map(([r, x]) => ({ round: +r, ...x }))
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.round - b.round);
}
export const PARTS = { 1: "1차 리포트 (응시 1~5번째)", 2: "2차 리포트 (응시 6~10번째)", 0: "전체 리포트" };
export function partRounds(rounds, part) {
  const t = takenRounds(rounds);
  return part === 1 ? t.slice(0, 5) : part === 2 ? t.slice(5, 10) : t;
}

// 같은 학년, 같은 회차 응시자 평균
export function classAverages(students, records) {
  const acc = {};
  for (const s of students) {
    const rr = records[s.id] || {};
    for (const [r, x] of Object.entries(rr)) {
      if (!x || typeof x.score !== "number" || x.status === "결시") continue;
      const k = `${s.grade}_${r}`; (acc[k] = acc[k] || []).push(x.score);
    }
  }
  const out = {}; for (const [k, v] of Object.entries(acc)) out[k] = v.reduce((a, b) => a + b, 0) / v.length;
  return out;
}

export function buildReport({ student, rounds, analyses, avgs, part, comments, cfg }) {
  const g = student.grade;
  const rows = partRounds(rounds, part).map(x => {
    const a = analyses[x.round];
    return {
      round: x.round, unit: UNITS[g][x.round - 1], date: x.date, score: x.score,
      classAvg: avgs[`${g}_${x.round}`] ?? null,
      items: a && a.confirmed ? a.items.map(i => i.score) : null,
      errs: a && a.confirmed ? a.items.filter(i => i.score < 5 && i.error_type).map(i => i.error_type) : []
    };
  });
  const sc = rows.map(r => r.score);
  const avg = sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null;
  const ca = rows.filter(r => r.classAvg != null);
  const cavg = ca.length ? ca.reduce((a, r) => a + r.classAvg, 0) / ca.length : null;
  const best = sc.length ? Math.max(...sc) : null;
  const bestRow = rows.find(r => r.score === best);
  const analyzed = rows.filter(r => r.items);
  const errCount = {};
  rows.forEach(r => r.errs.forEach(e => errCount[e] = (errCount[e] || 0) + 1));
  return {
    v: 1,
    program: cfg.programName || "수행평가·서술형 프로그램",
    contact: cfg.contact || "",
    student: { name: student.name, school: student.school, grade: g, teacher: student.teacher },
    part, partLabel: PARTS[part],
    period: rows.length ? [rows[0].date, rows[rows.length - 1].date] : null,
    rows,
    kpi: {
      avg, cavg, diff: avg != null && cavg != null ? avg - cavg : null, best, bestRound: bestRow?.round,
      full: analyzed.reduce((a, r) => a + r.items.filter(x => x === 5).length, 0),
      itemsTotal: analyzed.length * 10, taken: takenRounds(rounds).length
    },
    errors: Object.entries(errCount).sort((a, b) => b[1] - a[1]),
    comments: comments || {},
    createdAt: Date.now()
  };
}

function chartSVG(rows) {
  const W = 340, H = 176, L = 26, R = 8, T = 14, B = 26, ih = H - T - B, iw = W - L - R, n = Math.max(rows.length, 1);
  const y = v => T + ih - (v / 50) * ih, step = iw / n, bw = Math.min(30, step * 0.55), cx = i => L + step * i + step / 2;
  let g = "";
  [0, 10, 20, 30, 40, 50].forEach(t => g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--p-line)"/><text x="${L - 6}" y="${y(t) + 3.5}" text-anchor="end" font-size="9" fill="var(--p-muted)">${t}</text>`);
  rows.forEach((r, i) => {
    g += `<rect x="${cx(i) - bw / 2}" y="${y(r.score)}" width="${bw}" height="${y(0) - y(r.score)}" rx="2" fill="var(--p-green)"/>
      <text x="${cx(i)}" y="${Math.min(y(r.score), r.classAvg == null ? 999 : y(r.classAvg)) - 5}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--p-ink)">${fmt(r.score)}</text>
      <text x="${cx(i)}" y="${H - 9}" text-anchor="middle" font-size="9.5" fill="var(--p-muted)">${r.round}회</text>`;
  });
  const pts = rows.map((r, i) => r.classAvg == null ? null : [cx(i), y(r.classAvg)]).filter(Boolean);
  if (pts.length > 1) g += `<polyline points="${pts.map(p => p.join(",")).join(" ")}" fill="none" stroke="var(--p-gold)" stroke-width="1.6" stroke-dasharray="4 3"/>`;
  pts.forEach(p => g += `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="var(--p-bg)" stroke="var(--p-gold)" stroke-width="1.6"/>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="회차별 점수와 학년 평균">${g}</svg>`;
}

export function renderReport(d, logoSrc = "img/logo.png") {
  const s = d.student, k = d.kpi, rows = d.rows;
  const per = d.period ? `${md(d.period[0])} ~ ${md(d.period[1])}` : "–";
  const hasItems = rows.some(r => r.items);
  const kpi4 = k.itemsTotal ? `<div><small>만점 문항</small><b>${k.full}</b><i> / ${k.itemsTotal}문항</i></div>` : `<div><small>누적 응시</small><b>${k.taken}</b><i> / 10회</i></div>`;
  const diff = k.diff == null ? "–" : (k.diff >= 0 ? "+" : "−") + fmt(Math.abs(k.diff));
  const heat = hasItems ? `<div class="heat num"><span></span>${Array.from({ length: 10 }, (_, i) => `<span class="h">${i + 1}</span>`).join("")}
      ${rows.map(r => `<span class="rl">${r.round}회</span>` + (r.items ? r.items.map(p => `<span class="c ${p === 5 ? "o" : p === 0 ? "x" : "p"}">${p === 5 ? "" : fmt(p)}</span>`).join("") : `<span class="none">시험지 분석 전</span>`)).join("")}
    </div><div class="heat-leg"><span><i style="background:var(--p-good)"></i>만점</span><span><i style="background:var(--p-warn)"></i>부분 점수</span><span><i style="background:var(--p-bad)"></i>0점</span></div>`
    : `<p class="empty">시험지 분석이 끝나면 문항별 결과가 표시됩니다.</p>`;
  const mx = Math.max(1, ...d.errors.map(e => e[1]));
  const errs = d.errors.length ? d.errors.map(([t, n]) => `<div class="err"><span>${esc(t)}</span><div class="bar"><span style="width:${n / mx * 100}%"></span></div><b class="num">${n}</b></div>`).join("") +
    `<p class="note-s">감점된 문항 수 기준${d.errors[0] ? ` · '${esc(d.errors[0][0])}'에서 감점이 가장 많았습니다.` : ""}</p>` : `<p class="empty">분석된 시험지의 감점 원인이 여기에 정리됩니다.</p>`;
  const c = d.comments || {};
  const cm = (c.strengths || c.improve || c.plan) ? `<div class="r-sec"><h3>선생님 종합 의견</h3><div class="r-cmt">
      <div><b>잘하고 있어요</b><p>${esc(c.strengths)}</p></div><div><b>보완할 점</b><p>${esc(c.improve)}</p></div><div><b>다음 학습 계획</b><p>${esc(c.plan)}</p></div></div></div>` : "";
  return `<article class="rep"><div class="paper">
    <div class="r-top"><div>
      <div class="r-eyebrow">${esc(d.program)} &nbsp;|&nbsp; 학습 리포트</div>
      <div class="r-title">${esc(s.name)} 학생 <span>${d.part === 0 ? "전체" : d.part + "차"}</span> 결과</div><div class="r-rule"></div>
    </div><img class="r-logo" src="${logoSrc}" alt="수학도서관 1:1 명품 맞춤 수학학원"></div>
    <div class="r-info">
      <div><small>학교 · 학년</small><b>${esc(s.school)} ${s.grade}학년</b></div>
      <div><small>담당 선생님</small><b>${esc(s.teacher)}</b></div>
      <div><small>응시 기간</small><b class="num">${per}</b></div>
      <div><small>이번 리포트</small><b class="num">${rows.map(r => r.round).join(" · ") || "–"}회</b></div>
    </div>
    <div class="r-kpi num">
      <div><small>평균 점수</small><b>${fmt(k.avg)}</b><i> / 50</i></div>
      <div><small>같은 학년 평균 대비</small><b class="${k.diff >= 0 ? "up" : ""}">${diff}</b><i> 점</i></div>
      <div><small>최고 점수</small><b>${fmt(k.best)}</b><i> ${k.bestRound ? k.bestRound + "회" : ""}</i></div>
      ${kpi4}
    </div>
    <div class="r-two">
      <div class="r-sec"><h3>회차별 점수</h3><div class="chart">${chartSVG(rows)}</div>
        <div class="heat-leg"><span><i style="background:var(--p-green)"></i>내 점수</span><span><i class="ln"></i>학년 평균</span><span>응시한 순서대로</span></div></div>
      <div class="r-sec"><h3>단원별 결과</h3><table class="r-tbl num"><thead><tr><th>회차</th><th>단원</th><th class="r">점수</th><th class="r">학년 평균</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${r.round}회<small>${md(r.date)}</small></td><td>${unitBr(s.grade, r.round)}</td><td class="s">${fmt(r.score)}</td><td class="a">${fmt(r.classAvg)}</td></tr>`).join("")}
      </tbody></table></div>
    </div>
    <div class="r-two">
      <div class="r-sec"><h3>문항별 결과 (시험지 분석)</h3>${heat}</div>
      <div class="r-sec"><h3>감점 원인</h3><div class="errs">${errs}</div></div>
    </div>
    ${cm}
    <div class="r-foot"><span>수학도서관 중등부 · ${esc(d.program)}</span>${d.contact ? `<span>상담·문의 <b class="num">${esc(d.contact)}</b></span>` : ""}</div>
  </div></article>`;
}

/* ---------- 이미지 (A4 794px 폭, 2배 해상도) ---------- */
let h2c = null;
function loadH2C() {
  if (!h2c) h2c = new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => ok(window.html2canvas); s.onerror = () => no(new Error("이미지 도구를 불러오지 못했습니다"));
    document.head.appendChild(s);
  });
  return h2c;
}
export async function reportToBlob(d, logoSrc) {
  const html2canvas = await loadH2C();
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1";
  host.innerHTML = renderReport(d, logoSrc);
  host.querySelector(".rep").style.width = "794px";
  document.body.appendChild(host);
  try {
    await document.fonts.ready;
    await Promise.all([...host.querySelectorAll("img")].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
    const canvas = await html2canvas(host.querySelector(".rep"), { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: 1200 });
    return await new Promise(r => canvas.toBlob(r, "image/png"));
  } finally { host.remove(); }
}
