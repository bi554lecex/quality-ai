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
- Markdown/TXT PRD 的真实模型解析
- 基于 Node.js 内置 SQLite 的本地持久化
- 0825 版本两个真实需求的解析验证
- 需求概览、页面状态、待确认问题、测试用例四段式流程
- PRD 文件选择、需求切换、问题确认、用例选择等前端交互
- 为 Playwright 执行层预留位置

未导入 PRD 时页面显示示例数据；成功导入后会明确显示“真实解析”，刷新页面会从 SQLite 恢复最近一次结果。

## 常用命令

- `npm run dev`：启动开发服务器
- `npm run build`：生成生产构建
- `npm run test`：执行当前构建检查
- `npm run typecheck`：检查 Vue、API 与共享契约类型
- `npm run lint`：检查构建与服务端配置代码
