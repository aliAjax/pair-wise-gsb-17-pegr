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
- 可继续扩展IndexedDB、权限、后端API和复杂图表

## 终孔水文恢复与封孔验收

- 每孔录入回次终点、稳定水位、恢复观测小时与封孔批号
- 回次终点自 0m 起严格递增、必须衔接；终孔后孔深锁定
- 水位未稳定或观测不足 24 小时只能“待验”，待验孔禁止封孔
- 填错改值须注明原因，原版数值随修订记录保留；已封孔记录锁定
- 孔深、待验、封孔与修订均持久化到 localStorage，重开页面状态一致
- 受阻操作显示孔号、深度与触发条件
- 分层结构（各仅一处）：
  - `src/domain/borehole.ts` 处理：验收规则与状态推导（纯 TypeScript）
  - `src/storage/boreholeStore.ts` 存储：localStorage 读写与数据规范化
  - `src/ui/BoreholeConsole.tsx` 界面：录入、待验提示与受阻提示
- 不引入任何新依赖
