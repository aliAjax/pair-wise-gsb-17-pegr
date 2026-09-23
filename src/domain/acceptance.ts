// 终孔水文恢复与封孔验收 —— 领域规则（处理层）
// 纯函数、无 DOM / 存储依赖，封孔判定与修订逻辑集中在本文件。

export const STORAGE_KEY = "hxwl-03.acceptance.v1";

/** 水位恢复观测满 24 小时方可封孔 */
export const MIN_OBSERVE_HOURS = 24;

/** 孔的验收阶段：待验 / 可封孔 / 已封孔 */
export type HoleStage = "pending" | "sealable" | "sealed";

/** 流程受阻：borehole=孔号 depth=触发深度(0 表示与具体深度无关) condition=触发条件 */
export interface Blocker {
  borehole: string;
  depth: number;
  condition: string;
}

/** 修订留痕：保留原字段值并注明原因 */
export interface Revision {
  at: string;
  field: keyof HoleDraft | "sealBatch";
  from: string;
  to: string;
  reason: string;
}

/** 每孔录入内容 */
export interface HoleDraft {
  /** 回次终点深度（米），从 0 起算必须依次衔接 */
  runEnds: number[];
  /** 稳定水位埋深（米） */
  stableLevel: number | null;
  /** 水位观测小时数 */
  observeHours: number | null;
  /** 水位是否已稳定 */
  levelStable: boolean;
  /** 封孔批号（可封孔后填写） */
  sealBatch: string;
}

export interface Hole extends HoleDraft {
  id: string;
  createdAt: string;
  stage: HoleStage;
  blockers: Blocker[];
  revisions: Revision[];
}

export interface DraftResult {
  stage: HoleStage;
  depth: number;
  blockers: Blocker[];
}

export function formatDepth(value: number): string {
  return `${value.toFixed(2)}m`;
}

function blocker(id: string, depth: number, condition: string): Blocker {
  return { borehole: id, depth, condition };
}

/**
 * 回次终点衔接校验：从孔口 0m 起，逐回次递增且必须连续衔接。
 * 衔接失败属于结构性错误（无法确定孔深），录入即被阻止。
 */
export function evaluateRuns(runEnds: number[], id: string): Blocker[] {
  const blockers: Blocker[] = [];
  let prev = 0;
  runEnds.forEach((end, index) => {
    if (!Number.isFinite(end) || end <= 0) {
      blockers.push(
        blocker(id, prev, `回次${index + 1}终点“${formatDepth(end)}”无效，须为大于0的深度`)
      );
    } else if (end <= prev) {
      blockers.push(
        blocker(
          id,
          end,
          `回次${index + 1}终点${formatDepth(end)}未衔接上一终点${formatDepth(prev)}，须逐回次递增`
        )
      );
    }
    if (Number.isFinite(end)) prev = end;
  });
  if (runEnds.length === 0) {
    blockers.push(blocker(id, 0, "至少录入一个回次终点，否则无法确定终孔孔深"));
  }
  return blockers;
}

/** 终孔水文恢复判定：水位未稳定或观测不足 24 小时只能待验 */
export function evaluateHydrology(draft: HoleDraft, id: string, depth: number): Blocker[] {
  const blockers: Blocker[] = [];
  if (!draft.levelStable) {
    blockers.push(blocker(id, depth, "水位尚未稳定，只能待验，禁止封孔"));
  }
  if (draft.observeHours === null || !Number.isFinite(draft.observeHours)) {
    blockers.push(blocker(id, depth, "观测小时缺失，无法判定水位恢复是否满足24小时"));
  } else if (draft.observeHours < MIN_OBSERVE_HOURS) {
    blockers.push(
      blocker(id, depth, `观测仅${draft.observeHours}小时，不足${MIN_OBSERVE_HOURS}小时，只能待验`)
    );
  }
  if (draft.levelStable && (draft.stableLevel === null || !Number.isFinite(draft.stableLevel))) {
    blockers.push(blocker(id, depth, "水位已稳定但稳定水位埋深缺失或无效"));
  } else if (
    draft.levelStable &&
    draft.stableLevel !== null &&
    Number.isFinite(draft.stableLevel) &&
    (draft.stableLevel < 0 || draft.stableLevel > depth)
  ) {
    blockers.push(
      blocker(id, depth, `稳定水位${formatDepth(draft.stableLevel)}超出孔深范围0~${formatDepth(depth)}`)
    );
  }
  return blockers;
}

/** 评估录入稿：回次不衔接时孔深不可确定；水文未达标只能待验 */
export function evaluateDraft(id: string, draft: HoleDraft): DraftResult {
  const structural = evaluateRuns(draft.runEnds, id);
  if (structural.length > 0) {
    return { stage: "pending", depth: NaN, blockers: structural };
  }
  const depth = draft.runEnds[draft.runEnds.length - 1];
  const blockers = evaluateHydrology(draft, id, depth);
  return { stage: blockers.length > 0 ? "pending" : "sealable", depth, blockers };
}

/** 封孔前的强制校验：待验孔（含结构错误与水文未达标）禁止封孔 */
export function sealingBlockers(
  id: string,
  draft: HoleDraft,
  depth: number,
  batch: string
): Blocker[] {
  const runBlockers = evaluateRuns(draft.runEnds, id);
  if (runBlockers.length > 0) {
    return [...runBlockers, blocker(id, 0, "回次终点未衔接，只能待验，禁止封孔")];
  }
  const hydroBlockers = evaluateHydrology(draft, id, depth);
  if (hydroBlockers.length > 0) {
    return [
      blocker(id, depth, "水文恢复未达标，孔处于待验，禁止封孔"),
      ...hydroBlockers,
    ];
  }
  if (batch.trim() === "") {
    return [blocker(id, depth, "封孔批号缺失，须填写批号后方可封孔")];
  }
  return [];
}

interface OkResult {
  ok: true;
  hole: Hole;
}

interface FailResult {
  ok: false;
  blockers: Blocker[];
}

export type HoleResult = OkResult | FailResult;

function nowIso(): string {
  return new Date().toISOString();
}

/** 录入新孔：回次衔接错误直接拒收 */
export function createHole(
  id: string,
  draft: HoleDraft,
  existing: Hole[],
  now: string = nowIso()
): HoleResult {
  const trimmed = id.trim();
  if (trimmed === "") {
    return { ok: false, blockers: [blocker(id || "（空孔号）", 0, "钻孔编号不能为空")] };
  }
  if (existing.some((hole) => hole.id === trimmed)) {
    return { ok: false, blockers: [blocker(trimmed, 0, "孔号重复，不能重复建孔")] };
  }
  const result = evaluateDraft(trimmed, draft);
  if (Number.isNaN(result.depth)) {
    return { ok: false, blockers: result.blockers };
  }
  const preSeal = draft.sealBatch.trim();
  let stage: HoleStage = result.stage;
  let sealBatch = "";
  if (preSeal !== "") {
    const sealErrors = sealingBlockers(trimmed, draft, result.depth, preSeal);
    if (sealErrors.length > 0) {
      return { ok: false, blockers: sealErrors };
    }
    stage = "sealed";
    sealBatch = preSeal.trim();
  }
  return {
    ok: true,
    hole: {
      ...draft,
      sealBatch,
      id: trimmed,
      createdAt: now,
      stage,
      blockers: stage === "pending" ? result.blockers : [],
      revisions: [],
    },
  };
}

/** 可封孔孔执行封孔验收，登记封孔批号 */
export function sealHole(hole: Hole, batch: string): HoleResult {
  if (hole.stage === "sealed") {
    return { ok: false, blockers: [blocker(hole.id, lastDepth(hole), "该孔已封孔，不能重复封孔")] };
  }
  const depth = lastDepth(hole);
  const errors = sealingBlockers(hole.id, hole, depth, batch);
  if (errors.length > 0) return { ok: false, blockers: errors };
  return {
    ok: true,
    hole: { ...hole, stage: "sealed", sealBatch: batch.trim(), blockers: [] },
  };
}

function lastDepth(hole: Hole): number {
  const run = evaluateRuns(hole.runEnds, hole.id);
  if (run.length > 0) return NaN;
  return hole.runEnds[hole.runEnds.length - 1];
}

export type RevisableField = "runEnds" | "stableLevel" | "observeHours" | "levelStable" | "sealBatch";

interface RevisionInput {
  field: RevisableField;
  raw: string;
  reason: string;
}

/**
 * 改值修订：原版字段值随修订记录保留并注明原因；
 * 改后重新验收，已封孔孔若不再达标则退回待验并列出触发条件。
 */
export function reviseHole(
  hole: Hole,
  input: RevisionInput,
  all: Hole[]
): HoleResult {
  const reason = input.reason.trim();
  if (reason === "") {
    return { ok: false, blockers: [blocker(hole.id, lastDepth(hole), "修订必须注明原因")] };
  }

  const draft: HoleDraft = {
    runEnds: hole.runEnds,
    stableLevel: hole.stableLevel,
    observeHours: hole.observeHours,
    levelStable: hole.levelStable,
    sealBatch: hole.sealBatch,
  };

  if (input.field === "runEnds") {
    const parts = input.raw
      .split(/[,\s，、]+/)
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const parsed = parts.map((part) => Number(part));
    if (parsed.length === 0 || parsed.some((value) => !Number.isFinite(value))) {
      return {
        ok: false,
        blockers: [blocker(hole.id, lastDepth(hole), "回次终点须为逗号分隔的正数深度")],
      };
    }
    draft.runEnds = parsed;
  } else if (input.field === "levelStable") {
    draft.levelStable = input.raw === "true";
  } else if (input.field === "sealBatch") {
    if (hole.stage !== "sealed") {
      return {
        ok: false,
        blockers: [blocker(hole.id, lastDepth(hole), "仅已封孔孔可修订封孔批号")],
      };
    }
    if (input.raw.trim() === "") {
      return { ok: false, blockers: [blocker(hole.id, lastDepth(hole), "封孔批号不能为空")] };
    }
    draft.sealBatch = input.raw.trim();
  } else if (input.field === "stableLevel") {
    if (input.raw.trim() === "") {
      draft.stableLevel = null;
    } else {
      const value = Number(input.raw);
      if (!Number.isFinite(value)) {
        return { ok: false, blockers: [blocker(hole.id, lastDepth(hole), "稳定水位须为数字")] };
      }
      draft.stableLevel = value;
    }
  } else {
    if (input.raw.trim() === "") {
      draft.observeHours = null;
    } else {
      const value = Number(input.raw);
      if (!Number.isFinite(value) || value < 0) {
        return { ok: false, blockers: [blocker(hole.id, lastDepth(hole), "观测小时须为非负数字")] };
      }
      draft.observeHours = value;
    }
  }

  if (fieldDisplay(hole, input.field) === fieldDisplay(draft as Hole, input.field)) {
    return { ok: false, blockers: [blocker(hole.id, lastDepth(hole), "新值与原值一致，无需修订")] };
  }
  if (input.field === "sealBatch" && all.some((other) => other.id !== hole.id && other.sealBatch === draft.sealBatch)) {
    return { ok: false, blockers: [blocker(hole.id, lastDepth(hole), `封孔批号${draft.sealBatch}已被其他孔使用`)] };
  }

  const evaluation = evaluateDraft(hole.id, draft);
  const revision: Revision = {
    at: nowIso(),
    field: input.field,
    from: fieldDisplay(hole, input.field),
    to: fieldDisplay(draft as Hole, input.field),
    reason,
  };

  // 回次被改坏（结构性错误）：拒收，原版保持不变
  if (Number.isNaN(evaluation.depth)) {
    return { ok: false, blockers: evaluation.blockers };
  }

  let stage: HoleStage = evaluation.stage;
  let blockers = evaluation.blockers;
  const sealBatch = draft.sealBatch;

  if (hole.stage === "sealed") {
    if (input.field === "sealBatch") {
      stage = "sealed";
      blockers = [];
    } else {
      const sealErrors = sealingBlockers(hole.id, draft, evaluation.depth, sealBatch);
      if (sealErrors.length > 0) {
        // 改后不再满足封孔条件：退回待验并保留批号留痕
        stage = "pending";
        blockers = [
          ...sealErrors,
          blocker(hole.id, evaluation.depth, "修订后不再满足封孔条件，退回待验，禁止再次封孔"),
        ];
      } else {
        stage = "sealed";
        blockers = [];
      }
    }
  }

  return {
    ok: true,
    hole: {
      ...hole,
      ...draft,
      stage,
      blockers,
      revisions: [...hole.revisions, revision],
    },
  };
}

/** 字段的可读原值（用于修订留痕） */
export function fieldDisplay(hole: HoleDraft, field: RevisableField): string {
  switch (field) {
    case "runEnds":
      return hole.runEnds.map((value) => value.toFixed(2)).join(", ");
    case "stableLevel":
      return hole.stableLevel === null ? "未填" : `${hole.stableLevel}`;
    case "observeHours":
      return hole.observeHours === null ? "未填" : `${hole.observeHours}`;
    case "levelStable":
      return hole.levelStable ? "已稳定" : "未稳定";
    case "sealBatch":
      return hole.sealBatch === "" ? "未填" : hole.sealBatch;
  }
}

/**
 * 重开页面后的一致性校正：
 * 孔深、待验、封孔状态一律由回次终点与水文数据重新推导，不直接采信存储状态；
 * 已封孔数据若与规则冲突，保留封孔事实并挂出一致性受阻条件。
 */
export function normalizeHoles(raw: unknown, report: (message: string) => void): Hole[] {
  if (!Array.isArray(raw)) {
    report("存储的验收数据格式异常，已忽略");
    return [];
  }
  const holes: Hole[] = [];
  raw.forEach((record) => {
    if (!isRecord(record)) {
      report("存在无法识别的孔记录，已跳过");
      return;
    }
    const id = String(record.id);
    const runEnds = Array.isArray(record.runEnds)
      ? record.runEnds.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      : [];
    const draft: HoleDraft = {
      runEnds,
      stableLevel: typeof record.stableLevel === "number" ? record.stableLevel : null,
      observeHours: typeof record.observeHours === "number" ? record.observeHours : null,
      levelStable: Boolean(record.levelStable),
      sealBatch: typeof record.sealBatch === "string" ? record.sealBatch : "",
    };
    const revisions = Array.isArray(record.revisions) ? (record.revisions as Revision[]) : [];
    const structural = evaluateRuns(draft.runEnds, id);

    if (structural.length > 0) {
      report(`${id}：回次终点不衔接，孔深不可确定，按待验处理`);
      holes.push({
        id,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : nowIso(),
        ...draft,
        stage: "pending",
        blockers: structural,
        revisions,
      });
      return;
    }

    const evaluation = evaluateDraft(id, draft);
    const storedSealed = record.stage === "sealed" || draft.sealBatch.trim() !== "";

    if (storedSealed) {
      const sealErrors = sealingBlockers(id, draft, evaluation.depth, draft.sealBatch);
      if (sealErrors.length > 0) {
        report(`${id}：存储为已封孔但与验收规则冲突，请复核（保留封孔事实）`);
      }
      holes.push({
        id,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : nowIso(),
        ...draft,
        stage: "sealed",
        blockers: sealErrors,
        revisions,
      });
      return;
    }

    holes.push({
      id,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : nowIso(),
      ...draft,
      sealBatch: "",
      stage: evaluation.stage,
      blockers: evaluation.blockers,
      revisions,
    });
  });
  return holes;
}

function isRecord(value: unknown): value is Record<string, unknown> & { id: unknown } {
  return typeof value === "object" && value !== null && "id" in value;
}
