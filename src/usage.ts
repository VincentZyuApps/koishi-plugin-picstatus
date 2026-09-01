const pkg = require('../package.json')

const colorChip = (label: string, background: string, foreground = '#171717') =>
  `<span style="display:inline-block;padding:1px 6px;margin:1px 2px;border-radius:3px;background:${background};color:${foreground};font-weight:600;line-height:1.5">${label}</span>`

export const usage = `
<h2>📊 PicStatus 状态图片 🖼️</h2>
<p><b>当前版本：</b>v${pkg.version}</p>

<p>
  <a href="https://www.npmjs.com/package/koishi-plugin-picstatus" target="_blank">
    <img src="https://img.shields.io/npm/v/koishi-plugin-picstatus?style=flat-square&logo=npm" alt="npm version">
  </a>
  <a href="https://npm-stat.com/charts.html?package=koishi-plugin-picstatus" target="_blank">
    <img src="https://img.shields.io/npm/dm/koishi-plugin-picstatus?style=flat-square&logo=npm" alt="npm downloads">
  </a>
  <br>
  <a href="https://github.com/VincentZyuApps/koishi-plugin-picstatus" target="_blank">
    <img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  </a>
  <a href="https://gitee.com/vincent-zyu/koishi-plugin-picstatus" target="_blank">
    <img src="https://img.shields.io/badge/Gitee-C71D23?style=for-the-badge&logo=gitee&logoColor=white" alt="Gitee">
  </a>
  <br>
  <a href="https://forum.koishi.xyz/t/topic/13562" target="_blank">
    <img src="https://img.shields.io/badge/Koishi%20Forum-13562-5546A3?style=for-the-badge" alt="Koishi Forum">
  </a>
  <a href="https://qm.qq.com/q/ZHj33L5cuC" target="_blank">
    <img src="https://img.shields.io/badge/QQ群-1085190201-12B7F5?style=flat-square&logo=qq&logoColor=white" alt="QQ群">
  </a>
</p>

<h2>💬 交流反馈</h2>
<p>🐛 Bug 反馈 / 💡 建议 / 👨‍💻 插件开发交流，欢迎加群：</p>
<p><del>QQ群：<b>259248174</b>（该群已停用）</del></p>
<p>QQ群：<b>1085190201</b> 🎉</p>
<p>💡 在群里直接艾特我，回复会更快哦~ ✨</p>

<p>发送 <code>picstatus</code>，即可查看当前设备与 Koishi 的图片状态面板。</p>
<p><b>⚠️ 使用前请启用：</b><code>puppeteer</code> 与 <code>http</code> 服务；<code>database</code> 仅在需要持久化消息计数时启用。</p>

<details>
<summary><b>⌨️ 指令与临时选项</b></summary>
<p>默认别名：<code>运行状态</code>、<code>状态</code>、<code>zt</code>、<code>yxzt</code>。</p>
<pre><code>picstatus -s memory -n 10 -t dark</code></pre>
<ul>
  <li><code>-s, --sort &lt;cpu|memory&gt;</code>：设置本次进程排序方式。</li>
  <li><code>-n, --count &lt;0-100&gt;</code>：设置本次进程显示数量，0 表示隐藏。</li>
  <li><code>-t, --theme &lt;light|dark&gt;</code>：设置本次图片主题。</li>
</ul>
<p>这些选项仅对本次出图生效，不会修改控制台配置。</p>
</details>

<details>
<summary><b>🔤 字体与背景说明</b></summary>
<p>字体支持 npm 内置、Release 下载、自定义绝对路径和系统默认字体四种模式。</p>
<p>Release 字体存放于 <code>ctx.baseDir/data/fonts/LXGWWenKaiMono-Regular.ttf</code>，仅在选择该模式且文件不可用时下载。</p>
<p>背景支持消息图片、内置背景、本地文件或目录、远程 URL 和无背景模式；消息中的图片优先级最高。</p>
</details>

<details>
<summary><b>📈 采集、计数与兼容性</b></summary>
<p>支持 Windows、Linux、macOS 与容器环境，可展示 CPU、内存、Swap、磁盘、网络、进程、网站和 Bot 状态。</p>
<p>网站探测支持禁用代理、继承 Koishi/isolate 代理、使用 PicStatus 配置代理三种模式，并可在站点列表中逐项控制。</p>
<p><b>⚠️ 使用 HTTP 或 SOCKS 代理前，必须先安装并启用 Koishi 的 <code>proxy-agent</code> 插件。</b></p>
<p>默认将国内外对应站点成对排列：百度/Google、Gitee/GitHub、哔哩哔哩/YouTube、npm 镜像/npm 官方、中科大 Debian/Debian 官方；国内站点默认直连，国外站点默认勾选代理。</p>
<p>消息计数默认保存在内存中；选择 database 后可跨重启保留，database 不可用时会回退到内存。</p>
</details>

<details>
<summary><b>🧠 内存与 Swap 颜色图例</b></summary>
<p>颜色表示内存类别，色段长度表示该类别占总量的比例。浅色与深色主题会调整明暗，但类别语义不变。</p>
<ul>
  <li><b>Linux / Termux(Android) 详细模式：</b>${colorChip('used', '#38A64B')} ${colorChip('shared', '#9676CE')} ${colorChip('compressed', '#666D75', '#fff')} ${colorChip('buffers', '#2594C7')} ${colorChip('cache', '#D4AA2A')} ${colorChip('free', '#C7C7C7')}</li>
  <li><b>Windows MEM / RAM：</b>${colorChip('used', '#38A64B')} ${colorChip('available', '#C7C7C7')}</li>
  <li><b>macOS / 通用平台 MEM / RAM：</b>${colorChip('active / used', '#38A64B')} ${colorChip('cache', '#D4AA2A')} ${colorChip('remaining', '#C7C7C7')}</li>
  <li><b>所有平台 SWAP / SWP：</b>${colorChip('used', '#DB5B64')} ${colorChip('cached', '#D4AA2A')} ${colorChip('free', '#C7C7C7')}</li>
</ul>
<p>Linux 与 Termux/Android 优先使用完整分类，读取不到 procfs 时回退到通用分类；Windows 的 SWAP 表示 pagefile，通常没有独立 cached 分类。</p>
<p><b>注意：</b>SWAP / SWP 的红色是 used 类别色，不是告警；实际占用比例由红色色段的长度和圆心百分比表示。</p>
</details>

<details>
<summary><b>📜 来源与许可</b></summary>
<p>本插件参考并移植自 <a href="https://github.com/lgc-NB2Dev/nonebot-plugin-picstatus" target="_blank">nonebot-plugin-picstatus</a>，依据 MIT License 发布。</p>
<p>LXGW WenKai 字体依据 SIL Open Font License 1.1 分发，完整声明请查看 npm 包中的 <code>notices.md</code>。</p>
</details>

<p>📖 完整配置与故障排查请查看插件 README。</p>
`
