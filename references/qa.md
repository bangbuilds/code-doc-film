# 检查与调试

## 自动检查

```bash
python3 scripts/film.py qa            # 静态检查，几秒
python3 scripts/film.py qa --frames   # 加上抽帧检查，30 个镜头约 1 分钟
python3 scripts/film.py qa --frames --only ceylon africa    # 只查这几帧
```

**静态检查**（`✗` 是错误，必须改；`⚠` 是警告，要看）：

| 信息 | 怎么办 |
|---|---|
| `number “17” in the narration is not covered by any entry in facts[]` | 给这个数字补一条 fact 和出处。查不到出处的数字不要写进稿子 |
| `facts without a source` | 补来源；真没核到就写「未单独核对链接」并在交付时告诉用户 |
| `shot “x” has no renderer in scenes/…` | `film.json` 里的镜头 id 在场景文件的 `shots` 里没有同名函数 |
| `only 0.8s long — too short to read` | 镜头或标注太短，挪切点 |
| `subtitle too long` | 把这句旁白在标点处拆成两句 |
| `over the x limit of 140s` | X 普通账号最长 2 分 20 秒，见 `delivery.md` |
| `timeline is a DRY run` | 还没真配音，渲染前跑 `film.py audio` |
| `film.json was edited after the timeline was built`（错误） | 镜头、地图取景、标注是在 `film.py audio` 时解析进时间轴的。改了 `film.json` 之后要再跑一次 `film.py audio`（已合成的句子走缓存，不花钱），否则预览和渲染用的还是旧值 |

**抽帧检查**：每个镜头取开头（淡入之后）、中间、结尾三帧，无头渲染后逐帧看：

| 信息 | 常见原因 |
|---|---|
| `SCENE ERROR — the code threw`（算错误，不是警告） | 这个镜头的代码运行时出错。把提示的那张图打开来看：整帧是深红底，上面写着报错和 `scenes/xxx.js:行:列`。只有出错的镜头会被标出来；如果每一个镜头都报，多半是场景文件有语法错误或 import 写错了名字 |
| `every sampled frame is one flat colour`（算错误） | 整页脚本都没跑起来，连报错面板都画不出。开预览（`tools/serve.py`）看浏览器控制台 |
| `engine warning on this frame` | 机位被引擎修正过。打开那张图，右上角红框里写着原因：`camera … is under the ground` = 机位写到了地面以下；`terrain blocks the view` = 机位和目标之间有山。回去改镜头（用 `W.on(x, z, 离地)`，或换角度） |
| `nearly black` | 光太暗、灯没开、机位埋在东西里、镜头对着背光面。夜景本身偏暗是正常的，阈值已经放宽；真报出来就是黑得看不见 |
| `blown out` | 点光强度太大、雾太浓太亮、曝光太高 |
| `flat, almost no detail` | 浓雾里什么都没有，或镜头对着一面墙、一片天 |

然后**把总览图打开来看** `build/qa/contact-1.jpg`、`-2.jpg`…… 每格左上角是「帧/镜头 时间」。脚本查不出来、要靠眼睛的问题：

- 主体太小，看不出是什么（人在 100 米外就是点）。
- 画面一半是空的水面、空的天、空的坡。
- 字幕或左上角标题压在主体上。
- 相邻两个镜头看起来一模一样。
- 颜色和时间不对（说的是夜里，画面是白天）。
- 标注的数字和旁白正说的那句对不上。

有疑问的镜头，单独看全尺寸：`build/qa/frame-NN-at-<时间>s.png`。

## 在浏览器里调单个镜头

改一个镜头就全片抽帧太慢。日常调试用预览。这一节需要一个你能操作的浏览器（能打开本地网页、在页面里执行 JS、截图）；没有的话跳过这一节，用 `film.py qa --frames --only <帧id>` 代替，慢一点但结果一样。

1. 起一个本地服务：`python3 tools/serve.py 8765 .`（在工程目录里）。**一定用 `tools/serve.py`**，不要用 `python3 -m http.server`：后者不发禁用缓存的头，浏览器会一直用旧的 JS 模块，你改了代码页面却不变。
   在 Claude Code 桌面版里，把它登记进 `.claude/launch.json` 再用预览面板打开：
   ```json
   { "name": "film-preview", "runtimeExecutable": "python3", "runtimeArgs": ["videos/<slug>/tools/serve.py", "8765", "videos/<slug>"], "port": 8765 }
   ```
2. 把视口设成 1920×1080（竖屏 1080×1920），打开 `http://localhost:8765/index.html`。有些环境每轮对话会重置视口，截图前确认一下。
3. 在页面里执行：
   ```js
   await window.__hf.buildReady['film'];
   const F = window.__film.film.frames;
   const at = (id, shot, k) => { const f = F.find(x => x.id === id), s = f.shots.find(x => x.id === shot); return f.start + s.start + (s.end - s.start) * k; };
   window.__film.renderAt(at('ceylon', 'stele', 0.5));     // 画出这个镜头的中间一帧，然后截图
   window.__film.qa([at('ceylon', 'stele', 0.1), at('ceylon', 'stele', 0.9)]);   // 返回这些时刻的引擎警告
   ```
4. 一次看多帧：`await import('/tools/sheet.js?' + Date.now()); window.__sheet([t1, t2, …], 4);` 把这些时刻拼成一张图盖在页面上（只有三维画面，不含字幕叠层）；`window.__unsheet()` 关掉。

只想预览几帧时用 `film.py index --only <帧id …>` 生成一个短片的 `index.html`（记得之后再跑一次不带 `--only` 的 `film.py index`，否则渲染出来的就是短片）。

页面打不开、一片黑：看控制台。最常见的是场景文件里的语法错误或 import 了不存在的名字——`buildReady` 的 promise 会带着报错信息拒绝。

## 这套做法翻过的车

每一条都真实发生过，现在的保护措施写在后面。

| 翻车 | 现在怎么防 |
|---|---|
| 机位放进了山体里，画面是一整面土坡 | `world.cam` 自动抬高并报警 |
| 黄土塬面高 150 米，机位写在 16 米，从地底往上看，人和树像飘在空中 | 同上；写机位用 `W.on()` |
| 旁白说到哈达铺，画面还在上一个场景 | 镜头切点绑定到 `cue:N` |
| 夜战的照明弹太亮，夜景成了白天 | 点光先用小值；抽帧检查报 `blown out` |
| 整条江被火光倒影染红 | `ember` 用很暗的颜色（`#140804` 量级） |
| 树是纯黑的 | 实例颜色会和材质颜色相乘，材质底色必须是白（已在 `scatterTrees` 里修好） |
| 窑洞只露出拱顶 | 贴墙的东西放在墙脚外沿，不要放进墙的坡里；背光面看不见，调 `sunDir` |
| 两支「会师」的队伍最后隔着 40 米 | 路径终点要真的靠在一起；看结尾那一帧 |
| 水面比草地高，沼泽成了一片湖 | 水面有起伏，静水用 `amp` 压平并把水位放低 |
| 机位旁边的树是巨大的色块 | `trees.clear` 清掉机位和主体周围 |
| 爆炸是一个硬边光球 | 用 `createBlasts`（软光 + 水柱） |
| 改了代码页面不变 | 用 `tools/serve.py` 预览 |
| 页面永远不就绪 | 图片加载用 `onload`，不用 `img.decode()`（后台页面里它永远不返回） |
| 数字写错（9 天 9 夜，实为 7 天 7 夜） | 每个数字进 `facts` 并带出处；写稿前先查 |
| 凭印象写「麒麟送到北京」，查了才知道 1415 年都城还在南京 | 同上：地点、年份也要查，不只是数字 |
| 镜头正对太阳，海面一片白、太阳是一团光 | 看清东西的镜头把太阳放在镜头背后；对着太阳的镜头 `bloom` ≤ 0.5 |
| 热带沙滩是深褐色 | 色表用 `tropic` / `savanna` / `arid`，别用 `lush` |
| 明朝人戴着军帽、背着背包 | `figure` 选项（`hat`、`pack`、`robe`、`rifle`） |
| 印度的海边出现了中式大屋顶 | 建筑跟着地方走：中式用 `addHouses`，海湾一带用 `addFlatHouses` |
| 船队全在镜头背后，画面里只有一艘 | 编队是从旗舰往后排的；机位放在船队后部往前看，或把旗舰放远 |
| 尾流像一排车灯 | 已调淡；抛锚的船传 `moving: false` |
| 地名标签贴在了错的岛上（「爪哇」标在婆罗洲） | 地点在画面外时标签不再显示；地图取景用 `fit`，它会把点都放进没有字幕和标题的区域 |
| 航线贴着海岸、甚至压在陆地上 | 航线的中间点往海里多放半度到一度；每个地图镜头放大看一遍 |
| 改了 `film.json` 里的地图取景，预览没变 | 要重跑 `film.py audio`；现在检查脚本会报错提醒 |
| 拉远之后航线细得看不见 | 线宽、虚线、圆点现在随机位距离放大 |
| 下载地形时报证书错误 | 脚本会自动换用 curl；瓦片并行下载 |
| 罗盘的针指着东 | 道具的朝向和贴图的朝向要对一遍：盘面「子」朝 -z，针的红头停在「午」 |
| 视频第一帧是黑的，缩略图一片黑 | `meta.cover`；打包时会检查第一帧亮度 |
