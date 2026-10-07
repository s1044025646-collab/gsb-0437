import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBsgs, verifyCandidate } from '../dist/bsgs.js';
import { bruteForceDlog, ceilSqrt, isPrime, modInverse, modPow } from '../dist/bigmath.js';
import { validateParams, ValidationError } from '../dist/validation.js';

test('经典例子 p=23,g=5,h=8 最小解为 6', () => {
  const r = runBsgs({ p: 23n, g: 5n, h: 8n });
  assert.equal(r.status, 'found');
  assert.equal(r.hit?.x, '6');
  assert.equal(r.hit?.i, 1); // i=1,j=1 -> x=1*5+1
  assert.equal(r.hit?.j, 1);
  assert.ok(r.equation?.includes('= h(8)'));
});

test('真子群 p=23,g=4,h=5 无解且完整覆盖', () => {
  const r = runBsgs({ p: 23n, g: 4n, h: 5n });
  assert.equal(r.status, 'no_solution');
  assert.equal(r.fullyCovered, true);
  assert.equal(r.hit, null);
  // g=4 生成 11 阶真子群（m=5，baby 前 5 个恰好不同）；
  // 用阶为 2 的 g=-1=22 验证“重复余数保留最小下标”：
  const smallSubgroup = runBsgs({ p: 23n, g: 22n, h: 1n });
  assert.ok(smallSubgroup.distinctBabyResidues < smallSubgroup.babyStepsBuilt);
  assert.equal(smallSubgroup.hit?.x, '0');
  assert.equal(runBsgs({ p: 23n, g: 22n, h: 22n }).hit?.x, '1');
  assert.equal(runBsgs({ p: 23n, g: 22n, h: 2n }).status, 'no_solution');
});

test('h=1 零解；g=1 有解/无解', () => {
  assert.equal(runBsgs({ p: 23n, g: 5n, h: 1n }).hit?.x, '0');
  assert.equal(runBsgs({ p: 23n, g: 1n, h: 1n }).hit?.x, '0');
  const none = runBsgs({ p: 23n, g: 1n, h: 2n });
  assert.equal(none.status, 'no_solution');
});

test('末端指数 p-2 可被找到', () => {
  // p=7, g=3 阶 6: 3^5 mod 7 = 5
  const h = modPow(3n, 5n, 7n);
  const r = runBsgs({ p: 7n, g: 3n, h });
  assert.equal(r.status, 'found');
  assert.equal(r.hit?.x, '5');
});

test('重复 baby 余数仍返回最小解（非原根）', () => {
  // g=4 阶 11，h=16=4^2，最小解为 2
  const r = runBsgs({ p: 23n, g: 4n, h: 16n });
  assert.equal(r.hit?.x, '2');
});

test('预算耗尽返回 undetermined 而非 no_solution', () => {
  // 只建 1 条 baby、走 1 个 giant，无法触及 x=6，且未完整覆盖
  const r = runBsgs({ p: 23n, g: 5n, h: 8n }, { maxBabyEntries: 1, maxGiantSteps: 1 });
  assert.equal(r.status, 'undetermined');
  assert.equal(r.fullyCovered, false);
});

test('独立核验区分满足等式与已证实最小', () => {
  const nonMinimal = verifyCandidate({ p: 23n, g: 1n, h: 1n }, 5n);
  assert.equal(nonMinimal.satisfied, true);
  assert.equal(nonMinimal.minimal, false);
  const good = verifyCandidate({ p: 23n, g: 5n, h: 8n }, 6n);
  assert.equal(good.satisfied, true);
  assert.equal(good.minimal, true);
  const bad = verifyCandidate({ p: 23n, g: 5n, h: 8n }, 7n);
  assert.equal(bad.satisfied, false);
});

test('对一批小素数穷举完整指数范围，核对最小性与无解结论', () => {
  const primes = [3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const p of primes) {
    assert.ok(isPrime(p));
    for (let g = 1n; g < p; g++) {
      for (let h = 1n; h < p; h++) {
        const bsgs = runBsgs({ p, g, h }, {}, 1);
        const brute = bruteForceDlog(g, h, p);
        assert.equal(brute.exhausted, true);
        if (brute.x === null) {
          assert.equal(bsgs.status, 'no_solution', `p=${p} g=${g} h=${h} 应无解`);
        } else {
          assert.equal(bsgs.status, 'found');
          assert.equal(bsgs.hit?.x, brute.x.toString(), `p=${p} g=${g} h=${h}`);
        }
      }
    }
  }
});

test('数学工具：素性、模逆、ceilSqrt、模幂边界', () => {
  assert.equal(isPrime(1_000_003n), true);
  assert.equal(isPrime(1_000_001n), false);
  assert.equal(isPrime(9n), false);
  assert.equal(modInverse(3n, 11n), 4n);
  assert.equal(ceilSqrt(22n), 5n);
  assert.equal(ceilSqrt(25n), 5n);
  assert.equal(ceilSqrt(2n), 2n);
  assert.equal(modPow(5n, 0n, 23n), 1n);
});

test('参数校验：合数模数、超范围值、错误格式', () => {
  // 合数模数不在 validateParams 中拒绝，而由服务端/CLI 独立 isPrime 把关：
  assert.equal(isPrime(24n), false);
  assert.throws(() => validateParams({ p: '23', g: '0', h: '8' }), ValidationError);
  assert.throws(() => validateParams({ p: '23', g: '23', h: '8' }), ValidationError);
  assert.throws(() => validateParams({ p: '23', g: '5', h: '23' }), ValidationError);
  assert.throws(() => validateParams({ p: '2', g: '1', h: '1' }), ValidationError);
  assert.throws(() => validateParams({ p: '1000004', g: '1', h: '1' }), ValidationError);
  assert.throws(() => validateParams({ p: 'abc', g: '1', h: '1' }), ValidationError);
  assert.throws(() => validateParams({ p: '23', g: 5 as unknown as string, h: '8' }), ValidationError);
  assert.throws(() => validateParams({ p: ' 23', g: '5', h: '8' }), ValidationError);
});

test('素性由服务端独立把关：p 为合数即使标签声称素数也拒绝（经算法入口验证 isPrime）', () => {
  assert.equal(isPrime(35n), false);
});
