# BSGS 离散对数与碰撞见证核验后端（教学版）

在**小素数域**上，用 **Baby-step Giant-step（BSGS，小步—大步法）** 求解并核验
离散对数：

> 给定素数 `p`、非零底数 `g`、非零目标 `h`，在 `[0, p-2]` 内寻找满足
> `g^x ≡ h (mod p)` 的**最小**整数 `x`，或确定该范围内**无解**。

本项目仅提供 **HTTP API 与命令行（CLI）**，不含前端。使用 TypeScript + Node.js
（内置 `node:sqlite`），在 Windows 本地直接运行，**不依赖** Docker、WSL、付费服务或
任何在线外部 API。所有整数以**十进制字符串**输入输出，核心计算全程使用
[`BigInt`](src/math/bigint-utils.ts)，不把整数悄悄转成不安全的 `Number`。

> ⚠️ **安全声明**：本服务只处理 `3 ≤ p ≤ 1,000,003` 的虚构小参数，用于教学。
> 它**不能**也无意高效求解实际密码系统中的大参数（如真实椭圆曲线或大整数有限域）。

## 目录

- [背景知识](#背景知识)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [HTTP API](#http-api)
- [CLI](#cli)
- [数据与持久化](#数据与持久化)
- [参数校验与错误码](#参数校验与错误码)
- [算法说明](#算法说明)
- [规模与安全限制](#规模与安全限制)
- [项目结构](#项目结构)

## 背景知识

### 什么是离散对数

在模素数 `p` 的非零剩余集合（`1..p-1`，乘法群）中，`g^x mod p` 容易正向计算，
但从结果反推指数 `x` 就是离散对数问题。

### 子群现象（为什么“非原根”可能无解）

`g` 不一定是**原根（生成元）**。`g` 的各次幂只能覆盖乘法群的一个**子群**。
- 若 `h` 落在该子群内，则方程有解（且解构成等差数列 `x0 + k·ord`）。
- 若 `h` 不在该子群内，则**无解**，哪怕 `h` 是 `1..p-1` 中的合法元素。

经典例子（`p=23`）：底数 `g=4` 的阶为 `11`（`4^11 ≡ 1 mod 23`），只能覆盖
22 个非零元素中的 11 个，因此 `4^x ≡ 5 (mod 23)` **无解**。

### 平方根规模（时间—空间折中）

逐个指数穷举需要 `O(p)` 次乘法和 `O(1)` 内存。BSGS 用 `m = ceil(sqrt(p-1))`：
- 建一张大小约 `m` 的 baby 表（内存 `O(√p)`）；
- 最多走 `m` 个 giant 步（时间 `O(√p)`）。

即用约 `√p` 的空间换取约 `√p` 的时间。本项目 `demo` 会打印不同 `p` 下
`m`（表大小）、giant 步数与穷举步数 `p-1` 的对比。

## 环境要求

- Node.js **≥ 22.5**（使用内置 `node:sqlite` 与 TypeScript 类型擦除；开发机实测 v25）。
- npm。无需编译原生模块。

## 快速开始

```powershell
npm install

npm run build     # 类型检查并输出 JS 到 dist/
npm test          # 运行全部测试（含小素数穷举交叉验证、见证篡改测试）

npm run demo      # CLI 教学演示
npm start         # 启动 HTTP API（默认自动选择空闲端口）
```

启动后控制台会打印实际端口，例如 `http://127.0.0.1:55393`。

- 自定义端口：`$env:BSGS_PORT="8080"; npm start`（不设则由系统分配空闲端口）。
- 自定义数据目录：`$env:BSGS_DATA_DIR="E:\some\dir"`（默认 `./data`）。

## HTTP API

所有数值字段均为**十进制字符串**。监听 `127.0.0.1`，仅本地访问。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/api/problems` | 保存问题并执行 BSGS 搜索，返回 `problemId`、`reportId` 与完整报告 |
| GET | `/api/problems` | 列出全部问题 |
| GET | `/api/problems/:id` | 查询单个问题及其全部报告版本 |
| GET | `/api/reports/:id` | 查询某次报告（含见证） |
| POST | `/api/reports/:id/recheck` | 依据存储原文**重算**见证，识别篡改 |
| POST | `/api/verify` | 独立核验用户给出的候选 `x` |
| GET | `/api/compare?a=&b=` | 比较两个问题版本的参数与最新结果 |
| GET | `/api/export` | 导出全部问题、报告与见证为 JSON |

### 求解

```powershell
curl.exe -s -X POST http://127.0.0.1:<端口>/api/problems `
  -H "Content-Type: application/json" `
  --data '{\"p\":\"23\",\"g\":\"5\",\"h\":\"8\"}'
```

最小解 `x=6`，报告含 `m`、不同 baby 余数数、giant 步数、命中 `i/j`、命中余数与
重新验证的等式。可附带资源预算：

```json
{ "p": "23", "g": "5", "h": "19",
  "budget": { "maxBabySteps": "5", "maxGiantSteps": "2", "previewLimit": 10 } }
```

预算在覆盖完整范围前耗尽时返回 `"status": "undetermined"`，**不会**谎报无解。
`previewLimit` 只限制报告里附带展示的 baby/giant 条目数，**不影响实际搜索**。

### 独立核验

`POST /api/verify` 直接计算 `g^x mod p`，分别报告：
- `equationHolds`：等式是否成立；
- `isMinimum`：在完整 BSGS 搜索佐证下，该 `x` 是否为**最小**解；
- `xInRange`：是否位于 `[0, p-2]`。

一个满足等式的指数**不一定**最小：例如 `5^6 ≡ 5^28 ≡ 8 (mod 23)`（因 `ord(5)=22`），
`x=28` 等式成立但不是最小、且超出主搜索范围。

## CLI

```powershell
node --experimental-transform-types --import ./scripts/register-ts.mjs src/cli.ts `
  solve 23 5 8
node ... src/cli.ts verify 23 5 8 28
node ... src/cli.ts problem 1
node ... src/cli.ts recheck 1
node ... src/cli.ts compare 1 2
node ... src/cli.ts export out.json
node ... src/cli.ts demo
```

`solve` 支持 `--max-baby N`、`--max-giant N`、`--preview K`。
`npm run demo` 演示：成功碰撞、真子群无解、有效但非最小的候选、
表大小/步数对比、穷举基准交叉验证，以及预算耗尽得到“未确定”。

## 数据与持久化

- SQLite 文件：`<数据目录>/bsgs.sqlite`（默认 `./data`，WAL 模式）。
- 表 `problems` 保存问题**原文**；表 `reports` 保存算法版本、状态、最小解与完整见证 JSON。
- 修改参数会生成**新的问题与报告**，不覆盖旧数据；可通过 `compare` 比较版本。
- **失败输入不落库**：校验或规模检查失败时不会写入任何“成功记录”。
- 每个问题的报告按 `problem_id` 隔离，多个问题之间的表/步骤**不会串用**。
- 重启后可用 `recheck` 依据存储原文重新复算模等式，复查历史结论。

## 参数校验与错误码

所有检查在建表/分配之前进行。常见错误码（HTTP 400/404）：

| code | 触发条件 |
| --- | --- |
| `INVALID_TYPE` | 参数不是十进制字符串 |
| `INVALID_NUMBER` | 不是合法十进制整数 |
| `INVALID_LENGTH` | 数值字符串超过 `10` 位 |
| `P_OUT_OF_RANGE` | `p` 不在 `[3, 1,000,003]` |
| `INVALID_NOT_PRIME` | 服务自行试除判定 `p` 为合数（不轻信标签） |
| `G_OUT_OF_RANGE` / `H_OUT_OF_RANGE` | `g`/`h` 不在 `[1, p-1]` |
| `SCALE_LIMIT` | `m` 超表规模上限，拒绝分配 |
| `X_OUT_OF_RANGE` | 核验候选 `x` 为负数 |
| `NOT_FOUND` | 问题/报告不存在 |
| `INTERNAL` | 服务端内部错误 |

## 算法说明

实现在 [`src/math/bsgs.ts`](src/math/bsgs.ts)：

1. `m = ceil(sqrt(p-1))`（纯 BigInt 牛顿整数根）。
2. **Baby 阶段**：顺序计算 `g^0, g^1, …, g^(m-1) mod p`，用哈希表保存
   “余数 → 最小下标 j”。**余数重复时保留最小 j，不覆盖**。
3. **Giant 阶段**：以 `h` 为起点，每步乘 `g^(-m) mod p`（模逆由扩展欧几里得
   精确求得）。第 `i` 步值为 `h·(g^-m)^i`。
4. 当某 giant 值命中 baby 余数（对应 `j`），得到候选 `x = i·m + j`。
5. 候选必须在 `[0, p-2]` 内，并**重新模幂验证** `g^x ≡ h`；遍历所有命中，
   取最小合法 `x`。
6. `i ∈ [0, m-1]` 覆盖 `x ∈ [0, m²-1] ⊇ [0, p-2]`，故走满 `m` 步仍无命中即
   **完整覆盖后判定无解**。

`src/math/bsgs.ts` 中的 `exhaustiveDlog` 是**独立穷举基准**，仅供测试与演示对比，
正式求解路径始终使用 BSGS，不以穷举代替。

## 规模与安全限制

- 仅 `3 ≤ p ≤ 1,000,003`；`m ≤ 1002`，baby 表与 giant 步均为千级，毫秒级完成。
- 数值字符串最长 10 位；超限在分配表之前拒绝。
- 这是教学级平方根算法，**不代表**能攻击真实密码系统的离散对数；后者参数规模以
  百/千位计，且本实现未做任何面向大参数的工程优化。
- 服务仅绑定 `127.0.0.1`，无鉴权/多租户设计，不接入账户、密钥库或外部系统。

## 项目结构

```text
src/
  math/bigint-utils.ts   # BigInt 模幂/模逆(扩展欧几里得)/素性/ceilSqrt
  math/validation.ts     # 参数与规模校验、错误码
  math/bsgs.ts           # BSGS、见证、预算、穷举基准、独立核验
  db/store.ts            # node:sqlite 持久化
  services/dlog-service.ts # 编排：校验→搜索→存储→复查→比较→导出
  server.ts              # HTTP API（默认空闲端口）
  cli.ts                 # 命令行与 demo
scripts/                 # 开发/测试用 .js->.ts 解析钩子
tests/                   # node:test 测试
```
