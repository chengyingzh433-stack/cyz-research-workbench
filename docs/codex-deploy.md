# 把工作台与工作流一起交给 Codex

这是从源码部署工作台的入口。只想使用工作台，可以到 [预发布页面](https://github.com/chengyingzh433-stack/cyz-research-workbench/releases/tag/v0.1.0-preview.1) 下载安装包，再按 [安装版说明](windows-install.md) 操作，不必准备 Node 和 pnpm。源码和安装附件均公开下载，无需 GitHub 凭据；不要把令牌写入仓库地址、脚本或文档。

工作台 0.1.0 固定使用公开发布的 [工作流 0.3.0](https://github.com/chengyingzh433-stack/cyz-edu-research/releases/tag/0.3.0)。工作流可以独立运行，工作台依赖它提供研究规则、模板和检查脚本。完整关系见 [依赖说明](https://github.com/chengyingzh433-stack/cyz-edu-research/blob/main/docs/workbench-and-workflow.md)。

## 可以直接发给 Codex

```text
请在这台 Windows 电脑部署 cyz-research-workbench。
先读 README.md 和 docs/codex-deploy.md，检查 Node、pnpm、Python 3.11、Codex 安装及登录状态。
运行 setup.ps1，把固定版本 cyz-edu-research 工作流交给当前 Codex 的 skills 目录。
有本地修改或版本冲突时保留文件，不强制覆盖；不要下载 MinerU 模型、上传研究资料或启动付费研究任务。
运行 node scripts/probe-workflow-binding.ts，核实 Codex 真正发现并启用了工作流。
分别报告工作台、主工作流、语言依赖和 PDF 解析的状态，然后告诉我怎样启动。
不要使用子智能体或目标模式。
```

## 自动处理的部分

`setup.ps1` 调用 `scripts/setup-workflow.py`：下载工作流发布 ZIP 和固定提交中的官方安装/校验脚本，逐项核对预先固定的 SHA-256，再安装到选定 Codex 主目录。已有同内容安装直接复用，有任何受控文件差异则停止，不覆盖。

可单独安装工作流：

```powershell
py -3.11 scripts/setup-workflow.py
```

离线安装可以通过 `--cache` 指定已准备的三个文件，再加 `--offline`；每个文件仍须通过同样的哈希校验。定制 Codex 主目录时设置 CODEX_HOME，或给安装脚本传 `--codex-home`，启动工作台也须使用相同 CODEX_HOME。

工作台启动研究时使用 `skills/list` 重新检查 Skill，并把 `$cyz-edu-research` 文本标记与 `type: skill` 输入一起传入。依据 [Codex App Server 官方说明](https://developers.openai.com/zh-Hans/docs/app-server)。这不是在用户的 Codex 桌面任务列表中另建任务，也不会在安装时自动开始研究。

## 不能混为一谈的状态

- 主工作流：固定 0.3.0，可自动安装和校验。
- 中文/英文语言技能：源码安装脚本只报告目录是否存在，Windows 安装版不打包这些依赖；两者都不代表语义校验已通过。按工作流的 [安装指南](https://github.com/chengyingzh433-stack/cyz-edu-research/blob/main/docs/agent-install.md) 使用补充依赖锁完成核验。
- MinerU：工作台适配器需要兼容的 Desk 和本地模型，导出脚本来自主工作流；在 Codex 中直接走工作流的 MinerU 路线还需要兼容接入 Skill。本项目不打包未获再分发许可的包装器或模型，不自动下载。
- Codex：必须可用且已登录；研究运行会使用该账号额度。接入探测只读取技能目录，不发起模型轮次。

## 尚未交付

Windows x64 安装测试版已公开预发布，已在本机完成安装、运行和卸载验证，尚未签名，详见 [安装版验收记录](acceptance/2026-09-19-installer.md)。一键更新、旧缓存再核验、原版 PDF 图文对照、完整决定卡与审批验收、备份恢复、本机 Agent API、S0–S8 完整研究示例仍在待办中。已有测试不等于这些项目已验收。
