import test from 'node:test';
import assert from 'node:assert/strict';
import { runHeadless } from '../src/sim/runner.js';
import { noticeText } from '../src/render/notices.js';
import stage2 from '../src/stages/stage2.js';
import { lineStage, train } from './helpers.js';

test('通知の文面: 速度規制・点検・運休・折返し短縮', () => {
  const r = runHeadless(stage2, [
    { when: (s) => ['running', 'signal', 'dwelling'].includes(s.trainById.L844.status), command: { type: 'cancel', trainId: 'L844' } },
    {
      when: (s) => s.trains.some((t) => t.status === 'turnaround'),
      command: (s) => ({ type: 'shortenTurnaround', trainId: s.trains.find((t) => t.status === 'turnaround').id }),
    },
  ]);
  const text = Object.fromEntries(r.state.notices.map((n) => [n.kind, noticeText(r.state, n)]));
  assert.equal(text.limitStart, '強風のため速度規制 170km/h（18:50〜19:25）');
  assert.equal(text.limitEnd, '強風の速度規制を解除しました');
  assert.equal(text.inspection, '快速 718が湖南で車両点検のため臨時停車します（約6分）');
  assert.match(text.cancelled, /^各停 844を.+で運休にしました$/);
  assert.match(text.shortened, /^.+の折り返しを短縮しました（浪速）$/);
});

test('通知: 不明な種類は空文字（画面に出さない）', () => {
  const r = runHeadless(lineStage({ trains: [train('X', 'S', 100, 0, [])] }));
  assert.equal(noticeText(r.state, { kind: 'unknown' }), '');
});
