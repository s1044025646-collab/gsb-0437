import { isDecimalString, parseDecimal, isPrime } from './bigint-utils.js';

// 题目声明的参数上限（教学用虚构小参数）
export const P_MIN = 3n;
export const P_MAX = 1_000_003n;
// 十进制字符串长度上限（p/h 等不会超过 7 位，预留余量到 10 位）
export const MAX_DECIMAL_LENGTH = 10;
// baby 表最大允许规模（ceil(sqrt(p-1))，p 上限时约为 1001）
export const MAX_TABLE_SIZE = 1002n;

export interface ValidatedProblem {
  p: bigint;
  g: bigint;
  h: bigint;
}

export interface ValidationError {
  code: string;
  message: string;
}

/**
 * 校验输入三元组。成功返回 BigInt 参数，失败返回错误码与中文说明。
 */
export function validateProblem(input: {
  p?: unknown;
  g?: unknown;
  h?: unknown;
}): { ok: true; value: ValidatedProblem } | { ok: false; error: ValidationError } {
  const { p: rawP, g: rawG, h: rawH } = input;

  for (const [name, v] of [
    ['p', rawP],
    ['g', rawG],
    ['h', rawH],
  ] as const) {
    if (typeof v !== 'string') {
      return {
        ok: false,
        error: { code: 'INVALID_TYPE', message: `参数 ${name} 必须为十进制字符串` },
      };
    }
    if (v.length === 0 || v.length > MAX_DECIMAL_LENGTH) {
      return {
        ok: false,
        error: {
          code: 'INVALID_LENGTH',
          message: `参数 ${name} 长度必须在 1 到 ${MAX_DECIMAL_LENGTH} 位之间（收到 ${v.length} 位）`,
        },
      };
    }
    if (!isDecimalString(v)) {
      return {
        ok: false,
        error: { code: 'INVALID_NUMBER', message: `参数 ${name} 不是合法十进制整数: ${v}` },
      };
    }
  }

  const p = parseDecimal(rawP as string);
  const g = parseDecimal(rawG as string);
  const h = parseDecimal(rawH as string);

  if (p < P_MIN || p > P_MAX) {
    return {
      ok: false,
      error: {
        code: 'P_OUT_OF_RANGE',
        message: `素数 p 必须在 ${P_MIN} 到 ${P_MAX} 之间（收到 ${p}）`,
      },
    };
  }
  if (!isPrime(p)) {
    return {
      ok: false,
      error: { code: 'INVALID_NOT_PRIME', message: `p = ${p} 不是素数，本服务仅处理素数域` },
    };
  }
  if (g < 1n || g > p - 1n) {
    return {
      ok: false,
      error: {
        code: 'G_OUT_OF_RANGE',
        message: `底数 g 必须在 1 到 p-1 = ${p - 1n} 之间（收到 ${g}）`,
      },
    };
  }
  if (h < 1n || h > p - 1n) {
    return {
      ok: false,
      error: {
        code: 'H_OUT_OF_RANGE',
        message: `目标 h 必须在 1 到 p-1 = ${p - 1n} 之间（收到 ${h}）`,
      },
    };
  }

  return { ok: true, value: { p, g, h } };
}
