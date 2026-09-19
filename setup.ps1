$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Get-Command py,pnpm,node -ErrorAction Stop | Out-Null
& py -3.11 scripts/setup-workflow.py
if ($LASTEXITCODE -ne 0) { throw '工作流安装未完成，已停止。请检查冲突或下载提示。' }
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw '工作台依赖安装失败' }
& pnpm build
if ($LASTEXITCODE -ne 0) { throw '工作台构建失败' }
Write-Host '工作流已交给 Codex 的 skills 目录。现在可运行 pnpm start。'
Write-Host 'Codex 必须已安装并登录；语言依赖和 MinerU 模型需分别核验。'
