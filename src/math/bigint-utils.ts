// 精确的 BigInt 工具函数：所有整数运算均不经过 Number，避免精度损失。

/** 判断一个十进制字符串是否为合法的非负/负整数字面量 */
export function isDecimalString(s: unknown): s is string {
  return typeof s === 'string' && /^-?\d+$/.test(s) && s.trim() === s;
}

/**
 * 解析十进制字符串为 BigInt。
 * 调用前应先用 isDecimalString 校验；非法输入抛出 Error。
 */
export function parseDecimal(s: string): bigint {
  if (!isDecimalString(s)) {
    throw new Error(`非法十进制整数: ${String(s)}`);
  }
  return BigInt(s);
}

/** 大整数绝对值 */
export function bnAbs(a: bigint): bigint {
  return a < 0n ? -a : a;
}

/**
 * 扩展欧几里得算法。
 * 返回 { gcd, x, y } 满足 a*x + b*y = gcd(a,b)。
 */
export function extendedGcd(
  a: bigint,
  b: bigint,
): { gcd: bigint; x: bigint; y: bigint } {
  let oldR = a;
  let r = b;
  let oldS = 1n;
  let s = 0n;
  let oldT = 0n;
  let t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return { gcd: oldR, x: oldS, y: oldT };
}

/**
 * 模逆：返回 a^-1 mod m（m>1，且 gcd(a,m)=1）。
 * 不存在模逆时抛出 Error。
 */
export function modInverse(a: bigint, m: bigint): bigint {
  const reduced = ((a % m) + m) % m;
  const { gcd, x } = extendedGcd(reduced, m);
  if (gcd !== 1n) {
    throw new Error(`模逆不存在: gcd(${reduced}, ${m}) = ${gcd}`);
  }
  return ((x % m) + m) % m;
}

/** 非负取模 */
export function modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
  if (modulus <= 0n) throw new Error('模必须为正整数');
  let result = 1n % modulus;
  let b = ((base % modulus) + modulus) % modulus;
  let e = exp;
  if (e < 0n) {
    b = modInverse(b, modulus);
    e = -e;
  }
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * 计算 ceilSqrt(n)：满足 r^2 >= n 的最小非负整数 r。
 * 使用 BigInt 牛顿迭代，不转 Number。
 */
export function ceilSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('sqrt 输入必须非负');
  if (n === 0n) return 0n;
  if (n < 2n) return n;
  // 初始值用位移做纯 BigInt 估算：2^ceil(bitlen/2)
  const bitLen = BigInt(n.toString(2).length);
  let r = 1n << ((bitLen + 1n) / 2n);
  for (;;) {
    const next = (r + n / r) / 2n;
    if (next >= r) break;
    r = next;
  }
  // r 此时为 floorSqrt 附近，修正为 ceil
  if (r * r < n) r += 1n;
  return r;
}

/** 试除法素性检测（教学规模 p <= 1_000_003 足够快） */
export function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  if (n < 4n) return true;
  if ((n & 1n) === 0n) return n === 2n;
  if (n % 3n === 0n) return n === 3n;
  // 6k +/- 1 试除到 sqrt(n)
  let d = 5n;
  while (d * d <= n) {
    if (n % d === 0n || n % (d + 2n) === 0n) return false;
    d += 6n;
  }
  return true;
}
