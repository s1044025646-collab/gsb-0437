import { ceilSqrt, modInverse, modPow } from './bigint-utils.js';
import { MAX_TABLE_SIZE } from './validation.js';

export const ALGORITHM_VERSION = 'bsgs-v1.0.0';

/** 单项 baby/giant 见证（全部以十进制字符串表示） */
export interface StepItem {
  index: string; // 下标（baby 为 j，giant 为 i）
  residue: string; // 余数（十进制字符串）
}

export interface BabyItem extends StepItem {
  j: string;
  value: string; // g^j mod p
}

export interface GiantItem extends StepItem {
  i: string;
  value: string; // h * (g^-m)^i mod p
}

export interface SearchBudget {
  /** 最多构建多少个 baby 项（默认完整 m） */
  maxBabySteps?: bigint;
  /** 最多执行多少个 giant 步（默认完整 m） */
  maxGiantSteps?: bigint;
  /** 报告中最多附带多少 baby / giant 项（仅影响展示，不影响搜索） */
  previewLimit?: number;
}

export interface HitWitness {
  i: string;
  j: string;
  residue: string;
  candidateX: string;
  verifiedEquation: {
    base: string;
    exponent: string;
    modulus: string;
    computed: string;
    target: string;
    holds: boolean;
  };
}

export type SearchStatus = 'solved' | 'no_solution' | 'undetermined';

export interface BsgsReport {
  algorithmVersion: string;
  status: SearchStatus;
  p: string;
  g: string;
  h: string;
  orderBound: string; // p-1
  searchRange: { min: string; max: string }; // [0, p-2]
  m: string; // ceil(sqrt(p-1))
  distinctBabyResidues: string;
  babyStepsBuilt: string;
  giantStepsTaken: string;
  babyTable: {
    total: string;
    truncated: boolean;
    items: BabyItem[];
  };
  giantTrace: {
    total: string;
    truncated: boolean;
    items: GiantItem[];
  };
  hit: HitWitness | null;
  minimumX: string | null;
  completeSearchCovered: boolean; // 是否覆盖了算法所需的完整范围
  budgetExhausted: boolean;
  note: string;
}

/**
 * Baby-step Giant-step 离散对数搜索。
 *
 * 在 [0, p-2] 内寻找满足 g^x ≡ h (mod p) 的最小 x。
 * m = ceil(sqrt(p-1))。
 * baby 表：value = g^j mod p，j ∈ [0, m-1]，重复余数保留最小 j。
 * giant 序列：value_i = h * (g^-m)^i mod p；
 *   命中 value_i = g^j 时 x = i*m + j。
 *
 * 不假设 g 为原根；枚举全部候选并重新模幂验证，取最小合法 x。
 */
export function babyStepGiantStep(
  p: bigint,
  g: bigint,
  h: bigint,
  budget: SearchBudget = {},
): BsgsReport {
  const orderBound = p - 1n; // 指数搜索上界 p-2，循环群阶不超过 p-1
  const xMin = 0n;
  const xMax = p - 2n;
  const m = ceilSqrt(orderBound);

  if (m > MAX_TABLE_SIZE) {
    // 在分配表之前拒绝超限规模
    throw new Error(
      `计算规模超限: m = ${m} 超过上限 ${MAX_TABLE_SIZE}，拒绝分配 baby 表`,
    );
  }

  const maxBaby = budget.maxBabySteps ?? m;
  const maxGiant = budget.maxGiantSteps ?? m;
  const previewLimit = budget.previewLimit ?? 20;

  // ---------- baby 阶段 ----------
  // Map<余数字符串, 最小 j>
  const baby = new Map<string, bigint>();
  const babyBuilt = maxBaby < m ? maxBaby : m;
  let cur = 1n % p; // g^0
  for (let j = 0n; j < babyBuilt; j++) {
    const key = cur.toString();
    if (!baby.has(key)) {
      baby.set(key, j); // 重复余数保留最小下标（不覆盖）
    }
    cur = (cur * g) % p;
  }

  // ---------- giant 阶段 ----------
  // factor = g^(-m) mod p
  const gInvM = modInverse(modPow(g, m, p), p);
  let gamma = h % p; // giant 起点 h（i=0）
  const giantItemsFull: GiantItem[] = [];

  let bestX: bigint | null = null;
  let hitWitness: HitWitness | null = null;
  let giantTaken = 0n;
  let budgetExhausted = false;

  // giant i 取值范围 [0, m-1] 即可覆盖 x ∈ [0, m^2-1]，
  // 而 m^2 >= p-1，故完整覆盖 [0, p-2]。
  for (let i = 0n; i < m; i++) {
    if (i >= maxGiant) {
      budgetExhausted = true;
      break;
    }
    giantTaken = i + 1n;
    const key = gamma.toString();
    giantItemsFull.push({
      i: i.toString(),
      index: i.toString(),
      value: key,
      residue: key,
    });

    const jOpt = baby.get(key);
    if (jOpt !== undefined) {
      const candidate = i * m + jOpt;
      // 候选必须落在 [0, p-2] 内
      if (candidate >= xMin && candidate <= xMax) {
        const computed = modPow(g, candidate, p);
        const holds = computed === ((h % p) + p) % p;
        if (holds && (bestX === null || candidate < bestX)) {
          bestX = candidate;
          hitWitness = {
            i: i.toString(),
            j: jOpt.toString(),
            residue: key,
            candidateX: candidate.toString(),
            verifiedEquation: {
              base: g.toString(),
              exponent: candidate.toString(),
              modulus: p.toString(),
              computed: computed.toString(),
              target: h.toString(),
              holds,
            },
          };
        }
      }
    }
    gamma = (gamma * gInvM) % p;
  }

  const babyComplete = babyBuilt >= m;
  const giantComplete = giantTaken >= m && !budgetExhausted;
  const completeSearchCovered = babyComplete && giantComplete;

  let status: SearchStatus;
  let note: string;
  if (bestX !== null) {
    status = 'solved';
    note = `在 [0, ${xMax}] 内找到最小解 x = ${bestX}，已重新模幂验证。`;
  } else if (completeSearchCovered) {
    status = 'no_solution';
    note = `已覆盖完整搜索范围 [0, ${xMax}]（${m} 个 giant 步 × baby 表），不存在满足 g^x ≡ h (mod p) 的指数。`;
  } else {
    status = 'undetermined';
    note = '资源预算在覆盖完整搜索范围前耗尽，结果为未确定，不能宣称无解。';
  }

  const babyEntries: BabyItem[] = [];
  for (const [residue, j] of baby) {
    babyEntries.push({
      j: j.toString(),
      index: j.toString(),
      value: residue,
      residue,
    });
  }
  // 按下标排序，便于阅读
  babyEntries.sort((a, b) => Number(BigInt(a.j) - BigInt(b.j)));

  const babyTruncated = babyEntries.length > previewLimit;
  const giantTruncated = giantItemsFull.length > previewLimit;

  return {
    algorithmVersion: ALGORITHM_VERSION,
    status,
    p: p.toString(),
    g: g.toString(),
    h: h.toString(),
    orderBound: orderBound.toString(),
    searchRange: { min: xMin.toString(), max: xMax.toString() },
    m: m.toString(),
    distinctBabyResidues: BigInt(baby.size).toString(),
    babyStepsBuilt: babyBuilt.toString(),
    giantStepsTaken: giantTaken.toString(),
    babyTable: {
      total: BigInt(baby.size).toString(),
      truncated: babyTruncated,
      items: babyTruncated ? babyEntries.slice(0, previewLimit) : babyEntries,
    },
    giantTrace: {
      total: giantItemsFull.length.toString(),
      truncated: giantTruncated,
      items: giantTruncated
        ? giantItemsFull.slice(0, previewLimit)
        : giantItemsFull,
    },
    hit: hitWitness,
    minimumX: bestX === null ? null : bestX.toString(),
    completeSearchCovered,
    budgetExhausted,
    note,
  };
}

/**
 * 独立穷举基准（仅用于测试）：逐个指数检查 [0, p-2]。
 * 返回最小解或 null（无解）。不得用于正式求解。
 */
export function exhaustiveDlog(
  p: bigint,
  g: bigint,
  h: bigint,
): bigint | null {
  const target = ((h % p) + p) % p;
  let value = 1n % p;
  for (let x = 0n; x <= p - 2n; x++) {
    if (value === target) return x;
    value = (value * g) % p;
  }
  return null;
}

/**
 * 独立核验用户给出的指数 x：直接计算 g^x mod p。
 * 返回等式是否成立，以及（在完整 BSGS 搜索下）该 x 是否为最小解。
 */
export function verifyCandidate(
  p: bigint,
  g: bigint,
  h: bigint,
  x: bigint,
): {
  equationHolds: boolean;
  computed: string;
  target: string;
  xInRange: boolean;
  isMinimum: boolean | null; // null 表示无法仅凭本核验确认最小性
  minimumX: string | null;
} {
  const target = ((h % p) + p) % p;
  const xInRange = x >= 0n && x <= p - 2n;
  const computed = modPow(g, x, p);
  const equationHolds = computed === target;

  // 完整 BSGS 搜索以确定真正最小解
  const report = babyStepGiantStep(p, g, h);
  const minimumX =
    report.status === 'solved' && report.minimumX !== null
      ? report.minimumX
      : null;

  return {
    equationHolds,
    computed: computed.toString(),
    target: target.toString(),
    xInRange,
    isMinimum: equationHolds && minimumX !== null ? minimumX === x.toString() : null,
    minimumX,
  };
}
