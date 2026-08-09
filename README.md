# 知测 AI

面向重业务 B 端前端团队的 AI 测试工作台。第一阶段主流程是：版本管理、导入 PRD、需求结构化、页面状态建模、问题澄清和测试用例生成；模型调用与 Playwright 执行将在后续接入可配置服务。

## 本地运行

```bash
npm install
npm run dev
```

生产构建与静态预览：

```bash
npm run build
npm run start
```

## 当前实现

- Vue 3 + TypeScript + Vite
- 0825 版本与两个真实需求的工作台示例
- 需求概览、页面状态、待确认问题、测试用例四段式流程
- PRD 文件选择、需求切换、问题确认、用例选择等前端交互
- 为模型供应商适配层和 Playwright 执行层预留位置

当前界面中的需求解析结果是根据样例 PRD 与接口文档整理的演示数据，不会把“选择了文件”伪装成已完成真实模型解析。

## 常用命令

- `npm run dev`：启动开发服务器
- `npm run build`：生成生产构建
- `npm run test`：执行当前构建检查
- `npm run lint`：检查构建与服务端配置代码
