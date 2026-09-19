# Codex 接入验证

运行时：本机 Codex CLI 0.153.4。协议类型由该运行时生成，不手改生成文件。

| 检查 | 实测结果 | 证据 |
| --- | --- | --- |
| 初始化与登录状态读取 | 通过，没有发起模型 turn | codex-probe.json |
| 新会话、流式回复、结束事件、用量事件 | 通过，一轮短回复测试 | codex-turn-probe.json |
| 关闭连接后恢复既有会话 | 通过，正确回答上一轮保存的测试代号 | codex-lifecycle-probe.json |
| 中断运行中的 turn | 通过，收到 interrupted 终态 | codex-lifecycle-probe.json |
| 写入范围配置 | 返回 workspaceWrite，工作目录和额外写入根通过检查，排除隐式临时目录 | engine.ts、isolation.test.ts |
| 真实越界写入拦截 | 尚未验证 | 不以配置检查替代实际沙箱验证 |
| 交互审批与研究决定卡 | 尚未真实验证 | 接口已接入，不宣称验收通过 |
| 应用重启后的任务恢复界面 | 未完成 | 目前保留 reconciling，不自动重发 |

两份真实 turn 探测共启动四轮测试请求，未委派开发、未使用子智能体或目标模式。恢复与中断测试属于产品运行时验证，不代表完整论文流程已通过。
