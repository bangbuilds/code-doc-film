# 范例：《郑和下西洋》（海上题材）

2 分 05 秒，12 段（封面 + 开场 + 8 站 + 过洋牵星 + 结尾），用户只给了一句题目，确认过一次稿子。

```bash
SK=~/.claude/skills/code-doc-film        # skill 装在哪就写哪
python3 $SK/scripts/new_project.py videos/zheng-he-copy --example zheng-he
cd videos/zheng-he-copy
python3 scripts/film.py geo            # 列出要下载的地形瓦片（189 张，约 14 MB）；同意后加 --download
python3 scripts/film.py audio --dry    # 不花钱试排
```

值得照着学的地方：

- **跨洋地图**：`meta.style` 里的 `"sea"` 和 `"ramp": "warm"`；三条路线（主线 + 去忽鲁谟斯 + 去东非）；地图镜头几乎全用 `fit`，其中几处用空的经纬度点把画面撑向一边。
- **一段一个地方**：每段先用地图镜头把航线画到这一站，再切进这一站的三维场景。
- **船队**：`f01_hook.js` 的编队和揭示镜头，`f03_changle.js` 的升帆（`fleet.furl`）和夜里的船灯。
- **没有人物的「人物节点」**：立碑 → 石碑近景；导航 → 罗盘和牵星板；献麒麟 → 逆光里的长颈鹿。
- **首尾呼应**：开场和结尾是同一片空海、同一个机位（`f01_hook.js` 的 `empty` 和 `f10_last.js` 的 `empty`）。

事实口径上故意没讲的：宝船尺寸（四十四丈之说有争议）、郑和去世的时间地点、两次交战的人数。
