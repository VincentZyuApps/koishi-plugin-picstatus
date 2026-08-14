# koishi-plugin-picstatus

[![npm](https://img.shields.io/npm/v/koishi-plugin-picstatus?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-picstatus)

跨平台采集设备与 Koishi 运行状态，并通过 Puppeteer 渲染图片。

## 功能

- CPU、内存、Swap、磁盘、网络、进程和网站连通性状态。
- Koishi Bot 信息、连接时间与消息收发计数。
- 支持消息图片、本地文件或目录、URL 和无背景模式。
- 支持 Windows、Linux、macOS 与容器环境。
- 支持 npm 内置、Release 下载、自定义绝对路径和系统默认字体四种模式。

默认指令为 `picstatus`，别名包括 `运行状态`、`状态`、`zt` 和 `yxzt`；发生别名冲突时会跳过冲突项，不影响插件加载。

默认会在采集与渲染期间发送等待提示，并在状态图片成功发送后自动撤回；可通过 `enableWaitingHint` 关闭。

指令支持以下仅对本次出图生效的 options，不会修改管理端配置：

```text
picstatus -s memory -n 10 -t dark
```

- `-s, --sort <cpu|memory>`：进程排行榜按 CPU 或常驻内存降序排列。
- `-n, --count <0-100>`：本次图片显示的进程数量，`0` 表示不显示进程数据。
- `-t, --theme <light|dark>`：本次图片使用浅色或深色主题。

需要启用 Koishi 的 `puppeteer` 与 `http` 服务；使用持久化消息计数时还需要 `database` 服务。

默认字体模式使用 npm 包内的 LXGW WenKai Screen，不访问公共字体 CDN。Release 模式仅在被选中时检查 `ctx.baseDir/data/fonts/LXGWWenKaiMono-Regular.ttf`，缺失或校验失败时依次尝试 Gitee 与 GitHub Release。自定义模式支持 TTF、OTF 和 WOFF2 绝对路径；字体准备失败会停止本次出图并写入后台日志。

## 来源与许可

本项目参考并移植自 [nonebot-plugin-picstatus](https://github.com/lgc-NB2Dev/nonebot-plugin-picstatus)，原项目由 LgCuwukii 等贡献者开发并采用 MIT License。

状态图字体使用 LXGW WenKai Screen 或 LXGW WenKai Mono，两者均依据 SIL Open Font License 1.1 分发，详细来源见 `notices.md`。
