import { Schema } from 'koishi'

export interface SiteConfig {
  name: string // 🏷️ 站点显示名称
  url: string // 🔗 需要检测的 HTTP(S) 地址
  useProxy: boolean // 🌐 是否按网站探测代理模式使用代理
}

export type ComponentName = 'header' | 'cpu' | 'disk' | 'network' | 'process' | 'footer'
export type BackgroundMode = 'builtin' | 'local' | 'url' | 'none'
export type FontMode = 'npm' | 'release' | 'custom' | 'system'
export type MemoryPercentMode = 'platform' | 'available' | 'occupied'
export type SiteProxyMode = 'disabled' | 'inherit' | 'configured'

export const PROCESS_COUNT_MIN = 0
export const PROCESS_COUNT_MAX = 100
export const PROCESS_COUNT_DEFAULT = 10

export const DEFAULT_SITES: SiteConfig[] = [
  { name: '百度', url: 'https://www.baidu.com/', useProxy: false },
  { name: 'Gitee', url: 'https://gitee.com/', useProxy: false },
  { name: '哔哩哔哩', url: 'https://www.bilibili.com/', useProxy: false },
  { name: 'npm 镜像', url: 'https://registry.npmmirror.com/', useProxy: false },
  { name: '中科大 Debian', url: 'https://mirrors.ustc.edu.cn/debian/', useProxy: false },
  { name: 'Google', url: 'https://www.google.com/', useProxy: true },
  { name: 'GitHub', url: 'https://github.com/', useProxy: true },
  { name: 'YouTube', url: 'https://www.youtube.com/', useProxy: true },
  { name: 'npm 官方', url: 'https://registry.npmjs.org/', useProxy: true },
  { name: 'Debian 官方', url: 'https://deb.debian.org/debian/', useProxy: true },
]

export interface Config {
  // ---- 📌 指令设置 ----
  command: string // ⌨️ 主指令名称
  aliases: string[] // 🏷️ 指令别名列表
  authority: number // 🔐 执行指令所需的最低权限等级
  showCurrentBot: boolean // 🤖 是否仅展示执行指令的 Bot
  reply: boolean // 💬 是否引用触发指令的消息
  enableWaitingHint: boolean // ⏳ 是否显示采集与渲染等待提示

  // ---- 🖼️ 图片设置 ----
  components: ComponentName[] // 🧩 图片组件及排列顺序
  imageType: 'jpeg' | 'png' // 📤 输出图片格式
  imageQuality: number // 🎚️ JPEG 截图质量
  imageWidth: number // 📐 状态图片宽度
  theme: 'light' | 'dark' // 🎨 图片明暗主题
  fontMode: FontMode // 🔤 状态图片字体来源
  customFontPath: string // 📁 自定义字体绝对路径
  disableBlur: boolean // 🪟 是否关闭卡片毛玻璃效果
  disableRadius: boolean // ◼️ 是否关闭圆角效果
  disableShadow: boolean // 🌑 是否关闭阴影效果

  // ---- 📊 采集设置 ----
  collectInterval: number // ⏱️ 后台状态采样间隔
  collectTimeout: number // ⌛ 单项状态采集超时
  requestTimeout: number // 🌐 HTTP 请求超时
  siteProxyMode: SiteProxyMode // 🧭 网站探测代理来源
  siteProxyUrl: string // 🔐 网站探测自定义代理地址
  sites: SiteConfig[] // 🛰️ 网站连通性检测列表
  processCount: number // 📋 进程排行榜最大条数
  processSort: 'cpu' | 'memory' // 📈 进程排行榜排序依据
  ignoredProcesses: string[] // 🚫 忽略的进程名称正则列表
  ignoredDisks: string[] // 💽 忽略的磁盘挂载点正则列表
  ignoredNetworks: string[] // 📡 忽略的网卡名称正则列表
  hideIdleIo: boolean // 💤 是否隐藏无读写流量的项目
  memoryPercentMode: MemoryPercentMode // 🧠 RAM 圆环百分比口径
  showMemoryBars: boolean // 📊 是否显示全平台 MEM/SWP 内存横条

  // ---- 🌄 背景设置 ----
  backgroundMode: BackgroundMode // 🖼️ 背景图片来源模式
  backgroundPath: string // 📁 本地背景文件或目录路径
  backgroundUrl: string // 🔗 远程背景图片地址
  preloadCount: number // 📦 背景图片预加载数量

  // ---- 🧠 统计与调试 ----
  counterStorage: 'memory' | 'database' // 💾 消息计数存储模式
  resetCounterOnDisconnect: boolean // 🔄 Bot 断开时是否重置内存计数
  debug: boolean // 🐛 是否输出详细调试日志
}

const siteSchema = Schema.object({
  name: Schema.string()
    .required()
    .description('🏷️ 状态图中显示的站点名称'),
  url: Schema.string()
    .role('link')
    .required()
    .description('🔗 用于测试状态码与响应延迟的 HTTP(S) 地址'),
  useProxy: Schema.boolean()
    .default(false)
    .description('🌐 是否按网站探测代理模式使用代理<br><i>关闭时会强制直连，不继承 Koishi 或 isolate 代理。</i>')
    .experimental(),
})

export const Config: Schema<Config> = Schema.intersect([
  // ---- 📌 指令设置 ----
  Schema.object({
    command: Schema.string()
      .default('picstatus')
      .description('⌨️ 主指令名称<br><i>建议保留为 picstatus，避免与 Koishi 官方 status 插件发生冲突。</i>'),
    aliases: Schema.array(String)
      .role('table')
      .default(['运行状态', '状态', 'zt', 'yxzt'])
      .description('🏷️ 指令别名列表<br><i>与其他插件冲突的别名会被自动跳过，不会导致插件加载失败。</i>'),
    authority: Schema.number()
      .min(0)
      .default(1)
      .description('🔐 执行指令所需的最低权限等级'),
    showCurrentBot: Schema.boolean()
      .default(false)
      .description('🤖 是否仅展示执行指令的当前 Bot<br><i>关闭时会展示当前 Koishi 实例中的全部 Bot。</i>'),
    reply: Schema.boolean()
      .default(true)
      .description('💬 发送状态图片时是否引用触发指令的消息'),
    enableWaitingHint: Schema.boolean()
      .default(true)
      .description('⏳ 收到指令后是否发送“正在采集并渲染”提示<br><i>状态图片成功发送后会自动撤回该提示。</i>'),
  }).description('📌 指令设置 ⚙️'),

  // ---- 🖼️ 图片设置 ----
  Schema.object({
    components: Schema.array(Schema.union([
      Schema.const('header').description('🤖 Bot 信息与运行时间'),
      Schema.const('cpu').description('🧠 CPU、内存与 Swap 圆环'),
      Schema.const('disk').description('💽 磁盘容量与读写速度'),
      Schema.const('network').description('📡 网络速度与网站连通性'),
      Schema.const('process').description('📋 进程资源占用排行榜'),
      Schema.const('footer').description('📝 版本、时间与系统信息'),
    ]))
      .role('table')
      .default(['header', 'cpu', 'disk', 'network', 'process', 'footer'])
      .description('🧩 状态图组件及排列顺序<br><i>删除某项即可隐藏对应组件，也可以拖动调整上下顺序。</i>'),
    imageType: Schema.union([
      Schema.const('jpeg').description('🌄 JPEG：体积较小，支持调整图片质量'),
      Schema.const('png').description('🖼️ PNG：无损图片，不使用质量参数'),
    ])
      .role('radio')
      .default('jpeg')
      .description('📤 Puppeteer 输出的图片格式'),
    imageQuality: Schema.number()
      .role('slider')
      .min(1)
      .max(100)
      .step(1)
      .default(90)
      .description('🎚️ JPEG 截图质量，范围 1-100<br><i>选择 PNG 时此设置不生效。</i>'),
    imageWidth: Schema.number()
      .min(480)
      .max(1600)
      .default(650)
      .description('📐 状态图片宽度，单位 px，范围 480-1600'),
    theme: Schema.union([
      Schema.const('light').description('☀️ 浅色主题'),
      Schema.const('dark').description('🌙 深色主题'),
    ])
      .role('radio')
      .default('light')
      .description('🎨 状态图片的明暗主题'),
    fontMode: Schema.union([
      Schema.const('npm').description('📦 使用 npm 内置的 LXGW WenKai Screen 字体'),
      Schema.const('release').description('📥 使用 data/fonts 中由 Release 托管的 LXGW WenKai Mono 字体'),
      Schema.const('custom').description('📁 使用自定义绝对路径中的字体文件'),
      Schema.const('system').description('💻 使用 Chromium 所在系统的默认字体'),
    ])
      .role('radio')
      .default('npm')
      .description('🔤 状态图片字体来源<br><i>Release 模式会在插件加载时检查公共字体目录，只有缺失或校验失败时才会下载。</i>'),
    customFontPath: Schema.string()
      .role('textarea', { rows: [2, 4] })
      .default('')
      .description('📁 自定义字体文件绝对路径<br><i>仅在字体来源选择“自定义绝对路径”时生效，支持 TTF、OTF 和 WOFF2。</i>'),
    disableBlur: Schema.boolean()
      .default(false)
      .description('🪟 是否关闭卡片的毛玻璃模糊效果<br><i>在性能较弱的设备上关闭可略微减少渲染耗时。</i>'),
    disableRadius: Schema.boolean()
      .default(false)
      .description('◼️ 是否关闭卡片、标签与头像的圆角效果'),
    disableShadow: Schema.boolean()
      .default(false)
      .description('🌑 是否关闭卡片、标签与文字的阴影效果'),
  }).description('🖼️ 图片设置 🎨'),

  // ---- 📊 采集设置 ----
  Schema.object({
    collectInterval: Schema.number()
      .min(1)
      .default(10)
      .description('⏱️ 后台状态采样间隔，单位秒<br><i>用于刷新 CPU、磁盘、网络和进程状态。</i>'),
    collectTimeout: Schema.number()
      .min(1)
      .default(10)
      .description('⌛ 单项状态采集的最长等待时间，单位秒<br><i>某一项超时只会显示为不可用，不会中断整张图片。</i>'),
    requestTimeout: Schema.number()
      .min(1)
      .default(8)
      .description('🌐 网站检测、头像和远程背景请求的超时时间，单位秒'),
    siteProxyMode: Schema.union([
      Schema.const('disabled').description('🚫 禁用代理：全部网站探测强制直连'),
      Schema.const('inherit').description('🧩 继承代理：勾选代理的站点继承 Koishi 或 isolate 的 proxyAgent'),
      Schema.const('configured').description('🔐 配置代理：勾选代理的站点使用下方代理地址'),
    ])
      .role('radio')
      .default('disabled')
      .description('🧭 网站连通性探测的代理模式<br><i>继承或配置代理前，请先安装并启用 Koishi 的 proxy-agent 插件。</i>')
      .experimental(),
    siteProxyUrl: Schema.string()
      .default('http://127.0.0.1:7890')
      .description('🔐 网站探测代理 URL<br><i>仅“配置代理”模式生效，支持 HTTP、HTTPS、SOCKS4、SOCKS4A、SOCKS5 与 SOCKS5H；需启用 proxy-agent 插件。</i>')
      .experimental(),
    sites: Schema.array(siteSchema)
      .role('table')
      .default(DEFAULT_SITES)
      .description('🛰️ 网站连通性检测列表<br><i>状态图会按此处顺序显示 HTTP 状态码、状态文本和响应延迟。</i>'),
    processCount: Schema.number()
      .min(PROCESS_COUNT_MIN)
      .max(PROCESS_COUNT_MAX)
      .default(PROCESS_COUNT_DEFAULT)
      .description(`📋 进程排行榜最大显示条数，范围 ${PROCESS_COUNT_MIN}-${PROCESS_COUNT_MAX}，填写 ${PROCESS_COUNT_MIN} 可隐藏全部进程数据`),
    processSort: Schema.union([
      Schema.const('cpu').description('🧠 按 CPU 占用率降序排列'),
      Schema.const('memory').description('💾 按常驻内存大小降序排列'),
    ])
      .role('radio')
      .default('cpu')
      .description('📈 进程排行榜的排序依据'),
    ignoredProcesses: Schema.array(String)
      .role('table')
      .default([])
      .description('🚫 忽略的进程名称正则表达式列表<br><i>匹配时不区分大小写。</i>'),
    ignoredDisks: Schema.array(String)
      .role('table')
      .default([])
      .description('💽 忽略的磁盘挂载点正则表达式列表<br><i>例如可填写 ^/boot 或 ^C:\\\\Windows。</i>'),
    ignoredNetworks: Schema.array(String)
      .role('table')
      .default(['^lo(op)?\\d*$', '^(Loopback|本地连接)'])
      .description('📡 忽略的网卡名称正则表达式列表<br><i>默认忽略回环接口。</i>'),
    hideIdleIo: Schema.boolean()
      .default(false)
      .description('💤 是否隐藏当前读写或收发速度均为 0 的磁盘与网卡项目'),
    memoryPercentMode: Schema.union([
      Schema.const('platform').description('🧠 平台推荐：Linux/Android 使用 htop 已用、Windows 使用物理已用、macOS 使用活跃内存'),
      Schema.const('available').description('📉 内存压力：(总量 - 可用) / 总量'),
      Schema.const('occupied').description('📈 非空闲总量：(总量 - 空闲) / 总量'),
    ])
      .role('radio')
      .default('platform')
      .description('🧮 RAM 圆环中心百分比及下方第一行“已用 / 总量”的统计口径<br><i>此设置不改变圆环和彩条中各类内存的真实长度。</i>')
      .experimental(),
    showMemoryBars: Schema.boolean()
      .default(true)
      .description('📊 是否显示 MEM 与 SWP 内存横条<br><i>各平台按实际可获取的内存分类染色；关闭后仍保留分类圆环和紧凑数字。</i>')
      .experimental(),
  }).description('📊 状态采集设置 🔍'),

  // ---- 🌄 背景设置 ----
  Schema.object({
    backgroundMode: Schema.union([
      Schema.const('builtin').description('🎨 使用插件内置的默认背景'),
      Schema.const('local').description('📁 从本地文件或目录读取背景'),
      Schema.const('url').description('🔗 从固定远程 URL 下载背景'),
      Schema.const('none').description('🚫 不使用图片背景'),
    ])
      .role('radio')
      .default('builtin')
      .description('🖼️ 默认背景图片来源<br><i>用户随指令发送或引用的图片始终拥有更高优先级。</i>'),
    backgroundPath: Schema.string()
      .default('data/picstatus/backgrounds')
      .description('📁 本地背景文件或目录路径<br><i>相对路径基于 Koishi 的 ctx.baseDir 解析，目录模式会随机选择受支持图片。</i>'),
    backgroundUrl: Schema.string()
      .role('link')
      .default('')
      .description('🔗 固定远程背景图片地址<br><i>仅在背景来源选择 URL 时生效。</i>'),
    preloadCount: Schema.number()
      .min(0)
      .max(20)
      .default(2)
      .description('📦 后台预加载的背景图片数量，范围 0-20<br><i>填写 0 可禁用背景预加载。</i>'),
  }).description('🌄 背景图片设置 🖼️'),

  // ---- 🧠 统计与调试 ----
  Schema.object({
    counterStorage: Schema.union([
      Schema.const('memory').description('🧠 内存计数：无需数据库，重启后清空'),
      Schema.const('database').description('💾 数据库计数：需要 database 服务，重启后保留'),
    ])
      .role('radio')
      .default('memory')
      .description('💾 Bot 收发消息数量的存储模式<br><i>数据库服务不可用时会继续使用内存计数。</i>'),
    resetCounterOnDisconnect: Schema.boolean()
      .default(true)
      .description('🔄 Bot 断开连接时是否重置内存消息计数<br><i>数据库模式不会因断开连接而清除持久化数据。</i>'),
    debug: Schema.boolean()
      .default(false)
      .description('🐛 是否输出详细调试日志<br><i>生产环境建议关闭，排查采集或渲染问题时再开启。</i>'),
  }).description('🧠 统计与调试设置 🔧'),
])
