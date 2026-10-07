import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/db/store.js';
import { DlogService } from '../src/services/dlog-service.js';

let dir: string;
let store: Store;
let service: DlogService;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'bsgs-test-'));
  store = new Store(join(dir, 'test.sqlite'));
  service = new DlogService(store);
});

after(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('成功求解并持久化，可重新复查模等式', () => {
  const r = service.solve({ p: '23', g: '5', h: '8' });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.report.minimumX, '6');

  const recheck = service.recheckWitness(r.value.reportId);
  assert.ok(recheck.ok);
  if (recheck.ok) assert.equal(recheck.value.valid, true);

  // 问题确实入库
  assert.ok(service.getProblem(r.value.problemId));
});

test('失败输入不留下成功记录', () => {
  const before = service.listProblems().length;
  const bad1 = service.solve({ p: '9', g: '2', h: '3' });
  assert.equal(bad1.ok, false);
  const bad2 = service.solve({ p: '23', g: '99', h: '8' });
  assert.equal(bad2.ok, false);
  assert.equal(service.listProblems().length, before);
});

test('多个问题的数据互不串用', () => {
  const a = service.solve({ p: '23', g: '5', h: '8' });
  const b = service.solve({ p: '23', g: '4', h: '5' });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(a.value.report.minimumX, '6');
  assert.equal(b.value.report.status, 'no_solution');
  assert.notEqual(a.value.problemId, b.value.problemId);
  assert.deepEqual(
    service.listReports(a.value.problemId).map((x) => x.id),
    [a.value.reportId],
  );
  assert.deepEqual(
    service.listReports(b.value.problemId).map((x) => x.id),
    [b.value.reportId],
  );
});

test('篡改见证余数或指数会被复查拒绝', () => {
  const r = service.solve({ p: '23', g: '5', h: '8' });
  if (!r.ok) throw new Error('求解失败');
  const row = service.getReport(r.value.reportId)!;
  const report = JSON.parse(row.report_json);

  // 篡改命中余数
  const tamperedResidue = JSON.parse(row.report_json);
  tamperedResidue.hit.residue = '19';
  tamperedResidue.hit.verifiedEquation.computed = '19';
  // 直接用篡改对象覆盖存储进行复查：通过临时伪造调用验证逻辑
  // 这里重新走 service.recheck 需要改库，改为单独构造：
  store.close();
  const store2 = new Store(join(dir, 'test.sqlite'));
  const service2 = new DlogService(store2);
  // 用底层 db 直接改写
  const db = (store2 as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } }).db;
  db.prepare('UPDATE reports SET report_json=? WHERE id=?').run(JSON.stringify(tamperedResidue), row.id);
  const rc1 = service2.recheckWitness(row.id);
  assert.ok(rc1.ok && rc1.value.valid === false);
  assert.ok(rc1.ok && rc1.value.reasons.some((x) => x.includes('余数')));

  // 篡改候选指数
  db.prepare('UPDATE reports SET report_json=? WHERE id=?').run(JSON.stringify(report), row.id);
  const tamperedX = JSON.parse(row.report_json);
  tamperedX.hit.candidateX = '7';
  db.prepare('UPDATE reports SET report_json=? WHERE id=?').run(JSON.stringify(tamperedX), row.id);
  const rc2 = service2.recheckWitness(row.id);
  assert.ok(rc2.ok && rc2.value.valid === false);

  store2.close();
  // 重新打开供后续测试
  store = new Store(join(dir, 'test.sqlite'));
  service = new DlogService(store);
});

test('比较问题版本：修改参数生成新版本可检出差异', () => {
  const a = service.solve({ p: '23', g: '5', h: '8' });
  const b = service.solve({ p: '23', g: '5', h: '9' });
  if (!a.ok || !b.ok) throw new Error('求解失败');
  const cmp = service.compareVersions(a.value.problemId, b.value.problemId);
  assert.ok(cmp.ok);
  if (cmp.ok) {
    assert.equal(cmp.value.paramDiff.hChanged, true);
    assert.equal(cmp.value.paramDiff.gChanged, false);
  }
});

test('导出包含全部问题与报告', () => {
  const data = service.exportAll();
  assert.ok(data.problems.length >= 2);
  assert.ok(data.problems.every((p) => p.reports.length >= 1));
});

test('独立验证 API: 有效但非最小', () => {
  const v = service.verify({ p: '23', g: '5', h: '8', x: '28' });
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.value.equationHolds, true);
    assert.equal(v.value.isMinimum, false);
  }
});
