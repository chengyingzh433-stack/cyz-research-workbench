!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 CYZ 研究工作台"
  !define MUI_WELCOMEPAGE_TEXT "这是配合 Codex 使用的本地教育研究工作台。$\r$\n$\r$\n接下来可选择安装位置。安装程序会创建桌面和开始菜单快捷方式，并自动安装 cyz-edu-research 0.3.0 工作流 Skill。已有 Skill 若有不同内容，将保留并提示。$\r$\n$\r$\n无需另装 Node 或 Python。研究对话需要本机 Codex 已登录；PDF 解析需要本机 MinerU 及其模型。$\r$\n$\r$\n请把研究项目存放在独立文件夹，不要放进程序安装目录。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstall
  DetailPrint "正在安装配套工作流 Skill（已有修改不会覆盖）..."
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --install-workflow' $0
  ${If} $0 != 0
    DetailPrint "Skill 自动安装未完成：已有文件已保留。首次打开工作台时会再次检查。"
    IfSilent cyz_skill_notice_done
    MessageBox MB_OK|MB_ICONEXCLAMATION "工作台已安装，但配套 Skill 需要检查。已有文件均已保留，没有覆盖。请打开工作台查看提示。"
    cyz_skill_notice_done:
  ${Else}
    DetailPrint "配套工作流 Skill 已就绪。"
  ${EndIf}
!macroend

!macro customUnInstall
  DetailPrint "保留研究项目、Codex Skill 和用户设置。"
!macroend
