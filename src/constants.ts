// 全局参数规模上限（教学用，刻意限制为小参数）
export const ALGORITHM_VERSION = 'bsgs-1.0.0';

export const LIMITS = {
  MIN_P: 3n,
  MAX_P: 1_000_003n,
  // 十进制输入字符串最大长度（防止超长输入）
  MAX_DIGITS: 80,
  // 单次搜索允许的最大 baby 表条目 / giant 步数
  MAX_TABLE: 1_000_001,
  MAX_STEPS: 1_000_001,
} as const;

// 默认展示截断条数（不影响实际搜索）
export const DEFAULT_SAMPLE = 10;
