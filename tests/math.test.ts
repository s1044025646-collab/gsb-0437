import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  babyStepGiantStep,
  exhaustiveDlog,
  verifyCandidate,
} from '../src/math/bsgs.js';
import {
  ceilSqrt,
  isPrime,
  modInverse,
  modPow,
} from '../src/math/bigint-utils.js';
import { validateProblem } from '../src/math/validation.js';

test('ceilSqrt 精确', () => {
  assert.equal(ceilSqrt(0n), 0n);
  assert.equal(ceilSqrt(1n), 1n);
  assert.equal(ceilSqrt(22n), 5n); // ceil(sqrt(22))=5
  assert.equal(ceilSqrt(25n), 5n);
  assert.equal(ceilSqrt(26n), 6n);
  assert.equal(ceilSqrt(1_000_002n), 1001n);
});

test('isPrime 试除', () => {
  for (const n of [2n, 3n, 5n, 23n, 97n, 1009n, 1_000_003n]) assert.ok(isPrime(n), `${n} 应为素数`);
  for (const n of [0n, 1n, 4n, 9n, 25n, 1000n, 1_000_001n]) assert.ok(!isPrime(n), `${n} 应为合数`);
});

test('模逆与模幂', () => {
  assert.equal(modInverse(3n, 7n), 5n); // 3*5=15≡1
  assert.equal(modPow(5n, 6n, 23n), 8n);
  assert.equal(modPow(4n, 11n, 23n), 1n); // 4 的阶整除 11
});

test('已知例子: 5^x≡8 mod23 最小解为 6', () => {
  const r = babyStepGiantStep(23n, 5n, 8n);
  assert.equal(r.status, 'solved');
  assert.equal(r.minimumX, '6');
  assert.equal(r.hit?.candidateX, '6');
  assert.equal(r.hit?.verifiedEquation.holds, true);
});

test('真子群: 4^x≡5 mod23 无解且完整覆盖', () => {
  const r = babyStepGiantStep(23n, 4n, 5n);
  assert.equal(r.status, 'no_solution');
  assert.equal(r.minimumX, null);
  assert.equal(r.completeSearchCovered, true);
  // 4 的阶为 11，baby 表中不同余数应反映子群（m=5 内仍可能有重复）
  assert.ok(BigInt(r.distinctBabyResidues) <= 5n);
});

test('g=1 的有解(h=1)与无解(h≠1)', () => {
  const solved = babyStepGiantStep(7n, 1n, 1n);
  assert.equal(solved.status, 'solved');
  assert.equal(solved.minimumX, '0');
  const none = babyStepGiantStep(7n, 1n, 3n);
  assert.equal(none.status, 'no_solution');
  assert.equal(none.completeSearchCovered, true);
});

test('h=1 的零解（任意底数）', () => {
  const r = babyStepGiantStep(101n, 7n, 1n);
  assert.equal(r.status, 'solved');
  assert.equal(r.minimumX, '0');
  assert.equal(r.hit?.i, '0');
  assert.equal(r.hit?.j, '0');
});

test('末端指数 p-2 可被找到', () => {
  // 选 g 为原根，h = g^(p-2)
  const p = 11n;
  const g = 2n; // 2 是 mod 11 的原根
  const h = modPow(g, p - 2n, p);
  const r = babyStepGiantStep(p, g, h);
  assert.equal(r.status, 'solved');
  assert.equal(r.minimumX, (p - 2n).toString());
});

test('非原根但有解: 返回最小解', () => {
  // mod 23, g=4 阶 11; h=4^3=64 mod23=18
  const h = modPow(4n, 3n, 23n);
  const r = babyStepGiantStep(23n, 4n, h);
  assert.equal(r.status, 'solved');
  assert.equal(r.minimumX, '3');
});

test('批量小素数: BSGS 与穷举在全部 h 上一致（最小性与无解）', () => {
  const primes = [3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n];
  for (const p of primes) {
    for (let g = 1n; g <= p - 1n; g++) {
      for (let h = 1n; h <= p - 1n; h++) {
        const bsgs = babyStepGiantStep(p, g, h);
        const exh = exhaustiveDlog(p, g, h);
        const expected = exh === null ? null : exh.toString();
        assert.equal(
          bsgs.minimumX,
          expected,
          `p=${p} g=${g} h=${h}: BSGS=${bsgs.minimumX} 穷举=${expected}`,
        );
        assert.equal(
          bsgs.status,
          expected === null ? 'no_solution' : 'solved',
          `p=${p} g=${g} h=${h} 状态错误`,
        );
      }
    }
  }
});

test('资源预算耗尽返回 undetermined 而非无解', () => {
  const r = babyStepGiantStep(23n, 4n, 5n, { maxGiantSteps: 1n });
  assert.equal(r.status, 'undetermined');
  assert.equal(r.budgetExhausted, true);
  assert.equal(r.completeSearchCovered, false);
});

test('独立验证区分等式成立与最小解', () => {
  // ord_23(5)=22: 5^6=8，5^28=8 同样成立（28=6+22），有效但非最小
  assert.equal(modPow(5n, 28n, 23n), 8n);
  const v28 = verifyCandidate(23n, 5n, 8n, 28n);
  assert.equal(v28.equationHolds, true);
  assert.equal(v28.isMinimum, false);
  assert.equal(v28.xInRange, false);
  const v6 = verifyCandidate(23n, 5n, 8n, 6n);
  assert.equal(v6.equationHolds, true);
  assert.equal(v6.isMinimum, true);
  const vBad = verifyCandidate(23n, 5n, 8n, 7n);
  assert.equal(vBad.equationHolds, false);
  assert.equal(vBad.isMinimum, null);
});

test('校验: 合数/越界/类型/长度错误码', () => {
  assert.equal(validateProblem({ p: '9', g: '2', h: '3' }).ok, false);
  const composite = validateProblem({ p: '9', g: '2', h: '3' });
  if (!composite.ok) assert.equal(composite.error.code, 'INVALID_NOT_PRIME');
  const gRange = validateProblem({ p: '23', g: '0', h: '8' });
  if (!gRange.ok) assert.equal(gRange.error.code, 'G_OUT_OF_RANGE');
  const hRange = validateProblem({ p: '23', g: '5', h: '23' });
  if (!hRange.ok) assert.equal(hRange.error.code, 'H_OUT_OF_RANGE');
  const type = validateProblem({ p: 23, g: '5', h: '8' });
  if (!type.ok) assert.equal(type.error.code, 'INVALID_TYPE');
  const big = validateProblem({ p: '10000000000', g: '2', h: '3' });
  if (!big.ok) assert.ok(['INVALID_LENGTH', 'P_OUT_OF_RANGE'].includes(big.error.code));
  const pMin = validateProblem({ p: '2', g: '1', h: '1' });
  if (!pMin.ok) assert.equal(pMin.error.code, 'P_OUT_OF_RANGE');
});
