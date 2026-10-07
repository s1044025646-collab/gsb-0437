import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Store } from './db/store.js';
import { DlogService } from './services/dlog-service.js';
import { validateProblem } from './math/validation.js';
import { babyStepGiantStep, exhaustiveDlog } from './math/bsgs.js';

const DATA_DIR = process.env.BSGS_DATA_DIR ?? join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'bsgs.sqlite');

function getService(): DlogService {
  return new DlogService(new Store(DB_PATH));
}

function printReport(label: string, report: ReturnType<typeof babyStepGiantStep>): void {
  console.log(`\n=== ${label} ===`);
  console.log(`问题: ${report.g}^x ≡ ${report.h} (mod ${report.p})`);
  console.log(`状态: ${report.status}`);
  console.log(`m = ceil(sqrt(p-1)) = ${report.m}`);
  console.log(`baby 表不同余数数: ${report.distinctBabyResidues}（实际构建 ${report.babyStepsBuilt} 项）`);
  console.log(`giant 步数: ${report.giantStepsTaken}`);
  if (report.hit) {
    console.log(
      `命中: i=${report.hit.i}, j=${report.hit.j}, 余数=${report.hit.residue}, x=i*m+j=${report.hit.candidateX}`,
    );
    const eq = report.hit.verifiedEquation;
    console.log(`验证: ${eq.base}^${eq.exponent} mod ${eq.modulus} = ${eq.computed} == h ${eq.target} ? ${eq.holds}`);
  }
  console.log(`最小解 x = ${report.minimumX ?? '（无）'}`);
  console.log(`完整范围已覆盖: ${report.completeSearchCovered}; 预算耗尽: ${report.budgetExhausted}`);
  console.log(`说明: ${report.note}`);
}

function usage(): void {
  console.log([
    'BSGS 离散对数 CLI（小素数教学版）',
    '',
    '用法:',
    '  node src/cli.ts solve <p> <g> <h> [--max-baby N] [--max-giant N] [--preview K]',
    '      保存问题并执行 BSGS 搜索，打印报告与 id',
    '  node src/cli.ts verify <p> <g> <h> <x>',
    '      独立核验候选指数（区分“等式成立”与“最小解”）',
    '  node src/cli.ts problem <id>',
    '      查询已保存问题及其全部报告',
    '  node src/cli.ts recheck <reportId>',
    '      复查历史见证（重算模等式，识别篡改）',
    '  node src/cli.ts compare <idA> <idB>',
    '      比较两个问题版本的参数与结果',
    '  node src/cli.ts export [out.json]',
    '      导出全部问题与报告（默认打印到控制台）',
    '  node src/cli.ts demo',
    '      教学演示：成功碰撞、真子群无解、独立验证、表大小/步数对比',
    '',
    '数据目录可用环境变量 BSGS_DATA_DIR 覆盖（默认 ./data）。',
    '所有整数以十进制字符串给出，内部使用 BigInt 精确运算。',
  ].join('\n'));
}

function parseFlags(args: string[]) {
  const positional: string[] = [];
  let maxBaby: string | undefined;
  let maxGiant: string | undefined;
  let preview: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--max-baby') maxBaby = args[++i];
    else if (a === '--max-giant') maxGiant = args[++i];
    else if (a === '--preview') preview = Number(args[++i]);
    else positional.push(a as string);
  }
  return { positional, maxBaby, maxGiant, preview };
}

function cmdSolve(args: string[]): void {
  const { positional, maxBaby, maxGiant, preview } = parseFlags(args);
  const [p, g, h] = positional;
  if (!p || !g || !h) throw new Error('solve 需要 <p> <g> <h>');
  const service = getService();
  const result = service.solve(
    { p, g, h },
    {
      maxBabySteps: maxBaby ? BigInt(maxBaby) : undefined,
      maxGiantSteps: maxGiant ? BigInt(maxGiant) : undefined,
      previewLimit: preview,
    },
  );
  if (!result.ok) {
    console.error(`[${result.error.code}] ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`已保存: problemId=${result.value.problemId}, reportId=${result.value.reportId}`);
  printReport('BSGS 报告', result.value.report);
}

function cmdVerify(args: string[]): void {
  const [p, g, h, x] = args;
  if (!p || !g || !h || !x) throw new Error('verify 需要 <p> <g> <h> <x>');
  const service = getService();
  const result = service.verify({ p, g, h, x });
  if (!result.ok) {
    console.error(`[${result.error.code}] ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  const v = result.value;
  console.log(`\n独立核验: ${g}^${x} mod ${p} = ${v.computed}（目标 h=${v.target}）`);
  console.log(`等式成立: ${v.equationHolds}`);
  console.log(`x 在 [0, p-2] 内: ${v.xInRange}`);
  console.log(`已证实为最小解: ${v.isMinimum ?? '无法判定'}（真正最小解 = ${v.minimumX ?? '无解'}）`);
  if (v.equationHolds && v.isMinimum === false) {
    console.log('注意: 该指数满足等式，但不是最小解——有效指数不等于最小指数。');
  }
}

function cmdProblem(args: string[]): void {
  const id = Number(args[0]);
  const service = getService();
  const problem = service.getProblem(id);
  if (!problem) {
    console.error(`[NOT_FOUND] 问题 ${id} 不存在`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ problem, reports: service.listReports(id) }, null, 2));
}

function cmdRecheck(args: string[]): void {
  const id = Number(args[0]);
  const service = getService();
  const result = service.recheckWitness(id);
  if (!result.ok) {
    console.error(`[${result.error.code}] ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`见证有效: ${result.value.valid}`);
  for (const reason of result.value.reasons) console.log(` - ${reason}`);
}

function cmdCompare(args: string[]): void {
  const [a, b] = [Number(args[0]), Number(args[1])];
  const service = getService();
  const result = service.compareVersions(a, b);
  if (!result.ok) {
    console.error(`[${result.error.code}] ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  const v = result.value;
  console.log(`问题 A(id=${a}): ${v.a.problem.p},${v.a.problem.g},${v.a.problem.h} -> ${v.a.latest?.status ?? '无报告'} x=${v.a.latest?.minimumX ?? '-'}`);
  console.log(`问题 B(id=${b}): ${v.b.problem.p},${v.b.problem.g},${v.b.problem.h} -> ${v.b.latest?.status ?? '无报告'} x=${v.b.latest?.minimumX ?? '-'}`);
  console.log(`参数差异: p=${v.paramDiff.pChanged}, g=${v.paramDiff.gChanged}, h=${v.paramDiff.hChanged}`);
}

function cmdExport(args: string[]): void {
  const data = JSON.stringify(getService().exportAll(), null, 2);
  if (args[0]) {
    writeFileSync(args[0], data, 'utf8');
    console.log(`已导出到 ${args[0]}`);
  } else {
    console.log(data);
  }
}

function cmdDemo(): void {
  console.log('############ Baby-step Giant-step 教学演示 ############');

  const r1 = babyStepGiantStep(23n, 5n, 8n);
  printReport('成功碰撞 5^x ≡ 8 (mod 23)，期望 x=6', r1);

  const r2 = babyStepGiantStep(23n, 4n, 5n);
  printReport('真子群无解 4^x ≡ 5 (mod 23)', r2);

  console.log('\n=== 独立候选验证（有效但非最小）===');
  const service = getService();
  const v = service.verify({ p: '23', g: '5', h: '8', x: '28' });
  if (v.ok) {
    console.log(`x=28(=6+ord=6+22): 等式成立=${v.value.equationHolds}, 最小=${v.value.isMinimum}, 真正最小=${v.value.minimumX}`);
  }
  const v0 = service.verify({ p: '23', g: '5', h: '1', x: '0' });
  if (v0.ok) console.log(`h=1 零解 x=0: 等式成立=${v0.value.equationHolds}, 最小=${v0.value.isMinimum}`);

  console.log('\n=== 时间-空间折中对比 ===');
  console.log('p\t\tm(表大小≈sqrt)\tgiant步数\t穷举步数(p-1)');
  for (const p of [23n, 101n, 1009n, 99991n]) {
    const checked = validateProblem({ p: p.toString(), g: '2', h: '3' });
    if (!checked.ok) continue;
    const rep = babyStepGiantStep(checked.value.p, checked.value.g, checked.value.h);
    console.log(`${p}\t\t${rep.m}\t\t${rep.giantStepsTaken}\t\t${p - 1n}`);
  }

  console.log('\n=== 穷举基准交叉验证 ===');
  const ex = exhaustiveDlog(23n, 5n, 8n);
  console.log(`穷举得到最小解 x=${ex}（应与 BSGS 的 ${r1.minimumX} 一致）`);

  const r3 = babyStepGiantStep(23n, 5n, 19n, { maxGiantSteps: 2n });
  printReport('预算限制（最多 2 个 giant 步；真正最小解在 i=3 处）5^x ≡ 19 (mod 23)', r3);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'solve': return cmdSolve(rest);
      case 'verify': return cmdVerify(rest);
      case 'problem': return cmdProblem(rest);
      case 'recheck': return cmdRecheck(rest);
      case 'compare': return cmdCompare(rest);
      case 'export': return cmdExport(rest);
      case 'demo': return cmdDemo();
      default: usage();
    }
  } catch (err) {
    console.error('错误:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
