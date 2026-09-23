// 岩土钻孔：终孔水文恢复与封孔验收 —— 领域处理（纯逻辑，唯一一处）
// 不依赖 DOM、localStorage 与任何框架，界面与存储均调用此处规则。

export const MIN_OBSERVE_HOURS = 24;
const SURFACE_DEPTH = 0;

/** 钻孔生命周期：钻进中 → 终孔后【待验 | 可封孔】→ 已封孔 */
export type Phase = "drilling" | "pending" | "sealable" | "sealed";

export const PHASE_TEXT: Record<Phase, string> = {
  drilling: "钻进中",
  pending: "待验",
  sealable: "可封孔",
  sealed: "已封孔",
};

export type RevisionField = "回次终点" | "稳定水位" | "水位稳定" | "观测小时";

export const REVISION_FIELDS: RevisionField[] = [
  "回次终点",
  "稳定水位",
  "水位稳定",
  "观测小时",
];

export interface RevisionRecord {
  id: string;
  field: RevisionField;
  oldText: string;
  newText: string;
  reason: string;
  at: string;
}

export interface Borehole {
  id: string;
  code: string; // 孔号，如 ZK-18
  runs: number[]; // 各回次终点深度（m），自 0m 起严格递增即“衔接”
  stableLevel: number | null; // 稳定水位埋深（m）
  levelStable: boolean; // 水位是否已稳定
  observeHours: number | null; // 水文恢复观测小时数
  finalized: boolean; // 是否终孔
  finalizedAt: string | null;
  sealedBatch: string | null; // 封孔批号；非空即已封孔
  sealedAt: string | null;
  revisions: RevisionRecord[]; // 改值留档
  createdAt: string;
}

/** 受阻信息：界面统一按“孔号 / 深度 / 触发条件”展示 */
export interface Blocked {
  code: string;
  depth: number;
  condition: string;
}

export interface RevisionPatch {
  field: RevisionField;
  runs?: number[];
  stableLevel?: number | null;
  levelStable?: boolean;
  observeHours?: number | null;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 深度/小时统一保留两位、去掉多余零 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n * 100) / 100);
}

/** 孔深 = 最后一个回次终点 */
export function holeDepth(hole: Borehole): number {
  return hole.runs.length > 0 ? hole.runs[hole.runs.length - 1] : 0;
}

function blocked(hole: Borehole, condition: string): Blocked {
  return { code: hole.code, depth: holeDepth(hole), condition };
}

/** 回次终点序列校验：自地表 0m 起，每个终点必须大于前一个，才算衔接 */
export function runContinuationError(runs: number[]): string | null {
  let prev = SURFACE_DEPTH;
  for (let i = 0; i < runs.length; i += 1) {
    const end = runs[i];
    if (!Number.isFinite(end) || end <= 0) {
      return `第 ${i + 1} 个回次终点“${String(end)}”无效，须为大于 0m 的正数`;
    }
    if (end <= prev) {
      return `回次终点未衔接：第 ${i} 回次止于 ${fmtNum(prev)}m，第 ${i + 1} 回次终点 ${fmtNum(
        end,
      )}m 必须大于 ${fmtNum(prev)}m`;
    }
    prev = end;
  }
  return null;
}

/** 待验触发条件：水位未稳定 或 观测不足 24 小时 */
export function pendingConditions(hole: Borehole): string[] {
  const conditions: string[] = [];
  if (!hole.levelStable) {
    conditions.push("水位未稳定");
  }
  if (hole.observeHours === null || hole.observeHours < MIN_OBSERVE_HOURS) {
    const hours = hole.observeHours === null ? 0 : hole.observeHours;
    conditions.push(`观测 ${fmtNum(hours)} 小时，不足 ${MIN_OBSERVE_HOURS} 小时`);
  }
  return conditions;
}

/** 阶段一律由数据推导，不单独存储，保证重开页面后状态一致 */
export function phaseOf(hole: Borehole): Phase {
  if (hole.sealedBatch !== null) return "sealed";
  if (!hole.finalized) return "drilling";
  return pendingConditions(hole).length === 0 ? "sealable" : "pending";
}

export function isCodeUsed(holes: Borehole[], code: string): boolean {
  const target = code.trim();
  return holes.some((hole) => hole.code === target);
}

export function createBorehole(
  code: string,
  firstEnd: number,
  now: string,
): { hole?: Borehole; condition?: string } {
  if (!code.trim()) {
    return { condition: "钻孔编号不能为空" };
  }
  if (!Number.isFinite(firstEnd) || firstEnd <= 0) {
    return {
      condition: `首个回次终点“${String(firstEnd)}”无效，须为大于 0m 的正数`,
    };
  }
  return {
    hole: {
      id: newId(),
      code: code.trim(),
      runs: [firstEnd],
      stableLevel: null,
      levelStable: false,
      observeHours: null,
      finalized: false,
      finalizedAt: null,
      sealedBatch: null,
      sealedAt: null,
      revisions: [],
      createdAt: now,
    },
  };
}

/** 追加回次终点：终孔后锁定孔深，终点必须衔接 */
export function addRunBlock(hole: Borehole, end: number): Blocked | null {
  if (hole.sealedBatch !== null) {
    return blocked(hole, "该孔已封孔验收，记录锁定，不能再追加回次");
  }
  if (hole.finalized) {
    return blocked(hole, "已终孔，孔深锁定；如回次终点填错，请走“改值留档”并注明原因");
  }
  if (!Number.isFinite(end) || end <= 0) {
    return blocked(hole, `回次终点“${String(end)}”无效，须为大于 0m 的正数`);
  }
  const last = holeDepth(hole);
  if (end <= last) {
    return blocked(
      hole,
      `回次终点未衔接：上一回次终点 ${fmtNum(last)}m，新终点 ${fmtNum(
        end,
      )}m 必须大于 ${fmtNum(last)}m`,
    );
  }
  return null;
}

export function withRun(hole: Borehole, end: number): Borehole {
  return { ...hole, runs: [...hole.runs, end] };
}

/** 终孔：至少有一个回次 */
export function finalizeBlock(hole: Borehole): Blocked | null {
  if (hole.sealedBatch !== null) {
    return blocked(hole, "该孔已封孔验收，无需重复终孔");
  }
  if (hole.finalized) {
    return blocked(hole, "该孔已终孔");
  }
  if (hole.runs.length === 0) {
    return blocked(hole, "尚无任何回次终点，不能终孔");
  }
  return null;
}

export function markFinalized(hole: Borehole, now: string): Borehole {
  return { ...hole, finalized: true, finalizedAt: now };
}

/** 保存终孔后水文恢复观测 */
export function hydrologyBlock(
  hole: Borehole,
  level: number | null,
  stable: boolean,
  hours: number | null,
): Blocked | null {
  if (hole.sealedBatch !== null) {
    return blocked(hole, "该孔已封孔验收，水文记录锁定");
  }
  if (!hole.finalized) {
    return blocked(hole, "尚未终孔，水文恢复观测须在终孔后录入");
  }
  if (level !== null) {
    if (!Number.isFinite(level) || level < 0) {
      return blocked(hole, `稳定水位“${String(level)}”无效，须为不小于 0m 的数`);
    }
    if (level > holeDepth(hole)) {
      return blocked(
        hole,
        `稳定水位 ${fmtNum(level)}m 超过当前孔深 ${fmtNum(holeDepth(hole))}m`,
      );
    }
  }
  if (stable && level === null) {
    return blocked(hole, "水位判定为稳定时，必须填写稳定水位");
  }
  if (hours === null || !Number.isFinite(hours) || hours < 0) {
    return blocked(hole, `观测小时“${String(hours)}”无效，须为不小于 0 的数`);
  }
  return null;
}

export function withHydrology(
  hole: Borehole,
  level: number | null,
  stable: boolean,
  hours: number,
): Borehole {
  return {
    ...hole,
    stableLevel: level,
    levelStable: stable,
    observeHours: hours,
  };
}

/** 封孔验收：待验孔禁止封孔，批号必填 */
export function sealBlock(hole: Borehole, batch: string): Blocked | null {
  if (hole.sealedBatch !== null) {
    return blocked(hole, `已封孔（批号 ${hole.sealedBatch}），禁止重复封孔`);
  }
  if (!hole.finalized) {
    return blocked(hole, "尚未终孔，不能封孔");
  }
  const conditions = pendingConditions(hole);
  if (conditions.length > 0) {
    return blocked(
      hole,
      `待验孔禁止封孔，触发条件：${conditions.join("；")}`,
    );
  }
  if (!batch.trim()) {
    return blocked(hole, "封孔批号不能为空");
  }
  return null;
}

export function markSealed(hole: Borehole, batch: string, now: string): Borehole {
  return { ...hole, sealedBatch: batch.trim(), sealedAt: now };
}

/** 改值校验：已封孔锁定；原因必填；回次终点改后仍须衔接 */
export function revisionBlock(
  hole: Borehole,
  patch: RevisionPatch,
  reason: string,
): Blocked | null {
  if (hole.sealedBatch !== null) {
    return blocked(hole, "该孔已封孔验收，记录锁定，不能改值");
  }
  if (!reason.trim()) {
    return blocked(hole, `修改“${patch.field}”必须注明原因，原版数值保留留档`);
  }
  if (patch.field === "回次终点") {
    const runs = patch.runs ?? [];
    if (runs.length === 0) {
      return blocked(hole, "回次终点不得清空，每孔至少保留一个回次");
    }
    const error = runContinuationError(runs);
    if (error) return blocked(hole, error);
  }
  if (patch.field === "稳定水位" && patch.stableLevel != null) {
    const level: number = patch.stableLevel;
    if (!Number.isFinite(level) || level < 0) {
      return blocked(hole, `稳定水位“${String(level)}”无效，须为不小于 0m 的数`);
    }
    if (level > holeDepth(hole)) {
      return blocked(
        hole,
        `稳定水位 ${fmtNum(level)}m 超过当前孔深 ${fmtNum(holeDepth(hole))}m`,
      );
    }
  }
  if (patch.field === "观测小时" && patch.observeHours != null) {
    const hours: number = patch.observeHours;
    if (hours !== null && (!Number.isFinite(hours) || hours < 0)) {
      return blocked(hole, `观测小时“${String(hours)}”无效，须为不小于 0 的数`);
    }
  }
  return null;
}

export function describeField(hole: Borehole, field: RevisionField): string {
  switch (field) {
    case "回次终点":
      return hole.runs.length > 0 ? `${hole.runs.map(fmtNum).join(" → ")} m` : "无";
    case "稳定水位":
      return hole.stableLevel === null ? "未填" : `${fmtNum(hole.stableLevel)} m`;
    case "水位稳定":
      return hole.levelStable ? "稳定" : "未稳定";
    case "观测小时":
      return hole.observeHours === null ? "未填" : `${fmtNum(hole.observeHours)} 小时`;
  }
}

export function describePatch(patch: RevisionPatch): string {
  switch (patch.field) {
    case "回次终点":
      return `${(patch.runs ?? []).map(fmtNum).join(" → ")} m`;
    case "稳定水位":
      return patch.stableLevel === null || patch.stableLevel === undefined
        ? "清空"
        : `${fmtNum(patch.stableLevel)} m`;
    case "水位稳定":
      return patch.levelStable ? "稳定" : "未稳定";
    case "观测小时":
      return patch.observeHours === null || patch.observeHours === undefined
        ? "清空"
        : `${fmtNum(patch.observeHours)} 小时`;
  }
}

/** 应用改值：原值写入修订记录后再覆盖 */
export function applyRevision(
  hole: Borehole,
  patch: RevisionPatch,
  reason: string,
  now: string,
): Borehole {
  const record: RevisionRecord = {
    id: newId(),
    field: patch.field,
    oldText: describeField(hole, patch.field),
    newText: describePatch(patch),
    reason: reason.trim(),
    at: now,
  };
  const next: Borehole = { ...hole, revisions: [...hole.revisions, record] };
  switch (patch.field) {
    case "回次终点":
      next.runs = [...(patch.runs ?? [])];
      break;
    case "稳定水位":
      next.stableLevel = patch.stableLevel ?? null;
      break;
    case "水位稳定":
      next.levelStable = Boolean(patch.levelStable);
      break;
    case "观测小时":
      next.observeHours = patch.observeHours ?? null;
      break;
  }
  return next;
}
