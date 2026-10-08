// SVG の盤面と列車。シミュレーションの状態を読むだけで、書き換えない。SPEC.md §6.2〜§6.4。
// 操作（列車やポイントのタップ）は handlers に通知するだけで、ここでは何も変えない。
import { TYPE_NAMES } from '../config.js';
import { delaySec } from '../sim/timetable.js';
import { routeTargetTrain, plannedTrack } from '../sim/dispatch.js';
import {
  computeBoardLayout, trainPosition, trainCenter, trackPath, pointCenter, hitTestTrain, hitTestPoint,
  STATION_BOX_PX,
} from './layout.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** 表示する遅延（分）。1分未満は 0。 */
export const delayMinutes = (state, train) => Math.max(0, Math.floor(delaySec(state, train) / 60));

/** 属性が変わったときだけ書く（毎フレーム同じ値を書き込まない）。 */
function setAttr(node, name, value) {
  const v = String(value);
  if (node.getAttribute(name) !== v) node.setAttribute(name, v);
}
const show = (node, on) => {
  if (on) node.removeAttribute('display');
  else setAttr(node, 'display', 'none');
};

/**
 * container（縦にスクロールする領域）の中に盤面を作る。
 * 戻り値の render(state, view) を毎フレーム呼ぶ。大きさが変わったら自分で作り直す。
 *   view = { selectedId, focusId }  選択中の列車と、チュートリアルで輪を付ける列車
 *   handlers = { onTrainTap(trainId), onPointTap(stationIndex) }
 */
export function createBoard(container, state, handlers = {}) {
  let geo = null;
  let svg = null;
  let layers = null;
  let queueText = null;
  let stationRecs = [];
  let focusRing = null;
  let trainEls = new Map(); // trainId -> { g, nameText, delayText, badge, sel, ... }
  let lockEls = new Map(); // trainId -> 確定した進路の細い線
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
    // 重なり順: 経路の線 → 輪 → ポイント → 列車 → 「−1」（輪を列車の下にして、ラベルが隠れないようにする）
    layers = {
      route: el('g', { class: 'route-layer' }, svg),
      rings: el('g', { class: 'ring-layer' }, svg),
      points: el('g', { class: 'point-layer' }, svg),
      trains: el('g', { class: 'trains' }, svg),
      floats: el('g', { class: 'floats' }, svg),
    };
    stationRecs = state.layout.stations.map((st) => buildStationOverlay(st));
    focusRing = el('circle', { class: 'ring focus', r: 17, display: 'none' }, layers.rings);
    trainEls = new Map();
    lockEls = new Map();
  }

  function drawStatic(root, g, st) {
    const { stations } = st.layout;
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
        const x = g.cx + gs.trackDx[t.id];
        // 路線から各番線へ斜めに分岐し、出口で合流する（終点は合流せず行き止まり）
        el('path', { class: `track${t.isMain ? ' main' : ''}`, d: trackPath(g, st.layout, t) }, grp);
        if (t.hasPlatform) {
          const side = gs.trackDx[t.id] < 0 ? -1 : 1; // ホームは外側に置く
          el('rect', {
            class: 'platform', x: x + side * 7 - 2.5, y: gs.boxTop + STATION_BOX_PX * 0.3,
            width: 5, height: STATION_BOX_PX * 0.4, rx: 1.5,
          }, grp);
        }
        el('text', { class: 'track-label', x, y: gs.boxBottom - 5, 'text-anchor': 'middle' }, grp).textContent = t.label;
      }
    });
  }

  /** 駅ごとの重ね描き: 対象列車への経路、ポイントのアイコン、対象列車の輪。 */
  function buildStationOverlay(station) {
    const c = pointCenter(geo, station.index);
    const highlight = el('path', { class: 'route-highlight', display: 'none' }, layers.route);
    const icon = el('g', { class: 'point', transform: `translate(${c.x} ${c.y})` }, layers.points);
    el('rect', { class: 'point-bg', x: -14, y: -14, width: 28, height: 28, rx: 8 }, icon);
    // 1本の線が2本に分かれる記号
    el('path', { class: 'point-symbol', d: 'M0 -9 L0 0 M0 0 L-6 9 M0 0 L6 9' }, icon);
    const ring = el('circle', { class: 'ring target', r: 17, display: 'none' }, layers.rings);
    return { highlight, icon, ring };
  }

  function createTrainEl(train) {
    const g = el('g', { class: `train t-${train.type}` }, layers.trains);
    const sel = el('rect', { class: 'sel-frame', x: -13, y: -27, width: 26, height: 31, rx: 5, display: 'none' }, g);
    el('polygon', { class: 'train-body', points: '-8,-22 8,-22 8,-9 0,0 -8,-9' }, g);
    const nameText = el('text', { class: 'train-name' }, g);
    nameText.textContent = `${TYPE_NAMES[train.type]} ${train.number}`;
    const delayText = el('text', { class: 'train-delay' }, g);
    // 抑止中は赤い「抑」、予約中は点線の「抑」
    const badge = el('g', { class: 'badge', display: 'none' }, g);
    el('rect', { class: 'badge-bg', width: 15, height: 15, rx: 3 }, badge);
    el('text', { class: 'badge-text', x: 7.5, y: 11.5, 'text-anchor': 'middle' }, badge).textContent = '抑';
    const rec = { g, sel, nameText, delayText, badge, shown: '', mode: null };
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
      rec.badge.setAttribute('transform', 'translate(12 -20)');
    } else {
      set(rec.nameText, -12, -8, 'end');
      set(rec.delayText, 12, -8, 'start');
      rec.badge.setAttribute('transform', 'translate(40 -19)');
    }
  }

  function floatRecovered(x, y) {
    const t = el('text', { class: 'recover', x: x + 40, y: y - 8 }, layers.floats);
    t.textContent = '−1';
    t.addEventListener('animationend', () => t.remove());
    setTimeout(() => t.remove(), 1500); // 画面が非表示だとアニメーションが進まず animationend が来ないので、時間でも消す
  }

  function renderTrains(st, view) {
    let queued = 0;
    for (const t of st.trains) {
      if (t.status === 'queued') queued++;
      const pos = trainPosition(geo, st.layout, t);
      let rec = trainEls.get(t.id);
      if (!pos) {
        if (rec) show(rec.g, false);
        continue;
      }
      if (!rec) rec = createTrainEl(t);
      show(rec.g, true);
      placeLabels(rec, st.layout.resources[t.resId].kind === 'track' ? 'track' : 'block');
      setAttr(rec.g, 'transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`);

      const min = delayMinutes(st, t);
      const text = min >= 1 ? `+${min}` : '';
      if (text !== rec.shown) {
        rec.delayText.textContent = text;
        rec.shown = text;
      }
      const prev = lastMinutes.get(t.id);
      if (prev !== undefined && min < prev && prev >= 1) floatRecovered(pos.x, pos.y);
      lastMinutes.set(t.id, min);

      show(rec.sel, view.selectedId === t.id);
      const held = t.held;
      const reserved = !held && !!t.holdAt;
      show(rec.badge, held || reserved);
      rec.badge.setAttribute('class', `badge ${held ? 'held' : 'reserved'}`);
    }
    const q = queued > 0 ? `待機 ${queued}本` : '';
    if (queueText.textContent !== q) queueText.textContent = q;
  }

  /** 各駅のポイント: 対象列車（進路が未確定で最も駅に近い列車）に輪を付け、選ばれている番線までの経路を強調する。 */
  function renderPoints(st) {
    st.layout.stations.forEach((station, i) => {
      const rec = stationRecs[i];
      const target = routeTargetTrain(st, station.id);
      const c = target && trainCenter(geo, st.layout, target);
      if (!target || !c) {
        show(rec.highlight, false);
        show(rec.ring, false);
        rec.icon.setAttribute('class', 'point');
        return;
      }
      const trackId = plannedTrack(st, target, station);
      setAttr(rec.highlight, 'd', trackPath(geo, st.layout, st.layout.resources[trackId]));
      show(rec.highlight, true);
      setAttr(rec.ring, 'cx', c.x.toFixed(1));
      setAttr(rec.ring, 'cy', c.y.toFixed(1));
      show(rec.ring, true);
      rec.icon.setAttribute('class', 'point active');
    });
  }

  /** 進路が確定した列車の経路は、細い線で表示を続ける（どこへ入るか分かるように）。 */
  function renderLockedRoutes(st) {
    for (const t of st.trains) {
      const station = st.layout.stations[t.nextStation];
      const inPlay = t.status !== 'queued' && t.status !== 'done';
      const trackId = inPlay && station && t.routeLocked[station.id] ? t.routes[station.id] : null;
      let node = lockEls.get(t.id);
      if (!trackId) {
        if (node) show(node, false);
        continue;
      }
      if (!node) {
        node = el('path', { class: `route-locked t-${t.type}` }, layers.route);
        lockEls.set(t.id, node);
      }
      setAttr(node, 'd', trackPath(geo, st.layout, st.layout.resources[trackId]));
      show(node, true);
    }
  }

  function renderFocus(st, view) {
    const target = view.focusId && st.trainById[view.focusId];
    const c = target && trainCenter(geo, st.layout, target);
    if (!c) {
      show(focusRing, false);
      return;
    }
    setAttr(focusRing, 'cx', c.x.toFixed(1));
    setAttr(focusRing, 'cy', c.y.toFixed(1));
    show(focusRing, true);
  }

  function render(st, view = {}) {
    if (!svg) build();
    if (!svg) return;
    renderLockedRoutes(st);
    renderPoints(st);
    renderTrains(st, view);
    renderFocus(st, view);
  }

  // タップ: 列車（中心から24px以内で最も近いもの）→ ポイント（44×44px）の順に調べる。
  // スクロールのドラッグのあとは click が来ないので、誤タップにならない。
  function onClick(e) {
    if (!svg || !geo) return;
    const r = svg.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const t = hitTestTrain(geo, state.layout, state.trains, x, y);
    if (t) {
      handlers.onTrainTap?.(t.id);
      return;
    }
    const p = hitTestPoint(geo, x, y);
    if (p !== null) handlers.onPointTap?.(p);
  }
  container.addEventListener('click', onClick);

  // 幅や高さが変わったら作り直す（スマホの向き変更、PC のウィンドウサイズ変更）
  const observer = new ResizeObserver(() => { build(); });
  observer.observe(container);
  build();

  return {
    render,
    get layout() { return geo; },
    destroy() {
      observer.disconnect();
      container.removeEventListener('click', onClick);
      container.querySelector('svg')?.remove();
    },
  };
}
