# code-doc-film

一个 Agent Skill（在 [Claude Code](https://claude.com/claude-code) 上做的、测的）：说一句题目，做出一条 1–3 分钟的 **3D 纪录短片**。

画面全部由代码实时渲染（three.js），地图用真实地形数据，配乐和环境声用 numpy 合成。**不用一张图片、一段视频素材、一首现成的曲子。**

成片演示见作者的 X：[@bangbuilds](https://x.com/bangbuilds)（《长征》《郑和下西洋》两条都是用它做的）。

## 它做什么

你说：「做一条郑和下西洋的 3D 视频」。Claude 会：

1. 查资料、写旁白稿，把**稿子和每个数字的出处**列给你确认
2. 下载这片区域的真实地形（先告诉你要下什么、多大，你同意才下）
3. 写三维场景、排镜头、配音、合成配乐
4. 无头渲染抽帧自查（黑屏、过曝、机位钻进山里、数字没出处……）
5. 渲染出片，连同封面、上传版、预览版一起交给你

范例《郑和下西洋》：2 分 05 秒，30 个镜头，从一句话到成片 55 分钟（其中渲染 6 分钟）。

## 安装

需要：

- Claude Code（或其他能加载 `SKILL.md` 格式 skill 的编程助手，见下）
- Node.js 20+（渲染用 [HyperFrames](https://hyperframes.heygen.com)，通过 `npx` 调用）
- Python 3.10+，装好 `numpy` 和 `Pillow`
- `ffmpeg`

```bash
git clone https://github.com/bangbuilds/code-doc-film ~/.claude/skills/code-doc-film
pip install numpy pillow
```

然后在 Claude Code 里直接说题目就行，比如「做一条丝绸之路的 3D 视频」。

**Codex 等其他工具**：skill 是通用的 `SKILL.md` 格式，脚本只依赖 Python、Node 和 ffmpeg，装到那个工具读取 skill 的目录即可，例如：

```bash
git clone https://github.com/bangbuilds/code-doc-film ~/.agents/skills/code-doc-film
```

这条路**没有实测过**——能加载是一回事，三维场景写得好不好、会不会自己看图挑毛病，取决于模型。试过的话欢迎提 issue 告诉我结果。

## 不经过 AI，先手动跑一遍范例

```bash
SK=~/.claude/skills/code-doc-film        # 你克隆到的位置
python3 $SK/scripts/new_project.py zheng-he-demo --example zheng-he
cd zheng-he-demo
python3 scripts/film.py geo              # 列出要下载的地形：189 张瓦片，约 14 MB
python3 scripts/film.py geo --download   # 同意后下载
python3 scripts/film.py audio            # 配音（默认用系统语音）+ 配乐 + 环境声
python3 scripts/film.py qa --frames      # 抽帧检查，生成总览图 build/qa/contact-*.jpg
python3 scripts/film.py render           # 渲染 + 打包，约 6 分钟
```

## 配音

默认 `"provider": "auto"`：装了 `edge-tts` 就用它，否则在 macOS 上用系统自带的 `say`。系统语音机器味重，够排片和出第一版；要好听的声音，接你自己的语音合成：

- 任意命令行：`"provider": "command", "command": "mytts --out {out} \"{text}\""`
- 或者在 `~/.config/code-doc-film/` 放一个 `tts_<名字>.py`，实现 `synth(text, voice, out_path)`，然后 `"provider": "<名字>"`。云端声音的密钥放在这里，不要放进工程。

每一句旁白合成后都有缓存，改一句只重新合成那一句。

## 现在的状态（请先看这段）

这是一个**早期版本**，如实说明：

- 到目前只做过两条片子，都是 Claude Code 做的，都在同一台机器上（macOS，Apple Silicon）。**Linux、Windows、Codex 等其他工具都没有测过**。
- 配音：系统语音 `say`、任意命令行、自定义插件三条都实测过；`edge-tts` 这一条**没有**实测过。
- 发布前做过一次干净安装测试：只用仓库里的文件新建工程，用系统语音把范例完整渲了出来（2 分 17 秒，渲染 5.8 分钟，检查 0 错误）。
- 小人是低模剪影，近看是方块；它做不了人脸、表演、人物特写。
- 场景库里有：河谷、峡谷、湖、雪山垭口、沼泽、黄土高原、一线天、街巷、桌面特写、外海、海岸港湾，以及队伍、船队、码头、集市、驼队、火、烟、雨、雪。库里没有的东西（现代城市、车辆、机械……）Claude 会现写，会慢很多。
- 历史题材的事实核对靠网上能查到的来源，**稿子务必自己过一遍**。skill 的规矩是：每个数字带出处、有争议的不讲、没核到原文的如实标出来。
- 地图上不画任何国界和省界。

## 目录

```
SKILL.md              Claude 读的入口：流程、规矩
references/           详细文档：film.json 字段、场景库、声音、检查、红线、交付
scripts/new_project.py   新建工程 / 升级已有工程的引擎
template/film/        渲染引擎（three.js）：地形、水、海、船队、人物、道具、地图、字幕叠层
template/scripts/     film.py（唯一入口）、geo.py（地形）、synth.py（配乐和环境声）
examples/zheng-he/    完整范例：film.json + 10 个场景文件
```

一条片子 = 一个 `film.json`（旁白、镜头切点、地图、数字标注、配乐情绪）+ 每段一个场景文件。镜头切点绑定到「第几句旁白」而不是秒数，所以改稿、换声音都不用重排镜头。

## 数据与署名

- 地形：[Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/)（Mapzen / Tilezen 整理的公开数据，来源包括 SRTM、GMTED2010、ETOPO1 等）。发布用它做的片子时，请按其[署名要求](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)注明数据来源。
- 河流：[Natural Earth](https://www.naturalearthdata.com/)（公共领域）。
- 渲染：[three.js](https://threejs.org/)（MIT）、[HyperFrames](https://hyperframes.heygen.com)。

## 许可

MIT，见 [LICENSE](LICENSE)。

---

**English.** An Agent Skill (built and tested with Claude Code) that turns one sentence ("make a 3D film about Zheng He's voyages") into a 1–3 minute narrated documentary short. Every frame is rendered from code with three.js over real terrain data; the score and ambience are synthesized with numpy; no images, footage or stock music. Docs and prompts are in Chinese. Early release: two films made, tested on macOS only.
