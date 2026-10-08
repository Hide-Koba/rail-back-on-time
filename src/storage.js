// 各ステージの最高の星の数を localStorage に保存する。SPEC.md §5。
// 読み書きは必ず try/catch で囲み、失敗（プライベートモード・容量超過・無効化など）しても遊べるようにする。
const KEY = 'rbot.stars.v1';

const defaultStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // localStorage へのアクセス自体が例外になる環境
  }
};

/** { stageId: 星の数(0〜3) }。読めなければ空。壊れた値は捨てる。 */
export function loadStars(storage = defaultStorage()) {
  try {
    const obj = JSON.parse(storage.getItem(KEY) ?? '{}');
    const out = {};
    for (const [id, n] of Object.entries(obj ?? {})) {
      if (Number.isInteger(n) && n >= 0 && n <= 3) out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/** 最高の星の数だけを更新して保存する。保存できなくても更新後の値を返す（その回の表示には使える）。 */
export function saveStars(stageId, stars, storage = defaultStorage()) {
  const all = loadStars(storage);
  if (stars > (all[stageId] ?? 0)) all[stageId] = stars;
  try {
    storage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 保存できなくても遊べる */
  }
  return all;
}
