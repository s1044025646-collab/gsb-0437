import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/store.js';
import { runBsgs } from '../dist/bsgs.js';

function tempStore(): { store: Store; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dlog-'));
  const path = join(dir, 'test.sqlite');
  return { store: new Store(path), path };
}

test('保存、复查、重启后模等式仍成立', () => {
  const { store, path } = tempStore();
  const result = runBsgs({ p: 23n, g: 5n, h: 8n });
  const saved = store.saveReport(JSON.stringify({ p: '23', g: '5', h: '8' }), '23', '5', '8', {}, result);
  const check1 = store.recheck(saved);
  assert.equal(check1.hashOk, true);
  assert.equal(check1.equationOk, true);
  store.close();

  // 重新打开模拟重启
  const reopened = new Store(path);
  const again = reopened.getById(saved.id)!;
  assert.ok(again);
  const check2 = reopened.recheck(again);
  assert.equal(check2.hashOk, true);
  assert.equal(check2.equationOk, true);
  reopened.close();
});

test('篡改命中指数或余数会被拒绝', () => {
  const { store } = tempStore();
  const result = runBsgs({ p: 23n, g: 5n, h: 8n });
  const saved = store.saveReport('{}', '23', '5', '8', {}, result);

  const tamperedX: typeof saved = {
    ...saved,
    result: saved.result.replace('"x":"6"', '"x":"7"'),
  };
  assert.equal(store.recheck(tamperedX).hashOk, false);

  const tamperedResidue: typeof saved = {
    ...saved,
    result: saved.result.replace('"residue":"5"', '"residue":"9"'),
  };
  const rc = store.recheck(tamperedResidue);
  assert.ok(rc.hashOk === false || rc.equationOk === false);
  store.close();
});

test('修改参数生成新 key，同参数重复执行为新版本，问题之间互不串用', () => {
  const { store } = tempStore();
  const a1 = store.saveReport('{}', '23', '5', '8', {}, runBsgs({ p: 23n, g: 5n, h: 8n }));
  const a2 = store.saveReport('{}', '23', '5', '8', {}, runBsgs({ p: 23n, g: 5n, h: 8n }));
  const b = store.saveReport('{}', '23', '4', '5', {}, runBsgs({ p: 23n, g: 4n, h: 5n }));
  assert.equal(a1.problemKey, a2.problemKey);
  assert.equal(a1.version, 1);
  assert.equal(a2.version, 2);
  assert.notEqual(a1.problemKey, b.problemKey);
  assert.equal(store.listByProblem(a1.problemKey).length, 2);
  assert.equal(store.listByProblem(b.problemKey).length, 1);
  store.close();
});

test('仅保存的问题（未执行）复查状态明确', () => {
  const { store } = tempStore();
  const saved = store.saveReport('{}', '23', '5', '8', {}, null);
  assert.equal(saved.status, 'saved');
  const rc = store.recheck(saved);
  assert.equal(rc.equationOk, null);
  store.close();
});
