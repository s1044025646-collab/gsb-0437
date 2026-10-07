import { LIMITS } from './constants.js';

export interface DlogParams {
  p: bigint;
  g: bigint;
  h: bigint;
}

export interface BudgetInput {
  maxBabyEntries?: number;
  maxGiantSteps?: number;
}

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

const DIGITS_RE = /^[0-9]+$/;

// 解析十进制字符串：拒绝空串、符号、空白、非 ASCII 数字与超长输入。
export function parseDecimal(name: string, raw: unknown): bigint {
  if (typeof raw !== 'string') {
    throw new ValidationError('INVALID_TYPE', `${name} 必须是十进制字符串`);
  }
  const s = raw;
  if (!DIGITS_RE.test(s)) {
    throw new ValidationError('INVALID_INTEGER', `${name} 必须是非负十进制整数字符串`);
  }
  if (s.length > LIMITS.MAX_DIGITS + 20) {
    throw new ValidationError('NUMBER_TOO_LONG', `${name} 数字长度超过上限 ${LIMITS.MAX_DIGITS} 位`);
  }
  let v: bigint;
  try {
    v = BigInt(s);
  } catch {
    throw new ValidationError('INVALID_INTEGER', `${name} 无法解析为整数`);
  }
  if (v.toString().length > LIMITS.MAX_DIGITS) {
    throw new ValidationError('NUMBER_TOO_LONG', `${name} 数字长度超过上限 ${LIMITS.MAX_DIGITS} 位`);
  }
  return v;
}

export function validateParams(input: { p?: unknown; g?: unknown; h?: unknown }): DlogParams {
  const p = parseDecimal('p', input.p);
  const g = parseDecimal('g', input.g);
  const h = parseDecimal('h', input.h);

  if (p < LIMITS.MIN_P || p > LIMITS.MAX_P) {
    throw new ValidationError(
      'P_OUT_OF_RANGE',
      `p 必须在 [${LIMITS.MIN_P}, ${LIMITS.MAX_P}] 之间`
    );
  }
  if (g < 1n || g > p - 1n) {
    throw new ValidationError('G_OUT_OF_RANGE', 'g 必须在 [1, p-1] 范围内');
  }
  if (h < 1n || h > p - 1n) {
    throw new ValidationError('H_OUT_OF_RANGE', 'h 必须在 [1, p-1] 范围内');
  }
  return { p, g, h };
}

export function validateBudget(raw: unknown): BudgetInput {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('INVALID_BUDGET', 'budget 必须是对象');
  }
  const b = raw as Record<string, unknown>;
  const out: BudgetInput = {};
  for (const key of ['maxBabyEntries', 'maxGiantSteps'] as const) {
    if (b[key] !== undefined) {
      if (typeof b[key] !== 'number' || !Number.isInteger(b[key]) || b[key] < 1) {
        throw new ValidationError('INVALID_BUDGET', `${key} 必须是正整数`);
      }
      if ((b[key] as number) > LIMITS.MAX_TABLE) {
        throw new ValidationError('BUDGET_TOO_LARGE', `${key} 超过上限 ${LIMITS.MAX_TABLE}`);
      }
      out[key] = b[key] as number;
    }
  }
  return out;
}
