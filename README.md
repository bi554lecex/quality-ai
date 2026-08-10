# 知测 AI

面向重业务 B 端前端团队的 AI 测试工作台。主流程是：版本管理、导入 PRD、需求结构化、页面状态建模、问题澄清、测试用例生成和 Playwright 执行。

## 本地运行

```bash
npm install
npm run dev
```

本地页面运行在 `http://127.0.0.1:4173`，TypeScript API 运行在 `http://127.0.0.1:8787`。

在 `.env.local` 中配置模型，文件已被 Git 忽略：

```dotenv
DEEPSEEK_API_KEY=your-key
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-flash
API_PORT=8787
```

生产构建与静态预览：

```bash
npm run build
npm run start
```

## 当前实现

- Vue 3 + TypeScript + Vite
- DeepSeek/OpenAI-compatible 模型适配层
- Markdown/TXT PRD 与接口技术文档的多文件联合解析
- 基于 Node.js 内置 SQLite 的本地持久化
- 0825 版本两个真实需求的解析验证
- 需求概览、页面状态、待确认问题、测试用例四段式流程
- 版本记录自动沉淀、版本摘要进度展示与历史版本一键切换
- PRD 文件选择、需求切换、问题确认、用例选择等前端交互
- 问题确认和用例选择的刷新恢复
- Playwright 受控步骤 DSL、真实 Chromium 执行、截图与结果持久化
- 选中业务用例后由 DeepSeek 生成受控 DSL，并可对指定测试环境立即执行
- 测试环境持久化与 Playwright `storageState` 登录态导入、复用
- 登录态仅保存在 Git 忽略的 `data/auth` 目录，接口只返回是否已配置，不返回凭据或磁盘路径

未导入 PRD 时页面显示示例数据；成功导入后会明确显示“真实解析”，刷新页面会从 SQLite 恢复最近一次结果。

需要测试登录后的 B 端页面时，可先使用 Playwright 生成登录态文件：

```bash
npx playwright codegen --save-storage=storage-state.json https://你的测试环境地址
```

在打开的浏览器中完成登录并关闭窗口，然后在“测试用例”页签保存测试环境并导入该 JSON。后续确认执行 AI 计划时会自动复用对应环境的登录态。

## 常用命令

- `npm run dev`：启动开发服务器
- `npm run build`：生成生产构建
- `npm run test`：执行当前构建检查
- `npm run typecheck`：检查 Vue、API 与共享契约类型
- `npm run lint`：检查构建与服务端配置代码
