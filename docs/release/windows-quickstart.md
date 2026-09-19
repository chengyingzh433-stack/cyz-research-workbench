# CYZ 研究工作台：安装与第一次使用

适用版本：工作台 0.1.0 Windows x64 安装测试版，配套主工作流 0.3.0。

## 下载与安装

从 [官方预发布页面](https://github.com/chengyingzh433-stack/cyz-research-workbench/releases/tag/v0.1.0-preview.1) 下载 `CYZ-Research-Workbench-0.1.0-Setup-x64.exe` 和 `SHA256SUMS.txt`。不要下载 “Source code” 代替安装程序。

双击 `.exe`，按向导选择你有写入权限的安装位置。安装结束后，从桌面或开始菜单的“CYZ 研究工作台”书本图标打开。当前安装包未签名；遇到系统拦截时先核实来源和校验值，不要关闭安全防护。

安装程序 SHA256：`13f98118e3102c6fa9e31a4bde5726b37b454529201709a15d0d368501596379`。需要自己核对时，可在文件所在目录打开 PowerShell，执行：

```powershell
Get-FileHash -LiteralPath '.\CYZ-Research-Workbench-0.1.0-Setup-x64.exe' -Algorithm SHA256
```

把输出的 Hash 与上面的值或 `SHA256SUMS.txt` 对照。字母大小写不影响结果；若不同，不要运行该文件。

## 还需要准备什么

安装包已经包含工作台运行环境、Python 3.14.7 和主工作流，不需要先装 Node、pnpm 或系统 Python。主 Skill 自动装到当前用户的 `.codex/skills/cyz-edu-research`；设置过 `CODEX_HOME` 的用户使用对应目录。已有不同内容会保留并提示，不自动覆盖。

研究对话还需要本机 Codex CLI 可用并已登录，使用时会消耗你的账号额度。PDF 解析需要本机 MinerU Desk 0.3.1 和模型；中文或英文语言处理需要另装、核验 `humanizer-zh` 或 `humanizer`。这些不会由安装程序自动下载，也不因主 Skill 安装成功而被视为就绪。

## 第一次使用

1. 点击“打开或新建项目”，选择一个独立的空文件夹。不要选程序安装目录。
2. 在“草稿编辑”中写一点内容并保存，再退出和重新打开，确认文件正常保留。
3. Codex 准备好后，可在研究对话中说明现有想法、材料和困难。阶段切换只是浏览，不会自动运行研究。
4. 要读 PDF，在“文献材料”中导入并解析，先核对小样本，再确认全文解析。当前阅读区是解析文字，重要数字和图表仍须对照原件。
5. 任务生成的 Markdown 在“研究成果”中先作为候选展示，检查后再确认保存，不把运行结束当作研究质量通过。

在 Windows“已安装的应用”中可卸载工作台。卸载会移除程序和快捷方式，外部项目、Codex Skill 和用户设置保留。研究项目不要存入安装目录。

## 交给 agent 继续配置

请先读 [两个仓库的依赖说明](https://github.com/chengyingzh433-stack/cyz-edu-research/blob/main/docs/workbench-and-workflow.md) 和 [Codex 部署指南](https://github.com/chengyingzh433-stack/cyz-research-workbench/blob/main/docs/codex-deploy.md)。分别核实工作台、主工作流、Codex 登录、语言依赖和 PDF 解析，不要合并成一句“全部可用”。保留本地修改，不自动下载模型、上传资料或发起付费研究任务。

本版本仍缺少原版 PDF 图文对照、备份恢复、一键更新和完整研究示例，不建议把唯一一份重要研究资料交给测试版保管。
