// SVG の盤面と列車。シミュレーションの状態を読むだけで、書き換えない。SPEC.md §6.2 / §6.3。
import { TYPE_NAMES } from '../config.js';
import { delaySec } from '../sim/timetable.js';
import { computeBoardLayout, trainPosition, BRANCH_RATIO, STATION_BOX_PX } from './layout.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** 表示する遅延（分）。1分未満は 0。 */
export const delayMinutes = (state, train) => Math.max(0, Math.floor(delaySec(state, train) / 60));

/**
 * container（縦にスクロールする領域）の中に盤面を作る。
 * 戻り値の render(state) を毎フレーム呼ぶ。大きさが変わったら自分で作り直す。
 */
export function createBoard(container, state) {
  let geo = null;
  let svg = null;
  let trainLayer = null;
  let floatLayer = null;
  let queueText = null;
  let trainEls = new Map(); // trainId -> { g, delayText }
  const lastMinutes = new Map(); // trainId -> 直前に表示した遅延（分）。「−1」の演出に使う

  function build() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    if (geo && geo.width === width && geo.viewHeight === height) return;
    geo = computeBoardLayout(state.layout, { width, height });
    geo.viewHeight = height;

    container.querySelector('svg')?.remove();
    svg = el('svg', {
      class: 'board', width, height: geo.height, viewBox: `0 0 ${width} ${geo.height}`,
      role: 'img', 'aria-label': '路線と列車の盤面',
    });
    container.appendChild(svg);
    drawStatic(svg, geo, state);
    trainLayer = el('g', { class: 'trains' }, svg);
    floatLayer = el('g', { class: 'floats' }, svg);
    trainEls = new Map();
  }

  function drawStatic(root, g, st) {
    const { stations, resources } = st.layout;
    const stage = st.stage;
    const lines = el('g', { class: 'lines' }, root);

    // 区間: 画面中央の縦の破線。ブロックの境目に短い目印を付ける（詰まりが見えやすい）
    g.segments.forEach((seg) => {
      el('line', { class: 'route-dash', x1: g.cx, y1: seg.y0, x2: g.cx, y2: seg.y1 }, lines);
      seg.blockEdges.forEach((y) => {
        el('line', { class: 'block-tick', x1: g.cx - 6, y1: y, x2: g.cx + 6, y2: y }, lines);
      });
    });

    // 入線点
    el('text', { class: 'entry-label', x: g.cx, y: g.entryY - 50, 'text-anchor': 'middle' }, root).textContent =
      `▼ ${stage.entryLabel}`;
    queueText = el('text', { class: 'entry-queue', x: g.cx, y: g.entryY - 34, 'text-anchor': 'middle' }, root);

    // 駅の箱
    const boxX = 10;
    const boxW = g.width - 20;
    stations.forEach((s, i) => {
      const gs = g.stations[i];
      const grp = el('g', { class: 'station' }, root);
      el('rect', { class: 'station-box', x: boxX, y: gs.boxTop, width: boxW, height: STATION_BOX_PX, rx: 6 }, grp);
      el('text', { class: 'station-name', x: boxX + 8, y: gs.boxTop + 15 }, grp).textContent = s.name;
      if (s.isTerminal) {
        el('text', { class: 'station-note', x: boxX + boxW - 8, y: gs.boxTop + 15, 'text-anchor': 'end' }, grp).textContent = '終点';
      }
      for (const t of s.tracks) {
        const dx = gs.trackDx[t.id];
        const x = g.cx + dx;
        const yA = gs.boxTop + STATION_BOX_PX * BRANCH_RATIO;
        const yB = gs.boxTop + STATION_BOX_PX * (1 - BRANCH_RATIO);
        // 路線から各番線へ斜めに分岐し、出口で合流する（終点は合流せず行き止まり）
        const d = s.isTerminal
          ? `M ${g.cx} ${gs.boxTop} L ${x} ${yA} L ${x} ${yB}`
          : `M ${g.cx} ${gs.boxTop} L ${x} ${yA} L ${x} ${yB} L ${g.cx} ${gs.boxBottom}`;
        el('path', { class: `track${t.isMain ? ' main' : ''}`, d }, grp);
        if (t.hasPlatform) {
          const side = dx < 0 ? -1 : 1; // ホームは外側に置く
          const px = x + side * 7 - 2.5;
          el('rect', {
            class: 'platform', x: px, y: gs.boxTop + STATION_BOX_PX * 0.3,
            width: 5, height: STATION_BOX_PX * 0.4, rx: 1.5,
          }, grp);
        }
        el('text', { class: 'track-label', x, y: gs.boxBottom - 5, 'text-anchor': 'middle' }, grp).textContent = t.label;
      }
    });
  }

  function createTrainEl(train) {
    const g = el('g', { class: `train t-${train.type}` }, trainLayer);
    el('polygon', { class: 'train-body', points: '-8,-22 8,-22 8,-9 0,0 -8,-9' }, g);
    const nameText = el('text', { class: 'train-name' }, g);
    nameText.textContent = `${TYPE_NAMES[train.type]} ${train.number}`;
    const delayText = el('text', { class: 'train-delay' }, g);
    const rec = { g, nameText, delayText, shown: '', mode: null };
    trainEls.set(train.id, rec);
    return rec;
  }

  // ラベルの置き場所。区間では、ブロックが18pxの間隔で並んでも重ならないよう、左に「種別 番号」・右に遅延の1行ずつ。
  // 駅の番線では、番線が横に並ぶので、列車の下に中央揃えで「種別 番号」と遅延を重ねる。
  function placeLabels(rec, mode) {
    if (rec.mode === mode) return;
    rec.mode = mode;
    const set = (node, x, y, anchor) => {
      node.setAttribute('x', x);
      node.setAttribute('y', y);
      node.setAttribute('text-anchor', anchor);
    };
    if (mode === 'track') {
      set(rec.nameText, 0, 12, 'middle');
      set(rec.delayText, 0, 22, 'middle');
    } else {
      set(rec.nameText, -12, -8, 'end');
      set(rec.delayText, 12, -8, 'start');
    }
  }

  function floatRecovered(x, y) {
    const t = el('text', { class: 'recover', x: x + 40, y: y - 8 }, floatLayer);
    t.textContent = '−1';
    t.addEventListener('animationend', () => t.remove());
    setTimeout(() => t.remove(), 1500); // 画面が非表示だとアニメーションが進まず animationend が来ないので、時間でも消す
  }

  function render(st) {
    if (!svg) build();
    if (!svg) return;

    let queued = 0;
    for (const t of st.trains) {
      if (t.status === 'queued') queued++;
      const pos = trainPosition(geo, st.layout, t);
      let rec = trainEls.get(t.id);
      if (!pos) {
        if (rec) rec.g.setAttribute('display', 'none');
        continue;
      }
      if (!rec) rec = createTrainEl(t);
      rec.g.removeAttribute('display');
      placeLabels(rec, st.layout.resources[t.resId].kind === 'track' ? 'track' : 'block');
      rec.g.setAttribute('transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`);

      const min = delayMinutes(st, t);
      const text = min >= 1 ? `+${min}` : '';
      if (text !== rec.shown) {
        rec.delayText.textContent = text;
        rec.shown = text;
      }
      const prev = lastMinutes.get(t.id);
      if (prev !== undefined && min < prev && prev >= 1) floatRecovered(pos.x, pos.y);
      lastMinutes.set(t.id, min);
    }
    const q = queued > 0 ? `待機 ${queued}本` : '';
    if (queueText.textContent !== q) queueText.textContent = q;
  }

  // 幅や高さが変わったら作り直す（スマホの向き変更、PC のウィンドウサイズ変更）
  new ResizeObserver(() => { build(); }).observe(container);
  build();

  return { render, get layout() { return geo; } };
}
