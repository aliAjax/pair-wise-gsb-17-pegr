// 岩土钻孔数据存储 —— 唯一一处读写 localStorage（不引入任何依赖）

import {
  Borehole,
  MIN_OBSERVE_HOURS,
  RevisionRecord,
  newId,
  runContinuationError,
} from "../domain/borehole";

const STORAGE_KEY = "hxwl-03.boreholes.v1";

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRevision(value: unknown): RevisionRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.field !== "string") return null;
  return {
    id: typeof v.id === "string" ? v.id : newId(),
    field: v.field as RevisionRecord["field"],
    oldText: String(v.oldText ?? ""),
    newText: String(v.newText ?? ""),
    reason: String(v.reason ?? ""),
    at: typeof v.at === "string" ? v.at : "",
  };
}

/** 读回的数据先做校验：回次终点不衔接的孔丢弃坏数据，保证重开后状态可推导 */
function normalizeBorehole(value: unknown): Borehole | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.code !== "string" || !v.code.trim()) return null;

  const runs = Array.isArray(v.runs)
    ? v.runs.map(numOrZero).filter((n) => Number.isFinite(n))
    : [];
  if (runContinuationError(runs) !== null) return null;

  const revisions = Array.isArray(v.revisions)
    ? v.revisions.map(normalizeRevision).filter((r): r is RevisionRecord => r !== null)
    : [];

  const sealedBatch = typeof v.sealedBatch === "string" && v.sealedBatch.trim()
    ? v.sealedBatch
    : null;

  return {
    id: typeof v.id === "string" ? v.id : newId(),
    code: v.code,
    runs,
    stableLevel: numOrNull(v.stableLevel),
    levelStable: Boolean(v.levelStable),
    observeHours: numOrNull(v.observeHours),
    finalized: Boolean(v.finalized),
    finalizedAt: typeof v.finalizedAt === "string" ? v.finalizedAt : null,
    sealedBatch,
    sealedAt: typeof v.sealedAt === "string" ? v.sealedAt : null,
    revisions,
    createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
  };
}

/** 三种状态的示例孔：已封孔 / 待验 / 钻进中，另含一条改值留档 */
function seedBoreholes(): Borehole[] {
  const base: Borehole[] = [
    {
      id: newId(),
      code: "ZK-18",
      runs: [8.2, 15.6, 22.6],
      stableLevel: 3.4,
      levelStable: true,
      observeHours: 26,
      finalized: true,
      finalizedAt: "2026-09-18 14:20",
      sealedBatch: "FK-20260919-07",
      sealedAt: "2026-09-19 09:30",
      revisions: [],
      createdAt: "2026-09-16 08:00",
    },
    {
      id: newId(),
      code: "ZK-21",
      runs: [10.0, 21.5, 31.2],
      stableLevel: null,
      levelStable: false,
      observeHours: 12,
      finalized: true,
      finalizedAt: "2026-09-22 17:05",
      sealedBatch: null,
      sealedAt: null,
      revisions: [],
      createdAt: "2026-09-20 08:30",
    },
    {
      id: newId(),
      code: "ZK-24",
      runs: [6.4, 12.8, 18.4],
      stableLevel: 2.9,
      levelStable: true,
      observeHours: MIN_OBSERVE_HOURS,
      finalized: false,
      finalizedAt: null,
      sealedBatch: null,
      sealedAt: null,
      revisions: [
        {
          id: newId(),
          field: "回次终点",
          oldText: "6.4 → 12.8 → 18.2 m",
          newText: "6.4 → 12.8 → 18.4 m",
          reason: "终孔量测复核，末回次深度原记录 18.2m 与测绳读数不符，改为 18.4m",
          at: "2026-09-22 11:40",
        },
      ],
      createdAt: "2026-09-21 09:10",
    },
  ];
  return base;
}

export function loadBoreholes(): Borehole[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = seedBoreholes();
      saveBoreholes(seed);
      return seed;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return seedBoreholes();
    const holes = parsed
      .map(normalizeBorehole)
      .filter((h): h is Borehole => h !== null);
    return holes.length > 0 ? holes : seedBoreholes();
  } catch {
    return seedBoreholes();
  }
}

export function saveBoreholes(holes: Borehole[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holes));
    return true;
  } catch {
    // 隐私模式或配额受限时不崩溃，仅提示界面存储失败
    return false;
  }
}
