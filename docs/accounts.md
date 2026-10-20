# gfot 0.4：账号与本地代理

状态：实验实现，2026-10-20。已完成合成服务及真实 OpenCode 进程联调，Codex 导入已完成单账号真实诊断；独立浏览器授权仍待验收。

## 借鉴 CC Switch 的位置

参考的是“账号记录 → 凭证获取 / 刷新 → 本地路由 → 上游协议”的边界，不是把所有 Agent 的 Token 当成通用 API Key。

公开源码参考：[CC Switch](https://github.com/farion1231/cc-switch/tree/f92ff0b03964188f1cd011d9302ab8869d7a8219)。gfot 没有复制其 Rust 模块，也不读取 CC Switch 数据库或改写其他客户端配置。CC Switch 本身提供的路由可以作为额外模型连接接入。

## 已实现两条账号路径

### 独立 ChatGPT 授权

使用 gfot 自己的动态客户端注册：浏览器 OAuth、随机 state / nonce、PKCE、绑定准确回调 URI、服务端签发 client ID。通过公开 JWKS 验证 ID token 的签名、issuer、audience、到期和 nonce，以及返回的账号身份与订阅权限。主机 ID 本机稳定保存；各注册的 client ID 与凭证分开保存。

模型和推理只发往公开 `https://api.openai.com/v1`。访问凭证近到期时串行刷新，原子替换轮换凭证；退出先让本机授权失效，再尝试撤销远端会话，远端撤销失败会告知用户。

依据：[注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[账号与续期](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[推理限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。上游是否给账号授予权限，以真实授权结果为准。

### 导入本地 Codex

仅在用户点击原生文件选择后读取所选 JSON，解析 `tokens.access_token`、账号标识与访问到期；导入副本在本机加密。JWT 的未验证字段只用于识别该副本，不当作已经认证成功。文件解析、模型目录、额度和推理的结果分别展示。

不复制原文件的 refresh token，也不改写它。共享刷新凭证可能被原客户端轮换，因此副本过期或失效后提示重新导入，或改用独立登录。

此路径固定使用 Codex 兼容上游：`https://chatgpt.com/backend-api/codex`；额度查询单独调用兼容 usage 接口。它是非官方兼容路径，不是公开 API 稳定性承诺，服务可能拒绝非原生客户端或变更协议。已完成一个真实账号的目录、推理与工具回传诊断，不代表所有模型或账号均兼容。

## 本地代理与执行

每轮任务生成随机、本机回环的代理访问钥匙，绑定账号和模型。只有临时钥匙进入 OpenCode 进程；上游 access / refresh / ID token 留在账号模块中。代理拒绝无授权请求、浏览器 Origin、非 Responses 路径、模型改写以及被撤销的授权。

OpenCode 使用内置 OpenAI SDK 处理 Responses SSE 与工具调用。gfot 的代理强制 `store:false`、`stream:true`、完整上下文，过滤订阅接口不支持的参数；独立授权路由会按上游要求给函数工具分组。不会因为账号配额失败自动重放已有工具操作。API 或 CC Switch 连接另可选择 Chat Completions / Responses / Anthropic 原生 SDK。

## 尚未实现

- 原生 Claude Code、Gemini、Grok、WorkBuddy 订阅凭证导入和刷新。
- 系统钥匙串中其他 Agent 私有条目的自动读取。
- 自动额度检测与故障切换、通用全平台 Token 兑换。
- 原 Codex / WorkBuddy 聊天记录与内部记忆迁移。
- Harness² 跨任务经验反思与更深递归；h2 分支已提供任务级 k=1 优化，内层执行器仍为 OpenCode。

## 已验证与未验证

自动检查使用合成 JWT、临时 RSA 签名和合成模型服务，不消耗真实账号额度。覆盖凭证加密与脱敏、PKCE / callback / OIDC、刷新互斥、退出竞争、上传期间撤销代理授权、限额不重放、Responses 完成事件与工具结果回传。

真实 OpenCode 测试分别从本地凭证导入与独立 OAuth 进入代理，批准后写临时文件，再换到第二个合成账号继续同一会话。原生 UI 检查使用模拟文件选择，但执行真实的 preload / main IPC、文件解析和加密保存。实际系统对话框、真实浏览器授权和跨账号的所有模型兼容性尚待用户验收。

### 真实账号诊断：2026-10-20

经用户明确授权，只读取本机 Codex `auth.json` 的访问凭证，在内存中运行 gfot 账号管理和本地代理。通过 Electron Chromium 网络栈使用 macOS 系统代理。成功读取 7 个模型；所选 `gpt-6.1-sol` 完成两次固定 Responses 请求：返回诊断函数调用，再接收函数结果并回答。未发送项目内容，未使用共享刷新凭证，前后哈希确认原文件未变。

诊断修复了两个兼容问题：Node 默认网络不跟随系统代理；Codex 流式响应可能省略 Content-Type。后者仍须收到完整 `response.completed` 才记成功。没有把真实账号用于自动文件编辑，也未以真实第二账号验证切换。自动执行与切换证据来自合成账号测试。
