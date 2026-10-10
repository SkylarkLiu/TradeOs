export const defaultScoreRules = [
  { name: "策略符合度", max: 5, weight: 1, compliance: true, threshold: 4 },
  { name: "风险控制", max: 5, weight: 1, compliance: true, threshold: 4 },
  { name: "执行纪律", max: 5, weight: 1, compliance: true, threshold: 4 },
  { name: "交易心理", max: 5, weight: 1, compliance: false, threshold: 0 },
  { name: "复盘完整度", max: 5, weight: 1, compliance: false, threshold: 0 },
];
