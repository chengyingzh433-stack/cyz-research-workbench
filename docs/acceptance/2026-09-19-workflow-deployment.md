# 工作流配套部署验证

用户重新授权新建仓库上传源码。默认私有；不上传用户研究资料或运行缓存，不发布安装包。

- 当前已安装 Skill 与固定 0.3.0 ZIP 逐文件一致，安装脚本报告 already_verified，未更改已有安装。
- 全新临时 Codex 主目录安装成功，随后用其初始化脚本建立临时研究项目；结构校验 PASS，0 warning。新目录的三个外部依赖均报告缺失，没有虚报就绪。
- 错误 ZIP 会在创建安装目标前被 HASH_MISMATCH 拒绝。
- 运行时使用 CODEX_HOME 统一初始化、解析及研究 Skill 位置；0.3.0 版本门禁、Codex 启用状态检查和显式 skill 输入已有单元测试。
- 本机 Codex skills/list 实测识别并启用固定工作流；无模型轮次，详见 workflow-binding-probe.json。尚未将完整研究学术质量当成接口验证结果。
