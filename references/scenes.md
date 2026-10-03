# 写场景

一个场景文件（`scenes/<name>.js`）= 搭一次世界（`setup`）+ 每个镜头一个函数（`shots`）。镜头的起止时间、入场出场、标注、配乐都在 `film.json` 里，场景文件只管画面。

最小可运行的例子是新工程里的 `scenes/example.js`；完整范例在 `examples/zheng-he/scenes/`。

## 目录
- [场景文件的结构](#场景文件的结构)
- [镜头函数拿到什么、返回什么](#镜头函数)
- [机位](#机位)
- [光线 LOOKS](#光线-looks)
- [地形库 worlds.js](#地形库)
- [演员：队伍、人群、船、旗](#演员)
- [粒子 fx](#粒子-fx)
- [道具库 props.js](#道具库)
- [范例场景速查](#范例场景速查)
- [场景库里没有的东西怎么加](#加新东西)
- [竖屏](#竖屏)

## 场景文件的结构

```js
import { THREE, LOOKS, createColumn, polyPath, pinAt, windowAlpha, fx } from '../film/kit.js';
import { riverWorld } from '../film/worlds.js';

export default {
  // 只运行一次。把世界、演员、粒子都建好，返回给镜头用。
  // worlds 数组里列出所有世界——引擎靠它在切到别的帧时释放显存。
  setup({ map, geo, film }) {
    const W = riverWorld({ name: '于都河', seed: 102, halfWidth: 105, water: 'calm' });
    const path = polyPath([[-300, -160], [0, 0], [300, 160]], W.H, 0.05);
    const col = createColumn(W.scene, 120, { torches: true });
    return { worlds: [W], W, path, col };
  },
  shots: {
    // 函数名 = film.json 里这一帧的镜头 id
    bridge({ t, lt, k, S }) {
      S.W.tick(t);                                   // 推进水、天空
      S.W.look(LOOKS.moon);                          // 光线
      S.col.pose(t, S.path, { head: 0.6 + t * 0.001, spacing: 3.8, lanes: 2 });
      S.W.track(k, { pos: [[0, [48, 5.5, -62]], [1, [30, 6, -50]]], at: [[0, [-25, 2.2, 4]], [1, [-40, 2.2, 0]]] }, 36);
      return { world: S.W, post: { exposure: 1.15, bloom: 1.0, sat: 0.8 } };
    },
  },
};
```

所有东西都是**时间的函数**：同一个 `t` 永远画出同一帧，渲染器会乱序、分块地来要帧。所以不要用 `Math.random()`、`Date.now()`、累加状态（`x += v`）；随机数用 `rng(seed)`、`hash1(n)`，位置用 `起点 + 速度 × t`。

## 镜头函数

参数 `c`：

| 字段 | 含义 |
|---|---|
| `t` | 这一帧开始后的秒数（同一世界的几个镜头共用，演员动作用它才连贯） |
| `lt` | 这个镜头开始后的秒数 |
| `dur` | 这个镜头的时长 |
| `k` | `lt / dur`，0 → 1。**机位关键帧用它** |
| `S` | `setup()` 的返回值 |
| `cue(i)` | 第 i 句旁白在本镜头内的开始时间（秒），用来让事件踩在话上 |
| `shot`, `frame` | `film.json` 里解析后的镜头和帧（含所有镜头的起止时间） |
| `map`, `geo` | 地图对象和地理数据（有 `geo` 时） |

返回 `{ world, post?, pins? }`：
- `world`：这一帧画哪个世界（`makeWorld` / 各 `xxxWorld` / `tabletop` 的返回值）。
- `post`：`{ exposure, bloom, bloomThreshold, sat, vignette }`。夜景靠火光时 `bloom` 开到 0.9–1.0、`bloomThreshold` 降到 0.55–0.6；阴天、雪天 `sat` 降到 0.55–0.7。淡入淡出不用自己写，`film.json` 的 `in` / `out` 管。
- `pins`：钉在三维点上的文字标签，`pinAt(world.camera, [x, y, z], '北辰星', windowAlpha(lt, 0.3, 1.9), 'gold')`。**必须在设好机位之后调用**。

**清场**：同一世界里的镜头共用演员。每个镜头开头把不用的东西关掉（`col.hide()`、`p.visible = false`、`light.intensity = 0`、`gun.off()`），再打开自己要的。镜头多的场景写一个 `reset(t)`，每个镜头第一行先调它。

## 机位

```js
W.cam([x, y, z], [tx, ty, tz], fov = 38, { clear = 1.5, los = true });     // 直接给位置和目标
W.track(k, { pos: [[0, […]], [0.6, […]], [1, […]]], at: [[0, […]], [1, […]]] }, fov, ease);   // 关键帧
W.on(x, z, lift)        // → [x, 地面或水面高度 + lift, z]   用它来写「离地 3 米」
W.H(x, z)               // 地形高度
```

`cam` 带两道保护，都会在检查里报警告：
1. **离地**：机位低于地面/水面 + `clear` 时被抬上来。
2. **视线**：机位到目标的连线被地形挡住时，机位被一步步抬高直到看得见。

被修正过的镜头能看，但构图不是你设计的。看到警告就改：用 `W.on()` 重写机位，或者换个不被山挡的角度。确实需要贴着物体穿行的镜头（如贴着铁索飞）用 `{ los: false }` 关掉视线检查；贴地的特写把 `clear` 调小（如 0.6）。

好用的经验值：
- 全景交代环境：机位高 50–150 米，离主体 200–300 米，`fov` 40。
- 中景看队伍：高 6–25 米，离 40–70 米。1.7 米高的人在 70 米外约 25 像素，再远就是点。
- 贴水面的低机位：高 3–8 米，压低视角很有气氛，但别让水面占掉大半画面。
- 一个镜头 3–6 秒，机位只做一个动作（推、拉、摇、升之一），幅度小一点。
- `ease` 默认缓入缓出；连续跟拍用线性 `(x) => x`。

## 光线 LOOKS

`W.look(LOOKS.x, focus)` 一次设好天空、太阳、雾、环境光和水面。`focus`（`THREE.Vector3`）是阴影对准的地方，默认原点；主体不在原点时要传。

| 名字 | 用在 |
|---|---|
| `morning` | 清晨薄雾 |
| `day` | 晴天白昼 |
| `hot` | 干热河谷，强光 |
| `afternoon` | 午后斜阳，略阴 |
| `golden` | 黄昏金光 |
| `dusk` | 日落后 |
| `overcast` | 阴天，雨 |
| `night` | 无月的夜（靠火把、火光） |
| `moon` | 月夜，有星 |
| `winterNight` | 冬夜 |
| `blizzard` | 暴风雪 |
| `seaDawn` / `seaDay` / `tropic` / `seaGolden` / `seaDusk` / `seaNight` | 海上：日出 / 白天 / 热带正午 / 金色黄昏 / 日落后 / 星夜。雾的颜色等于天边的颜色，海面才会和天连在一起 |

改某一项就展开覆盖：`W.look({ ...LOOKS.night, fog: ['#1d1612', 0.0017], ember: '#140804' })`。常改的：`fog: [颜色, 浓度]`（浓度 0.0006 通透 … 0.006 伸手不见五指）、`sunDir: [x, y, z]`（太阳方向，决定哪面被照亮）、`hemi`（环境光，暗处发死黑就加）、`ember`（火光映在水上的颜色）。

背光面会是一片黑：主体在哪面墙上，就让 `sunDir` 朝向那面墙的外侧。

**太阳和镜头的关系决定了水面的样子。** 镜头朝着太阳：水面是一条刺眼的反光带，船是剪影——只适合日出日落的抒情镜头，而且 `bloom` 要压到 0.5 以下，否则太阳是一团白。要看清船、帆、岸上的东西，把太阳放到镜头背后或侧后（`sunDir` 的水平方向和镜头朝向相反）。

## 地形库

`film/worlds.js`。每个都返回一个世界（带安全机位、`look`、`tick`、`H`、`on`），外加对自己形状的描述。**同一个 `seed` 永远是同一个地方。**

| 函数 | 是什么 | 额外提供 |
|---|---|---|
| `riverWorld(o)` | 河谷或峡谷里的一条河 | `W.river.bank(side, s, inset)` 岸上一点；`W.river.center(s)`、`halfWidth(s)` |
| `valleyWorld(o)` | 两山之间的平坦谷底，可带小溪 | `W.valley.floorHalf` |
| `lakeWorld(o)` | 群山环抱的静湖 | `W.lake.shore(角度, inset)` 岸边一点 |
| `passWorld(o)` | 往上爬的雪坡和垭口 | `W.pass.trail` 之字形小路的点 |
| `bogWorld(o)` | 沼泽草地：草墩和黑水塘 | `W.firm(x, z)` 能站人的高度 |
| `loessWorld(o)` | 黄土高原：塬、沟壑、梯田 | `W.loess.floorY`（主沟底）、`topY`（塬面） |
| `slotWorld(o)` | 一线天：几米宽的峡缝和溪流 | `W.slot.halfWidth(x)`、`floorY` |
| `flatWorld(o)` | 平地（街巷、院落） | — |
| `tabletop(o)` | 暗室里的一张木桌（文件、地图、灯） | `T.table`；没有地形，机位无保护 |
| `seaWorld(o)` | 一望无际的外海 | `W.sea.height(x, z, t)` 水面高度（船靠它起伏） |
| `coastWorld(o)` | 海岸：海湾、沙滩、平地、背后的山。陆地在 -z，海在 +z | `W.coast.shore(x)` 岸线的 z；`W.coast.inland(x, d)` 岸线往里 d 米的点；`W.sea.height` |

### riverWorld 的参数

```js
riverWorld({
  name, seed,
  axis: 'z',                         // 河流方向：'z' 或 'x'
  halfWidth: 105,                    // 河面半宽（数字或 (s, side) => 数字）
  center: (s) => 30 * Math.sin(s / 500),     // 河道中线的弯曲
  bed: [-5, 3.5], bank: [2, 6],      // 河床深度；岸高和岸坡宽
  shelfW: 0, shelfH: 2,              // 岸边平台的宽和高（城镇、营地用；可为函数）
  wall: { h: 90, hVar: 70, run: 240, base: 0.5, ridge: 0.7, ridgeScale: 0.004, spurs: 0 },   // 山的高度、起伏、坡度（run 越小越陡）
  size: [2000, 2400], origin: [0, 0],
  water: 'slow',                     // calm | slow | stream | rapids | muddy | still，或 { speed, deep, shallow, foam }
  waterHalfWidth: 160,               // 水面网格的半宽，要盖住最宽处
  palette: 'green',                  // green | lush | dry | alpine | snow | bog | loess | canyon，或自定义色表
  trees: { count: 9000, color, scale: [4, 9], maxSlope: 2.2, minY: 4, shape: 'blob'|'cone', clear: (x, y, z) => 留空的区域 },
});
```

量级参考：宽缓的河（于都河、湘江）`halfWidth` 100–120、`wall.h` 70–90、`run` 240–260；山间小河（赤水）`halfWidth` 34、`wall.h` 260、`run` 170；大峡谷（金沙江）`halfWidth` 95、`wall.h` 480、`run` 300、`palette: 'dry'`、`water: 'muddy'`。

机位或主体附近的树要用 `trees.clear` 清掉——离镜头十几米的树是一个个大色块，很难看。

树形 `shape`：`'blob'`（阔叶）、`'cone'`（针叶）、`'palm'`（棕榈）、`'acacia'`（平顶的金合欢）。`trees` 可以是数组，几种树各管一个高度带。

色表 `palette`：`green lush dry alpine snow bog loess canyon`，加上 `tropic`（亮沙滩 + 浓绿）、`savanna`（枯草色）、`arid`（荒漠）、`quay`（码头的土色）。**沙滩和岸边的颜色来自色表的 `sand`**——用 `lush` 做热带海岸，沙滩会是一片深褐色。

### seaWorld / coastWorld 的参数

```js
seaWorld({ name, wind: 0.6,            // 浪往哪个方向走（弧度，从 +x 转向 +z）
  sea: 'ocean' });                     // ocean | tropic | harbor | heavy | muddy，或 { deep, shallow, foam, amp, chop }

coastWorld({ name, seed, sea: 'harbor', wind,
  bay: { width: 380, depth: 260 },     // 以 x=0 为中心切进陆地的海湾；depth 0 = 平直海岸
  beach: [2.2, 45],                    // 沙滩升多高、多宽
  flat: 120,                           // 沙滩后面的平地有多深（放城镇、仓库、集市）
  hills: { h: 120, hVar: 80, run: 320 },
  islands: [{ x, z, r, h }],
  palette: 'tropic', trees: [{ shape: 'palm', count: 2600, minY: 2.3, maxY: 16 }, { count: 12000, minY: 9 }] });
```

`amp` 是涌浪高度：外海 1，热带近岸 0.5–0.7，避风的港湾 0.2–0.3。岸上的东西用 `W.coast.inland(x, d)` 定位，别手写 z——岸线是弯的。

## 演员

小人是 1.7 米高的低模剪影，带走路动作（腿和手臂摆动）。**只当远景和中景用。**

```js
const col = createColumn(scene, 120, { torches: true });       // 一支队伍（可举火把）
col.pose(t, path, {
  head: 0.6 + t * 0.001,     // 排头在路径上的位置（0–1）。随 t 增大就是在往前走
  spacing: 3.8,              // 排与排的间距，米
  lanes: 2, laneGap: 1.0,    // 几路纵队
  pitch: 0.1,                // 身体前倾（上坡、顶风 0.3–0.4）
  speed: 6.5, gait: 1,       // 步频；步幅（0 = 站着不动，涉水 0.5）
  visible: (i, s) => s > 0.8 // 可选：只显示一部分
});
col.hide();

const path = polyPath([[x, z], …], yFn, lift);   // 按弧长参数化的路径；path(s) → Vector3；path.meters = 总长
// yFn 通常是 W.H；过桥时：(x, z) => bridge.userData.on(x, z) ? bridge.userData.deckY : W.H(x, z)

createCrowd(scene, 260, (i, rnd) => [x, y, z, 朝向], { seed });   // 站着的人群
createSoldiers(n) + setPose(mesh, i, x, y, z, 朝向, 俯仰, 侧倾, 缩放) + setGait(mesh, i, 相位, 幅度)   // 自己摆（坐、趴、爬、躺）
```

队伍走得多快：真人步行约 1.4 m/s。`head` 每秒的增量 = 1.4 / `path.meters`。走得太快会像滑行。

**船队**（`film/sea.js`）：帆船是整支船队画成两个实例网格（船身、帆），几十上百艘也不慢。

```js
const fleet = createFleet(W.scene, 62, { length: 64, masts: 5, lanterns: true });   // masts: 3 | 5 | 7
const slots = formation(62, { cols: 6, gapX: 170, gapZ: 210 });      // 编队：[[横向, 纵向, 大小], …]，0 号在最前
// 每个镜头里：W.tick(t) → fleet.pose(...) → W.cam(...)   顺序不能错：tick 清空尾流，pose 登记尾流，cam 把它们交给水面
fleet.pose(t, (i) => ({ x, z, heading, scale, moving }), { sea: W });   // 返回 null = 这艘不显示；moving: false = 抛锚（没有尾流）
fleet.furl(k);      // 0 = 帆张满，1 = 帆落下（泊港）。在两个值之间过渡就是升帆
fleet.lamps(k);     // 夜里的船灯 0–1
fleet.hide();
```

船头朝 +z 时 `heading` 为 0；朝着 (dx, dz) 走就是 `Math.atan2(dx, dz)`。航速 3 m/s 左右（约 6 节）：位置写成 `z0 + 3 * t`。在河上用（没有海浪）就不传 `sea`，传 `{ y: 水面高度, sway: 0 }`。船是中远景用的，镜头别近于 60 米。

**人的样子**：`createCrowd` / `createColumn` 的 `figure` 选项。默认是带军帽、背包、步枪的士兵；别的年代、别的身份要改，不然古人会戴着军帽出场：

```js
{ rifle: false, pack: false, robe: true, hat: 'conical', hatColor: '#c8b078', uniform: '#6a5a44' }   // hat: cap | conical | turban | none
```

其他：`createBoat()`（木船）、`createPontoon({ from, to, boats })`（浮桥，`userData.on(x, z)` / `deckY`）、`createChainBridge` + `createPlanks` + `chainY`（铁索桥）、`createBuilding({ w, d, wallH, roofH, wall, roof, stories })`（中式坡顶房）、`createFlag()`（红旗，`userData.update(t)` 让它飘）、`createGunfire(scene)`（枪口火光和弹道，`.fire(t, 发射点[], 落点函数, { rate })` / `.off()`）、`createBlasts(scene)`（爆炸，`.update(lt, [{ t0, pos, size, water }])`）。

敌方只用枪口火光、弹道、碉堡来表现，不放人。

## 粒子 fx

```js
const fire = fx.fire([[x, y, z], …], { size, rise });   scene.add(fire);
fire.userData.update(t);        // 每帧调
fire.visible = false;           // 别的镜头里关掉
```

`fx.fire` 火、`fx.smoke` 浓烟、`fx.embers` 火星、`fx.mist(中心, [x, y, z 范围])` 贴地雾、`fx.dust` 扬尘、`fx.rain()`、`fx.snow()`、`fx.splashes(点[])` 水花。每个都可以用第二个参数覆盖任意字段（`count`、`size`、`opacity`、`colA`、`wind`…）。

雨和雪是一个盒子里的粒子，要每帧挪到镜头前：`rain.position.copy(W.camera.position).add(new THREE.Vector3(0, -10, -60))`（设完机位之后）。

火旁边加一盏会闪的点光才像真的：`light.intensity = 1300 * (0.8 + 0.3 * hash1(Math.floor(t * 18)))`。点光强度的量级：火把 40–50，篝火 9，着火的房子 900–1300，照明弹 300。**先小后大**——强度一过头，整个画面就成了一团橙色。

## 道具库

`film/props.js`：

| 函数 | 是什么 |
|---|---|
| `createTorchReflections(scene, n)` | 火把在水面上的倒影（`userData.pose(t, camera, i => 点或null)`，设完机位后调） |
| `createArcadeHall()` | 两层拱廊楼（会址类建筑），`userData.flicker(k)` 让窗内灯光微动 |
| `addHouses(scene, n, place)` | 一片民房 |
| `createBunker({ at, scale })` | 圆形石碉堡，`userData.slits` 是射击孔位置 |
| `createWoodBridge({ length, y })` | 木板桥，`userData.deckY` |
| `createOilLamp({ at })` | 油灯（带火苗和闪动的光），`userData.update(t)` |
| `createPaper({ draw })` | 桌上的一张纸，内容用 canvas 画；`userData.redraw(lt)` 可以让线条随时间画出来 |
| `paperGround(g, w, h)` | 旧纸底色 |
| `drawNewspaper(g, w, h)` | 一张**没有可读文字**的报纸 |
| `createCampfire(scene, { at, groundY })` | 篝火、锅、围坐的人；`.show(on, t)` |
| `addCaveDwellings(W, { z, floorY })`（在 worlds.js） | 黄土崖脚的一排窑洞 |
| `createPier({ from, to, width, y })` | 伸进水里的木栈桥，`userData.deckY` |
| `createDepot({ at, w, d, groundY })` | 栅栏围起来的仓库区：四座门楼、几排库房、一面旗（`userData.flag`） |
| `createFlagPole(h, color, bw, bh)` | 高杆大旗，`userData.update(t, wind)`：wind 0 垂着、1 展开——「起风了」就靠它 |
| `addFlatHouses(scene, n, place, { wall, domes, towers, size })` | 平顶土坯城（海湾、红海一带），带几个穹顶和塔 |
| `createStalls(scene, n, place)` | 集市：布棚、罐子、箱子 |
| `createStele()` | 石碑。碑文是三块不同笔迹的刻痕，**没有可读文字** |
| `createStupa({ r })` | 白色覆钵塔 |
| `createGiraffe()` | 长颈鹿，`userData.update(t)` |
| `createCaravan(scene, n)` | 驼队，`.pose(t, path, { head, spacing })` |
| `createCompass()` | 水罗盘（二十四向），`userData.update(t, turn)`：浮针晃几下停在南北向 |
| `createStarBoard({ size })` | 牵星板，`userData.place(camera, dir, dist)`：举在镜头前，设完机位后调 |

没有人物的「人物节点」就用这些讲：会议 → 夜里亮着灯的楼；决策 → 灯下的地图，红线改道；消息 → 桌上的报纸；艰苦 → 篝火和一口锅。

## 范例场景速查

`examples/zheng-he/scenes/`：

| 文件 | 可以借的东西 |
|---|---|
| `f01_hook.js` | 外海日出、62 艘船的编队、从船队后部升起的揭示镜头 |
| `f02_depart.js` | 大江边的码头和船厂、泊船、升帆顺流而下 |
| `f03_changle.js` | 港湾：黄昏泊港亮灯（水面灯影）→ 清晨起风升帆出港 |
| `f04_nav.js` | 一个文件三个世界：白天跟拍旗舰、桌面上的罗盘、夜海上的牵星板和星 |
| `f05_malacca.js` | 热带海岸、栅栏仓库、栈桥上运货的队伍 |
| `f06_ceylon.js` | 器物近景（石碑）+ 同一地点拉开的逆光全景 |
| `f07_calicut.js` | 沙滩集市、人群、往来的小船 |
| `f08_hormuz.js` | 荒山、土城、沿海滩走的驼队 |
| `f09_africa.js` | 稀树草原海岸；逆光的动物剪影 |
| `f10_last.js` | 远去的船队 → 亮灯归航 → 空海（和开场呼应） |

## 加新东西

**新地形**：写一个高度函数 `H(x, z)`，交给 `makeWorld({ heightFn: H, size, seg, palette, water })`。`makeNoise(seed)` 给你 `fbm`（起伏）和 `ridged`（山脊）。先定大形（哪里低、哪里高、多陡），再加细节。只有这一条片子用的地形可以直接写在场景文件里；通用的就加进 `worlds.js`（改 skill 里的 `template/film/worlds.js`，再对工程 `--sync`）。

**新道具**：用 three.js 的基本几何体拼（盒子、圆柱、拉伸的 Shape、旋转成型的 Lathe）。贴图用 `canvasTexture(w, h, draw)` 画，不要加载图片文件。带网格细节的石头材质加 `addRockDetail(material)`。

**新演员动作**：`createSoldiers` + `setPose` 自己摆；需要成批运动就照 `createColumn` 的写法。

加完新东西，先单独看一帧（`film.py index --only <帧>` + 浏览器），再放进片子。开工前要告诉用户「这个题材有 N 个新场景要写」，因为它比复用慢得多。

## 竖屏

`"aspect": "9:16"` 时引擎会自动把镜头的视野加宽、地图机位拉远，字幕、标题、标注换成竖屏排版并避开平台上下的遮挡区。但横屏构图的镜头直接转竖屏，主体常常偏小或被切掉——竖屏片子要**按竖屏重新过一遍每个镜头的机位**（主体放在画面中部偏下，机位更正、更近），不能指望自动适配。
