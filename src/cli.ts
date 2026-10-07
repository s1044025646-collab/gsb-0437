#!/usr/bin/env node
import { resolve } from 'node:path';
import { runBsgs, verifyCandidate } from './bsgs.js';
import { bruteForceDlog, isPrime } from './bigmath.js';
import { parseDecimal, validateParams, ValidationError } from './validation.js';
import { Store } from './store.js';

const DATA_DIR = resolve(process.cwd(), 'data');

function usage(): void {
  console.log(`用法:
  dlog search --p 23 --g 5 --h 8 [--max-baby N] [--max-giant N] [--sample N]
                               执行 BSGS 搜索并打印碰撞见证（不落库）
  dlog save   --p 23 --g 5 --h 8                    保存问题到 SQLite
  dlog verify --p 23 --g 5 --h 8 --x 6             独立核验候选指数
  dlog steps  --id 12                               查询已保存报告的碰撞步骤并复查
  dlog list                                          列出最近报告
  dlog compare --key <problemKey>                   比较同一问题版本
  dlog export  --id 12                              导出完整 JSON 见证包
  dlog brute   --p 23 --g 5 --h 8                   穷举基准（仅小规模对照）
  dlog demo                                          教学演示（成功/真子群无解/候选核验/折中对比）
  dlog help

所有整数均以十进制字符串传入，内部使用 BigInt 精确运算。`);
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function paramsFromFlags(args: string[]) {
  const params = validateParams({
    p: arg(args, 'p'),
    g: arg(args, 'g'),
    h: arg(args, 'h'),
  });
  if (!isPrime(params.p)) {
    throw Object.assign(new Error(`p=${params.p} 不是素数`), { code: 'P_NOT_PRIME' });
  }
  return params;
}

function printResult(title: string, r: ReturnType<typeof runBsgs>): void {
  console.log(`\n=== ${title} ===`);
  console.log(`参数: p=${r.p}, g=${r.g}, h=${r.h}`);
  console.log(`状态: ${r.status}（${r.note}）`);
  console.log(`m=ceil(sqrt(p-1))=${r.m}，baby 表条目=${r.babyStepsBuilt}，不同余数=${r.distinctBabyResidues}，giant 步数=${r.giantSteps}`);
  console.log(`搜索范围 ${r.range}，完整覆盖=${r.fullyCovered}，算法版本=${r.algorithmVersion}`);
  if (r.hit) {
    console.log(`命中: i=${r.hit.i}, j=${r.hit.j}, 余数=${r.hit.residue}, x=${r.hit.x}`);
    console.log(`验证等式: ${r.equation}`);
  }
  console.log(`baby 样例(前${r.babySample.length}条, 截断=${r.truncated.baby}):`,
    r.babySample.map((e) => `g^${e.index}=${e.residue}`).join(', '));
  console.log(`giant 样例(前${r.giantSample.length}条, 截断=${r.truncated.giant}):`,
    r.giantSample.map((e) => `h*g^(-${e.index}m)=${e.residue}`).join(', '));
}

function cmdSearch(args: string[]): void {
  const params = paramsFromFlags(args);
  const budget = {
    maxBabyEntries: arg(args, 'max-baby') ? Number(arg(args, 'max-baby')) : undefined,
    maxGiantSteps: arg(args, 'max-giant') ? Number(arg(args, 'max-giant')) : undefined,
  };
  const sample = arg(args, 'sample') ? Number(arg(args, 'sample')) : 10;
  const r = runBsgs(params, budget, sample);
  printResult('BSGS 搜索', r);
}

function cmdBrute(args: string[]): void {
  const params = paramsFromFlags(args);
  const { x, tested, exhausted } = bruteForceDlog(params.g, params.h, params.p);
  console.log(`穷举基准: ${exhausted ? '已完整覆盖 [0,p-2]' : '预算内未覆盖'}`);
  console.log(x === null ? '无解（完整范围内 g^x ≠ h）' : `最小解 x=${x}`);
  console.log(`共测试指数 ${tested} 个（BSGS 的 m≈${Math.ceil(Math.sqrt(Number(params.p - 1n)))}，体现平方根优势）`);
}

function cmdVerify(args: string[]): void {
  const params = paramsFromFlags(args);
  const x = parseDecimal('x', arg(args, 'x'));
  const v = verifyCandidate(params, x);
  console.log(`\n=== 独立候选核验 ===`);
  console.log(`等式: ${v.equation}`);
  console.log(`满足等式(satisfied)=${v.satisfied}`);
  console.log(`已证实最小(minimal)=${v.minimal}`, v.satisfied && !v.minimal ? '（有效但不是最小非负解）' : '');
}

function withStore<T>(fn: (store: Store) => T): T {
  const store = new Store(resolve(DATA_DIR, 'dlog.sqlite'));
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

function cmdSave(args: string[]): void {
  const params = paramsFromFlags(args);
  withStore((store) => {
    const saved = store.saveReport(
      JSON.stringify({ p: params.p.toString(), g: params.g.toString(), h: params.h.toString() }),
      params.p.toString(),
      params.g.toString(),
      params.h.toString(),
      {},
      null
    );
    console.log(`已保存问题 id=${saved.id} key=${saved.problemKey} version=${saved.version}`);
  });
}

function cmdSteps(args: string[]): void {
  const id = Number(arg(args, 'id'));
  withStore((store) => {
    const saved = store.getById(id);
    if (!saved) throw new Error(`报告 id=${id} 不存在`);
    if (!saved.result) {
      console.log('该问题仅保存，尚未执行 /search');
      return;
    }
    const r = JSON.parse(saved.result) as ReturnType<typeof runBsgs>;
    printResult(`报告 #${saved.id}（${saved.algorithmVersion}）`, r);
    console.log('复查:', store.recheck(saved));
  });
}

function cmdList(): void {
  withStore((store) => {
    for (const s of store.list(20)) {
      console.log(`#${s.id} v${s.version} [${s.status}] p=${s.p} g=${s.g} h=${s.h} ${s.createdAt} key=${s.problemKey}`);
    }
  });
}

function cmdCompare(args: string[]): void {
  const key = arg(args, 'key');
  if (!key) throw new ValidationError('MISSING_KEY', '需要 --key');
  withStore((store) => {
    const versions = store.listByProblem(key);
    if (versions.length === 0) throw new Error('未找到该问题');
    console.log(`问题 ${key} 共 ${versions.length} 个版本:`);
    for (const v of versions) {
      const r = v.result ? (JSON.parse(v.result) as ReturnType<typeof runBsgs>) : null;
      console.log(
        `  #${v.id} v${v.version} [${v.status}] ${v.algorithmVersion} ${v.createdAt}` +
          (r?.hit ? ` x=${r.hit.x}` : '') +
          (r ? ` 表=${r.babyStepsBuilt} 步=${r.giantSteps}` : '')
      );
    }
  });
}

function cmdExport(args: string[]): void {
  const id = Number(arg(args, 'id'));
  withStore((store) => {
    const saved = store.getById(id);
    if (!saved) throw new Error(`报告 id=${id} 不存在`);
    console.log(JSON.stringify({ report: saved, result: saved.result ? JSON.parse(saved.result) : null, recheck: store.recheck(saved) }, null, 2));
  });
}

// 教学演示：成功碰撞、真子群无解、独立候选核验、穷举与 BSGS 的时空折中对比。
function cmdDemo(): void {
  console.log('########################################################');
  console.log('# Baby-step Giant-step 离散对数教学演示（小素数域）  #');
  console.log('########################################################');

  // 1) 经典成功例子 p=23,g=5,h=8 -> x=6
  const r1 = runBsgs({ p: 23n, g: 5n, h: 8n }, {}, 12);
  printResult('成功碰撞: 5^x ≡ 8 (mod 23)', r1);
  const b1 = bruteForceDlog(5n, 8n, 23n);
  console.log(`>> 时空折中: BSGS 表大小 m=${r1.m}、giant 步=${r1.giantSteps}（合计 O(sqrt n)）；穷举测试到第 ${b1.tested} 个指数才命中。`);

  // 2) 真子群无解 p=23,g=4,h=5
  const r2 = runBsgs({ p: 23n, g: 4n, h: 5n }, {}, 12);
  printResult('真子群无解: 4^x ≡ 5 (mod 23)', r2);
  console.log('>> g=4 mod 23 的阶为 11（真子群），只覆盖一半非零元素，h=5 不在其中。');

  // 3) 边界：h=1 零解；g=1
  printResult('零解: g^0 = 1', runBsgs({ p: 23n, g: 5n, h: 1n }, {}, 5));
  printResult('g=1 有解 (h=1)', runBsgs({ p: 23n, g: 1n, h: 1n }, {}, 5));
  printResult('g=1 无解 (h=2)', runBsgs({ p: 23n, g: 1n, h: 2n }, {}, 5));

  // 4) 独立候选核验：有效但非最小 vs 最小
  const vBad = verifyCandidate({ p: 23n, g: 1n, h: 1n }, 5n); // 成立但最小解是 0
  const vGood = verifyCandidate({ p: 23n, g: 5n, h: 8n }, 6n);
  console.log(`\n=== 候选核验对比 ===`);
  console.log(`p=23,g=1,h=1,x=5: satisfied=${vBad.satisfied}, minimal=${vBad.minimal}（等式成立但最小解是 0，不能见有效指数就称最小）`);
  console.log(`x=6 : satisfied=${vGood.satisfied}, minimal=${vGood.minimal}`);

  // 5) 预算耗尽 -> undetermined
  const r5 = runBsgs({ p: 23n, g: 5n, h: 8n }, { maxBabyEntries: 2, maxGiantSteps: 2 }, 5);
  printResult('预算耗尽（演示未确定，不得冒充无解）', r5);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'search': return cmdSearch(rest);
      case 'brute': return cmdBrute(rest);
      case 'verify': return cmdVerify(rest);
      case 'save': return cmdSave(rest);
      case 'steps': return cmdSteps(rest);
      case 'list': return cmdList();
      case 'compare': return cmdCompare(rest);
      case 'export': return cmdExport(rest);
      case 'demo': return cmdDemo();
      default: usage();
    }
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error(`错误[${e.code ?? 'ERROR'}]: ${e.message}`);
    process.exitCode = 1;
  }
}

main();
