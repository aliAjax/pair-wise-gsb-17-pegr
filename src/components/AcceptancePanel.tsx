import { useEffect, useMemo, useState } from "react";
import {
  Blocker,
  Hole,
  MIN_OBSERVE_HOURS,
  RevisableField,
  createHole,
  fieldDisplay,
  formatDepth,
  reviseHole,
  sealHole,
} from "../domain/acceptance";
import { loadHoles, saveHoles } from "../storage/acceptanceStore";

interface FormState {
  id: string;
  runEnds: string;
  stableLevel: string;
  observeHours: string;
  levelStable: boolean;
  sealBatch: string;
}

const emptyForm: FormState = {
  id: "",
  runEnds: "",
  stableLevel: "",
  observeHours: "",
  levelStable: false,
  sealBatch: "",
};

const stageMeta: Record<Hole["stage"], { text: string; cls: string }> = {
  pending: { text: "待验", cls: "stage-pending" },
  sealable: { text: "可封孔", cls: "stage-sealable" },
  sealed: { text: "已封孔", cls: "stage-sealed" },
};

const fieldLabels: Record<RevisableField, string> = {
  runEnds: "回次终点",
  stableLevel: "稳定水位",
  observeHours: "观测小时",
  levelStable: "水位稳定",
  sealBatch: "封孔批号",
};

function parseRuns(raw: string): number[] {
  return raw
    .split(/[,\s，、]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number);
}

function depthOf(hole: Hole): number {
  return hole.runEnds.length > 0 ? hole.runEnds[hole.runEnds.length - 1] : NaN;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN", { hour12: false });
}

function BlockerList({ blockers }: { blockers: Blocker[] }) {
  if (blockers.length === 0) return null;
  return (
    <ul className="blocker-list">
      {blockers.map((item, index) => (
        <li key={`${item.depth}-${index}`}>
          <span className="blocker-hole">{item.borehole}</span>
          <span className="blocker-depth">深度 {formatDepth(item.depth)}</span>
          <span className="blocker-condition">触发条件：{item.condition}</span>
        </li>
      ))}
    </ul>
  );
}

function AcceptancePanel() {
  const [holes, setHoles] = useState<Hole[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formBlockers, setFormBlockers] = useState<Blocker[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 重开页面：孔深、待验、封孔与修订由存储层 + 领域规则重新推导
  useEffect(() => {
    const result = loadHoles();
    setHoles(result.holes);
    setNotices(result.warnings);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const errors = saveHoles(holes);
    if (errors.length > 0) setNotices((prev) => [...prev, ...errors]);
  }, [holes, loaded]);

  const summary = useMemo(() => {
    const totalDepth = holes.reduce((sum, hole) => sum + (depthOf(hole) || 0), 0);
    return {
      count: holes.length,
      depth: totalDepth,
      pending: holes.filter((hole) => hole.stage === "pending").length,
      sealed: holes.filter((hole) => hole.stage === "sealed").length,
    };
  }, [holes]);

  function updateForm(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setFormBlockers([]);
  }

  function handleCreate() {
    const draft = {
      runEnds: parseRuns(form.runEnds),
      stableLevel: form.stableLevel.trim() === "" ? null : Number(form.stableLevel),
      observeHours: form.observeHours.trim() === "" ? null : Number(form.observeHours),
      levelStable: form.levelStable,
      sealBatch: form.sealBatch.trim(),
    };
    const result = createHole(form.id, draft, holes);
    if (!result.ok) {
      setFormBlockers(result.blockers);
      return;
    }
    setHoles((prev) => [...prev, result.hole]);
    setForm(emptyForm);
    setFormBlockers([]);
    setNotices([]);
  }

  function handleSeal(hole: Hole, batch: string) {
    const result = sealHole(hole, batch);
    if (!result.ok) {
      setHoles((prev) =>
        prev.map((item) => (item.id === hole.id ? { ...item, blockers: result.blockers } : item))
      );
      return;
    }
    setHoles((prev) => prev.map((item) => (item.id === hole.id ? result.hole : item)));
  }

  return (
    <section className="acceptance panel">
      <div className="section-heading">
        <div>
          <p>终孔验收</p>
          <h2>水文恢复与封孔验收</h2>
        </div>
        <div className="acceptance-summary">
          <span>{summary.count} 孔</span>
          <span>累计孔深 {formatDepth(summary.depth)}</span>
          <span>待验 {summary.pending}</span>
          <span>已封孔 {summary.sealed}</span>
        </div>
      </div>
      <p className="acceptance-rule">
        回次终点须从孔口 0m 起逐回次衔接；水位未稳定或观测不足 {MIN_OBSERVE_HOURS}{" "}
        小时只能待验，待验孔禁止封孔。改值自动保留原版并注明原因。
      </p>

      {notices.length > 0 && (
        <div className="notice-box">
          {notices.map((notice, index) => (
            <p key={index}>{notice}</p>
          ))}
        </div>
      )}

      <div className="acceptance-layout">
        <div className="entry-form">
          <h3>逐孔录入</h3>
          <label>
            <span>钻孔编号</span>
            <input
              value={form.id}
              placeholder="如 ZK-25"
              onChange={(event) => updateForm({ id: event.target.value })}
            />
          </label>
          <label>
            <span>回次终点（米，逗号分隔，须衔接）</span>
            <input
              value={form.runEnds}
              placeholder="如 6.0, 12.5, 20.0"
              onChange={(event) => updateForm({ runEnds: event.target.value })}
            />
          </label>
          <RunChainPreview raw={form.runEnds} />
          <div className="form-row">
            <label>
              <span>稳定水位埋深（米）</span>
              <input
                value={form.stableLevel}
                inputMode="decimal"
                placeholder="如 3.4"
                onChange={(event) => updateForm({ stableLevel: event.target.value })}
              />
            </label>
            <label>
              <span>观测小时</span>
              <input
                value={form.observeHours}
                inputMode="decimal"
                placeholder="须 ≥ 24"
                onChange={(event) => updateForm({ observeHours: event.target.value })}
              />
            </label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.levelStable}
              onChange={(event) => updateForm({ levelStable: event.target.checked })}
            />
            <span>水位已稳定</span>
          </label>
          <label>
            <span>封孔批号（仅达标孔可填，填即封孔）</span>
            <input
              value={form.sealBatch}
              placeholder="如 FK-20260923-01"
              onChange={(event) => updateForm({ sealBatch: event.target.value })}
            />
          </label>
          <BlockerList blockers={formBlockers} />
          <button className="primary-action" type="button" onClick={handleCreate}>
            录入钻孔
          </button>
        </div>

        <div className="hole-list">
          {holes.length === 0 && <p className="empty-tip">暂无钻孔，请在左侧录入。</p>}
          {holes.map((hole) => (
            <HoleCard
              key={hole.id}
              hole={hole}
              expanded={Boolean(expanded[hole.id])}
              onToggle={() =>
                setExpanded((prev) => ({ ...prev, [hole.id]: !prev[hole.id] }))
              }
              onSeal={handleSeal}
              onChange={(next) =>
                setHoles((prev) => prev.map((item) => (item.id === next.id ? next : item)))
              }
              all={holes}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function RunChainPreview({ raw }: { raw: string }) {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const chain = ["0.00", ...parseRuns(trimmed).map((value) => (Number.isFinite(value) ? value.toFixed(2) : "?"))];
  return <p className="chain-preview">回次衔接：{chain.join(" → ")} m</p>;
}

interface CardProps {
  hole: Hole;
  expanded: boolean;
  onToggle: () => void;
  onSeal: (hole: Hole, batch: string) => void;
  onChange: (hole: Hole) => void;
  all: Hole[];
}

function HoleCard({ hole, expanded, onToggle, onSeal, onChange, all }: CardProps) {
  const [batch, setBatch] = useState("");
  const [field, setField] = useState<RevisableField>("stableLevel");
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const depth = depthOf(hole);
  const meta = stageMeta[hole.stage];

  function submitRevision() {
    const result = reviseHole(hole, { field, raw: newValue, reason }, all);
    if (!result.ok) {
      onChange({ ...hole, blockers: result.blockers });
      return;
    }
    onChange(result.hole);
    setNewValue("");
    setReason("");
  }

  return (
    <article className={`hole-card ${meta.cls}`}>
      <header className="hole-head">
        <div>
          <h3>{hole.id}</h3>
          <p className="hole-depth">
            孔深 {Number.isNaN(depth) ? "不可确定" : formatDepth(depth)} · 稳定水位{" "}
            {hole.stableLevel === null ? "未填" : formatDepth(hole.stableLevel)} · 观测{" "}
            {hole.observeHours === null ? "未填" : `${hole.observeHours}h`} ·{" "}
            {hole.levelStable ? "水位已稳定" : "水位未稳定"}
          </p>
        </div>
        <span className={`stage-badge ${meta.cls}`}>{meta.text}</span>
      </header>

      <p className="run-chain">
        回次终点：0 → {hole.runEnds.map((value) => value.toFixed(2)).join(" → ")} m
      </p>
      {hole.sealBatch !== "" && <p className="seal-batch">封孔批号：{hole.sealBatch}</p>}

      <BlockerList blockers={hole.blockers} />

      <div className="hole-actions">
        {hole.stage === "sealable" && (
          <>
            <input
              value={batch}
              placeholder="填写封孔批号"
              onChange={(event) => setBatch(event.target.value)}
            />
            <button type="button" onClick={() => onSeal(hole, batch)}>
              封孔验收
            </button>
          </>
        )}
        {hole.stage === "pending" && (
          <button type="button" disabled title="待验孔禁止封孔">
            待验，禁止封孔
          </button>
        )}
        <button type="button" className="link-button" onClick={onToggle}>
          {expanded ? "收起修订与留痕" : `改值修订（${hole.revisions.length}）`}
        </button>
      </div>

      {expanded && (
        <div className="revision-box">
          <div className="revision-form">
            <label>
              <span>字段</span>
              <select value={field} onChange={(event) => setField(event.target.value as RevisableField)}>
                {Object.entries(fieldLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>新值{field === "runEnds" ? "（逗号分隔）" : field === "levelStable" ? "（true/false）" : ""}</span>
              <input
                value={newValue}
                placeholder={`原值：${fieldDisplay(hole, field)}`}
                onChange={(event) => setNewValue(event.target.value)}
              />
            </label>
            <label>
              <span>修订原因（必填，原版自动保留）</span>
              <input
                value={reason}
                placeholder="如：现场复测水位更正"
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button type="button" onClick={submitRevision}>
              提交修订
            </button>
          </div>
          {hole.revisions.length > 0 ? (
            <ul className="revision-log">
              {hole.revisions.map((revision, index) => (
                <li key={`${revision.at}-${index}`}>
                  <strong>
                    {formatTime(revision.at)} · {fieldLabels[revision.field]}
                  </strong>
                  <span>
                    {revision.from} → {revision.to}
                  </span>
                  <em>原因：{revision.reason}</em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-tip">暂无修订记录。</p>
          )}
        </div>
      )}
    </article>
  );
}

export default AcceptancePanel;
