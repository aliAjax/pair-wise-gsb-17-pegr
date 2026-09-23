# hxwl-03 岩土钻孔编录

钻孔分层、标贯与地下水位的现场记录面板

## 技术栈

React + Vite + TypeScript + CSS

## 本地运行

```bash
npm install
npm run dev
```

开发端口：5103

## 初始功能

- 领域指标看板
- 角色和分类筛选
- 专业字段录入区
- 示例记录列表
- 终孔水文恢复与封孔验收（回次终点衔接、稳定水位/观测小时校验、待验禁封、修订留痕、localStorage 持久化）
- 可继续扩展IndexedDB、权限、后端API和复杂图表

## 封孔验收规则

- 回次终点从孔口 0m 起逐回次衔接递增，不衔接直接拒收
- 水位未稳定或观测不足 24 小时只能待验，待验孔禁止封孔
- 改值修订自动保留原字段值并注明原因；已封孔改后不达标的退回待验
- 重开页面后孔深、待验、封孔状态由录入数据重新推导，保证与修订一致
- 代码分层：处理 `src/domain/acceptance.ts`、存储 `src/storage/acceptanceStore.ts`、界面 `src/components/AcceptancePanel.tsx`
