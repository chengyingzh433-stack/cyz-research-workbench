# Windows 安装版使用说明

工作台 0.1.0 使用 [CYZ 教育研究工作流 0.3.0](https://github.com/chengyingzh433-stack/cyz-edu-research/releases/tag/0.3.0)。工作流负责研究规则，工作台负责桌面操作；只想在 Codex 里使用工作流，可以不装工作台。版本搭配和各项准备工作见 [依赖说明](https://github.com/chengyingzh433-stack/cyz-edu-research/blob/main/docs/workbench-and-workflow.md)。

到 [Windows 安装测试版发布页](https://github.com/chengyingzh433-stack/cyz-research-workbench/releases/tag/v0.1.0-preview.1) 下载 `.exe` 和 `SHA256SUMS.txt`。这是公开的预发布版本，不需要 GitHub 登录。页面里的 “Source code” 是给开发者看的源码压缩包，不是安装程序。

## 安装

1. 双击 `CYZ-Research-Workbench-0.1.0-Setup-x64.exe`。
2. 按向导选择安装位置。使用你有写入权限的目录；这是当前用户安装版。
3. 安装结束后，从桌面的书本图标或开始菜单打开“CYZ 研究工作台”。

安装包自带工作台运行环境和主工作流 Skill，不需要先装 Node、pnpm 或 Python，安装过程也不需要下载模型。当前是未签名的本地测试版；若系统拦截，请先核实文件来源和附带的 SHA256，不要关闭安全防护。

程序目录和研究项目目录是两回事。建议在“文档”或资料盘中新建研究项目文件夹，不要把论文、草稿放进程序安装目录。

## Skill 会放在哪里

安装时，主工作流 `cyz-edu-research 0.3.0` 自动放进当前用户的 `.codex/skills/cyz-edu-research`。设置过 `CODEX_HOME` 的用户，使用该目录下的 `skills`。软件安装位置改变，不会改变 Codex 的 Skill 目录。

安装包内有固定版的 41 个工作流文件及许可文本。复制前逐文件校验；已有相同版本且内容一致就直接复用，有内容差异就保留原文件并提示，不自动覆盖。第一次打开工作台也会检查。安装 Skill 不会运行模型任务、不修改登录信息。

如果 Codex 尚未显示新 Skill，可重新打开相关任务或重启 Codex。工作台发起研究时会重新查询技能列表；识别不到、被禁用或版本不匹配时会说明原因，不作为普通聊天偷偷继续。

本安装包不包含 `humanizer`、`humanizer-zh` 等额外 Skill，也不包含 MinerU 模型。需要对应研究环节时，仍需按工作流的依赖说明准备；不会把你本机的其他技能私自打包。

## 第一次使用

1. 打开工作台，点击“打开或新建项目”，选择一个独立的空文件夹。已有研究项目则选原来的项目文件夹。
2. 在“草稿编辑”写几句话并保存，确认本地读写正常。
3. 发起研究对话前，确保本机 Codex CLI 已安装且已登录。安装版复用你的登录，不携带账号，也不自动消费额度。
4. 要解析 PDF，再准备好本机 MinerU Desk 和模型，在“文献材料”导入 PDF。先看解析样本，确认后再解析全文。

阶段导航不等于研究已经完成。研究任务产生的 Markdown 在“研究成果”中作为候选展示，核对后再确认保存。当前阅读区是解析文字，不是完整的原 PDF 图文阅读器。

## 卸载与更新

在 Windows“已安装的应用”中找到“CYZ 研究工作台”即可卸载。卸载移除程序和快捷方式，不主动删除外部研究项目、Codex Skill 或用户设置。请勿把研究项目放在安装目录内。

重新安装时仍执行同样的 Skill 内容检查。若已有不同的工作流版本或人工修改，先在 Codex 中备份、比较并决定使用哪一版；安装程序不会替你作这个决定。

## 给维护者

运行 `pnpm dist:win` 可构建安装包，产物位于 `release/`；此命令明确禁用自动发布。构建机需要 Node、pnpm 和 Python 3.11，最终使用者不需要。

固定资源：工作流 0.3.0 发布包，以及 [Python 官方 3.14.7 Windows 嵌入式包](https://www.python.org/downloads/release/python-3147/)，均在构建前校验 SHA256。安装向导使用 [electron-builder NSIS](https://www.electron.build/nsis/)。许可文本保留在程序资源目录中。

本地验收范围和限制见 [安装版验收记录](acceptance/2026-09-19-installer.md)。
