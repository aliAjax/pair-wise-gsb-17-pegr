// 岩土钻孔：终孔水文恢复与封孔验收 —— 界面（唯一一处）

import { useEffect, useMemo, useState } from "react";
import {
  Borehole,
  Blocked,
  Phase,
  PHASE_TEXT,
  REVISION_FIELDS,
  RevisionField,
  RevisionPatch,
  addRunBlock,
  applyRevision,
  createBorehole,
  describeField,
  finalizeBlock,
  fmtNum,
  holeDepth,
  hydrologyBlock,
  isCodeUsed,
  markFinalized,
  markSealed,
  pendingConditions,
  phaseOf,
  revisionBlock,
  sealBlock,
  withHydrology,
  withRun,
} from "../domain/borehole";
import { loadBoreholes, saveBoreholes } from "../storage/boreholeStore";

function nowText(): string {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

const PHASE_BADGE: Record<Phase, string> = {
  drilling: "badge badge-drill",
  pending: "badge badge-pending",
  sealable: "badge badge-sealable",
  sealed: "badge badge-sealed",
};

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p className="metric-hint">{hint}</p>
    </article>
  );
}

function BlockedBanner({ blocked }: { blocked: Blocked | null }) {
  if (!blocked) return null;
  return (
    <div className="blocked-banner" role="alert">
      <strong>操作受阻</strong>
      <span>
        孔号 {blocked.code} · 深度 {fmtNum(blocked.depth)}m
      </span>
      <span>触发条件：{blocked.condition}</span>
    </div>
  );
}

export function BoreholeConsole() {
  // 孔深、待验、封孔与修订全部来自同一份存储，重开页面后推导一致
  const [holes, setHoles] = useState<Borehole[]>(() => loadBoreholes());
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newEnd, setNewEnd] = useState("");

  useEffect(() => {
    setStorageError(!saveBoreholes(holes));
  }, [holes]);

  function raiseBlocked(b: Blocked | null): boolean {
    if (b) {
      setBlocked(b);
      return true;
    }
    return false;
  }

  function patchHole(id: string, updater: (hole: Borehole) => Borehole) {
    setHoles((prev) => prev.map((hole) => (hole.id === id ? updater(hole) : hole)));
  }

  function handleCreate() {
    const end = parseNumber(newEnd);
    if (isCodeUsed(holes, newCode)) {
      raiseBlocked({ code: newCode.trim() || "空", depth: 0, condition: "孔号已存在，禁止重复建档" });
      return;
    }
    if (end === null || Number.isNaN(end) || end <= 0) {
      raiseBlocked({
        code: newCode.trim() || "空",
        depth: 0,
        condition: `首个回次终点“${newEnd}”无效，须为大于 0m 的正数`,
      });
      return;
    }
    const result = createBorehole(newCode, end, nowText());
    if (result.condition || !result.hole) {
      raiseBlocked({ code: newCode.trim() || "空", depth: 0, condition: result.condition ?? "建档失败" });
      return;
    }
    setHoles((prev) => [...prev, result.hole as Borehole]);
    setNewCode("");
    setNewEnd("");
  }

  function handleAddRun(id: string, end: number | null) {
    const hole = holes.find((h) => h.id === id);
    if (!hole) return;
    if (end === null || Number.isNaN(end)) {
      raiseBlocked({
        code: hole.code,
        depth: holeDepth(hole),
        condition: `回次终点“无效”，须为大于 0m 的数字`,
      });
      return;
    }
    if (raiseBlocked(addRunBlock(hole, end))) return;
    patchHole(id, (h) => withRun(h, end));
  }

  function handleFinalize(id: string) {
    const hole = holes.find((h) => h.id === id);
    if (!hole) return;
    if (raiseBlocked(finalizeBlock(hole))) return;
    patchHole(id, (h) => markFinalized(h, nowText()));
  }

  function handleHydrology(
    id: string,
    level: number | null,
    stable: boolean,
    hours: number | null,
  ) {
    const hole = holes.find((h) => h.id === id);
    if (!hole) return;
    if (raiseBlocked(hydrologyBlock(hole, level, stable, hours))) return;
    patchHole(id, (h) => withHydrology(h, level, stable, hours as number));
  }

  function handleSeal(id: string, batch: string) {
    const hole = holes.find((h) => h.id === id);
    if (!hole) return;
    if (raiseBlocked(sealBlock(hole, batch))) return;
    patchHole(id, (h) => markSealed(h, batch, nowText()));
  }

  function handleRevision(id: string, patch: RevisionPatch, reason: string) {
    const hole = holes.find((h) => h.id === id);
    if (!hole) return;
    if (raiseBlocked(revisionBlock(hole, patch, reason))) return;
    patchHole(id, (h) => applyRevision(h, patch, reason, nowText()));
  }

  const metrics = useMemo(() => {
    const totalDepth = holes.reduce((sum, hole) => sum + holeDepth(hole), 0);
    const pending = holes.filter((hole) => phaseOf(hole) === "pending").length;
    const sealed = holes.filter((hole) => phaseOf(hole) === "sealed").length;
    const revisions = holes.reduce((sum, hole) => sum + hole.revisions.length, 0);
    return { totalDepth, pending, sealed, revisions };
  }, [holes]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-03 · 终孔水文恢复与封孔验收</p>
          <h1>岩土钻孔编录</h1>
          <p className="subtitle">
            回次终点逐段衔接，终孔后录入稳定水位与观测小时；水位未稳定或观测不足 24
            小时只能待验，待验孔禁止封孔；改值保留原版并注明原因，刷新页面状态一致。
          </p>
        </div>
        <div className="stack-card">
          <span>处理 / 存储 / 界面</span>
          <strong>纯 TypeScript 规则 + localStorage + React</strong>
          <small>不引入任何新依赖</small>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="累计孔深" value={`${fmtNum(metrics.totalDepth)}m`} hint={`在录 ${holes.length} 孔`} />
        <MetricCard label="待验孔" value={String(metrics.pending)} hint="水位未稳定或观测不足 24h" />
        <MetricCard label="已封孔" value={String(metrics.sealed)} hint="批号留痕、记录锁定" />
        <MetricCard label="修订留档" value={String(metrics.revisions)} hint="改值保留原版与原因" />
      </section>

      {storageError && (
        <div className="blocked-banner storage-warn" role="status">
          <strong>存储未生效</strong>
          <span>浏览器拒绝写入 localStorage（隐私模式或配额已满），本次改动刷新后将丢失。</span>
        </div>
      )}
      <BlockedBanner blocked={blocked} />

      <section className="workspace">
        <aside className="panel narrow">
          <h2>新建钻孔</h2>
          <div className="create-form">
            <label>
              <span>钻孔编号（孔号）</span>
              <input
                value={newCode}
                placeholder="如 ZK-25"
                onChange={(e) => setNewCode(e.target.value)}
              />
            </label>
            <label>
              <span>首个回次终点深度（m）</span>
              <input
                value={newEnd}
                inputMode="decimal"
                placeholder="如 6.5"
                onChange={(e) => setNewEnd(e.target.value)}
              />
            </label>
            <button className="primary-action" onClick={handleCreate}>
              建档并录入第一回次
            </button>
          </div>

          <h2>验收规则</h2>
          <ul className="rule-list">
            <li>回次终点自 0m 起严格递增，必须衔接</li>
            <li>终孔后孔深锁定，只能通过改值留档修订</li>
            <li>水位未稳定，或观测不足 24 小时 → 待验</li>
            <li>待验孔禁止封孔；封孔须填批号</li>
            <li>已封孔记录锁定，不可再改值</li>
            <li>改值必须注明原因，原版数值保留</li>
          </ul>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>钻孔台账</p>
              <h2>终孔 · 水文恢复 · 封孔验收</h2>
            </div>
          </div>
          {holes.length === 0 ? (
            <p className="empty-tip">暂无钻孔，请在左侧建档。</p>
          ) : (
            <div className="hole-list">
              {holes.map((hole) => (
                <HoleCard
                  key={hole.id}
                  hole={hole}
                  onAddRun={handleAddRun}
                  onFinalize={handleFinalize}
                  onHydrology={handleHydrology}
                  onSeal={handleSeal}
                  onRevision={handleRevision}
                />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function RunForm({ hole, onAddRun }: {
  hole: Borehole;
  onAddRun: (id: string, end: number | null) => void;
}) {
  const [text, setText] = useState("");
  const last = holeDepth(hole);
  return (
    <div className="inline-form">
      <input
        value={text}
        inputMode="decimal"
        placeholder={`下一回次终点（须 > ${fmtNum(last)}m）`}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        onClick={() => {
          onAddRun(hole.id, parseNumber(text));
          setText("");
        }}
      >
        录入回次终点
      </button>
    </div>
  );
}

function HydrologyForm({ hole, onHydrology }: {
  hole: Borehole;
  onHydrology: (id: string, level: number | null, stable: boolean, hours: number | null) => void;
}) {
  const [levelText, setLevelText] = useState(
    hole.stableLevel === null ? "" : String(hole.stableLevel),
  );
  const [stable, setStable] = useState(hole.levelStable);
  const [hoursText, setHoursText] = useState(
    hole.observeHours === null ? "" : String(hole.observeHours),
  );

  return (
    <div className="hydro-form">
      <label>
        <span>稳定水位埋深（m）</span>
        <input
          value={levelText}
          inputMode="decimal"
          placeholder="如 3.4"
          onChange={(e) => setLevelText(e.target.value)}
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={stable}
          onChange={(e) => setStable(e.target.checked)}
        />
        <span>水位已稳定</span>
      </label>
      <label>
        <span>恢复观测小时数（≥24）</span>
        <input
          value={hoursText}
          inputMode="decimal"
          placeholder="如 26"
          onChange={(e) => setHoursText(e.target.value)}
        />
      </label>
      <button
        onClick={() =>
          onHydrology(hole.id, parseNumber(levelText), stable, parseNumber(hoursText))
        }
      >
        保存水文恢复观测
      </button>
    </div>
  );
}

function SealPanel({ hole, onSeal }: {
  hole: Borehole;
  onSeal: (id: string, batch: string) => void;
}) {
  const [batch, setBatch] = useState("");
  const phase = phaseOf(hole);

  if (phase === "sealed") {
    return (
      <div className="seal-box sealed-box">
        <span>封孔批号：{hole.sealedBatch}</span>
        {hole.sealedAt && <small>验收时间 {hole.sealedAt} · 记录已锁定</small>}
      </div>
    );
  }
  if (phase === "pending") {
    return (
      <div className="seal-box pending-box">
        <strong>待验孔禁止封孔</strong>
        <span>触发条件：{pendingConditions(hole).join("；")}</span>
        <small>请补测至水位稳定且观测满 24 小时后再申请封孔</small>
      </div>
    );
  }
  return (
    <div className="seal-box">
      <label>
        <span>封孔批号</span>
        <input
          value={batch}
          placeholder="如 FK-20260923-01"
          onChange={(e) => setBatch(e.target.value)}
        />
      </label>
      <button className="primary-action" onClick={() => onSeal(hole.id, batch)}>
        封孔验收
      </button>
    </div>
  );
}

function RevisionPanel({ hole, onRevision }: {
  hole: Borehole;
  onRevision: (id: string, patch: RevisionPatch, reason: string) => void;
}) {
  const [field, setField] = useState<RevisionField>("回次终点");
  const [runsText, setRunsText] = useState(hole.runs.join(", "));
  const [levelText, setLevelText] = useState(
    hole.stableLevel === null ? "" : String(hole.stableLevel),
  );
  const [stable, setStable] = useState(hole.levelStable);
  const [hoursText, setHoursText] = useState(
    hole.observeHours === null ? "" : String(hole.observeHours),
  );
  const [reason, setReason] = useState("");

  const sealed = phaseOf(hole) === "sealed";

  function submit() {
    const patch: RevisionPatch = { field };
    if (field === "回次终点") {
      const runs = runsText
        .split(/[,\s，、]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map(Number);
      // 即便含无效值（NaN）也交给领域规则，返回“第 k 个终点无效”的精确提示
      patch.runs = runs;
    } else if (field === "稳定水位") {
      patch.stableLevel = parseNumber(levelText);
    } else if (field === "水位稳定") {
      patch.levelStable = stable;
    } else {
      patch.observeHours = parseNumber(hoursText);
    }
    onRevision(hole.id, patch, reason);
    setReason("");
  }

  return (
    <div className="revision-box">
      <h4>改值留档（原版保留）</h4>
      {sealed ? (
        <p className="empty-tip">已封孔验收，记录锁定，不能改值。</p>
      ) : (
        <>
          <div className="revision-form">
            <label>
              <span>修改字段</span>
              <select value={field} onChange={(e) => setField(e.target.value as RevisionField)}>
                {REVISION_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f}（现值：{describeField(hole, f)}）
                  </option>
                ))}
              </select>
            </label>

            {field === "回次终点" && (
              <label>
                <span>全部回次终点（m，逗号分隔，必须衔接）</span>
                <input
                  value={runsText}
                  onChange={(e) => setRunsText(e.target.value)}
                />
              </label>
            )}
            {field === "稳定水位" && (
              <label>
                <span>新稳定水位（m，留空表示未填）</span>
                <input
                  value={levelText}
                  inputMode="decimal"
                  onChange={(e) => setLevelText(e.target.value)}
                />
              </label>
            )}
            {field === "水位稳定" && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={stable}
                  onChange={(e) => setStable(e.target.checked)}
                />
                <span>水位已稳定</span>
              </label>
            )}
            {field === "观测小时" && (
              <label>
                <span>新观测小时数（留空表示未填）</span>
                <input
                  value={hoursText}
                  inputMode="decimal"
                  onChange={(e) => setHoursText(e.target.value)}
                />
              </label>
            )}

            <label>
              <span>修改原因（必填）</span>
              <textarea
                rows={2}
                value={reason}
                placeholder="如：量测复核发现原记录与测绳读数不符"
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button onClick={submit}>提交改值并留档</button>
          </div>
        </>
      )}

      {hole.revisions.length > 0 && (
        <div className="revision-history">
          <h4>修订记录</h4>
          {[...hole.revisions].reverse().map((rev) => (
            <div key={rev.id} className="revision-item">
              <div className="revision-head">
                <strong>{rev.field}</strong>
                <time>{rev.at}</time>
              </div>
              <p>
                <s>{rev.oldText}</s> → <b>{rev.newText}</b>
              </p>
              <p className="revision-reason">原因：{rev.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HoleCard(props: {
  hole: Borehole;
  onAddRun: (id: string, end: number | null) => void;
  onFinalize: (id: string) => void;
  onHydrology: (id: string, level: number | null, stable: boolean, hours: number | null) => void;
  onSeal: (id: string, batch: string) => void;
  onRevision: (id: string, patch: RevisionPatch, reason: string) => void;
}) {
  const { hole } = props;
  const phase = phaseOf(hole);
  const depth = holeDepth(hole);

  return (
    <article className={`hole-card hole-${phase}`}>
      <header className="hole-head">
        <div>
          <h3>{hole.code}</h3>
          <small>建档 {hole.createdAt}</small>
        </div>
        <span className={PHASE_BADGE[phase]}>{PHASE_TEXT[phase]}</span>
      </header>

      <div className="hole-summary">
        <div>
          <span>当前孔深</span>
          <strong>{fmtNum(depth)}m</strong>
        </div>
        <div>
          <span>回次数</span>
          <strong>{hole.runs.length}</strong>
        </div>
        <div>
          <span>稳定水位</span>
          <strong>{hole.stableLevel === null ? "未填" : `${fmtNum(hole.stableLevel)}m`}</strong>
        </div>
        <div>
          <span>观测小时</span>
          <strong>{hole.observeHours === null ? "未填" : fmtNum(hole.observeHours)}</strong>
        </div>
      </div>

      <section className="hole-section">
        <h4>回次终点（衔接自 0m）</h4>
        <div className="run-chain">
          <span className="run-node">0m 地表</span>
          {hole.runs.map((end, index) => (
            <span key={index} className="run-node">
              第{index + 1}回次 {fmtNum(end)}m
            </span>
          ))}
        </div>
        {phase === "drilling" ? (
          <>
            <RunForm hole={hole} onAddRun={props.onAddRun} />
            <button className="primary-action" onClick={() => props.onFinalize(hole.id)}>
              终孔（孔深锁定为 {fmtNum(depth)}m）
            </button>
          </>
        ) : (
          <p className="locked-note">
            已于 {hole.finalizedAt} 终孔，孔深 {fmtNum(depth)}m 锁定；填错请走下方改值留档。
          </p>
        )}
      </section>

      {phase !== "drilling" && (
        <section className="hole-section">
          <h4>终孔水文恢复</h4>
          {phase === "sealed" ? (
            <p className="locked-note">
              水位 {hole.stableLevel === null ? "—" : `${fmtNum(hole.stableLevel)}m`} ·{" "}
              {hole.levelStable ? "已稳定" : "未稳定"} · 观测{" "}
              {hole.observeHours === null ? "—" : fmtNum(hole.observeHours)} 小时（已锁定）
            </p>
          ) : (
            <>
              {phase === "pending" && (
                <p className="pending-note">
                  当前只能待验：{pendingConditions(hole).join("；")}
                </p>
              )}
              {phase === "sealable" && (
                <p className="sealable-note">水位稳定且观测满 24 小时，具备封孔条件。</p>
              )}
              <HydrologyForm hole={hole} onHydrology={props.onHydrology} />
            </>
          )}
        </section>
      )}

      {phase !== "drilling" && (
        <section className="hole-section">
          <h4>封孔验收</h4>
          <SealPanel hole={hole} onSeal={props.onSeal} />
        </section>
      )}

      <section className="hole-section">
        <RevisionPanel
          // 改值提交后随修订数重建表单，使“现值”与输入默认值刷新
          key={hole.revisions.length}
          hole={hole}
          onRevision={props.onRevision}
        />
      </section>
    </article>
  );
}
