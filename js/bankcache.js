// 문제은행·세트·Preview/Review 결과를 한곳에 모아 두는 캐시 (여러 화면이 함께 씀)
//   programs/{pid}/items/{id}     문항 {grade, sem, round, unit, concept, diff, body, answer, criteria, source:{type,ref}, figure?, parent?, vtype?, status, by, at}
//   programs/{pid}/figs/{id}      문항 그림 {data}  (문항 문서를 가볍게 두려고 따로 저장)
//   programs/{pid}/sets/{sem-g-r} 세트 {preview:[id×10], previewOk, test:[id×10], testOk, plan:['num'|'content'×10]}
//   programs/{pid}/reviews/{sid_term_r}  학생별 Review {items:[id×10], plan:[{concept,n}], issued, by, at}
//   programs/{pid}/results/{sid_term_r_stage}  Preview·Review 채점 {sid, term, round, stage, date, status, score, marks:[10], by, at}
//   programs/{pid}/config/term    지금 진행 중인 학기 {year, sem}
export const BANK = { items: {}, sets: {}, loaded: false, figs: {} };
export const RES = { results: {}, reviews: {} };

export async function loadSets(store) {
  const rows = await store.listX("sets");
  BANK.sets = {}; rows.forEach(r => BANK.sets[r.id] = r);
}
export async function ensureBank(store, force = false) {
  if (BANK.loaded && !force) return;
  const rows = await store.listX("items");
  BANK.items = {}; rows.forEach(r => BANK.items[r.id] = r);
  BANK.loaded = true;
}
export async function loadResults(store, term) {
  const rows = await store.listX("results", [["term", "==", term]]);
  RES.results = {}; rows.forEach(r => RES.results[r.id] = r);
  const rv = await store.listX("reviews", [["term", "==", term]]);
  RES.reviews = {}; rv.forEach(r => RES.reviews[r.id] = r);
}
export async function getFigure(store, id) {
  if (BANK.figs[id] !== undefined) return BANK.figs[id];
  const d = await store.getX("figs", id).catch(() => null);
  return (BANK.figs[id] = d ? d.data : null);
}
