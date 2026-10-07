// 全部核心运算使用 BigInt，绝不把输入整数悄悄转成 Number。

export function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

// 扩展欧几里得算法，返回 gcd(a,b) 与 x、y，满足 a*x + b*y = gcd
export function extendedGcd(a: bigint, b: bigint): { g: bigint; x: bigint; y: bigint } {
  let [oldR, r] = [a, b];
  let [oldS, s] = [1n, 0n];
  let [oldT, t] = [0n, 1n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return { g: oldR, x: oldS, y: oldT };
}

// a 在模 m 下的乘法逆元；不存在时抛出
export function modInverse(a: bigint, m: bigint): bigint {
  const { g, x } = extendedGcd(mod(a, m), m);
  if (g !== 1n) {
    throw new Error(`模逆不存在: gcd(${a}, ${m}) = ${g}`);
  }
  return mod(x, m);
}

// 模幂 (base^exp mod modu)，exp 必须非负。平方-乘实现。
export function modPow(base: bigint, exp: bigint, modu: bigint): bigint {
  if (exp < 0n) throw new Error('modPow 仅支持非负指数');
  let result = 1n % modu;
  let b = mod(base, modu);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modu;
    e >>= 1n;
    if (e > 0n) b = (b * b) % modu;
  }
  return result;
}

// 试除法素性检查（本题 p ≤ 1,000,003，完全够用）。
export function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  if (n % 2n === 0n) return n === 2n;
  if (n % 3n === 0n) return n === 3n;
  // 6k±1 试除到 sqrt(n)
  let i = 5n;
  while (i * i <= n) {
    if (n % i === 0n || n % (i + 2n) === 0n) return false;
    i += 6n;
  }
  return true;
}

// ceil(sqrt(n))，纯 BigInt 牛顿迭代，避免 Number 精度问题。
export function ceilSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('ceilSqrt 不支持负数');
  if (n < 2n) return n;
  // 初始值：用位长得到 2^ceil(bitlen/2)
  const bits = n.toString(2).length;
  let x = 1n << BigInt(Math.ceil(bits / 2));
  // 向下收敛到 floor(sqrt(n))
  while (true) {
    const y = (x + n / x) / 2n;
    if (y >= x) break;
    x = y;
  }
  return x * x >= n ? x : x + 1n;
}

// 小素数穷举基准（仅测试/对照用，正式服务不得用它代替 BSGS）。
// 返回最小非负解，或在完整范围 [0, p-2] 均无解时返回 null。
export function bruteForceDlog(
  g: bigint,
  h: bigint,
  p: bigint,
  budget?: { maxExponents?: number }
): { x: bigint | null; tested: number; exhausted: boolean } {
  const upper = p - 2n;
  let cur = 1n;
  let tested = 0;
  for (let x = 0n; x <= upper; x++) {
    if (cur === h) return { x, tested, exhausted: true };
    cur = (cur * g) % p;
 tested++;
    if (budget?.maxExponents !== undefined && tested >= budget.maxExponents) {
      return { x: null, tested, exhausted: false };
    }
  }
  return { x: null, tested, exhausted: true };
}
