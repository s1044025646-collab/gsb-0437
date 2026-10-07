import { ALGORITHM_VERSION, LIMITS } from './constants.js';
import { ceilSqrt, mod, modInverse, modPow } from './bigmath.js';
import type { BudgetInput, DlogParams } from './validation.js';

export interface TraceEntry {
  index: number;
  residue: string; // 余数（十进制字符串）
}

export interface BsgsResult {
  status: 'found' | 'no_solution' | 'undetermined';
  p: string;
  g: string;
  h: string;
  m: number;
  distinctBabyResidues: number;
  babyStepsBuilt: number;
  giantSteps: number;
  hit: { i: number; j: number; residue: string; x: string } | null;
  equation: string | null; // 重新模幂验证等式
  range: string; // 搜索指数范围
  fullyCovered: boolean; // 是否覆盖完整 [0, p-2]
  babySample: TraceEntry[];
  giantSample: TraceEntry[];
  truncated: { baby: boolean; giant: boolean };
  budget: { maxBabyEntries: number | null; maxGiantSteps: number | null };
  note: string;
  algorithmVersion: string;
}

function toResidue(v: bigint): string {
  return v.toString();
}

// 在指定预算下执行 BSGS。预算耗尽时返回 undetermined，绝不冒充无解。
export function runBsgs(
  params: DlogParams,
  budget: BudgetInput = {},
  sampleSize = 10
): BsgsResult {
  const { p, g, h } = params;
  const orderBound = p - 1n; // 群阶上界
  const mBig = ceilSqrt(orderBound);
  const m = Number(mBig);

  if (m > LIMITS.MAX_TABLE) {
    // 在分配表之前拒绝超规模
    throw Object.assign(new Error(`计算规模超过上限 m=${m}`), { code: 'SCALE_TOO_LARGE' });
  }

  const maxBaby = Math.min(
    budget.maxBabyEntries ?? m,
    m
  );
  const maxGiant = budget.maxGiantSteps ?? m;

  // Baby 表： residue -> 最小下标 j（重复余数保留最小 j，不能覆盖丢失最小解）
  const baby = new Map<bigint, number>();
  let gj = 1n; // g^0
  for (let j = 0; j < maxBaby; j++) {
    if (!baby.has(gj)) baby.set(gj, j);
    gj = (gj * g) % p;
  }
  const babyBuilt = maxBaby;
  const fullBaby = babyBuilt === m;

  // gamma = g^{-m} mod p；giant 值 gamma_i = h * gamma^i = h * g^{-i*m}
  const gamma = mod(modInverse(modPow(g, mBig, p), p), p);

  let gammaI = h % p;
  let giantSteps = 0;
  let hit: BsgsResult['hit'] = null;
  const giantTrace: TraceEntry[] = [];

  for (let i = 0; i < maxGiant; i++) {
    giantSteps = i + 1;
    if (giantTrace.length < sampleSize) {
      giantTrace.push({ index: i, residue: toResidue(gammaI) });
    }
    const j = baby.get(gammaI);
    if (j !== undefined) {
      const x = BigInt(i) * mBig + BigInt(j);
      if (x >= 0n && x <= p - 2n) {
        hit = { i, j, residue: toResidue(gammaI), x: toResidue(x) };
        break;
      }
      // x 超范围：继续后续 i（理论上首个有效碰撞即最小，但这里不做额外假设）
    }
    gammaI = (gammaI * gamma) % p;
  }

  // baby 采样（取前若干条，按 j 升序）
  const babySample: TraceEntry[] = [];
  let sampleCollected = 0;
  for (const [residue, j] of baby) {
    if (j < sampleSize) {
      babySample.push({ index: j, residue: toResidue(residue) });
      sampleCollected++;
    }
    if (sampleCollected >= sampleSize) break;
  }
  babySample.sort((a, b) => a.index - b.index);

  // 覆盖性：满 baby 表 + m 个 giant 覆盖 [0, m^2-1] ⊇ [0, p-2]
  const fullGiant = giantSteps >= m || (hit !== null);
  const fullyCovered = fullBaby && (fullGiant || hit !== null);

  let status: BsgsResult['status'];
  let equation: string | null = null;
  let note: string;

  if (hit) {
    const x = BigInt(hit.x);
    const check = modPow(g, x, p);
    if (check !== h) {
      // 见证不通过：不报告找到
      status = 'undetermined';
      note = '碰撞候选未通过独立模幂验证';
      hit = null;
    } else {
      status = 'found';
      equation = `${g}^${x} mod ${p} = ${check} = h(${h})`;
      note = '碰撞命中且已通过模幂重新验证；baby 表对重复余数保留最小下标，故该解为最小非负解。';
    }
  } else if (fullBaby && giantSteps >= m) {
    status = 'no_solution';
    note = '完整 baby 表与全部 m 个 giant 步均无碰撞，指数范围 [0, p-2] 内不存在解（可能 g 仅生成真子群）。';
  } else {
    status = 'undetermined';
    note = '资源预算在覆盖完整搜索范围前耗尽，结果未确定，不能据此断言无解。';
  }

  return {
    status,
    p: toResidue(p),
    g: toResidue(g),
    h: toResidue(h),
    m,
    distinctBabyResidues: baby.size,
    babyStepsBuilt: babyBuilt,
    giantSteps,
    hit,
    equation,
    range: `[0, ${toResidue(p - 2n)}]`,
    fullyCovered,
    babySample,
    giantSample: giantTrace.slice(0, sampleSize),
    truncated: {
      baby: baby.size > babySample.length,
      giant: giantSteps > giantTrace.length,
    },
    budget: {
      maxBabyEntries: budget.maxBabyEntries ?? null,
      maxGiantSteps: budget.maxGiantSteps ?? null,
    },
    note,
    algorithmVersion: ALGORITHM_VERSION,
  };
}

// 独立核验用户给定指数 x：直接计算 g^x mod p。
// satisfied = 等式成立；minimal = 等式成立且 [0, x-1] 内不存在更小解（需完整 BSGS 支撑）。
export function verifyCandidate(
  params: DlogParams,
  xBig: bigint
): {
  satisfied: boolean;
  minimal: boolean;
  x: string;
  computed: string;
  equation: string;
  minimalProof: BsgsResult | null;
} {
  const { p, g, h } = params;
  if (xBig < 0n || xBig > p - 2n) {
    throw Object.assign(new Error('x 超出允许指数范围 [0, p-2]'), { code: 'X_OUT_OF_RANGE' });
  }
  const computed = modPow(g, xBig, p);
  const satisfied = computed === h;
  let minimal = false;
  let minimalProof: BsgsResult | null = null;
  if (satisfied) {
    if (xBig === 0n) {
      minimal = true;
    } else {
      // 用完整 BSGS 找出最小解进行比对
      minimalProof = runBsgs(params, {}, 1);
      if (minimalProof.status === 'found' && minimalProof.hit) {
        minimal = BigInt(minimalProof.hit.x) === xBig;
      }
    }
  }
  return {
    satisfied,
    minimal,
    x: xBig.toString(),
    computed: computed.toString(),
    equation: `${g}^${xBig} mod ${p} = ${computed} (h=${h})`,
    minimalProof,
  };
}
