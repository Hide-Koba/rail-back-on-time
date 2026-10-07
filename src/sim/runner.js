// 画面なしで最後まで実行する。ゲーム開始時の初期化（warmup）もここ。
import { DT_SEC } from '../config.js';
import { createState } from './model.js';
import { step } from './simulation.js';
import { delayLoss, onTimeRate } from './score.js';

/** ステージを開始できる状態にする。warmupSec があれば、その秒数だけ自動運転で進める。 */
export function createGame(stage) {
  const state = createState(stage);
  for (let t = 0; t < (stage.warmupSec ?? 0); t += DT_SEC) step(state);
  return state;
}

/**
 * 操作の予定 schedule を実行して結果を返す。
 *   { atSec, command }              … ゲーム内時刻が atSec になったティックで1回だけ
 *   { when(state), command, once }  … 条件が成り立ったティックで。once は省略すると true（1回だけ）
 * options.onTick(state) は step() のたびに呼ばれる（不変条件の検査などに使う）。
 */
export function runHeadless(stage, schedule = [], options = {}) {
  const state = createGame(stage);
  const entries = schedule.map((s) => ({ ...s, fired: false }));
  const limit = Math.ceil(stage.maxDurationSec / DT_SEC) + 10;

  for (let i = 0; !state.finished; i++) {
    if (i > limit) throw new Error('終了判定が働かず、ティック数の上限を超えました');
    const commands = [];
    for (const e of entries) {
      if (e.fired && (e.atSec !== undefined || (e.once ?? true))) continue;
      const due = e.atSec !== undefined ? state.timeSec >= e.atSec : e.when(state);
      if (!due) continue;
      commands.push(e.command);
      e.fired = true;
    }
    step(state, commands);
    options.onTick?.(state);
  }
  return summarize(state);
}

export function summarize(state) {
  const finalDelaySec = {};
  for (const t of state.trains) finalDelaySec[t.id] = t.finalDelaySec;
  return {
    state,
    endReason: state.endReason,
    endSec: state.timeSec,
    finalDelaySec,
    loss: delayLoss(state),
    onTimeRate: onTimeRate(state),
  };
}

/** ベースライン（操作なし）の遅延損失。決定的なので毎回同じ値になる。 */
export function baselineLoss(stage) {
  return runHeadless(stage).loss;
}
