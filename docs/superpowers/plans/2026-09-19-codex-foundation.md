# Codex 连接基础实施计划

由主智能体使用 executing-plans 顺序执行；用户禁止子智能体。

**目标：** 建立可测试的协议连接，并对已安装的 Codex 做不触发模型的真实兼容性探测。

**架构：** 传输层负责换行帧、请求对应和超时；原生进程层负责隐藏启动与退出；探测脚本只保存脱敏事实。后续客户端使用生成的协议类型。

**技术栈：** Node 24、TypeScript、Vitest、pnpm；具体版本固定在锁文件。

## Task 1：传输边界

- [ ] 创建 tests/unit/transport.test.ts，覆盖反序响应、中文字节分片、通知、服务端请求、超时无重发、断连拒绝、非法帧与帧大小上限。
- [ ] 运行 `pnpm test:unit`，确认新增测试因传输实现缺失失败。
- [ ] 创建 packages/codex-adapter/src/transport.ts，接口为 `request(method, params, timeoutMs?)`、`notify(method, params)`、`reply(id, result)`、`close()`；请求 ID 单调增长，结果通过 pending map 分发。
- [ ] 运行 `pnpm test:unit` 与 `pnpm typecheck`，修复至通过。

## Task 2：原生连接与真实探测

- [ ] scripts/probe-codex.ts 使用显式环境变量 CYZ_CODEX_EXE 或已验证可执行路径参数；spawn 参数数组、shell=false、windowsHide=true。
- [ ] 发送 initialize → initialized → account/read(refreshToken=false)，只输出登录布尔值与协议能力，不输出邮件或认证数据。
- [ ] 保留生成类型的 SHA-256 清单、CLI 版本和响应事件类型；没有 turn/start 时模型调用计数应为 0。
- [ ] 运行探测，结果写 docs/acceptance/codex-probe.json，并在 codex-compatibility.md 区分已经验证与尚未执行的研究/恢复/停止能力。

## Task 3：可视化预览

- [ ] 用 brainstorming 提供的本地服务展示三栏交互原型，明确标为演示；支持阶段切换、材料/矩阵/草稿视图。
- [ ] 实际打开页面验证选择和编辑演示，并保持可访问供用户反馈。

## 后续批次

下一份计划覆盖 typed CodexEngine 的真实 turn、停止与恢复；之后实施项目 ID、导入、数据库事务、租约、版本和 API。全部 WB01-WB20/E01-E06 仍按总验收表关闭，当前批次没有完整 WB 通过声明。
