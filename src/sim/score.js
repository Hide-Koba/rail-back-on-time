// スコア。SPEC.md §5。
import { PAX } from '../config.js';

/** 遅延損失 [人分] = Σ 乗客数 × max(0, 終点到着遅延[分]) */
export function delayLoss(state) {
  let sum = 0;
  for (const t of state.trains) sum += PAX[t.type] * (Math.max(0, t.finalDelaySec ?? 0) / 60);
  return sum;
}

/** 改善率 = 1 − 自分 / ベースライン（ベースラインが0なら0）。 */
export function improvementRate(loss, baselineLoss) {
  return baselineLoss > 0 ? 1 - loss / baselineLoss : 0;
}

/** 星の数。クリアで1、改善率が stars.two 以上で2、stars.three 以上で3。 */
export function starCount(stage, rate) {
  if (rate >= stage.stars.three) return 3;
  if (rate >= stage.stars.two) return 2;
  return 1;
}

/** 定時率 = 終点到着時点の遅延が60秒未満の列車の割合。 */
export function onTimeRate(state) {
  if (state.trains.length === 0) return 1;
  const ok = state.trains.filter((t) => (t.finalDelaySec ?? Infinity) < 60).length;
  return ok / state.trains.length;
}
