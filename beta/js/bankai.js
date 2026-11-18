import { unitsOf } from "./curriculum.js?v=8";
// 문제은행용 분석 서버 호출: PDF 쪽에서 문항 뽑기(/extract), 변형 문항 만들기(/variant)
const post = async (store, path, body) => {
  const cfg = window.APP_CONFIG;
  const res = await fetch(cfg.workerUrl.replace(/\/$/, "") + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + await store.idToken() },
    body: JSON.stringify(body)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `분석 서버 오류 (${res.status})`);
  return j;
};
const hasWorker = () => !!(window.APP_CONFIG || {}).workerUrl;

// 쪽 이미지(data URL, 최대 4장) → 문항 초안 목록
// 각 문항: {page, body, answer, criteria, concept, diff, round, figure:[x0,y0,x1,y1](0~1000) | null}
export async function requestExtract({ store, images, grade, sem, hint }) {
  if (!hasWorker()) { await new Promise(r => setTimeout(r, 900)); return demoExtract(images.length, grade, sem); }
  const j = await post(store, "/extract", { images: images.map(d => d.split(",")[1]), grade, sem, hint: hint || "", units: unitsOf(grade, sem) });
  return (j.items || []).map(it => ({ ...it, page: Math.max(0, (+it.page || 1) - 1) }));
}

// 문항 → 변형 문항 (type: 'num' 숫자 변형 | 'content' 내용 변형)
// 서버가 변형을 만든 뒤 따로 다시 풀어서 정답이 같은지 확인한다 → {body, answer, criteria, concept, verified, check}
export async function requestVariant({ store, item, type, grade, unit }) {
  if (!hasWorker()) { await new Promise(r => setTimeout(r, 700)); return demoVariant(item, type); }
  return post(store, "/variant", { type, grade, unit, item: { body: item.body, answer: item.answer, criteria: item.criteria, concept: item.concept || "", diff: item.diff || 2, hasFigure: !!item.hasFigure } });
}

/* ---------- 데모 ---------- */
function demoExtract(n, grade, sem) {
  const out = [];
  for (let p = 0; p < n; p++) for (let k = 0; k < 2; k++) {
    const a = 2 + p * 3 + k, b = 5 + k;
    out.push({ page: p, body: `(데모) 일차방정식 \\(${a}x+${b}=${a * 3 + b}\\)의 해를 구하는 과정을 서술하시오.`, answer: "\\(x=3\\)",
      criteria: `① 이항하여 \\(${a}x=${a * 3}\\) 정리 2점\n② 양변을 ${a}로 나누기 2점\n③ 답 \\(x=3\\) 1점`, concept: "일차방정식의 풀이", diff: 1 + k, round: 0,
      figure: k === 1 ? [80, 520, 520, 760] : null });
  }
  return out;
}
function demoVariant(item, type) {
  const body = type === "num"
    ? String(item.body || "").replace(/\d+/g, m => String(+m + 1))
    : `(데모 · 내용 변형) ${String(item.body || "").replace(/구하시오/, "구하고, 그 이유를 서술하시오")}`;
  return { body, answer: "(데모) 정답을 확인해 주세요", criteria: item.criteria || "", concept: item.concept || "", verified: false, check: "데모 모드에서는 검산하지 않아요." };
}
