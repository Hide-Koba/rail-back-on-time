// 衝突防止の不変条件。SPEC.md §3.3。テストでは全ティックで呼ぶ。

const EPS = 1e-6;

/** 違反の説明を配列で返す（空なら問題なし）。 */
export function checkInvariants(state) {
  const problems = [];
  const { resources, stations } = state.layout;
  const seen = new Map(); // resId -> trainId

  for (const t of state.trains) {
    const inPlay = t.status !== 'queued' && t.status !== 'done';
    if (!inPlay) {
      if (t.resId !== null) problems.push(`${t.id}: ${t.status} なのにリソース ${t.resId} を持っている`);
      continue;
    }
    const res = resources[t.resId];
    if (!res) {
      problems.push(`${t.id}: 存在しないリソース ${t.resId}`);
      continue;
    }
    if (seen.has(t.resId)) {
      problems.push(`${t.resId}: ${seen.get(t.resId)} と ${t.id} が同時に占有している`);
    }
    seen.set(t.resId, t.id);

    if (state.occ[t.resId] !== t.id) {
      problems.push(`${t.id}: ${t.resId} の占有表が ${state.occ[t.resId]} になっている`);
    }
    if (t.km < res.startKm - EPS || t.km > res.endKm + EPS) {
      problems.push(`${t.id}: km=${t.km} が ${t.resId} の範囲 [${res.startKm}, ${res.endKm}] の外`);
    }
    if (t.status === 'dwelling' || t.status === 'turnaround') {
      if (res.kind !== 'track' || Math.abs(t.km - stations[res.stationIndex].km) > EPS) {
        problems.push(`${t.id}: ${t.status} なのに駅中心にいない`);
      }
    }
  }

  // 占有表の側からも確認する（列車が持っていない占有が残っていないか）
  for (const [resId, trainId] of Object.entries(state.occ)) {
    if (trainId == null) continue;
    const t = state.trainById[trainId];
    if (!t || t.resId !== resId) problems.push(`${resId}: 占有表の ${trainId} が実際にはそこにいない`);
  }
  return problems;
}

export function assertInvariants(state) {
  const problems = checkInvariants(state);
  if (problems.length > 0) {
    throw new Error(`不変条件の違反 (t=${state.timeSec}):\n  ${problems.join('\n  ')}`);
  }
}
