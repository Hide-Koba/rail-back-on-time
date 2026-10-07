// ゲームループの時間配分。DOM に依存しない。SPEC.md §3.1。
import { DT_SEC, GAME_SEC_PER_REAL_SEC, MAX_FRAME_TICKS } from './config.js';

/**
 * 前フレームからの実時間 realDtSec と倍率から、このフレームで進めるティック数を決める。
 * acc は前のフレームから持ち越した端数。戻り値の acc を次のフレームに渡す。
 * 1フレームの上限（MAX_FRAME_TICKS）を超えた分は切り捨てる（裏に回ったタブが戻ったときなど）。
 */
export function framesTicks(acc, realDtSec, multiplier) {
  const total = Math.min(acc + (realDtSec * GAME_SEC_PER_REAL_SEC * multiplier) / DT_SEC, MAX_FRAME_TICKS);
  const ticks = Math.floor(total);
  return { ticks, acc: total - ticks };
}
