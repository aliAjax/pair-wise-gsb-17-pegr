// 终孔水文恢复与封孔验收 —— 本地持久化（存储层）
// 仅负责 localStorage 读写与首次示例数据，不含判定规则。

import { Hole, STORAGE_KEY, normalizeHoles } from "../domain/acceptance";

export interface LoadResult {
  holes: Hole[];
  warnings: string[];
}

/** 重开页面：读取并经领域规则做一致性校正 */
export function loadHoles(): LoadResult {
  const warnings: string[] = [];
  if (typeof localStorage === "undefined") return { holes: seedHoles(), warnings };

  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return { holes: seedHoles(), warnings };
  }
  try {
    return { holes: normalizeHoles(JSON.parse(raw), (message) => warnings.push(message)), warnings };
  } catch {
    return {
      holes: [],
      warnings: ["验收数据已损坏无法解析，已清空展示，请重新录入"],
    };
  }
}

export function saveHoles(holes: Hole[]): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holes));
    return [];
  } catch {
    return ["本地存储写入失败（容量或隐私模式限制），当前改动未能持久化"];
  }
}

/** 首次打开的示例孔：分别处于已封孔 / 可封孔 / 待验三种状态 */
function seedHoles(): Hole[] {
  const at = "2026-09-20T08:00:00.000Z";
  return [
    {
      id: "ZK-18",
      createdAt: at,
      runEnds: [6.2, 13.5, 22.6],
      stableLevel: 3.4,
      observeHours: 30,
      levelStable: true,
      sealBatch: "FK-20260921-03",
      stage: "sealed",
      blockers: [],
      revisions: [],
    },
    {
      id: "ZK-21",
      createdAt: "2026-09-21T02:30:00.000Z",
      runEnds: [8.0, 18.6, 31.2],
      stableLevel: 5.1,
      observeHours: 26,
      levelStable: true,
      sealBatch: "",
      stage: "sealable",
      blockers: [],
      revisions: [],
    },
    {
      id: "ZK-24",
      createdAt: "2026-09-22T06:10:00.000Z",
      runEnds: [5.4, 12.0, 18.4],
      stableLevel: null,
      observeHours: 9,
      levelStable: false,
      sealBatch: "",
      stage: "pending",
      blockers: [
        { borehole: "ZK-24", depth: 18.4, condition: "水位尚未稳定，只能待验，禁止封孔" },
        { borehole: "ZK-24", depth: 18.4, condition: "观测仅9小时，不足24小时，只能待验" },
      ],
      revisions: [],
    },
  ];
}
