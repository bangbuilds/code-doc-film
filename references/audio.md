# 声音：配音、配乐、环境声

三条音轨：旁白（语音合成）、配乐、环境声。后两条完全在本地用 numpy 算出来，不调任何服务，不用任何素材。

```bash
python3 scripts/film.py audio --dry   # 不合成配音：按字数估时长，生成静音占位。用来排镜头、排标注，不花钱
python3 scripts/film.py audio         # 真配音 → 句子时间 → build/timeline.json → 配乐 + 环境声
python3 scripts/film.py score         # 只重做配乐和环境声（改了情绪、标签之后）
```

## 配音

`meta.voice`：

| 字段 | 含义 |
|---|---|
| `provider` | 用什么合成，见下面「配音从哪来」。默认 `"auto"` |
| `id` | 音色名，各家不同（`say` 默认 `Tingting`，`edge` 默认 `zh-CN-XiaoxiaoNeural`） |
| `speed` | 合成时的语速，保持 1.0 |
| `tempo` | 合成后用 ffmpeg 在本地调速（1.08 = 快 8%）。**改节奏改这个**，不用重新合成 |
| `lead` / `tail` | 每帧配音前后的留白（秒）。画面需要先交代环境就加大 `lead` |
| `gap` | 句与句之间的停顿（秒），默认 0.28 |
| `unit` | `"cue"`（默认）：一句一合成，句子时间是精确的。`"frame"`：一帧一合成，句界靠停顿检测，不太准，只为兼容旧音频 |

### 配音从哪来

| `provider` | 是什么 | 备注 |
|---|---|---|
| `auto`（默认） | 装了 `edge-tts` 就用它，否则在 macOS 上用 `say` | 不用配置就能出声 |
| `say` | macOS 自带的语音 | 免费、离线，机器味重——够排片和出第一版 |
| `edge` | 命令行工具 `edge-tts`（要自己 `pip install edge-tts`） | 这条路径作者没有实测过 |
| `command` | 任意命令行：`"command": "mytts --voice x --out {out} \"{text}\""` | `{text}` 是一句旁白，`{out}` 是要写出的音频文件 |
| 自己的名字 | 在 `~/.config/code-doc-film/` 放一个 `tts_<名字>.py`，里面写 `synth(text, voice, out_path)` | 付费的云端声音和它的密钥放这里，不要放进工程 |

先问用户有没有想用的声音；没有就用默认的出片，并在交付时说明「旁白是系统语音，可以换」。

云端配音通常**按次付费**，所以：
- 稿子确认之前只用 `--dry`。
- 合成结果按「文本 + 音色」缓存在 `audio/tts/`，没改的句子不会重新合成。改一句只花一句的钱。
- 想快一点、慢一点，改 `tempo`，不改 `speed`。

中文旁白的节奏：正常约 4.3 字/秒（`tempo` 1.0 时）。一帧 10–14 秒、三四句话最舒服。数字多的句子读得慢（「1935年10月19日」是九个音节）。

## 配乐

每个镜头的 `music` 写情绪名，或写对象细调：

```json
"music": "battle"
"music": { "mood": "tension", "chord": "Bb", "level": 0.8, "bright": 0.4, "drums": "pulse", "horn": ["F4", "Bb4"] }
```

| 情绪 | 听感 | 鼓 | 默认和弦 |
|---|---|---|---|
| `silence` | 无 | — | — |
| `swell` | 低音弦乐铺底，开场、地图 | — | Dm |
| `calm` | 平静 | — | F、Bb |
| `somber` | 低沉、哀伤 | — | Dm、Am |
| `tension` | 紧张，缓慢的大鼓 | pulse | Gm、Bb、A |
| `march` | 行军，军鼓 | march | Bb、Gm、Dm |
| `battle` | 战斗，密集军鼓加大鼓 | battle | Dm、Gm |
| `reveal` | 揭示，一记重鼓 | hit | Dm、F |
| `hope` | 转明亮，有号角 | hit | F、C |
| `triumph` | 胜利，全奏加号角 | battle | D |
| `resolve` | 收束 | hit | D |

可用和弦：`Dm Gm Am Em Cm`（小调，沉）和 `F C G D A Bb Eb`（大调，亮）。`level` 音量（0.5 轻 … 1.3 最强），`bright` 音色明暗（0.25 暗 … 0.8 亮），`horn` 号角旋律的音名。

编排的思路：全片围绕一个调（长征用 D 小调）；平铺直叙用 `swell` / `calm`，冲突升级用 `tension` → `battle`；**转折和胜利才转大调**（`hope`、`triumph`），全片只留两三个高点，否则高点不高。一帧里情绪要变（比如说到「转折点」时变亮），在帧上写一组按句切的 `music` 段落。

## 环境声

镜头的 `ambience` 是标签数组，可以叠加：

| 标签 | 声音 |
|---|---|
| `river` / `rapids` / `lake` | 缓流 / 急流 / 湖水轻响 |
| `sea` / `surf` / `sails` | 外海的涌浪 / 浪打沙滩 / 船上木头和缆绳的吱呀声 |
| `rain` / `wind` / `blizzard` | 雨 / 风 / 暴风雪 |
| `fire` | 火的低吼和噼啪 |
| `gunfire` / `battle` | 零星枪声 / 密集枪声加炮声 |
| `march` | 许多人的脚步 |
| `crowd` | 人群的嘈杂 |
| `night` | 夜虫 |
| `room` | 室内的安静底噪 |

规则很简单：**画面里有什么就给什么声音**。河边的镜头加 `river`，下雨加 `rain`，有队伍加 `march`，有火加 `fire`。地图镜头不加环境声。

## 响度

旁白平均约 −18 dB；配乐平均约 −28 dB，有人说话时再自动压 9 dB；环境声约 −37 dB，说话时压 5 dB。出片时整体归一到 −16 LUFS（各平台通用）。觉得配乐压不住或太吵，调 `meta.musicLevel`（默认 0.62）和 `meta.ambienceLevel`（默认 0.30），再 `film.py score`。
