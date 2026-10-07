# Baby-step Giant-step 离散对数教学后端（TypeScript + Node.js + SQLite）

一个只做 **API 与 CLI** 的本地教学服务：在**小素数域**上求解离散对数
`g^x ≡ h (mod p)`，或确定在 `x ∈ [0, p-2]` 范围内**无解**。

> ⚠️ **仅用于教学**：参数被刻意限制为虚构小参数（`3 ≤ p ≤ 1,000,003`）。
> 本项目**不能**、也无意高效求解真实密码系统（如有限域 DH / 椭圆曲线）中的大参数离散对数。

## 目录
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [算法说明](#算法说明)
- [子群现象](#子群现象)
- [规模与平方根限制](#规模与平方根限制)
- [HTTP API](#http-api)
- [CLI](#cli)
- [持久化与见证核验](#持久化与见证核验)
- [错误码](#错误码)
- [项目结构](#项目结构)

## 环境要求
- Windows 本地运行，不依赖 Docker / WSL / 付费服务 / 外部在线 API。
- Node.js **≥ 22.5**（开发与实测环境为 **Node v25.5.0**）。
- SQLite 使用 Node 内置模块 `node:sqlite`（当前版本会打印一条 ExperimentalWarning，不影响使用），无需本地编译。

## 快速开始
```powershell
npm install        # 安装 typescript / @types/node（开发依赖）
npm run build      # 编译到 dist/
npm test           # 编译并运行 15 个内置测试
npm start          # 启动 HTTP 服务（默认自动选择空闲端口；set PORT=8080 可指定）
npm run demo       # CLI 教学演示：成功碰撞 / 真子群无解 / 候选核验 / 折中对比
```
数据文件固定在项目内 `data/dlog.sqlite`（自动创建）。

## 算法说明
核心自行实现 **Baby-step Giant-step (BSGS)**，文件 `src/bsgs.ts`：

1. 令 `m = ceil(sqrt(p-1))`。
2. **Baby 步**：建表存 `g^j mod p`（`j = 0 … m-1`）。
   同一余数出现多次时**只保留最小下标 j**——非原根底数会产生重复余数，
   覆盖旧下标会错失最小解。
3. **Giant 步**：从 `h` 出发，每次乘 `g^{-m} mod p`
   （`g^{-m}` 由扩展欧几里得求模逆，见 `src/bigmath.ts`），得到
   `γ_i = h·g^{-i·m}`。
4. 当 `γ_i` 命中 baby 表中的 `g^j` 时，有候选 `x = i·m + j`。
   按 i 升序、表内取最小 j，第一个落在 `[0, p-2]` 的命中即**最小非负解**。
5. 候选必须再用平方-乘 `modPow(g, x, p)` **独立重新验证**后才报告。

报告包含 `m`、baby 表不同余数数量、实际 giant 步数、命中的 `i/j`、
余数、验证等式；baby/giant 明细只返回截断样例（默认各 10 条，可用
`sampleSize` 调整），**截断只影响展示，不影响搜索完整性**。

### 预算（资源限制）
可传 `budget: { maxBabyEntries, maxGiantSteps }`（CLI 对应 `--max-baby` /
`--max-giant`）。预算不足以覆盖完整范围时返回
`status = "undetermined"`，**绝不会冒充 `no_solution`**。
只有建满 `m` 条 baby 且走完 `m` 个 giant（覆盖 `[0, m²-1] ⊇ [0,p-2]`）
仍无碰撞，才下 `no_solution` 结论。

## 子群现象
`g` **不一定是原根**。例如 `p=23`：
- `g=5` 是模 23 的原根（阶 22），`5^6 ≡ 8 (mod 23)`，最小解 **x=6**。
- `g=4` 的阶只有 **11**，它生成的真子群只覆盖 22 个非零元素中的一半；
  因此 `4^x ≡ 5 (mod 23)` **无解**，即使 5 是合法非零元素。

边界情况都有明确结果：`x=0`、`g=1`（有解当且仅当 `h=1`）、`h=1`
（零解）、末端指数 `p-2`、重复 baby 值等均有测试覆盖。

## 规模与平方根限制
- 允许 `3 ≤ p ≤ 1,000,003`，`1 ≤ g,h ≤ p-1`；十进制输入最长 80 位。
- BSGS 时间与空间均约为 `O(√(p-1))`：p 接近一百万时，表与步数约
  `m ≈ 1000`，毫秒级完成；这正是“时间-空间折中”——用约 √n 的存储
  换掉逐个指数穷举的 O(n) 时间。
- 穷举实现 `bruteForceDlog` **仅作为测试基准与 CLI `brute` 对照**，
  正式搜索路径从不使用穷举。
- 超规模输入在**分配哈希表之前**即被拒绝（`SCALE_TOO_LARGE` /
  `P_OUT_OF_RANGE`）。所有整数从输入到运算全程 `BigInt`，十进制字符串
  进出接口，不悄悄转成不安全的 `Number`。

## HTTP API
启动后见控制台输出的地址。请求/响应均为 JSON，整数字段为**十进制字符串**。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/problems` | 校验并保存问题定义（成功才落库，`status=saved`） |
| POST | `/search` | 执行 BSGS 并保存一份带见证的结果报告 |
| GET  | `/problems` | 列出最近报告（`?limit=N`） |
| GET  | `/problems/:id` | 报告详情 + 复查结果 |
| GET  | `/problems/:id/steps` | 碰撞步骤、样例、验证等式与复查 |
| POST | `/verify` | 独立核验候选 `x` |
| GET  | `/compare/:problemKey` | 比较同一问题的多个版本 |
| GET  | `/export/:id` | 导出完整 JSON 见证包 |
| GET  | `/healthz` | 健康检查 |

`POST /search` 示例：
```powershell
Invoke-RestMethod http://127.0.0.1:PORT/search -Method Post `
  -ContentType 'application/json' -Body '{"p":"23","g":"5","h":"8"}'
```

`POST /verify` 的响应区分两个概念：
- `satisfied`：直接计算 `g^x mod p` 是否等于 `h`；
- `minimal`：等式成立**并且**经完整 BSGS 比对确认它是最小非负解。
  一个指数可以“满足等式”却不是最小（例如 `g=1,h=1` 时 `x=5` 成立，最小解是 0），
  服务不会因为等式成立就宣称最小。

## CLI
```powershell
node dist/cli.js search --p 23 --g 5 --h 8
node dist/cli.js search --p 23 --g 4 --h 5
node dist/cli.js verify --p 23 --g 1 --h 1 --x 5
node dist/cli.js brute  --p 23 --g 5 --h 8     # 穷举基准（小规模对照）
node dist/cli.js save   --p 23 --g 5 --h 8     # 保存问题到 SQLite
node dist/cli.js list
node dist/cli.js steps  --id 1
node dist/cli.js compare --key <problemKey>
node dist/cli.js export --id 1
node dist/cli.js demo                          # 完整教学演示
```

## 持久化与见证核验
- SQLite 表 `problems` 保存：问题原文 `raw_input`、规范化 `p/g/h`、预算、
  算法版本 `algorithm_version`、完整结果 JSON、见证哈希与时间戳。
- **问题隔离**：`problem_key` 是参数与预算的 SHA-256 指纹；修改参数生成新
  key，不同问题的 baby 表/报告互不串用。同一参数重复 `/search` 产生递增
  `version`，可通过 `/compare/:key` 对比。
- **失败不落库**：参数/素性/预算校验在任何写库之前完成，非法输入不会留下
  成功记录。
- **防篡改**：`witness_hash` 覆盖 p/g/h、m、命中 i/j/余数/x、状态与算法版本。
  查询/导出时会重算哈希，并用 `modPow` 独立复验模等式；篡改余数或指数会得到
  `hashOk=false`（必要时 `equationOk=false`）。测试中包含故意篡改用例。
- **重启可复查**：重新打开数据库后仍可重算原来的模等式（测试覆盖）。

## 错误码
| code | HTTP | 含义 |
| --- | --- | --- |
| `INVALID_TYPE` / `INVALID_INTEGER` | 400 | 不是十进制字符串 |
| `NUMBER_TOO_LONG` | 400 | 数字超过 80 位 |
| `P_OUT_OF_RANGE` / `G_OUT_OF_RANGE` / `H_OUT_OF_RANGE` | 400 | 超出取值范围 |
| `X_OUT_OF_RANGE` | 400 | 候选指数超出 `[0,p-2]` |
| `INVALID_BUDGET` / `BUDGET_TOO_LARGE` | 400 | 预算字段非法或过大 |
| `INVALID_JSON` / `PAYLOAD_TOO_LARGE` | 400 / 413 | 请求体问题 |
| `P_NOT_PRIME` | 422 | 服务端试除判定 p 为合数（不相信输入标签） |
| `SCALE_TOO_LARGE` | 422 | 计算规模超上限，建表前拒绝 |
| `NOT_FOUND` | 404 | 报告/问题不存在 |

## 项目结构
```
src/
  constants.ts   规模上限与算法版本
  bigmath.ts     BigInt 模运算、扩展欧几里得模逆、模幂、试除素性、ceilSqrt、穷举基准
  validation.ts  十进制字符串解析与参数/预算校验
  bsgs.ts        BSGS 搜索与独立候选核验
  store.ts       SQLite 持久化、问题指纹、见证哈希与复查
  server.ts      HTTP API（默认空闲端口，PORT 环境变量可指定）
  cli.ts         命令行与教学演示
test/            15 个测试（算法/穷举交叉核对/边界/持久化/篡改见证）
data/            运行时生成的 SQLite 数据目录
```
