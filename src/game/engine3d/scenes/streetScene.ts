import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import wallTex from "@/assets/wall.png";
import { addOutline, makeBrickTexture, makeFacadeTexture } from "../textures";
import {
  emptyMetroState,
  STREET,
  USE_MERCEDES,
  type MetroState,
  type ModelPool,
  type SceneContext,
  type SceneDeps,
  type StreetChunk,
  type StreetState,
} from "./types";

/**
 * 街头（street）场景：沿街墙 / 巷口 / 十字路口 / 随机装饰 / 墙后楼房 / 球场。
 *
 * 本文件把原 ThreeRunner 里街头专属的方法拆成「接收 SceneContext 的纯函数」，
 * 再由文件末尾的 StreetScene 类把它们包装成方法（ctx.street 整块即 this）。
 */

export function isOccupiedByBuilding(
  ctx: SceneContext,
  side: number,
  z: number,
  halfDepth = 2
): boolean {
  const st = ctx.street;
  return st.buildings.some((b) => {
    const bSide = b.mesh.position.x > 0 ? 1 : -1;
    if (bSide !== side) return false;
    const bh = b.halfD ?? 6;
    return z + halfDepth > b.z - bh && z - halfDepth < b.z + bh;
  });
}

// 判断某侧、某 z 是否落在巷口范围内（巷口处不得摆放任何人行道装饰，
// 否则会堵住通往另一条街的开口）。
// 注意：必须读【实时】巷口位置 —— 巷口随其绑定的墙段一起滚动并回绕，
// 建巷时记录的静态 z 在滚动后就失效了，故直接遍历 alleyways；
// 且把回绕周期（wallCycle）也纳入比较，覆盖跨周期边界的相邻性。
export function isInAlleyMouth(
  ctx: SceneContext,
  side: number,
  z: number,
  margin = 0
): boolean {
  const st = ctx.street;
  const half = STREET.wallSegLen * 0.75 + margin;
  const cycle = STREET.wallLen;
  for (const a of st.alleyways) {
    if ((a.userData.side as number) !== side) continue;
    // 比较 z 与巷口中心的环向距离（考虑回绕）
    let d = Math.abs(a.position.z - z) % cycle;
    if (d > cycle / 2) d = cycle - d;
    if (d < half) return true;
  }
  return false;
}

// 判断某侧、某 z 是否落在【球场两侧的巷道口】范围内。
// 球场两侧各有一条通往球场内部的通道（宽 courtGapWidth），那是进出球场的开口，
// 不应摆放长椅 / BMX 等占地装饰，否则会把通道堵住。
// courtZSlots 记录的是球场模型（含地面）的整体 z 区间，其范围已略大于球场本体，
// 再向外各扩一个通道宽度即可整盖住两条巷道口。
export function isInCourtAlley(
  ctx: SceneContext,
  side: number,
  z: number,
  margin = 0
): boolean {
  const st = ctx.street;
  const pad = STREET.courtGapWidth + margin;
  return st.courtZSlots.some(
    (s) => s.side === side && z >= s.z0 - pad && z <= s.z1 + pad
  );
}

// ==================== 十字路口 ====================
//
// 做法与取舍：
//   · 只做「视觉事件」，不提供转弯 —— 玩家仍然只能向前跑，路口只是路面 / 墙体 / 街景的变化；
//   · 候选位置在 220 的回绕周期内随机取（严格对齐 6 单位的墙段网格），每次构建都不同；
//     每圈再随机启用其中几个（见 scrollStreet 的回绕重掷），于是路口位置会不断变化；
//   · 几何挂在一块「宿主墙段」上（路口范围内 3 段墙被隐藏），由 scrollStreet 同步 z，
//     与巷口（alley）完全同一套机制，回绕时不会出现缺口与几何错位。
/** 路口宽度（沿 z）= 3 段墙 = 18，正好整段让开 3 段墙 */
const CROSS_SEG = 3;
const CROSS_HALF = (CROSS_SEG * STREET.wallSegLen) / 2; // 9
/** 墙段顶部边界 z（与 buildStreetWalls 的 wallZ0 对应：wallZ0 + segLen/2） */
const CROSS_Z_TOP = 40;
/** 路缘石所在 x（主路宽 14，人行道 7~10.5，墙在 10.5） */
const CROSS_CURB_X = 7;
/** 横向马路向两侧延伸的距离：要长到足以盖住 x≈28 的二线远景楼，
 *  否则横街尽头会看到「悬空」的远景楼（下面没有地面）。
 *  玩家加速时相机后拉、视野变广，会看到横街尽头之外的地图空白，
 *  因此这里延伸到 46（并在尽头补封口墙，见 makeCrossroadGeometry）。 */
const CROSS_REACH = 40;
/** 主路二线楼房要给横街那排楼让出的纵深（横街楼从 z≈9 一直伸到 ~23） */
const CROSS_BUILDING_PAD = 14;
/**
 * 【近排 / 第二排矮楼】贴赛道摆放的 x。
 * 这一排改为【随块生成】：每块自己布点、挂在本块 chunkRoot 下，
 * 因此能读本块的 crossZSlots 精确让开路口，不需要靠推远来躲避。
 */
const BACKDROP_NEAR_X = 28;
/** 近排让位半径：路口 ±9 之外再各留 10（横街两侧楼的进深约 8~12） */
const BACKDROP_CROSS_CLEAR = 10;
/**
 * 【远排 / 天际线高楼】的最小 x（楼的近侧边缘）。
 * 这一排仍是【全局一份、220 周期回绕、视差 0.5】，无法按每块随机路口让位
 * （所有块共享同一相位，同一 z 位置不能给不同块显示不同内容）。
 * 所以必须放在横街地面尽头 CROSS_REACH(46) 与封口墙外沿(≈46.5) 之外，
 * 否则又会在随机路口处站到横街 / 人行道上。
 * +2 已经贴到硬下限：再小就会压到封口墙。两排的视觉间距改由
 * 近排的 xJit（让矮楼往远侧散开去接住远排）来消化，而不是继续拉近远排。
 */
const BACKDROP_FAR_MIN_X = CROSS_REACH + 2;
/** 转角墙：沿 x 长度 / 厚度 / 高度（高度与沿街墙一致） */
const CROSS_WALL_LEN = CROSS_REACH - STREET.wallX + 2;
const CROSS_WALL_T = 0.5;
const CROSS_WALL_H = 4.5;
/** 横向车行道半宽（沿 z）：主路 ±7，横路取 ±6，两侧各留 3 单位人行道 */
const CROSS_ROAD_HALF = 6;
/** 车行道平面在内侧（x 方向）压到哪：要越过主路红路缘（6.89~7.11）把它盖住 */
const CROSS_ROAD_EDGE = 6.7;
/** 横向人行道宽度（从车行道边 6 到路口边缘 9） */
const CROSS_WALK_W = CROSS_HALF - CROSS_ROAD_HALF; // 3
/**
 * 横向路面 / 人行道高度 —— 与主赛道完全一致。
 *
 * 主路的人行道与路缘石在路口范围被几何挖空（见 rebuildWalkStrips），
 * 所以横路可以直接平接：主路 0 / 横路 0.012（略高 1cm 避免共面）/ 人行道 0.035。
 */
const CROSS_ROAD_Y = 0.012;
/** 横向人行道高度：与主路人行道完全一致（0.035） */
const CROSS_WALK_Y = 0.035;
/** 横向路缘石（与主路同规格：高 0.12、宽 0.22） */
const CROSS_CURB_H = 0.12;
const CROSS_CURB_W = 0.22;
/**
 * 路口转角的「路缘石圆弧半径」。
 * 现实里两条街路缘相交处不会做成直角，而是用一段圆弧顺接（curb radius）。
 * 这里把四个转角各做 1/4 圆弧，并把圆弧外侧切掉的那块铺成沥青，
 * 于是人行道角部与路缘都变成连续的弧线。
 */
const CROSS_CORNER_R = 1.2;
/**
 * 黄线到道路中心线的距离 —— 按 road.png 的实测值，且【左右并不对称】
 * （贴图里两条边线分别画在 u=0.0513 / u=0.9459，不是严格的 0.05 / 0.95）：
 *   主路 14 宽：左侧 |x| = 6.282，右侧 = 6.243
 *   横路 12 宽：+z 侧 |z| = 5.384，-z 侧 = 5.351
 * 之前用 6.3 / 5.4 统一值，接缝处会差 2~5cm —— 就是截图里那点小偏差。
 */
const CROSS_YELLOW_X_LEFT = 6.282;
const CROSS_YELLOW_X_RIGHT = 6.243;
const CROSS_YELLOW_Z_POS = 5.384;
const CROSS_YELLOW_Z_NEG = 5.351;
/**
 * 转角黄线圆弧半径。
 * 圆弧要与两条直黄线相切，圆心必须到两线等距 → 圆心 = (6.3+R, 5.4+R)；
 * R 取 1.85 时，弧线离路缘圆弧约 0.6m，与真实路口的边线间距接近。
 */
const CROSS_YELLOW_R = 1.85;
/**
 * 某个 z 落在十字范围内（左右两侧都算，路口横穿整条） * 与巷口同理：必须读实时路口位随主段滚动并回绕），
 * 建路时录的静z 在滚动后就失效了 */
export function isInCrossroad(
  ctx: SceneContext,
  z: number,
  margin = 0
): boolean {
  const st = ctx.street;
  const half = CROSS_HALF + margin;
  const cycle = STREET.wallLen;
  for (const g of st.crossroads) {
    let d = Math.abs(g.position.z - z) % cycle;
    if (d > cycle / 2) d = cycle - d;
    if (d < half) return true;
  }
  return false;
}

/**
 * 规划位置（只z，不建几何） * 必须早于 buildBuildings：楼要避区间，否则会街道上 * 并与墙互相穿插 */
export function planCrossroads(ctx: SceneContext) {
  const st = ctx.street;
  st.crossZSlots = [];
  const segLen = STREET.wallSegLen;
  const maxK = Math.floor(STREET.wallLen / segLen) - CROSS_SEG; // 起段号上限
  // 每构建随机 1~2 口：再密街道会切得
  // 2 个候选位：每圈启用 1~2 个（见 buildCrossroads 的初始激活与 scrollStreet 的重掷）。
  // 之前用 3 个，每个候选位都要让出 18 + 2×14 的纵深，三条街的房子被挤得太稀。
  const count = 2;
  const centers: number[] = [];
  for (let tries = 0; tries < 40 && centers.length < count; tries++) {
    const k = Math.floor(Math.random() * (maxK + 1));
    const center = CROSS_Z_TOP - (k + CROSS_SEG / 2) * segLen;
    // 避开块的【近端接缝】：上一块的人行道/路缘石条带向前多铺 12 米
    //（zFar = -(墙长+12)），会覆盖到本块局部 z ∈ [-12, 37]（直到本块条带
    // 从 z=12 接手为止）。上一块建条带时不知道本块的路口位置（不挖缺口），
    // 路口若落在那片范围，跑近后就会被上一块完整的条带横穿
    //（表现为「人行道穿过横路」，块切换瞬间又消失）。
    // 路口含转角圆弧要占到中心 ±(6+1.2)=±7.2，故中心须 < -12-7.2 = -19.2；
    // 6 米墙段网格上即 -17 不可用、-23 起可用，守卫取 -18 即可正确筛掉 -17。
    if (center > -18 || center < -160) continue;
    // 两个之间至少3 口度，避免两个口挨在一
    if (centers.some((z) => Math.abs(z - center) < CROSS_HALF * 5)) continue;
    centers.push(center);
  }
  for (const z of centers)
    st.crossZSlots.push({ z0: z - CROSS_HALF, z1: z + CROSS_HALF });
}

/**
 * 按各路口 Group 的 userData.active 切换「谁真的存在」：
 *   · 激活的路口 → 路口几何显示、3 段墙隐藏、补片隐藏；
 *   · 未激活的候选位 → 路口几何隐藏、3 段墙恢复、补片显示（= 普通街道）。
 *
 * 只改 visible，**不重建任何几何**：人行道 / 路缘石的缺口在构建期已按
 * 所有候选位一次性挖好（见 rebuildWalkStrips），未启用的位置由补片填平。
 */
export function applyCrossActive(ctx: SceneContext) {
  const st = ctx.street;
  const streetOn = ctx.isStreetActive();
  for (const g of st.crossroads) {
    const on = !!g.userData.active;
    g.visible = on && streetOn;
    const fg = g.userData.filler as THREE.Group | undefined;
    if (fg) fg.visible = !on && streetOn;
  }
  for (const w of st.walls) {
    if (!w.userData.crossRoad) continue;
    const g = w.userData.crossGroup as THREE.Group | undefined;
    w.visible = streetOn && !(g && g.userData.active);
  }
}

/** 横向马路贴图（与主赛道同一张 road.png）：缓存一次，避免每次构建重复加载 */
let crossRoadTex: THREE.Texture | null = null;
function getCrossRoadTexture(ctx: SceneContext): THREE.Texture {
  if (!crossRoadTex) crossRoadTex = ctx.loadRoadTexture();
  return crossRoadTex;
}

/** 路口共享材质集合（每块生成一次，供该块所有路口复用） */
interface CrossroadMats {
  roadMat: THREE.MeshStandardMaterial;
  walkMat: THREE.MeshStandardMaterial;
  curbMat: THREE.MeshStandardMaterial;
  wallMat: THREE.MeshStandardMaterial;
  wallEndMat: THREE.MeshStandardMaterial;
  edgeMat: THREE.MeshStandardMaterial;
  copeMat: THREE.MeshStandardMaterial;
  lineMat: THREE.MeshStandardMaterial;
}

/**
 * 路口材质缓存。所有块的路口材质完全相同（砖纹均带 noGraffiti，无随机涂鸦），
 * 跨块复用可彻底消除「每块 2 次 loadWallTexture（异步加载图片 + canvas 重绘）」，
 * 这正是运行中补块偶发卡顿的一个来源。build() 重建时清空。
 */
let crossroadMatsCache: CrossroadMats | null = null;

/**
 * 生成路口的共享材质。单独拆成一步：它内部有 2 次砖纹贴图的 canvas 绘制，
 * 与路口几何/装饰分开，避免挤在同一个分帧步骤里造成单帧尖峰。
 */
function makeCrossroadMats(ctx: SceneContext): CrossroadMats {
  if (crossroadMatsCache) return crossroadMatsCache;
  const roadMat = new THREE.MeshStandardMaterial({
    map: getCrossRoadTexture(ctx),
    roughness: 0.95,
    metalness: 0.05,
  });
  // 人道：复用主路人道贴图（clone 后按尺repeat，避免影响主行道）
  const SW_W = 3.5; // 主路人道
  const SW_L = 220; // 主路人道长
  const baseRX = ctx.sidewalkTex.repeat.x || 1;
  const baseRY = ctx.sidewalkTex.repeat.y || 1;
  const walkTex = ctx.sidewalkTex.clone();
  walkTex.needsUpdate = true;
  walkTex.wrapS = walkTex.wrapT = THREE.RepeatWrapping;
  walkTex.repeat.set(
    (CROSS_WALK_W / SW_W) * baseRX,
    ((CROSS_REACH - STREET.wallX) / SW_L) * baseRY
  );
  const walkMat = new THREE.MeshStandardMaterial({
    map: walkTex,
    roughness: 0.95,
    metalness: 0,
  });
  const curbMat = new THREE.MeshStandardMaterial({
    color: ctx.theme.red,
    roughness: 0.7,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    map: ctx.loadWallTexture(wallTex, CROSS_WALL_LEN / STREET.wallSegLen, 1, {
      outW: STREET.segTexW,
      outH: STREET.segTexH,
      segments: 1,
      noGraffiti: true,
    }),
    roughness: 0.9,
  });
  const edgeMat = new THREE.MeshStandardMaterial({
    color: ctx.theme.wallL,
    roughness: 0.95,
  });
  const wallEndMat = new THREE.MeshStandardMaterial({
    map: ctx.loadWallTexture(wallTex, CROSS_WALL_T / STREET.wallSegLen, 1, {
      outW: STREET.segTexW,
      outH: STREET.segTexH,
      segments: 1,
      noGraffiti: true,
    }),
    roughness: 0.9,
  });
  const copeMat = new THREE.MeshStandardMaterial({
    color: 0x9c948a,
    roughness: 0.93,
  });
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xbb9216,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  crossroadMatsCache = {
    roadMat,
    walkMat,
    curbMat,
    wallMat,
    wallEndMat,
    edgeMat,
    copeMat,
    lineMat,
  };
  return crossroadMatsCache;
}

/**
 * 构建单个路口（几何 + 两侧装饰）。作为独立分帧步骤：每个路口单独一步，
 * 避免两个路口 + 装饰的 clone 挤在同一帧。某个路口出错也不影响后续步骤
 * （rebuildWalkStrips 等），由 drainChunkBuilds 的 try/catch 兜底。
 */
function buildCrossroadGeometryAt(
  ctx: SceneContext,
  slot: { z0: number; z1: number },
  mats: CrossroadMats
): THREE.Group | null {
  const st = ctx.street;
  const center = (slot.z0 + slot.z1) / 2;
  // 先只找宿主段（路口中心所在那一段），此时【不隐藏任何墙】。
  // 关键：若先挖墙、后建几何，一旦几何/装饰构造中途抛异常，
  // 墙已被挖掉、路口却没建起来，就会留下一个「墙壁空缺块」。
  let host: THREE.Mesh | null = null;
  for (const w of st.walls) {
    if (Math.abs(w.position.z - center) > CROSS_HALF + 0.01) continue;
    if (Math.abs(w.position.z - center) < 0.01) {
      host = w;
      break;
    }
  }
  if (!host) return null;
  const g = makeCrossroadGeometry(
    mats.roadMat,
    mats.walkMat,
    mats.curbMat,
    mats.wallMat,
    mats.wallEndMat,
    mats.edgeMat,
    mats.copeMat,
    mats.lineMat
  );
  g.position.set(0, 0, center);
  g.visible = false; // 先关，最后按 active 统一打开
  g.userData.slot = { z0: slot.z0, z1: slot.z1 };
  g.userData.active = false;
  ctx.chunkRoot.add(g);
  st.crossroads.push(g);
  host.userData.crossroad = g;
  // 几何已经完整挂到场景后，才挖掉这 3 段墙（此时即便后续出问题也不会露空）。
  for (const w of st.walls) {
    if (Math.abs(w.position.z - center) > CROSS_HALF + 0.01) continue;
    w.userData.crossRoad = true;
    w.visible = false;
    w.userData.crossGroup = g;
  }
  return g;
}

/**
 * 路口静态装饰（楼房 + 街具 + 交通灯）。与行人/车辆拆成两步，
 * 避免「楼房 clone + 骨骼克隆」挤在同一帧。
 */
function decorateCrossroadStatic(ctx: SceneContext, g: THREE.Group) {
  const m = ctx.models;
  const st = ctx.street;
  const walkZ = CROSS_ROAD_HALF + CROSS_WALK_W / 2; // ±7.5：横街人行道
  const xMin = STREET.wallX + 4; // 离路口本体留出距
  const xMax = CROSS_REACH - 3;

  // 记录每象限楼房占用的 x 区间（局部坐标，正数），供具避
  const occupied = new Map<string, Array<[number, number]>>();

  // ---- 1) 两侧楼房：门面朝向横街 ----
  if (m.buildings.length > 0) {
    const dirs = m.buildings.map((b) => detectBuildingFrontDir(ctx, b));
    // 整个路口横路【总共只随机放 1~4 栋】（原先每象限最多 3 栋、总计最多 12 栋，
    // 对补块 clone 与渲染都太重）。名额随机分配到 4 个象限，每象限最多 2 栋。
    const totalBuildings = 1 + Math.floor(Math.random() * 4); // 1~4
    const quadrants: Array<{ sx: number; sz: number }> = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) quadrants.push({ sx, sz });
    const counts = new Map<string, number>();
    for (const q of quadrants) counts.set(`${q.sx}|${q.sz}`, 0);
    for (let n = 0; n < totalBuildings; n++) {
      const avail = quadrants.filter(
        (q) => (counts.get(`${q.sx}|${q.sz}`) ?? 0) < 2
      );
      if (avail.length === 0) break;
      const pick = avail[Math.floor(Math.random() * avail.length)];
      const key = `${pick.sx}|${pick.sz}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const { sx, sz } of quadrants) {
      const want = counts.get(`${sx}|${sz}`) ?? 0;
      let x = xMin;
      for (let i = 0; i < want && x < xMax; i++) {
        const idx = Math.floor(Math.random() * m.buildings.length);
        const src = m.buildings[idx];
        if (!src) break;
        const b = src.clone(true);
        b.traverse((o) => {
          const mm = o as THREE.Mesh;
          if (mm.isMesh) {
            mm.castShadow = true;
            mm.receiveShadow = false;
          }
        });
        b.scale.setScalar(0.82 * (1.15 + Math.random() * 0.5));
        const dir = dirs[idx] ?? new THREE.Vector2(0, 1);
        // 让门面朝向横街中心（方向 (0, -sz)，即侧）
        // 旋转量推导：模型门面在局部坐标里的角度 α = atan2(fz, fx)；
        // 绕 Y 轴转过 θ 后朝向变为 α - θ，要它等于目标角 φ = -sz·π/2，
        // 故 θ = α + sz·π/2（之前写成 α - sz·π/2，整整差了 180°，门朝里）。
        b.rotation.y = (sz * Math.PI) / 2 + Math.atan2(dir.y, dir.x);
        b.updateMatrixWorld(true);
        const box = _tmpBox.setFromObject(b);
        const w = Math.max(box.max.x - box.min.x, 1);
        // 门面压到围墙【前一点点】…
        const targetZ = sz * (CROSS_HALF - 0.7);
        b.position.z = targetZ - (sz > 0 ? box.min.z : box.max.z);
        b.position.y = -box.min.y;
        b.position.x = sx * (x + w / 2);
        g.add(b);
        const key = `${sx}|${sz}`;
        const span = occupied.get(key) ?? [];
        span.push([x - 0.6, x + w + 0.6]);
        occupied.set(key, span);
        x += w + 2.5;
      }
    }
  }

  // ---- 2) 人道具：与主行道同 ----
  // 路灯 / 棕榈 / STOP 牌 / 长椅 / 消防栓 / BMX / 垃圾桶（垃圾桶主路是程序化几何，这里照做）。
  const trashBodyMat = new THREE.MeshStandardMaterial({
    color: 0x2f7d4f,
    roughness: 0.7,
  });
  const trashLidMat = new THREE.MeshStandardMaterial({
    color: 0x256144,
    roughness: 0.7,
  });
  const makeTrashBin = () => {
    const bin = new THREE.Group();
    const can = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.36, 1.0, 12),
      trashBodyMat
    );
    can.position.y = 0.5;
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.44, 0.12, 12),
      trashLidMat
    );
    lid.position.y = 1.05;
    bin.add(can, lid);
    return bin;
  };
  const propPool: Array<THREE.Object3D | "trash" | null> = [
    m.streetLight,
    m.palm,
    m.stop,
    m.bench,
    m.hydrant,
    m.bmx,
    "trash",
  ];
  /**
   * 横路 STOP 牌朝向：模型牌面默认 +x，不旋转即朝 +x（沿横路行车方向）。
   * 左横路(sx=-1) 朝 +x = 朝向赛道；右横路(sx=+1) 朝 +x = 背对赛道。
   * 只有实际看到牌背（模型牌面为 -x）时才改成 Math.PI。
   */
  const CROSS_STOP_FACE_Y = 0;
  // 玩家沿 -z 前进、相机在 +z 侧：只有 sz=-1（路口迎面）的两个象限看得见。
  // sz=+1 那侧的矮道具被转角墙挡在身后，生成了也看不到，白耗 clone / draw call。
  const VISIBLE_SZ = [-1];
  // 靠墙道具（长椅 / BMX）的 z：贴到转角墙内表面(±9)附近，而非人行道中心(±7.5)
  const WALL_SIDE_Z = CROSS_HALF - 0.4; // 8.6
  for (const sx of [-1, 1]) {
    for (const sz of VISIBLE_SZ) {
      const spans = occupied.get(`${sx}|${sz}`) ?? [];
      for (let x = xMin; x < xMax; x += 6 + Math.random() * 3.5) {
        // 不在楼房模型前面摆具（会穿进门面）
        // 余量1.4（大于楼面到街具1.3 米间距），彻底避免具贴门面
        if (spans.some(([a, b]) => x > a - 1.4 && x < b + 1.4)) {
          continue;
        }
        const pick = propPool[Math.floor(Math.random() * propPool.length)];
        const p =
          pick === "trash" ? makeTrashBin() : pick ? pick.clone(true) : null;
        if (!p) continue;
        // 长椅 / BMX 背靠墙：从人行道中心移到墙边；其余道具仍在人行道中心
        const againstWall = pick === m.bench || pick === m.bmx;
        p.position.set(sx * x, 0, sz * (againstWall ? WALL_SIDE_Z : walkZ));
        // 朝向规则：
        // · 长椅：模型正面 -x，转到坐面朝横路车行道（-sz 方向），背贴墙。
        // · STOP 牌：两块牌【同向】，统一朝 +x（沿横路行车方向），给横路上的
        //   车辆与行人看。按用户给的判定：左横路(sx=-1) 朝 +x = 朝向赛道；
        //   右横路(sx=+1) 朝 +x = 背对赛道。
        //   模型牌面默认即 +x（见主路 stopSign 的 rotation.y=-π/2 → 朝 +z 面向镜头），
        //   所以这里【不旋转】；绝不能按 sx 分别转 ±90°，那会变成朝 ±z 的砖墙。
        //   若实际看到的是牌背（模型牌面为 -x），只需把 CROSS_STOP_FACE_Y 改成 Math.PI。
        // · BMX：车沿 x（与墙平行）停放，±90° 随机。
        // · 路灯固定，棕榈 / 消防栓 / 垃圾桶无正反面，随机。
        if (pick === m.bench) p.rotation.y = (-sz * Math.PI) / 2;
        else if (pick === m.stop) p.rotation.y = CROSS_STOP_FACE_Y;
        else if (pick === m.bmx)
          p.rotation.y = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
        else if (pick === m.streetLight) p.rotation.y = 0;
        else p.rotation.y = Math.random() * Math.PI * 2;
        p.traverse((o) => {
          const mm = o as THREE.Mesh;
          if (mm.isMesh) {
            mm.castShadow = false; // 装饰不投影，省一shadow pass
            mm.receiveShadow = false;
          }
        });
        g.add(p);
      }
    }
  }

  // ---- 2b) 交信号灯：每口只放一----
  // 位置取主缘石」与「横街路缘石」交汇的那个人道（前方那一侧）
  // 正镜头（法线与视线平），玩迎面就能看清三色
  if (m.trafficLight) {
    // 固定放在前进方向(-z) 的右侧：镜头朝 -z 时 +x 就是右手边。
    const sx = 1;
    const tl = m.trafficLight.clone(true);
    tl.position.set(
      sx * (CROSS_CURB_X + 1.0), // 8.0：紧贴竖着那道红路缘的内侧
      CROSS_WALK_Y, // 站在人行道面上
      -(CROSS_ROAD_HALF + 1.0) // -7.0：路口前方那侧的转角
    );
    // 不转：模型面按 +z，好法线与镜头视线平（对玩家）
    // 若模型面其实是 -z（看到的背），把这里改成 Math.PI 即可
    tl.rotation.y = 0;
    tl.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh) {
        mm.castShadow = false; // 与其它横街饰一致：不投
        mm.receiveShadow = false;
      }
    });
    g.add(tl);
  }
}

/**
 * 路口动态装饰（行人 + 车辆）。行人骨骼克隆较重，单独成一步。
 */
function decorateCrossroadActors(ctx: SceneContext, g: THREE.Group) {
  const m = ctx.models;
  const st = ctx.street;
  const walkZ = CROSS_ROAD_HALF + CROSS_WALK_W / 2;
  const xMin = STREET.wallX + 4;
  const xMax = CROSS_REACH - 3;

  // ---- 3) 行人（带骨骼动画）----
  // 原来固定「4 象限 × 2 = 8 个/路口」（每块 2 个路口 = 16 次 skeletonClone，
  // 是补块卡顿的大头）。现在每个路口只随机放 1~2 个，方位随机。
  if (m.peds.length > 0) {
    const pedCount = 1 + Math.floor(Math.random() * 2);
    for (let n = 0; n < pedCount; n++) {
      const sx = Math.random() < 0.5 ? -1 : 1;
      const sz = Math.random() < 0.5 ? -1 : 1;
      const src = m.peds[Math.floor(Math.random() * m.peds.length)];
      if (!src) continue;
      let ped: THREE.Group;
      try {
        ped = skeletonClone(src) as THREE.Group;
      } catch {
        ped = src.clone(true) as THREE.Group;
      }
      ped.position.set(
        sx * (xMin + Math.random() * (xMax - xMin)),
        0,
        sz * (walkZ + (Math.random() - 0.5) * 0.9)
      );
      // 行走方向：沿横街（x 轴）来回走 —— 模型默认正面是 +z，
      // 转 π/2 面朝 +x、转 -π/2 面朝 -x，到端点掉头。
      const dir = Math.random() < 0.5 ? 1 : -1;
      ped.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      ped.userData.crossWalk = {
        dir,
        a: sx > 0 ? xMin : -(xMax - 1),
        b: sx > 0 ? xMax - 1 : -xMin,
      } as { dir: number; a: number; b: number };
      const anims: any[] = (src.userData && src.userData.animations) || [];
      if (anims.length > 0) {
        const walk = anims.find((a) => /walk/i.test(a.name));
        const clip = walk || anims[0];
        const mixer = new THREE.AnimationMixer(ped);
        mixer.clipAction(clip).reset().play();
        mixer.timeScale = 1.8;
        st.pedMixers.push(mixer);
      }
      g.add(ped);
      st.pedestrians.push(ped);
    }
  }

  // ---- 4) 车辆：只走侧车道，且避 ----
  // 开关关闭时不含精细 Mercedes，只用低模车（减少 draw call / 面数）
  const carPool = [USE_MERCEDES ? m.mercedes : null, ...m.cars].filter(
    Boolean
  ) as THREE.Object3D[];
  if (carPool.length > 0) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        if (Math.random() < 0.35) continue; // 不是每个象限都有
        const src = carPool[Math.floor(Math.random() * carPool.length)];
        if (!src) continue;
        const car = src.clone(true);
        car.position.set(
          sx * (xMin + 2 + Math.random() * (xMax - xMin - 6)),
          CROSS_ROAD_Y,
          sz * (CROSS_ROAD_HALF - 2.1) // 外侧车道
        );
        // 车头沿横街的行车方向（x 轴）
        car.rotation.y = (sx > 0 ? -1 : 1) * (Math.PI / 2);
        car.traverse((o) => {
          const mm = o as THREE.Mesh;
          if (mm.isMesh) {
            mm.castShadow = true;
            mm.receiveShadow = false;
          }
        });
        g.add(car);
      }
    }
  }
}

const WALK_STRIP_Z_FAR = -400;
const WALK_STRIP_Z_NEAR = 40;
const WALK_TILE_LEN = 10; // 人道贴图一= 10 世界单位（与offset 滚动致）

/**
 * 生成【本块】的人行道 / 路缘石条带。
 *
 * 分块后不再有「220 周期 + 回绕」：每块的条带只覆盖本块范围
 * （局部 z ∈ [-(块长+12), 12]），缺口按本块的 crossZSlots（块内局部坐标）挖。
 * 条带挂在块容器下，随块一起平移、一起销毁。
 */
function rebuildWalkStrips(ctx: SceneContext) {
  const st = ctx.street;
  const zFar = -STREET.wallLen - 12;
  const zNear = 12;

  // 每个路口中心（块内局部 z）
  const centers = st.crossZSlots
    .map((s) => (s.z0 + s.z1) / 2)
    .sort((p, q) => p - q);

  // 求补集：在 [zFar, zNear] 内挖掉所有缺口后剩下的区间。half 为缺口半宽。
  const complement = (half: number): Array<[number, number]> => {
    const cuts: Array<[number, number]> = [];
    for (const c of centers) cuts.push([c - half, c + half]);
    const spans: Array<[number, number]> = [];
    let cursor = zFar;
    for (const [c0, c1] of cuts) {
      if (c1 <= cursor || c0 >= zNear) continue;
      if (c0 > cursor) spans.push([cursor, Math.min(c0, zNear)]);
      cursor = Math.max(cursor, c1);
      if (cursor >= zNear) break;
    }
    if (cursor < zNear) spans.push([cursor, zNear]);
    return spans;
  };

  // 人行道缺口按车行道宽（±6）；路缘石要让到转角圆弧外（±(6+R)=±7.2），
  // 否则直路缘会一直铺进圆弧区间 [6, 7.2]，在转角处多出一段「突出的路肩」。
  const walkSpans = complement(CROSS_ROAD_HALF);
  const curbSpans = complement(CROSS_ROAD_HALF + CROSS_CORNER_R);

  // ---- 人行道：平面条带 + 按世界 z 烘焙 UV（每 10 单位一格）----
  const walkW = 3.5;
  const walkParts: THREE.BufferGeometry[] = [];
  for (const [a, b] of walkSpans) {
    const len = b - a;
    if (len <= 0.05) continue;
    const g = new THREE.PlaneGeometry(walkW, len);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, a + len / 2);
    walkParts.push(g);
  }
  if (walkParts.length === 0) return;
  const walkGeo = mergeGeometries(walkParts, false)!;
  for (const p of walkParts) p.dispose();
  const wp = walkGeo.attributes.position;
  const wuv = walkGeo.attributes.uv as THREE.BufferAttribute | undefined;
  if (wp && wuv) {
    for (let i = 0; i < wp.count; i++) {
      wuv.setXY(i, (wp.getX(i) + walkW / 2) / walkW, wp.getZ(i) / 10);
    }
    wuv.needsUpdate = true;
  }
  ctx.sidewalkTex.wrapS = THREE.RepeatWrapping;
  ctx.sidewalkTex.wrapT = THREE.RepeatWrapping;
  ctx.sidewalkTex.repeat.set(1, 1);

  // ---- 路缘石：盒子条带（纯色，不需要 UV）----
  const curbParts: THREE.BufferGeometry[] = [];
  for (const [a, b] of curbSpans) {
    const len = b - a;
    if (len <= 0.05) continue;
    const g = new THREE.BoxGeometry(0.22, 0.12, len);
    g.translate(0, 0, a + len / 2);
    curbParts.push(g);
  }
  const curbGeo = mergeGeometries(curbParts, false)!;
  for (const p of curbParts) p.dispose();

  for (const side of [-1, 1]) {
    const walk = new THREE.Mesh(walkGeo.clone(), ctx.sidewalkMat);
    walk.position.set(side * 8.75, 0.035, 0);
    walk.receiveShadow = true;
    ctx.chunkRoot.add(walk);

    const curb = new THREE.Mesh(curbGeo.clone(), ctx.curbMat);
    curb.position.set(side * 7.0, 0.06, 0);
    curb.receiveShadow = true;
    ctx.chunkRoot.add(curb);
  }
  walkGeo.dispose();
  curbGeo.dispose();
}

/**
 * 路口几何模板缓存：每个路口的形状完全相同（只有 z 位置不同），
 * 首次建好后克隆复用（clone(true) 共享几何/材质），避免每块都重新
 * 生成一堆几何并上传 GPU —— 这是“加载新地图”时一次性卡顿的一个来源。
 * build() 重建场景时清空。
 */
let crossroadGeoTemplate: THREE.Group | null = null;

/** 一段十字路口的几何（局部坐标：z=0 为路口中心，y=0 为地面） */
function makeCrossroadGeometry(
  roadMat: THREE.Material,
  walkMat: THREE.Material,
  curbMat: THREE.Material,
  wallMat: THREE.Material,
  wallEndMat: THREE.Material,
  edgeMat: THREE.Material,
  copeMat: THREE.Material,
  lineMat: THREE.Material
): THREE.Group {
  if (!crossroadGeoTemplate) {
    const tpl = buildCrossroadGeometryFresh(
      roadMat,
      walkMat,
      curbMat,
      wallMat,
      wallEndMat,
      edgeMat,
      copeMat,
      lineMat
    );
    // 标记共享：disposeChunk 只释放“本块自己创建”的几何，模板几何必须留下。
    tpl.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.userData.shared = true;
    });
    crossroadGeoTemplate = tpl;
  }
  return crossroadGeoTemplate.clone(true);
}

/** 实际构建路口几何（只会在首次被 makeCrossroadGeometry 调用）。 */
function buildCrossroadGeometryFresh(
  roadMat: THREE.Material,
  walkMat: THREE.Material,
  curbMat: THREE.Material,
  wallMat: THREE.Material,
  wallEndMat: THREE.Material,
  edgeMat: THREE.Material,
  copeMat: THREE.Material,
  lineMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  const roadW = CROSS_ROAD_HALF * 2;
  // 转角圆弧外侧那块用的沥青材质：取 road.png 的纯沥青段（与路口补丁同一套 UV 规则）。
  // 双面渲染 —— 四个象限的三角形绕序不同，这样不用为每个象限单独纠正绕序。
  const cornerAsphaltMat = roadMat.clone() as THREE.MeshStandardMaterial;
  cornerAsphaltMat.side = THREE.DoubleSide;
  // 车行道从主路路缘石内侧起铺，人行道从墙线起铺
  const roadLen = CROSS_REACH - CROSS_ROAD_EDGE;
  // 路缘石从主路路缘线(x=7) 起；人行道从主路墙线(x=10.5) 起 ——
  // 转角那 3.5 米本来就是主路的人行道，横路不要再铺一层
  // （两层只差 2mm 时，远处深度精度不够会随机「缺一块」，跑近了又出现）。
  const walkStart = STREET.wallX;
  const walkLen = CROSS_REACH - walkStart;
  /**
   * 把平面转成「横向马路」的朝向：U 转到 z（横路宽度）、V 转到 x（沿路长）。
   * 主赛道贴图是 U=路面横截面、V=沿路长的布局，转 90° 才能让标线沿横路走。
   */
  const orient = (geo: THREE.BufferGeometry) => {
    geo.rotateX(-Math.PI / 2); // 放平：→x、长→z
    geo.rotateY(Math.PI / 2); // 再转 90°：U→z、V→x
  };
  for (const side of [-1, 1]) {
    // 1) 车行道：与主赛道同一张 road.png，V 按长度缩放使「每 27.5 单位一格」。
    //    起点压到主路路缘外侧（CROSS_ROAD_EDGE），把主路的红路缘整条盖住 ——
    //    路口处不该有一条红路缘横穿路面。
    const roadGeo = new THREE.PlaneGeometry(roadW, roadLen);
    orient(roadGeo);
    const ruv = roadGeo.attributes.uv as THREE.BufferAttribute;
    const vScale = roadLen / 220; // 主路是 220 长铺 8 格
    for (let i = 0; i < ruv.count; i++) ruv.setY(i, ruv.getY(i) * vScale);
    ruv.needsUpdate = true;
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.position.set(side * (CROSS_ROAD_EDGE + roadLen / 2), CROSS_ROAD_Y, 0);
    road.receiveShadow = true;
    g.add(road);

    // 2) 两侧人道：与主款贴图，外沿正好与转角齐平
    for (const sz of [-1, 1]) {
      const walkGeo = new THREE.PlaneGeometry(CROSS_WALK_W, walkLen);
      orient(walkGeo); // 人道贴图是按世界尺寸 repeat 的，UV 不再缩放
      const walk = new THREE.Mesh(walkGeo, walkMat);
      walk.position.set(
        side * (walkStart + walkLen / 2),
        CROSS_WALK_Y,
        sz * (CROSS_ROAD_HALF + CROSS_WALK_W / 2)
      );
      walk.receiveShadow = true;
      g.add(walk);
      // 3) 红色石：与主规格（高 0.12、 0.22、红漆）
      // 起点到圆弧之外（x = 7 + R），那一段由下面1/4 圆弧石顺接
      // 起点比圆弧端点再往里 6cm：让直路缘插到圆弧端头下面，
      // 两者重叠而不是「对接」，否则接缝会露出一个亮边 / 多出一小块。
      const curbStart = CROSS_CURB_X + CROSS_CORNER_R - 0.06;
      const curbSpan = CROSS_REACH - curbStart;
      const curbH = CROSS_CURB_H - 0.005;
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(curbSpan, curbH, CROSS_CURB_W),
        curbMat
      );
      curb.position.set(
        side * (curbStart + curbSpan / 2),
        curbH / 2,
        sz * CROSS_ROAD_HALF
      );
      g.add(curb);

      // 3b) 圆弧石（curb radius）
      // 圆心 C = (±(7+R), ±(6+R))，半径 R = CROSS_CORNER_R，
      // P(t) = C + (-side·R·cos t, -sz·R·sin t)，t ∈ [0, π/2]：
      //   t=0 → (±7, ±(6+R))  与主路路缘接上（主路路缘已在此断开）
      //   t=1 → (±(7+R), ±6)  与横路直路缘接上
      const SEGS = 12; // 分得，弧段之间会出现的折细缝
      const cornerX = side * CROSS_CURB_X;
      const cornerZ = sz * CROSS_ROAD_HALF;
      const ccx = cornerX + side * CROSS_CORNER_R;
      const ccz = cornerZ + sz * CROSS_CORNER_R;
      const arcPts: THREE.Vector2[] = [];
      for (let i = 0; i <= SEGS; i++) {
        const t = (i / SEGS) * (Math.PI / 2);
        arcPts.push(
          new THREE.Vector2(
            ccx - side * CROSS_CORNER_R * Math.cos(t),
            ccz - sz * CROSS_CORNER_R * Math.sin(t)
          )
        );
      }
      // 3b-2) 用【挤出圆环】做路缘圆弧，而不是一串小方块。
      // 小方块的宽度(0.22)大于弧长分段(0.157)，转角处盒子外角必然顶出去，
      // 表现为“路肩多出一小块”。挤出环是连续曲面，没有这个问题。
      const curbROut = CROSS_CORNER_R + CROSS_CURB_W / 2;
      const curbRIn = CROSS_CORNER_R - CROSS_CURB_W / 2;
      const ringPts: THREE.Vector2[] = [];
      // 形状坐标用 (x, -z)：rotateX(−90°) 后 shape 的 y 正好映射到世界 −z
      for (let i = 0; i <= SEGS; i++) {
        const t = (i / SEGS) * (Math.PI / 2);
        ringPts.push(
          new THREE.Vector2(
            ccx - side * curbROut * Math.cos(t),
            -(ccz - sz * curbROut * Math.sin(t))
          )
        );
      }
      for (let i = SEGS; i >= 0; i--) {
        const t = (i / SEGS) * (Math.PI / 2);
        ringPts.push(
          new THREE.Vector2(
            ccx - side * curbRIn * Math.cos(t),
            -(ccz - sz * curbRIn * Math.sin(t))
          )
        );
      }
      const arcGeo = new THREE.ExtrudeGeometry(new THREE.Shape(ringPts), {
        depth: curbH,
        bevelEnabled: false,
        curveSegments: 6,
      });
      arcGeo.rotateX(-Math.PI / 2);
      const arc = new THREE.Mesh(arcGeo, curbMat);
      arc.receiveShadow = true;
      g.add(arc);

      // 3c) 圆弧外侧掉的角部铺成沥青（人行道形网格，无法切
      // 这里在其上盖一层）：用「从方点出发连到圆弧采样点」的扇形三
      // 精确贴合圆弧；UV 仍取 road.png 的纯沥青段，色调与路致
      //
      // 注意：这块补片比人道高 3mm、贴片边界又的，
      // 从低角度看会从缝里出背景，形成一条白—以除了顶
      // 还沿边界（圆弧 + 两条直边）补圈侧裙把 y=0~顶面 封住
      const wedgePos: number[] = [];
      const wedgeUv: number[] = [];
      const wedgeTopY = CROSS_WALK_Y + 0.003;
      const pushVert = (x: number, y: number, z: number) => {
        wedgePos.push(x, y, z);
        wedgeUv.push(0.1 + ((x + 7) / 14) * 0.2, z / 220);
      };
      // 顶面扇形
      for (let i = 0; i < SEGS; i++) {
        pushVert(cornerX, wedgeTopY, cornerZ);
        pushVert(arcPts[i].x, wedgeTopY, arcPts[i].y);
        pushVert(arcPts[i + 1].x, wedgeTopY, arcPts[i + 1].y);
      }
      // 侧（双面材不用管绕序）
      const skirtSeg = (x0: number, z0: number, x1: number, z1: number) => {
        pushVert(x0, 0, z0);
        pushVert(x0, wedgeTopY, z0);
        pushVert(x1, wedgeTopY, z1);
        pushVert(x0, 0, z0);
        pushVert(x1, wedgeTopY, z1);
        pushVert(x1, 0, z1);
      };
      for (let i = 0; i < SEGS; i++)
        skirtSeg(arcPts[i].x, arcPts[i].y, arcPts[i + 1].x, arcPts[i + 1].y);
      skirtSeg(arcPts[SEGS].x, arcPts[SEGS].y, cornerX, cornerZ);
      skirtSeg(cornerX, cornerZ, arcPts[0].x, arcPts[0].y);
      const wedgeGeo = new THREE.BufferGeometry();
      wedgeGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(wedgePos, 3)
      );
      wedgeGeo.setAttribute("uv", new THREE.Float32BufferAttribute(wedgeUv, 2));
      wedgeGeo.computeVertexNormals();
      const wedge = new THREE.Mesh(wedgeGeo, cornerAsphaltMat);
      g.add(wedge);

      // 3d) 地面黄线的转角圆弧。
      //     要让圆弧与两条直黄线【真正连上】，圆弧必须同时与它们相切：
      //       主路黄线在 x = ±6.3（14 宽路面，边线在 u≈0.05）
      //       横路黄线在 z = ±5.4（12 宽路面，边线在 u≈0.05）
      //     相切 ⇔ 圆心到两条线等距，所以圆心取 (6.3+R, 5.4+R)；
      //     不能沿用路缘圆弧的圆心（它到两条线分别是 1.9 / 1.8，必然差 5cm 接不上）。
      const LINE_HALF_W = 0.142; // 黄线宽约 0.284（road.png 实测边线宽度）
      // 黄线位置按象限取实测值（左右 / 两侧各不相同）
      const yx = side < 0 ? CROSS_YELLOW_X_LEFT : CROSS_YELLOW_X_RIGHT;
      const yz = sz > 0 ? CROSS_YELLOW_Z_POS : CROSS_YELLOW_Z_NEG;
      const lineCx = side * (yx + CROSS_YELLOW_R);
      const lineCz = sz * (yz + CROSS_YELLOW_R);
      const rOut = CROSS_YELLOW_R + LINE_HALF_W;
      const rIn = CROSS_YELLOW_R - LINE_HALF_W;
      const linePts: THREE.Vector2[] = [];
      // 形状坐标 (x, -z)：rotateX(-90°) 后 shape 的 y 正好映射到世界 -z
      for (let i = 0; i <= SEGS; i++) {
        const t = (i / SEGS) * (Math.PI / 2);
        linePts.push(
          new THREE.Vector2(
            lineCx - side * rOut * Math.cos(t),
            -(lineCz - sz * rOut * Math.sin(t))
          )
        );
      }
      for (let i = SEGS; i >= 0; i--) {
        const t = (i / SEGS) * (Math.PI / 2);
        linePts.push(
          new THREE.Vector2(
            lineCx - side * rIn * Math.cos(t),
            -(lineCz - sz * rIn * Math.sin(t))
          )
        );
      }
      const lineGeo = new THREE.ExtrudeGeometry(new THREE.Shape(linePts), {
        depth: 0.0145,
        bevelEnabled: false,
      });
      lineGeo.rotateX(-Math.PI / 2);
      const lineArc = new THREE.Mesh(lineGeo, lineMat);
      lineArc.receiveShadow = true;
      g.add(lineArc);

      // 3e) 吃掉「直黄线探出圆弧」的那两小段。
      //     直黄线是烘在路面贴图里的，几何上无法截断，只能在它上面盖一块
      //     「纯沥青」补片（UV 取 road.png 的沥青段，色调与路面一致）：
      //       · 主路这条：从路口边缘(z=6) 一直盖到圆弧起点(z=6+R+0.3)；
      //       · 横路这条：从路口边缘(x=6.7) 盖到圆弧起点(x=7+R+0.3)。
      //     高度都压在圆弧黄线(0.0145) 之下，不会盖住圆弧本身。
      const coverAsphalt = (
        xa: number,
        xb: number,
        za: number,
        zb: number,
        y: number
      ) => {
        const w = Math.abs(xb - xa);
        const d = Math.abs(zb - za);
        if (w < 0.02 || d < 0.02) return;
        const geo = new THREE.PlaneGeometry(w, d);
        geo.rotateX(-Math.PI / 2);
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++)
          uv.setXY(i, 0.1 + uv.getX(i) * 0.2, uv.getY(i) * (d / 220));
        uv.needsUpdate = true;
        const mesh = new THREE.Mesh(geo, roadMat);
        mesh.position.set((xa + xb) / 2, y, (za + zb) / 2);
        mesh.receiveShadow = true;
        g.add(mesh);
      };
      // 主路侧（黄线 x=±6.3）：盖到【圆弧切点】为止 —— z 到 ±(5.4+R)，
      // 不能多盖：盖过头会在切点之外露出一段空沥青，看起来就是「黄线断开了」。
      const zTangent = sz * (yz + CROSS_YELLOW_R) - sz * 0.01;
      coverAsphalt(
        Math.min(cornerX - side * 1.1, cornerX - side * 0.05),
        Math.max(cornerX - side * 1.1, cornerX - side * 0.05),
        Math.min(cornerZ, zTangent),
        Math.max(cornerZ, zTangent),
        0.0065
      );
      // 横路侧（黄线 z=±5.4）：同理盖到 ±(6.3+R)
      const xTangent = side * (yx + CROSS_YELLOW_R) - side * 0.01;
      coverAsphalt(
        Math.min(side * CROSS_ROAD_EDGE, xTangent),
        Math.max(side * CROSS_ROAD_EDGE, xTangent),
        Math.min(cornerZ - sz * 1.1, cornerZ - sz * 0.05),
        Math.max(cornerZ - sz * 1.1, cornerZ - sz * 0.05),
        0.0135
      );
    }
  }
  // 5) 路口中央「无标线沥青」补丁：盖掉主赛道穿过路口时的黄线 / 白虚线。
  //    road.png 的横截面里黄线在 u≈0.04~0.06 与 0.94~0.96、白虚线在 u≈0.31/0.67，
  //    这里把 UV 压进 u∈[0.10,0.30] 的纯沥青段铺满 14×12 的路口，只抬 6mm。
  {
    const patchGeo = new THREE.PlaneGeometry(14, roadW);
    patchGeo.rotateX(-Math.PI / 2);
    const puv = patchGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < puv.count; i++)
      puv.setXY(i, 0.1 + puv.getX(i) * 0.2, puv.getY(i) * (roadW / 220));
    puv.needsUpdate = true;
    const patch = new THREE.Mesh(patchGeo, roadMat);
    patch.position.set(0, 0.006, 0);
    patch.receiveShadow = true;
    g.add(patch);
  }
  // 2) 四道转角墙：正面(±z) 贴砖 —— 玩家迎面看到的就是这面墙
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      // 转角墙放在路口边线【外侧】(z = ±(9 + 0.25))，整段都躲到主路墙背后：
      // 这样它朝向马路的那两个窄端面(±x，宽 0.5) 正好被主路墙压住，
      // 不会再在砖墙接缝处露出一条颜色不一样的竖边。
      const cz = sz * (CROSS_HALF + CROSS_WALL_T / 2);
      // 起点放在主路墙的【背面】(wallX + 厚度/2)：主路方向的砖墙压在横路方向的砖墙之前，
      // 相交处看到的是主路墙的完整砖面，而不是被横路的墙切断。
      const cx =
        sx * (STREET.wallX + STREET.wallThickness / 2 + CROSS_WALL_LEN / 2);
      const w = new THREE.Mesh(
        new THREE.BoxGeometry(CROSS_WALL_LEN, CROSS_WALL_H, CROSS_WALL_T),
        // 材质顺序 [+x, -x, +y, -y, +z, -z]：两个端面(±x) 也用砖纹，
        // 否则它们正对马路、会显示成一条"颜色不一样的竖条"。
        [wallEndMat, wallEndMat, edgeMat, edgeMat, wallMat, wallMat]
      );
      w.position.set(cx, CROSS_WALL_H / 2, cz);
      w.receiveShadow = true;
      g.add(w);
      // 压顶石：与沿街同一条细石线脚，避免这一段头是「光板
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(CROSS_WALL_LEN, 0.12, CROSS_WALL_T + 0.06),
        copeMat
      );
      cap.position.set(cx, CROSS_WALL_H + 0.06, cz);
      g.add(cap);
    }
  }
  // 3) 横路尽头封口墙：加速后相机拉远、视野变广时，若横路地面在远处结束，
  //    会露出「地图外」的空白。在 x = ±CROSS_REACH 封一道墙挡住地面尽头。
  //    它位于二线远景楼（x≈28）之后，正常视角下几乎被远景楼遮住，只在缝隙里兜底。
  for (const sx of [-1, 1]) {
    const endW = CROSS_HALF * 2 + CROSS_WALL_T * 2; // 横跨整条横路，含两侧转角墙
    const end = new THREE.Mesh(
      new THREE.BoxGeometry(CROSS_WALL_T, CROSS_WALL_H, endW),
      // 材质顺序 [+x, -x, +y, -y, +z, -z]：两个 ±x 面正对赛道，贴砖；其余窄面用纯色。
      [wallMat, wallMat, edgeMat, edgeMat, edgeMat, edgeMat]
    );
    end.position.set(
      sx * (CROSS_REACH + CROSS_WALL_T / 2),
      CROSS_WALL_H / 2,
      0
    );
    end.receiveShadow = true;
    g.add(end);
  }
  // 4) 人行横道（程序化斑马线）：十字路口四个方向。
  //    road.png 的黄色边线在 u≈0.05 / 0.95 —— 主路 |x|≈6.28、横路 |z|≈5.38，
  //    是【道路两侧】的边线而非中央线。所以斑马线必须整体收在黄线以内，
  //    两端都不许压到黄线上；中央反而要连续铺满（那里没有黄线）。
  //    底板复用 road.png 的纯沥青段 UV，盖掉延伸过来的白色虚线且不留色差。
  {
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xf0f0f0,
      roughness: 0.88,
      metalness: 0,
    });
    const stripeW = 0.6;
    const gap = 0.3;
    /** 斑马线端点与黄色边线之间留出的余量（米） */
    const YELLOW_CLEAR = 0.5;

    const makeStripeSet = (
      cx: number,
      cz: number,
      rotY: number,
      spanLen: number,
      depth: number,
      y: number
    ) => {
      const group = new THREE.Group();
      // 底板：把 UV 压进 road.png 的纯沥青段(u∈[0.10,0.30])，
      // 与下方路面同色，盖住穿过斑马线的白色虚线（车道线在斑马线处本就断开）。
      const bg = new THREE.PlaneGeometry(spanLen, depth);
      bg.rotateX(-Math.PI / 2);
      const buv = bg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < buv.count; i++)
        buv.setXY(i, 0.1 + buv.getX(i) * 0.2, buv.getY(i) * (depth / 220));
      buv.needsUpdate = true;
      const base = new THREE.Mesh(bg, roadMat);
      base.position.y = -0.003;
      base.receiveShadow = true;
      base.castShadow = false;
      group.add(base);

      // 白条纹：整组连续（中央没有黄线，无需留空）
      const step = stripeW + gap;
      const n = Math.max(1, Math.floor((spanLen + gap) / step));
      const total = n * stripeW + (n - 1) * gap;
      const parts: THREE.BufferGeometry[] = [];
      let x = -total / 2 + stripeW / 2;
      for (let i = 0; i < n; i++) {
        const geo = new THREE.PlaneGeometry(stripeW, depth);
        geo.rotateX(-Math.PI / 2);
        geo.translate(x, 0, 0);
        parts.push(geo);
        x += step;
      }
      if (parts.length > 0) {
        const merged = mergeGeometries(parts, false)!;
        for (const p of parts) p.dispose();
        const stripes = new THREE.Mesh(merged, stripeMat);
        stripes.receiveShadow = true;
        stripes.castShadow = false;
        group.add(stripes);
      }
      group.position.set(cx, y, cz);
      group.rotation.y = rotY;
      return group;
    };
    // 南北：主路黄线 |x|≈6.28 → 斑马线收在 ±(6.28-0.5) 以内
    const mainSpan = (CROSS_YELLOW_X_LEFT - YELLOW_CLEAR) * 2;
    g.add(makeStripeSet(0, CROSS_ROAD_HALF + 1.5, 0, mainSpan, 3, 0.02));
    g.add(makeStripeSet(0, -(CROSS_ROAD_HALF + 1.5), 0, mainSpan, 3, 0.02));
    // 东西：横路黄线 |z|≈5.38 → 收在 ±(5.38-0.5) 以内
    const crossSpan = (CROSS_YELLOW_Z_POS - YELLOW_CLEAR) * 2;
    g.add(
      makeStripeSet(CROSS_ROAD_HALF + 1.5, 0, Math.PI / 2, crossSpan, 3, 0.05)
    );
    g.add(
      makeStripeSet(
        -(CROSS_ROAD_HALF + 1.5),
        0,
        Math.PI / 2,
        crossSpan,
        3,
        0.05
      )
    );
  }
  return g;
}

// 清除落在巷口范围内的人道饰（人）
// 时序说明：巷口随机生成且依赖已建楼群，无法在 buildCityDecor 时知，
// 故在 buildAlleyways 之后执法，把已生成但恰好压在巷口的装饰移除
// 移走后处留空是合理的巷口本就不该有东西；运行期补充时也会跳过巷口
export function clearDecorInAlleyMouths(ctx: SceneContext) {
  const st = ctx.street;
  const kept: THREE.Object3D[] = [];
  for (const m of st.cityDecor) {
    const side = m.position.x > 0 ? 1 : -1;
    if (isInAlleyMouth(ctx, side, m.position.z, 0.5)) {
      ctx.scene.remove(m);
      continue;
    }
    kept.push(m);
  }
  st.cityDecor = kept;
  // 兜底：清除压在球场两侧巷道口的长椅 / BMX。
  // 装饰行生成的，球场巷道位赖球场模型的识别结果，可能晚于饰生成；
  // 这里按类型再筛一遍，通道口不地饰堵住（其余类型装饰保持不动）
  const kept2: THREE.Object3D[] = [];
  for (const m of st.cityDecor) {
    const side = m.position.x > 0 ? 1 : -1;
    const n = (m.userData.decorKind as string) ?? "";
    const isBenchOrBmx = n === "bench" || n === "bmx";
    if (isBenchOrBmx && isInCourtAlley(ctx, side, m.position.z, 1.2)) {
      ctx.scene.remove(m);
      continue;
    }
    kept2.push(m);
  }
  st.cityDecor = kept2;
  // 行人同理：站在巷口会挡住缺口
  const keptPeds: THREE.Group[] = [];
  for (const p of st.pedestrians) {
    const side = p.position.x > 0 ? 1 : -1;
    if (
      isInAlleyMouth(ctx, side, p.position.z, 0.5) ||
      isInCourtAlley(ctx, side, p.position.z, 1.2)
    ) {
      ctx.scene.remove(p);
      continue;
    }
    keptPeds.push(p);
  }
  st.pedestrians = keptPeds;
}

/** 清空本块装饰（每块构建开始时一次） */
function clearCityDecor(ctx: SceneContext) {
  const st = ctx.street;
  for (const m of st.cityDecor) ctx.scene.remove(m);
  st.cityDecor.length = 0;
  // 注意：不要清空 st.pedestrians / st.pedMixers！
  // 它们是【跨块】累积的数组：路口行人在地产带之前就生成了，若在这里清空，
  // 它们的 mixer 会丢失 → 不再被 update（表现为"路人不走路"）。
  // 每块行人的增删由 finishChunk / disposeChunk 按块负责。
}

/** 铺设一段装饰带 [zStart, zEnd)。按 z 分片，避免整条装饰带挤在一帧。 */
function buildCityDecorSpan(ctx: SceneContext, zStart: number, zEnd: number) {
  const st = ctx.street;
  let z = zStart;
  while (z < zEnd) {
    // 范围内不放人行道装饰（横向道留出通的空地）
    if (isInCrossroad(ctx, z, 5)) {
      z += 7 + Math.random() * 3.5;
      continue;
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    const mesh = makeRandomDecor(ctx, side, z);
    mesh.visible = false; // 由 applySceneMode 控制显示
    ctx.chunkRoot.add(mesh);
    st.cityDecor.push(mesh);
    z += 7 + Math.random() * 3.5;
  }
}

// 垂直小巷透：随机间隔地把某段隐藏（露出上的缺口=巷口），
// 并在缺口处向墙后深段暗巷地+ 巷尾暖光，制造垂直于人道向墙后的纵深感
// 仅隐藏段不影响墙后建筑；与墙同周期(wallCycle)滚动复用；仅street 模式显示、不参与碰撞
export function buildAlleyways(ctx: SceneContext) {
  const st = ctx.street;
  for (const m of st.alleyways) ctx.scene.remove(m);
  st.alleyways.length = 0;
  const wallX = 10.5; // 墙所在的 x 绝
  const depth = 70; // 暗巷向后（x 方向）延伸深度：足长，使巷尾沉入远看不到尽
  const segLen = STREET.wallSegLen; // 巷口= 段长度，与缺口对齐
  // 墙后建筑禁区：巷口不要好开在楼临面（避免洞口楼面对挡死
  // 与楼面前后重叠会打架，故只避开楼面前后一小段，远小于楼间空隙（2 米以上）。
  // 保证楼与楼之间的空隙处仍能开出巷口，不会因区连片一条都没有
  // 用真实占位半b.halfD) + 整墙长(segLen)余量，确保巷口与任何建筑/球场之间
  // 至少隔着段实心，避免巷口紧贴楼/球场、从赛道看像楼房侵入巷子
  const blocked = st.buildings.map((b) => {
    const h = (b.halfD ?? 6) + segLen + 2;
    return { lo: b.z - h, hi: b.z + h };
  });
  const inBlocked = (z: number) => blocked.some((r) => z >= r.lo && z <= r.hi);
  // 跳过落在场区间（及其两侧余量）的墙，避免巷口开在球场、暗巷穿透球场；
  // 余量扩大为一段segLen)，确保球场缺口两侧各留一段实心，暗巷不会紧贴球场缺
  const courtMargin = segLen + 2;
  const inCourt = (z: number, side: number) =>
    st.courtZSlots.some(
      (s) =>
        s.side === side && z >= s.z0 - courtMargin && z <= s.z1 + courtMargin
    );
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x121216,
    roughness: 1,
    metalness: 0,
  });
  // 沿墙段随机间隔挑选巷口：每段之后随机决定「下一段的间隔」(randGap ∈ [4,10])
  // 间隔长短不一、完全无规律；左右侧各自，避免两侧巷口贴在一起
  const randGap = () => 4 + Math.floor(Math.random() * 7); // 4~10 段随机间
  const since: Record<number, number> = { [-1]: 0, [1]: randGap() }; // 左右起错开
  const nextGap: Record<number, number> = { [-1]: randGap(), [1]: randGap() };
  let passed = 0; // 通过建筑避过滤的段数
  let created = 0; // 实际创建的巷口数
  for (const w of st.walls) {
    // 十字让开的段不再开巷口（两者叠在一起会把路口切碎）
    if (w.userData.crossRoad) continue;
    const side: number = w.position.x > 0 ? 1 : -1;
    const z = w.position.z;
    // 跳过落在墙后建筑禁区内的墙，确保巷口不与楼体重
    if (inBlocked(z)) continue;
    // 跳过落在场区间的墙，避免巷口开在球场、暗巷穿透球
    if (inCourt(z, side)) continue;
    passed++;
    since[side]++;
    // 达到随机间隔后尝试开巷口；若因建筑避让未能开成，则顺延到下一段再判断
    if (since[side] >= nextGap[side]) {
      w.visible = false; // 去掉这一段，露出缺
      const g = new THREE.Group();
      g.position.set(0, 0, z); // Group 仅承载滚动平移，子物体用相坐标
      // 暗巷地面：沿 z 长 = segLen（正好填满缺口），向墙后 x 方向延伸 depth
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(depth, segLen),
        floorMat
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(side * (wallX + depth / 2), 0.01, 0);
      floor.receiveShadow = false;
      g.add(floor);
      // 不再设置明确的巷尾亮块：暗巷直接延伸至远depth=70），
      // 尽头吞没，玩家看不到底，纵深感更真实
      // 巷子两侧夹：沿 z 方向、位于暗巷两条边（z = ±segLen/2），向后延depth
      // 高度与主墙一4.5)。内侧（面向巷子内）贴涂鸦（砖纹+涂鸦），外侧贴纯砖纹（无涂鸦）
      // 贴图沿深度方向平repeat.x=depth/segLen，使砖纹比例正确、不伸
      const alleyWallTex = ctx.loadWallTexture(wallTex, depth / segLen, 1, {
        outW: STREET.segTexW,
        outH: STREET.segTexH,
        segments: 1,
      });
      const alleyWallMat = new THREE.MeshStandardMaterial({
        map: alleyWallTex,
        roughness: 0.9,
      }); // 内面：涂鸦
      // 外侧：纯砖纹（无涂鸦），同样按深度平铺避免拉
      const outerTex = ctx.loadWallTexture(wallTex, depth / segLen, 1, {
        outW: STREET.segTexW,
        outH: STREET.segTexH,
        noGraffiti: true,
      });
      const plainMat = new THREE.MeshStandardMaterial({
        map: outerTex,
        roughness: 0.9,
      }); // 外面：纯砖纹
      for (const ez of [-segLen / 2, segLen / 2]) {
        // Box 材质索引=+x,1=-x,2=+y,3=-y,4=+z,5=-z
        // 内面 = 朝巷子中z=0)的那ez<0 时内 +z(索引4)，ez>0 时内 -z(索引5)
        const innerFace = ez < 0 ? 4 : 5;
        const mats = [
          plainMat,
          plainMat,
          plainMat,
          plainMat,
          plainMat,
          plainMat,
        ];
        mats[innerFace] = alleyWallMat; // 仅内侧贴涂鸦
        const aw = new THREE.Mesh(
          new THREE.BoxGeometry(depth, 4.5, 0.16),
          mats
        );
        aw.position.set(side * (wallX + depth / 2), 2.25, ez);
        g.add(aw);
      }
      // 巷口两侧（提示开口边界）
      for (const ez of [-segLen / 2, segLen / 2]) {
        const lip = new THREE.Mesh(
          new THREE.BoxGeometry(depth + 0.4, 0.12, 0.4),
          new THREE.MeshStandardMaterial({ color: 0x33333b, roughness: 1 })
        );
        lip.position.set(side * (wallX + depth / 2), 0.06, ez);
        g.add(lip);
      }
      g.visible = false; // 由 applySceneMode 控制显示
      g.userData.side = side;
      ctx.chunkRoot.add(g);
      st.alleyways.push(g);
      w.userData.alley = g; // 绑定到段，随墙起滚回收
      since[side] = 0; // 重置该侧计数
      nextGap[side] = randGap(); // 随机决定下一次间隔，消除规律 created++;
    }
  }
  const leaks: any[] = [];
  for (const g of st.alleyways) {
    const z = g.position.z;
    const side = g.userData.side as number;
    for (const b of st.buildings) {
      const bSide = b.mesh.position.x > 0 ? 1 : -1;
      if (bSide !== side) continue;
      const bh = b.halfD ?? 6;
      if (z + 3 > b.z - bh && z - 3 < b.z + bh) {
        leaks.push({
          z: Math.round(z),
          bz: Math.round(b.z),
          bh: Math.round(bh),
          isCourt: !!b.isCourt,
        });
      }
    }
  }
}

// ==================== ====================

/**
 * 柱与停靠车辆都立在人行道上（ x=±7.7、停x=±8.2，横向必然重叠） * 以只能在 z 方向错开：灯柱与车身的距离小于这就
 * 否则会从车头/车尾插进车模型车长约 2.4，再1 米余量 */
const LAMP_CAR_CLEAR_Z = 3.4;

/** 该位置附近是否有同侧的停靠车辆（给灯柱选址用） */
function isNearParkedCar(ctx: SceneContext, side: number, z: number): boolean {
  return ctx.street.cityDecor.some((m) => {
    if (m.userData.decorKind !== "car") return false;
    const ms = m.position.x > 0 ? 1 : -1;
    return ms === side && Math.abs(m.position.z - z) < LAMP_CAR_CLEAR_Z;
  });
}

/** 该位置附近是否有同侧路灯（给停车位选址用） */
function isNearStreetLight(
  ctx: SceneContext,
  side: number,
  z: number
): boolean {
  return ctx.street.streetLights.some((m) => {
    const ms = m.position.x > 0 ? 1 : -1;
    return ms === side && Math.abs(m.position.z - z) < LAMP_CAR_CLEAR_Z;
  });
}

// 规律带：沿两侧固定间隔（STREETLIGHT_GAP）交替出现（左一右
// 始终朝马心，营整齐的街道照明节感
export function buildStreetLights(ctx: SceneContext) {
  const st = ctx.street;
  for (const m of st.streetLights) ctx.scene.remove(m);
  st.streetLights.length = 0;
  st.streetLightCount = 0; // 重置交替相位计数
  const gap = 22; // 相邻（含左右）间距，密度适中
  let z = -130;
  while (z < 20) {
    const side = st.streetLightCount % 2 === 0 ? -1 : 1;
    if (isInCrossroad(ctx, z, 4) || isNearParkedCar(ctx, side, z)) {
      // 这一档在里或正好停着车：放弃，但消一位，保持左右交替的节奏不
      st.streetLightCount++;
    } else {
      const mesh = makeStreetLight(ctx, z);
      mesh.visible = false; // 由 applySceneMode 控制显示
      ctx.chunkRoot.add(mesh);
      st.streetLights.push(mesh);
    }
    z += gap;
  }
}

// 生成左右由全计数streetLightCount）决定，保证严格交替
export function makeStreetLight(ctx: SceneContext, z: number): THREE.Object3D {
  const st = ctx.street;
  const side = st.streetLightCount % 2 === 0 ? -1 : 1; // 偶数左、奇数右
  st.streetLightCount++;
  const x = side * 7.7; // 墙内侧道，避免
  let mesh: THREE.Object3D;
  if (ctx.models.streetLight) {
    mesh = ctx.models.streetLight.clone(true);
    mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = false;
      }
    });
    // 将模型内容在 x 方向居中到原点， mesh.position.x 能精制左右位
    // （GLB 模型原点不在，否则左右交替会失效
    const box = new THREE.Box3().setFromObject(mesh);
    const cx = (box.min.x + box.max.x) / 2;
    mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.position.x -= cx;
    });
  } else {
    // 回：电线杆 +
    mesh = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.16, 6, 8),
      new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.9 })
    );
    pole.position.y = 3;
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.12, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    arm.position.y = 5.6;
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0xfff2b0,
        emissive: 0xffe066,
        emissiveIntensity: 0.8,
      })
    );
    lamp.position.set(0.7, 5.4, 0);
    const wire = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x111111 })
    );
    wire.position.set(0.35, 5.5, 0);
    mesh.add(pole, arm, lamp, wire);
  }
  mesh.rotation.y += side < 0 ? 0 : Math.PI;
  mesh.position.set(x, 0, z);
  mesh.visible = false;
  return mesh;
}

// 规律带动态回收：随世界滚越过相机后方的移除，在最远持续补充
// 始终保持固定间隔、左右交替的节
export function recycleStreetLights(ctx: SceneContext, move: number) {
  const st = ctx.street;
  for (const m of st.streetLights) {
    m.position.z += move;
    if (m.position.z > 18) ctx.scene.remove(m);
  }
  st.streetLights = st.streetLights.filter((m) => m.position.z <= 18);
  // 在最远补充，直到达到目标纵
  let minZ = Infinity;
  for (const m of st.streetLights) if (m.position.z < minZ) minZ = m.position.z;
  if (!isFinite(minZ)) minZ = 20;
  const gap = 22;
  while (minZ > -130) {
    const nz = minZ - gap;
    // 左右由全计数器自动决定，与初始严格连续交替
    const side = st.streetLightCount % 2 === 0 ? -1 : 1;
    if (isInCrossroad(ctx, nz, 4) || isNearParkedCar(ctx, side, nz)) {
      st.streetLightCount++; // 该档在路口内/有停靠车辆：不立，只消相
    } else {
      const mesh = makeStreetLight(ctx, nz);
      mesh.visible = ctx.isStreetActive();
      ctx.chunkRoot.add(mesh);
      st.streetLights.push(mesh);
    }
    minZ = nz;
  }
}

/**
 * 人道停靠车辆开关 *
 * 车辆现在只作为赛道障碍物出现在马路上（见 ThreeRunner.makeObstacle 的 car 分支），
 * 人道停车功能暂时停用恢复：把它改回 true 即可，下面的分支代码原样保留 */
const PARKED_CARS_ENABLED = false;

// 随机生成头饰（人）。注意：不再由本函数生成
// 改由的律路（buildStreetLights）负责，保证固定间隔左右交替
// 行人会 push 到 st.pedestrians / st.pedMixers（由调用方负责清空）。
export function makeRandomDecor(
  ctx: SceneContext,
  side: number,
  z: number
): THREE.Object3D {
  const st = ctx.street;
  const x = side * 8.5; // 墙内侧7.0~10.5)，避免墙遮
  const r = Math.random();
  const ink = ctx.theme.ink;
  const tagColors = [
    ctx.theme.magenta,
    ctx.theme.cyan,
    ctx.theme.yellow,
    ctx.theme.red,
  ];
  let mesh: THREE.Object3D;
  let placed = false; // 行人分支完成定位（避免通用定位逻辑覆盖/旋转
  if (r < 0.16) {
    // 棕树：优先使用真实模型（PalmyraPalmTree.obj/.mtl），加载失败回到程序化
    if (ctx.models.palm) {
      mesh = ctx.models.palm.clone(true);
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = false;
        }
      });
    } else {
      // 回：细长树+ 几片下垂
      mesh = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.22, 5.2, 8),
        new THREE.MeshStandardMaterial({ color: 0x9c7b4a, roughness: 1 })
      );
      trunk.position.y = 2.6;
      const frondMat = new THREE.MeshStandardMaterial({
        color: 0x3f8f3a,
        roughness: 0.9,
      });
      for (let f = 0; f < 6; f++) {
        const frond = new THREE.Mesh(
          new THREE.ConeGeometry(0.35, 2.4, 6),
          frondMat
        );
        const a = (f / 6) * Math.PI * 2;
        const dir = new THREE.Vector3(
          Math.cos(a),
          -0.4,
          Math.sin(a)
        ).normalize();
        frond.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        frond.position.set(Math.cos(a) * 0.5, 5.0, Math.sin(a) * 0.5);
        mesh.add(frond);
      }
      mesh.add(trunk);
    }
  } else if (PARKED_CARS_ENABLED && r < 0.34) {
    // 停靠车辆：约半率用 Mercedes 190E（精细模型），否则随机低模车
    // 都无模型时回到程序化 lowrider。位下方通用定位放到人道停车位
    // （当PARKED_CARS_ENABLED = false，本分支不生效，见文件上方常量注释）
    const useMercedes = !!ctx.models.mercedes && Math.random() < 0.5;
    const src = useMercedes
      ? ctx.models.mercedes
      : ctx.models.cars.length > 0
      ? ctx.models.cars[Math.floor(Math.random() * ctx.models.cars.length)]
      : null;
    if (
      isInAlleyMouth(ctx, side, z, 2.5) ||
      isInCourtAlley(ctx, side, z, 2.5) ||
      // 该已经立着：不停车，否则灯柱会插进车身（两者横向位叠）
      isNearStreetLight(ctx, side, z)
    ) {
      // 巷口/球场通道处不停车
      mesh = new THREE.Group();
      placed = true;
    } else if (src) {
      mesh = src.clone(true);
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = false;
        // Mercedes 自带 PBR 贴图，保持原材质（调亮会污染贴图色相 / 质感）。
        if (useMercedes) return;
        const mats = Array.isArray(m.material)
          ? (m.material as THREE.MeshStandardMaterial[])
          : [m.material as THREE.MeshStandardMaterial];
        for (const mat of mats) {
          if (!mat || !("color" in mat)) continue;
          const name = (mat.name || "").toLowerCase();
          if (/light|window|glass|lamp|tyre|tire/.test(name)) continue;
          const c = mat.color;
          const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
          if (lum > 0.12) {
            c.offsetHSL(0, 0.05, 0.18);
            mat.roughness = Math.min(0.35, (mat.roughness ?? 0.8) * 0.6);
            mat.metalness = Math.max(0.4, (mat.metalness ?? 0) * 0.5 + 0.3);
            mat.emissive = c.clone().multiplyScalar(0.12);
            mat.needsUpdate = true;
          }
        }
      });
    } else {
      // 回：Lowrider 老式长车
      mesh = new THREE.Group();
      const col = tagColors[Math.floor(Math.random() * tagColors.length)];
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.55, 4.4),
        new THREE.MeshStandardMaterial({
          color: col,
          roughness: 0.3,
          metalness: 0.55,
          emissive: new THREE.Color(col).multiplyScalar(0.14),
        })
      );
      body.position.y = 0.5;
      addOutline(body, ink);
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.5, 2.0),
        new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3 })
      );
      cabin.position.set(0, 1.0, -0.3);
      addOutline(cabin, ink);
      const bumper = new THREE.Mesh(
        new THREE.BoxGeometry(1.75, 0.18, 0.3),
        new THREE.MeshStandardMaterial({
          color: 0xcfcfcf,
          roughness: 0.25,
          metalness: 0.9,
        })
      );
      bumper.position.set(0, 0.4, 2.25);
      mesh.add(body, cabin, bumper);
      for (const wx of [-0.85, 0.85])
        for (const wz of [-1.5, 1.5]) {
          const wheel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.42, 0.42, 0.35, 14),
            new THREE.MeshStandardMaterial({
              color: 0x111111,
              roughness: 0.6,
            })
          );
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(wx, 0.42, wz);
          mesh.add(wheel);
        }
    }
  } else if (r < 0.34) {
    // 停靠车辆停用期间的占位：这一段率留空（人道处不放东西）
    // 这样不会把这段占比挤给别的饰（否则 BMX/消防栓会突然变）
    mesh = new THREE.Group();
    mesh.position.set(side * 8.5, 0, z);
    placed = true;
  } else if (r < 0.46) {
    // BMX 小轮车：优先使用真实模型（bmx.obj/.mtl），加载失败回到程序化
    // 限制：不得出现在楼房/球场临位置（沿 z 与任意建筑区间重叠则跳过，避免穿模）
    // 也不得出现在场两侧的巷道口（会堵住进出球场的通道
    if (
      isOccupiedByBuilding(ctx, side, z, 1.2) ||
      isInCourtAlley(ctx, side, z, 1.2)
    ) {
      mesh = new THREE.Group(); // 空占位，不渲
      placed = true;
    } else if (ctx.models.bmx) {
      mesh = ctx.models.bmx.clone(true);
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = false;
        }
      });
    } else {
      mesh = new THREE.Group();
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.5, 1.1),
        new THREE.MeshStandardMaterial({
          color: ctx.theme.yellow,
          roughness: 0.5,
        })
      );
      frame.position.y = 0.6;
      frame.rotation.x = 0.2;
      mesh.add(frame);
      for (const wz of [-0.6, 0.6]) {
        const wheel = new THREE.Mesh(
          new THREE.TorusGeometry(0.4, 0.1, 8, 16),
          new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 })
        );
        wheel.position.set(0, 0.4, wz);
        mesh.add(wheel);
      }
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.12, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
      );
      seat.position.set(0, 0.92, -0.45);
      mesh.add(seat);
    }
    mesh.userData.decorKind = "bmx"; // 供球场巷道口清理」按类型识别
  } else if (r < 0.55) {
    // 消防栓：随机加在人道（通用 x=±8.5），朝向随机不影响（近轴对称
    if (ctx.models.hydrant) {
      mesh = ctx.models.hydrant.clone(true);
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = false;
        }
      });
    } else {
      mesh = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.26, 0.9, 10),
        new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 })
      );
      body.position.y = 0.45;
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 })
      );
      cap.position.y = 0.9;
      mesh.add(body, cap);
    }
  } else if (r < 0.66) {
    // 长：方向与平（长边沿 z 行进方向），放在人道中后侧
    // 限制：长椅不得出现在楼房/球场临位置（沿 z 与任意建筑区间重叠则跳过，避免穿模）
    // 也不得出现在场两侧的巷道口（会堵住进出球场的通道
    if (
      isOccupiedByBuilding(ctx, side, z, 1.5) ||
      isInCourtAlley(ctx, side, z, 1.5)
    ) {
      mesh = new THREE.Group(); // 空占位，不渲染长
      placed = true;
    } else if (ctx.models.bench) {
      mesh = ctx.models.bench.clone(true);
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = false;
        }
      });
    } else {
      mesh = new THREE.Group();
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.12, 2.0),
        new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 })
      );
      seat.position.y = 0.5;
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.5, 2.0),
        new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 })
      );
      back.position.set(-0.3, 0.75, 0);
      mesh.add(seat, back);
    }
    // 长长边z（马向），坐面统朝向赛道
    // 模型默认正面朝左(-x)，故左侧(side=-1) 需转 180° 使坐面朝 +x（中心）；
    // 右侧(side=+1) 默认正面朝 -x 即已朝向中心，无需旋转。
    // 位置紧贴墙壁（墙在 ±10.5），略微内移避免与墙共面 z-fighting。
    mesh.rotation.y = side < 0 ? Math.PI : 0;
    mesh.position.set(side * 9.9, 0, z);
    mesh.userData.decorKind = "bench"; // 供球场巷道口清理」按类型识别
    placed = true; // 定位，跳过用定位逻辑
  } else if (r < 0.74) {
    // STOP 标识牌：靠近（x=±7.2）。模型牌面默认 +x，转 -90° 后朝 +z 面向镜头
    //（下方 rotation.y = -π/2；不要再写成「rotation.y=0 朝 ±z」）。
    if (ctx.models.stop) {
      mesh = ctx.models.stop.clone(true);
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = false;
        }
      });
    } else {
      mesh = new THREE.Group();
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 2.0, 8),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 })
      );
      post.position.y = 1.0;
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.7, 0.06),
        new THREE.MeshStandardMaterial({
          color: 0xcc2222,
          roughness: 0.6,
          emissive: new THREE.Color(0x330000),
        })
      );
      sign.position.y = 1.8;
      mesh.add(post, sign);
    }
    mesh.rotation.y = -Math.PI / 2; // 模型默牌面+x，转 -90° 使牌面朝镜头（赛道方向）
    mesh.position.set(side * 7.2, 0, z);
    placed = true; // 定位，跳过用定位逻辑
  } else if (r >= 0.74 && r < 0.8) {
    // 垃圾箱：背靠墙壁摆放；旁边固定放两个垃圾袋。
    // 避开球场两侧巷道口（那里墙被挖开，会悬空/穿模）与建筑物临街位置。
    if (
      ctx.models.dumpster &&
      !isInCourtAlley(ctx, side, z, 1.6) &&
      !isOccupiedByBuilding(ctx, side, z, 1.4)
    ) {
      mesh = new THREE.Group();
      const dump = ctx.models.dumpster.clone(true);
      dump.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh) {
          mm.castShadow = true;
          mm.receiveShadow = false;
        }
      });
      // 垃圾箱转身背靠墙（模型正面默认 +z：右侧墙转向 -x，左侧转向 +x）
      dump.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      mesh.add(dump);
      // 两个垃圾袋紧挨垃圾箱两侧（沿墙方向 = 局部 z）
      if (ctx.models.trashBag) {
        for (const dz of [-1.15, 1.15]) {
          const bag = ctx.models.trashBag.clone(true);
          bag.position.set((Math.random() - 0.5) * 0.4, 0, dz);
          bag.rotation.y = Math.random() * Math.PI * 2;
          bag.traverse((o) => {
            const mm = o as THREE.Mesh;
            if (mm.isMesh) {
              mm.castShadow = true;
              mm.receiveShadow = false;
            }
          });
          mesh.add(bag);
        }
      }
      mesh.position.set(side * (STREET.wallX - 0.85), 0, z);
      placed = true;
    } else {
      mesh = new THREE.Group();
      placed = true;
    }
  } else if (r < 0.86) {
    // 绿色垃圾桶（带盖
    mesh = new THREE.Group();
    const can = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.36, 1.0, 12),
      new THREE.MeshStandardMaterial({ color: 0x2f7d4f, roughness: 0.7 })
    );
    can.position.y = 0.5;
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.44, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x256144, roughness: 0.7 })
    );
    lid.position.y = 1.05;
    mesh.add(can, lid);
  } else if (r < 0.94) {
    // 井盖：只出现在人行道（与赛道地面颜色接近，放赛道上几乎看不清）
    if (ctx.models.manhole) {
      mesh = ctx.models.manhole.clone(true);
      mesh.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh) {
          mm.castShadow = false;
          mm.receiveShadow = true;
        }
      });
      const px = side * (8.2 + Math.random() * 1.8);
      mesh.position.set(px, 0.046, z);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      placed = true;
    } else {
      mesh = new THREE.Group();
      placed = true;
    }
  } else {
    // 其余槽位不生成饰（降低垃圾桶等密度
    mesh = new THREE.Group();
  }
  // 行人分支：以随机概率在某装饰槽位生成边走的人。
  // 普通赛道两侧保持原有概率（18%）；只在十字路口那边降低了行人/车辆密度。
  if (Math.random() < 0.18) {
    let ped: THREE.Group;
    if (ctx.models.peds.length > 0) {
      const src =
        ctx.models.peds[Math.floor(Math.random() * ctx.models.peds.length)];
      try {
        ped = skeletonClone(src) as THREE.Group;
      } catch (e) {
        console.warn("[buildCityDecor] 行人克隆失败，回退普通克隆:", e);
        ped = src.clone(true) as THREE.Group;
      }
      const anims: any[] = (src.userData && src.userData.animations) || [];
      if (anims.length > 0) {
        const walk = anims.find((a) => /walk/i.test(a.name));
        const clip = walk || anims.find((a) => /run/i.test(a.name)) || anims[0];
        const mixer = new THREE.AnimationMixer(ped);
        const action = mixer.clipAction(clip);
        action.reset().play();
        mixer.timeScale = 1.8; // 行人走动速度（1.5 → 1.8 稍快一点点）
        ped.userData.mixer = mixer;
        st.pedMixers.push(mixer);
      }
    } else {
      // 回：程序化街头青年
      ped = new THREE.Group();
      const col = tagColors[Math.floor(Math.random() * tagColors.length)];
      const legGeo = new THREE.BoxGeometry(0.18, 0.7, 0.18);
      const legL = new THREE.Mesh(
        legGeo,
        new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.9 })
      );
      legL.position.set(-0.16, 0.35, 0);
      legL.name = "legL";
      const legR = new THREE.Mesh(
        legGeo,
        new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.9 })
      );
      legR.position.set(0.16, 0.35, 0);
      legR.name = "legR";
      const bodyP = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.32, 0.7, 4, 8),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 })
      );
      bodyP.position.y = 1.05;
      addOutline(bodyP, ink);
      const hood = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 10, 10),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 })
      );
      hood.position.y = 1.55;
      const armGeo = new THREE.BoxGeometry(0.14, 0.6, 0.14);
      const armL = new THREE.Mesh(
        armGeo,
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 })
      );
      armL.position.set(-0.44, 1.1, 0);
      armL.name = "armL";
      const armR = new THREE.Mesh(
        armGeo,
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 })
      );
      armR.position.set(0.44, 1.1, 0);
      armR.name = "armR";
      const headP = new THREE.Mesh(
        new THREE.SphereGeometry(0.27, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x7a4a2e, roughness: 0.8 })
      );
      headP.position.y = 1.8;
      ped.add(legL, legR, bodyP, hood, armL, armR, headP);
    }
    ped.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    ped.scale.setScalar(1.12); // 行人稍微调大点点（与玩/车辆比例更协调）
    const px = side * 8.8;
    ped.position.set(px, 0, z);
    // 沿人行道走：模型默认正面 +z，故 rotation 0 面朝 +z（朝镜头走）、π 面朝 -z。
    // 步写userData，由 animateStreetPeds 每帧叠加到世界滚动上
    // 于是"朝镜头走"的人相对世界走得慢点背向的走得快点
    const walkDir = Math.random() < 0.5 ? 1 : -1;
    ped.rotation.y = walkDir > 0 ? 0 : Math.PI;
    ped.userData.walkDir = walkDir;
    ped.userData.walkSpeed = 1.15 + Math.random() * 0.35;
    st.pedestrians.push(ped);
    mesh = ped;
    placed = true;
  } else {
    mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  }
  // 通用定位（人已在分定位，跳过）
  if (!placed && r < 0.34) {
    mesh.rotation.y += Math.random() < 0.5 ? 0 : Math.PI;
    mesh.position.set(side * 8.2, 0, z);
    mesh.userData.decorKind = "car"; // 供路让停车位」识
  } else if (!placed && r < 0.46) {
    mesh.rotation.y += Math.random() < 0.5 ? 0 : Math.PI;
    mesh.position.set(side * 9.8, 0, z);
  } else if (!placed) {
    mesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    mesh.position.set(x, 0, z);
  }
  mesh.visible = false;
  return mesh;
}

// 动回+ 补充：把越过相机后方的饰移除，并在远持续补新随机装饰
// 保证装饰带不前涌现，绝不重固定组合
export function recycleCityDecor(ctx: SceneContext, move: number) {
  const st = ctx.street;
  // 滚动
  let maxZ = -Infinity;
  for (const m of st.cityDecor) {
    m.position.z += move;
    if (m.position.z > maxZ) maxZ = m.position.z;
    if (m.position.z > 18) {
      ctx.scene.remove(m);
    }
  }
  // 移除越界的（filter 重建数组
  st.cityDecor = st.cityDecor.filter((m) => m.position.z <= 18);
  // 在远充新装饰，直到最远的装饰达到纵深130 左右
  let minZ = Infinity;
  for (const m of st.cityDecor) if (m.position.z < minZ) minZ = m.position.z;
  if (!isFinite(minZ)) minZ = 20;
  while (minZ > -130) {
    const step = 7 + Math.random() * 3.5;
    const nz = minZ - step;
    const side = Math.random() < 0.5 ? -1 : 1;
    // 巷口范围内不放任何人行道装饰（会堵住"通往另一条"的开口）跳过该位
    if (
      isInAlleyMouth(ctx, side, nz, 0.5) ||
      isInCourtAlley(ctx, side, nz, 1.2) ||
      isInCrossroad(ctx, nz, 5)
    ) {
      minZ = nz;
      continue;
    }
    const mesh = makeRandomDecor(ctx, side, nz);
    mesh.visible = ctx.isStreetActive();
    ctx.chunkRoot.add(mesh);
    st.cityDecor.push(mesh);
    minZ = nz;
  }
  // 规律带同步回+ 补充
  recycleStreetLights(ctx, move);
}

// 墙后实体楼房（替代原天际线占位）：两侧后各排一列楼房，沿滚动
// 楼房building1~4.glb 随机复用，随机高度缩放与左右侧，作为街头远景天际线
// 检测建筑模型「门」的局部方向（单位向量，x/z 为分量）：
// 优先用材质名含 door 的网格顶点平均位置定位门；其次 window；
// 都没有则化为面积取面大的立面在。放让方向朝向
export function detectBuildingFrontDir(
  ctx: SceneContext,
  root: THREE.Object3D
): THREE.Vector2 {
  const st = ctx.street;
  const accumulate = (re: RegExp): THREE.Vector2 | null => {
    let sx = 0;
    let sz = 0;
    let c = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (!mats.some((mat) => mat && re.test((mat as any).name || ""))) return;
      const p = m.geometry.attributes.position as
        | THREE.BufferAttribute
        | undefined;
      if (!p) return;
      for (let i = 0; i < p.count; i++) {
        sx += p.getX(i);
        sz += p.getZ(i);
        c++;
      }
    });
    return c > 0 ? new THREE.Vector2(sx / c, sz / c) : null;
  };
  const door = accumulate(/door/i);
  const front = door || accumulate(/window/i);
  if (front && (front.x !== 0 || front.y !== 0)) {
    // 量化到最近的水平主轴(X 或 Z)，保证建筑严格平行于街道（旋转立面平行街道），
    // 避免因门/窗几何略对称导致方向偏斜、建筑不平
    if (Math.abs(front.x) >= Math.abs(front.y)) {
      return new THREE.Vector2(Math.sign(front.x) || 1, 0);
    }
    return new THREE.Vector2(0, Math.sign(front.y) || 1);
  }
  // 兜底：面主水平轴，取方向
  let areaX = 0;
  let areaZ = 0;
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const idx = g.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3;
      const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      vA.fromBufferAttribute(pos, ia);
      vB.fromBufferAttribute(pos, ib);
      vC.fromBufferAttribute(pos, ic);
      e1.subVectors(vB, vA);
      e2.subVectors(vC, vA);
      n.crossVectors(e1, e2);
      const area = 0.5 * n.length();
      if (Math.abs(n.x) > Math.abs(n.z)) areaX += area;
      else areaZ += area;
    }
  });
  return areaX >= areaZ ? new THREE.Vector2(1, 0) : new THREE.Vector2(0, 1);
}

// 球场「标线」层(Markings) 的 UV 退化缺陷：
// 该层盖整场的单个 quad，全部顶UV=(0,0)（FBX→glTF 导出时丢失）
// 导致样线稿贴图左上的纯白不透明像素 线区整面显示为白块
// 贴图即整场俯视线稿，按局部包围盒把顶点 XY 归一化到 [0,1] 重建 UV。
export function fixCourtMarkingUV(ctx: SceneContext, root: THREE.Object3D) {
  const st = ctx.street;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const isMarking = mats.some(
      (mm) => mm && /markngs|marking/i.test(mm.name ?? "")
    );
    if (!isMarking) return;
    const geo = m.geometry;
    const uvAttr = geo.getAttribute("uv");
    const posAttr = geo.getAttribute("position");
    if (!uvAttr || !posAttr) return;
    // 化：UV 严格为同常量
    const u0 = uvAttr.getX(0);
    const v0 = uvAttr.getY(0);
    let degenerate = true;
    for (let i = 1; i < uvAttr.count; i++) {
      if (uvAttr.getX(i) !== u0 || uvAttr.getY(i) !== v0) {
        degenerate = false;
        break;
      }
    }
    if (!degenerate) return;
    // 平面在局部 XY 面内（POSITION z ≈ 0），按 XY 归一化重建 UV：
    // 贴图为竖画的半场线：u 沿球场长轴(y)，v 沿宽度(x)，
    // 且底线在 u=0、中线在 u=1（三分弧在 u≈0.47、u≈0.2~0.36）。
    // 取 u = 2t + MirroredRepeat 拼出完整球场。
    // 远半正放)：底0) 三分(1)；近半场(镜像)：中三分底线
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const w = Math.max(bb.max.x - bb.min.x, 1e-6);
    const h = Math.max(bb.max.y - bb.min.y, 1e-6);
    const newUV = new Float32Array(posAttr.count * 2);
    for (let i = 0; i < posAttr.count; i++) {
      newUV[i * 2] = ((posAttr.getY(i) - bb.min.y) / h) * 2; // u = 2t（镜像平铺，底线在 u=0）
      newUV[i * 2 + 1] = (posAttr.getX(i) - bb.min.x) / w; // v 沿 x
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(newUV, 2));
    uvAttr.needsUpdate = true;
    // 半场线要镜像平铺才能拼出完整球场（REPEAT 平移重，方向会对不齐）
    // 注意：wrapS 属于 GPU sampler 状态，three.js 仅在纹理（重）上传时应用 ——
    // 必须 needsUpdate=true 触发重传，否则仍是 glTF sampler 的 REPEAT。
    // 表现为三分线出现在中缝远半场整体颠（镜像平铺完全效）
    for (const mm of mats) {
      if (mm instanceof THREE.MeshStandardMaterial && mm.map) {
        mm.map.wrapS = THREE.MirroredRepeatWrapping;
        mm.map.wrapT = THREE.MirroredRepeatWrapping;
        mm.map.needsUpdate = true; // 关键：触sampler 重传，否则修改静默忽略
      }
    }
  });
}

// ==================== 墙远景层（视差纵深====================

/**
 * 远景楼墙贴图（模块级缓存）：用灰泥质感贴图，**不含窗户**。
 * 关键改动：窗户从「贴图里的深色方块」改为独立的玻璃几何（ buildBackdropWindowQuads） * 之前窗户画在墙贴图上，整张贴图会例的 instanceColor 相乘染色 * 于是窗洞墙色 × 深灰"压成块，远看就是黑方格拆之后 * 玻璃用自己的浅蓝灰贴图与的实例色，永远比墙亮，才像玻璃 */
let backdropWallTex: THREE.Texture | null = null;
function getBackdropWallTexture(): THREE.Texture {
  if (!backdropWallTex) backdropWallTex = makeFacadeTexture("wall");
  return backdropWallTex;
}

/** 远景楼外墙变体：灰泥涂料 / 红砖。砖墙用带颜色的贴图，配色只做明暗抖动 */
type WallVariant = "plaster" | "brick";
let backdropBrickTex: THREE.Texture | null = null;
function getBackdropBrickTexture(): THREE.Texture {
  if (!backdropBrickTex) backdropBrickTex = makeBrickTexture();
  return backdropBrickTex;
}

/**
 * 远景楼玻璃贴图（贴在窗四边形上，UV 0..1 不再平铺）：
 * 上亮下暗天空反射的浅蓝灰玻璃，四周压圈深色窗框，底部条亮窗台 * 远景里这圈深框作凹进去的窗洞，比纯黑方块柔和得多 */
let backdropGlassTex: THREE.CanvasTexture | null = null;
function getBackdropGlassTexture(): THREE.CanvasTexture {
  if (backdropGlassTex) return backdropGlassTex;
  const S = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c = cv.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, "#dbe7f2");
  g.addColorStop(0.55, "#b3c6d6");
  g.addColorStop(1, "#8fa6ba");
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  // 窗：深蓝灰，向内收圈*必须*：侧立面在道尽头会压成细条
  // 粗窗框会把玻璃挤没，半个"，看上去就像的窗
  c.strokeStyle = "rgba(56,66,78,0.85)";
  c.lineWidth = 3;
  c.strokeRect(1.5, 1.5, S - 3, S - 3);
  // 梃：扇窗分成两格，远有结构感
  c.fillStyle = "rgba(62,72,84,0.55)";
  c.fillRect(S / 2 - 1, 3, 2, S - 6);
  // 窗台高光：下沿一道亮线，强化"的识
  c.fillStyle = "rgba(255,255,255,0.7)";
  c.fillRect(1.5, S - 6, S - 3, 3);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  backdropGlassTex = t;
  return t;
}

/** 远景楼型：5 档固定尺寸（宽 × 高 × 深 + 是否有女儿墙），几何在模块级缓存复用 */
type BackdropKind = { w: number; h: number; d: number; parapet: boolean };
const BACKDROP_KINDS: BackdropKind[] = [
  { w: 7, h: 8, d: 9, parapet: true }, // ?
  { w: 9, h: 12, d: 10, parapet: false }, // ?
  { w: 10, h: 16, d: 11, parapet: true }, // ?
  { w: 11, h: 21, d: 12, parapet: false }, // ?
  { w: 9, h: 27, d: 11, parapet: true }, // 超高
];
/** 墙贴图一格对应的世界尺寸（灰泥 / 红砖纹理重复密度） */
const BACKDROP_TILE = 6;
/** 立面开窗模数：层高 / 前后间距 / 侧向间距 / 窗洞尺寸 */
const BD_FLOOR_H = 3;
const BD_BAY_Z = 2.6;
const BD_BAY_X = 3.4;
const BD_WIN_W = 1.45;
const BD_WIN_H = 1.7;
/** 女儿墙：高度 / 单边厚度 */
const BD_PARAPET_H = 0.8;
const BD_PARAPET_T = 0.4;

let backdropWallMat: THREE.MeshStandardMaterial | null = null;
let backdropBrickMat: THREE.MeshStandardMaterial | null = null;
let backdropGlassMat: THREE.MeshStandardMaterial | null = null;
let backdropRoofMat: THREE.MeshStandardMaterial | null = null;
/** 楼体 / 窗户几何缓存（两种材质 → 两个 InstancedMesh；屋顶配件另算） */
const backdropBodyGeos: (THREE.BufferGeometry | undefined)[] = [];
const backdropGlassGeos: (THREE.BufferGeometry | undefined)[] = [];

/** 把 BoxGeometry 每个面的 UV 按世界尺寸缩放，使贴图密度与楼体尺寸无关（否则纹理会被拉长） */
function scaleBoxUV(g: THREE.BufferGeometry, w: number, h: number, d: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const perFace: Array<[number, number]> = [
    [d, h],
    [d, h], // ±x
    [w, d],
    [w, d], // ±y
    [w, h],
    [w, h], // ±z
  ];
  for (let f = 0; f < 6; f++) {
    const su = perFace[f][0] / BACKDROP_TILE;
    const sv = perFace[f][1] / BACKDROP_TILE;
    for (let i = f * 4; i < f * 4 + 4; i++)
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}

/** 给几何写入统一顶点色（屋顶配件的固定配色，不受墙体材质影响） */
function paintGeo(g: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color(hex);
  const n = (g.getAttribute("position") as THREE.BufferAttribute).count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

/**
 * 远景楼窗户四边形：按「层3 单位 + 间的模数，在四个立面上排窗 *
 * 注意侧立±x）在街道尽头的楼上是接近侧的，窗户会透压成细条 * 因玻璃贴图的窗框刻意做得很细（getBackdropGlassTexture），
 * 压扁后到的扇窄而不的窗 */
function buildBackdropWindowQuads(K: BackdropKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (
    cx: number,
    cy: number,
    cz: number,
    qw: number,
    qh: number,
    rotY: number
  ) => {
    const q = new THREE.PlaneGeometry(qw, qh);
    if (rotY) q.rotateY(rotY);
    q.translate(cx, cy, cz);
    parts.push(q);
  };
  const OUT = 0.06; // 贴在墙点点，避免与楼体共面 z-fighting
  // 前后立面（法±z）：x 排开
  const baysZ = Math.max(1, Math.round(K.w / BD_BAY_Z));
  const stepZ = K.w / baysZ;
  for (const sign of [1, -1]) {
    const z = sign * (K.d / 2 + OUT);
    const rotY = sign > 0 ? 0 : Math.PI;
    for (let i = 0; i < baysZ; i++) {
      const x = -K.w / 2 + stepZ * (i + 0.5);
      for (let f = 0; ; f++) {
        const cy = BD_FLOOR_H * (f + 0.62);
        if (cy + BD_WIN_H / 2 > K.h - 0.7) break;
        if (Math.random() < 0.06) continue; // 少量间是实，避免整模一
        add(x, cy, z, BD_WIN_W, BD_WIN_H, rotY);
      }
    }
  }
  // 侧立法线 ±x）：z 排开间（间略宽，侧压扁后仍有明显窗
  const baysX = Math.max(1, Math.round(K.d / BD_BAY_X));
  const stepX = K.d / baysX;
  for (const sign of [1, -1]) {
    const x = sign * (K.w / 2 + OUT);
    const rotY = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    for (let i = 0; i < baysX; i++) {
      const z = -K.d / 2 + stepX * (i + 0.5);
      for (let f = 0; ; f++) {
        const cy = BD_FLOOR_H * (f + 0.62);
        if (cy + BD_WIN_H / 2 > K.h - 0.7) break;
        if (Math.random() < 0.06) continue;
        add(x, cy, z, BD_WIN_W, BD_WIN_H, rotY);
      }
    }
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

/** 取（并缓存）某个楼型的几何：楼体 + 女儿墙（墙材质）、窗户（玻璃材质） */
function getBackdropGeometry(k: number): {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
} {
  const K = BACKDROP_KINDS[k];
  let body = backdropBodyGeos[k];
  if (!body) {
    const parts: THREE.BufferGeometry[] = [];
    const box = new THREE.BoxGeometry(K.w, K.h, K.d);
    box.translate(0, K.h / 2, 0); // 几何底部贴地，实例只y=0 摆放
    scaleBoxUV(box, K.w, K.h, K.d);
    parts.push(box);
    if (K.parapet) {
      // 女儿墙属于体本该和墙同砖同色），仍走材质
      const t = BD_PARAPET_T;
      const ph = BD_PARAPET_H;
      const f1 = new THREE.BoxGeometry(K.w, ph, t);
      f1.translate(0, K.h + ph / 2, K.d / 2 - t / 2);
      parts.push(f1);
      const f2 = new THREE.BoxGeometry(K.w, ph, t);
      f2.translate(0, K.h + ph / 2, -K.d / 2 + t / 2);
      parts.push(f2);
      const f3 = new THREE.BoxGeometry(t, ph, K.d);
      f3.translate(K.w / 2 - t / 2, K.h + ph / 2, 0);
      parts.push(f3);
      const f4 = new THREE.BoxGeometry(t, ph, K.d);
      f4.translate(-K.w / 2 + t / 2, K.h + ph / 2, 0);
      parts.push(f4);
    }
    body = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    backdropBodyGeos[k] = body;
  }
  let glass = backdropGlassGeos[k];
  if (!glass) {
    glass = buildBackdropWindowQuads(K);
    backdropGlassGeos[k] = glass;
  }
  return { body, glass };
}

// ==================== 屋顶装饰物（随机配件库） ====================
//
// 以前屋顶「水箱一种，而且形状/颜色/位置全部写：同型的每个实例
// 水都在同一同小同色，眼就能看出是复制粘贴
// 现在改成「配件库 + 随机摆放」。
// · 7 种配件（水/机房/空调机组/排气天线/能板/烟囱）；
// · 每个楼顶 1 件，45% 概率再加 1 件；
// · 位置在屋顶范围内随机、朝向随机整体比例随机实例色机；
// · 水还会木桶（暖棕）"锌钢罐（冷灰之间随机
// 配件各自一个 InstancedMesh（共用一套顶点色材质），画质不变、只多几次 draw call。
/** 屋顶装饰物类型 */
type RoofPropKind =
  | "tank" // 屋顶水箱
  | "hut" // 楼梯间 / 屋顶机房
  | "hvac" // 空调机组
  | "pipe" // 排气管
  | "antenna" // 电视天线
  | "solar" // 太阳能板
  | "chimney"; // 烟囱

/** 配件配色（顶点色）：配件是外挂件，不能跟随墙体贴图 */
const ROOF_COLOR = {
  steel: 0x6f6a63, // 钢支架 / 平台 / 栏杆
  tank: 0x8a6b52, // 木质水箱罐体（做旧）
  tankBand: 0x6b5340, // 加强箍
  tankCap: 0x7a5c46, // 锥形顶盖
  concrete: 0xb8b4ab, // 楼梯间 / 屋顶机房
  door: 0x54504a, // 出屋面门
  pipe: 0x8d8a84, // 排气管 / 天线杆
  ac: 0xa9aeb0, // 空调机组外壳
  acDark: 0x8b9092, // 空调风扇罩
  solar: 0x33465c, // 太阳能板
  chimney: 0x8d7a68, // 烟囱砖体
};

const roofPropGeos: Partial<Record<RoofPropKind, THREE.BufferGeometry>> = {};

/** 取（并缓存）某个屋顶配件的几何：原点居中、底面在 y=0，便于直接摆在屋顶面上 */
function getRoofPropGeometry(kind: RoofPropKind): THREE.BufferGeometry {
  const cached = roofPropGeos[kind];
  if (cached) return cached;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: number) => {
    paintGeo(g, color);
    parts.push(g);
  };
  if (kind === "tank") {
    // 水：四腿钢+ 平台 + 略收口罐+ 两道铁箍 + 锥顶
    const r = 1.05;
    const legH = 1.4;
    const tankH = 2.1;
    const legOff = r * 0.82;
    for (const [dx, dz] of [
      [legOff, legOff],
      [-legOff, legOff],
      [legOff, -legOff],
      [-legOff, -legOff],
    ]) {
      const leg = new THREE.BoxGeometry(0.15, legH, 0.15);
      leg.translate(dx, legH / 2, dz);
      add(leg, ROOF_COLOR.steel);
    }
    for (const dz of [legOff, -legOff]) {
      const tie = new THREE.BoxGeometry(legOff * 2, 0.09, 0.09);
      tie.translate(0, legH * 0.62, dz);
      add(tie, ROOF_COLOR.steel);
    }
    for (const dx of [legOff, -legOff]) {
      const tie = new THREE.BoxGeometry(0.09, 0.09, legOff * 2);
      tie.translate(dx, legH * 0.62, 0);
      add(tie, ROOF_COLOR.steel);
    }
    const deck = new THREE.BoxGeometry(r * 2.2, 0.12, r * 2.2);
    deck.translate(0, legH, 0);
    add(deck, ROOF_COLOR.steel);
    const tank = new THREE.CylinderGeometry(r, r * 0.9, tankH, 14);
    tank.translate(0, legH + tankH / 2, 0);
    add(tank, ROOF_COLOR.tank);
    for (const t of [0.3, 0.68]) {
      const ring = new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.11, 14);
      ring.translate(0, legH + tankH * t, 0);
      add(ring, ROOF_COLOR.tankBand);
    }
    const cap = new THREE.ConeGeometry(r * 1.08, r * 0.72, 14);
    cap.translate(0, legH + tankH + r * 0.36, 0);
    add(cap, ROOF_COLOR.tankCap);
  } else if (kind === "hut") {
    // 楼梯间 / 屋顶机房：混凝土方盒 + 女儿墙 + 出挑檐口
    const w = 3.0;
    const h = 2.2;
    const d = 2.6;
    const hut = new THREE.BoxGeometry(w, h, d);
    hut.translate(0, h / 2, 0);
    add(hut, ROOF_COLOR.concrete);
    const door = new THREE.BoxGeometry(w * 0.3, h * 0.66, 0.08);
    door.translate(0, h * 0.33, d / 2 + 0.04);
    add(door, ROOF_COLOR.door);
    const lip = new THREE.BoxGeometry(w * 1.08, 0.14, d * 1.08);
    lip.translate(0, h + 0.07, 0);
    add(lip, ROOF_COLOR.concrete);
  } else if (kind === "hvac") {
    // 空调机组：矮方 + 顶部风扇+ 侧边
    const w = 1.7;
    const h = 1.05;
    const d = 1.3;
    const body = new THREE.BoxGeometry(w, h, d);
    body.translate(0, h / 2, 0);
    add(body, ROOF_COLOR.ac);
    const fan = new THREE.CylinderGeometry(w * 0.3, w * 0.3, 0.12, 12);
    fan.translate(0, h + 0.06, 0);
    add(fan, ROOF_COLOR.acDark);
    const duct = new THREE.BoxGeometry(0.28, 0.28, d * 0.9);
    duct.translate(w / 2 + 0.1, h * 0.55, 0);
    add(duct, ROOF_COLOR.acDark);
  } else if (kind === "pipe") {
    // 排气管：粗一细两+ 顶部防雨
    const p1 = new THREE.CylinderGeometry(0.19, 0.19, 1.8, 8);
    p1.translate(0, 0.9, 0);
    add(p1, ROOF_COLOR.pipe);
    const cap1 = new THREE.CylinderGeometry(0.28, 0.28, 0.1, 8);
    cap1.translate(0, 1.85, 0);
    add(cap1, ROOF_COLOR.pipe);
    const p2 = new THREE.CylinderGeometry(0.11, 0.11, 1.2, 8);
    p2.translate(0.55, 0.6, 0.2);
    add(p2, ROOF_COLOR.pipe);
  } else if (kind === "antenna") {
    // 电天线：细+ 三根递减 + 底座
    const base = new THREE.BoxGeometry(0.5, 0.16, 0.5);
    base.translate(0, 0.08, 0);
    add(base, ROOF_COLOR.steel);
    const mast = new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6);
    mast.translate(0, 1.6, 0);
    add(mast, ROOF_COLOR.pipe);
    for (let i = 0; i < 3; i++) {
      const len = 1.5 - i * 0.35;
      const bar = new THREE.BoxGeometry(len, 0.07, 0.07);
      bar.translate(0, 2.35 + i * 0.35, 0);
      add(bar, ROOF_COLOR.pipe);
    }
  } else if (kind === "solar") {
    // 能板：一块斜面板 + 四根
    const panel = new THREE.BoxGeometry(2.6, 0.09, 1.5);
    panel.rotateX(-0.36);
    panel.translate(0, 0.85, 0);
    add(panel, ROOF_COLOR.solar);
    for (const [dx, dz] of [
      [0.9, 0.55],
      [-0.9, 0.55],
      [0.9, -0.55],
      [-0.9, -0.55],
    ]) {
      const leg = new THREE.BoxGeometry(0.1, 0.8, 0.1);
      leg.translate(dx, 0.4, dz);
      add(leg, ROOF_COLOR.steel);
    }
  } else {
    // 烟囱：砖+ 顶帽
    const body = new THREE.BoxGeometry(0.9, 1.9, 0.9);
    body.translate(0, 0.95, 0);
    add(body, ROOF_COLOR.chimney);
    const cap = new THREE.BoxGeometry(1.14, 0.14, 1.14);
    cap.translate(0, 1.97, 0);
    add(cap, ROOF_COLOR.chimney);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  roofPropGeos[kind] = merged;
  return merged;
}

/** 主件权重：水箱仍是最常见的老式楼顶配件 */
const ROOF_PROP_WEIGHTS: Array<[RoofPropKind, number]> = [
  ["tank", 0.22],
  ["hut", 0.18],
  ["hvac", 0.17],
  ["pipe", 0.14],
  ["antenna", 0.11],
  ["solar", 0.1],
  ["chimney", 0.08],
];
/** 附带的小件（整体更小、不压主件） */
const ROOF_SMALL_PROPS: RoofPropKind[] = ["pipe", "antenna", "hvac"];
/** 各配件的占地半径（用于把配件限制在屋顶范围内，不悬空） */
const ROOF_PROP_FOOT: Record<RoofPropKind, number> = {
  tank: 1.25,
  hut: 1.9,
  hvac: 1.15,
  pipe: 0.7,
  antenna: 0.75,
  solar: 1.5,
  chimney: 0.75,
};

function pickWeighted(list: Array<[RoofPropKind, number]>): RoofPropKind {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of list) {
    r -= w;
    if (r <= 0) return k;
  }
  return list[list.length - 1][0];
}

/** 配件的实例色：整体明暗随机；水箱再区分木桶（暖棕）与镀锌钢罐（冷灰） */
function propTint(kind: RoofPropKind): THREE.Color {
  const c = new THREE.Color(1, 1, 1);
  c.offsetHSL(
    (Math.random() - 0.5) * 0.03,
    (Math.random() - 0.5) * 0.08,
    (Math.random() - 0.5) * 0.2
  );
  if (kind === "tank" && Math.random() < 0.38) {
    // 钢罐：压暗红/绿道，整体偏冷灰
    c.r *= 0.82;
    c.g *= 0.9;
    c.b *= 1.05;
  }
  return c;
}

/**
 * 为一栋楼随机生成屋顶配件（世界坐标） * 位置在屋顶可用范围内随机，所以同型的每栋楼摆放都不一样 */
function makeRoofProps(
  K: BackdropKind,
  s: number,
  bx: number,
  bz: number
): Array<{ kind: RoofPropKind; m: THREE.Matrix4; c: THREE.Color }> {
  const out: Array<{ kind: RoofPropKind; m: THREE.Matrix4; c: THREE.Color }> =
    [];
  const inset = K.parapet ? BD_PARAPET_T + 0.35 : 0.35;
  const halfW = Math.max(0.4, K.w / 2 - inset);
  const halfD = Math.max(0.4, K.d / 2 - inset);
  const place = (kind: RoofPropKind, scaleMul = 1) => {
    // 占地按缩放后的实际尺寸算，保证配件整体压在屋顶范围内、不到楼
    const foot = ROOF_PROP_FOOT[kind] * scaleMul;
    const hx = Math.max(0, halfW - foot);
    const hz = Math.max(0, halfD - foot);
    const px = bx + (Math.random() * 2 - 1) * hx * s;
    const pz = bz + (Math.random() * 2 - 1) * hz * s;
    const rotY = Math.random() * Math.PI * 2;
    // 竖直比例随机：水塔有时矮胖有时瘦
    const sy = 0.82 + Math.random() * 0.42;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(px, K.h * s, pz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(s * scaleMul, s * scaleMul * sy, s * scaleMul)
    );
    out.push({ kind, m, c: propTint(kind) });
  };
  const main = pickWeighted(ROOF_PROP_WEIGHTS);
  place(main, 1); // 主件
  // 小件：缩75%。机房占地大，再塞小件易穿模，跳过
  if (main !== "hut" && Math.random() < 0.45) {
    place(
      ROOF_SMALL_PROPS[Math.floor(Math.random() * ROOF_SMALL_PROPS.length)],
      0.75
    );
  }
  return out;
}

/**
 * 远景层：两排程序化楼群，按 <1 的系数滚动形成纵深。
 * · 近排（x≈28，8~12 高）：填补主楼之间的缝隙，避免隔着缝直接看到天空；
 * 三个关键点：
 * 1) 楼体与窗户用两材质：楼体灰红砖+ 实例染色，窗户独立玻璃，
 * 因窗户永远的，不会像以前那样染色成黑块；
 * 2) 屋顶装饰物走"配件+ 随机摆放"（ makeRoofProps），
 * 不再模一样的水复制粘贴 * 3) 布点铺两回绕周期远整体平移的，期时，平移超 * (周期 深度) 后远会空出来，回绕瞬间又整片补回；加速道具下
 * 表现远房子突然冒出。铺两个周期后任何平移量下远有盖，
 * 且两周期内严格相同，回绕前后画面完全重合 */
/**
 * 生成远景楼。
 * @param mode "near" = 第二排矮楼，【每块一份】挂在本块 chunkRoot 下，
 *             按本块 crossZSlots 让开路口，随块平移/销毁；
 *             "far"  = 天际线高楼，【全局一份】挂 scene 下，220 周期回绕 + 视差 0.5。
 *             远排不能按块让位（所有块共享同一相位），所以放在横街之外。
 */
export function buildBackdrop(ctx: SceneContext, mode: "near" | "far" = "far") {
  const st = ctx.street;
  const isNear = mode === "near";
  // 幂等清理只对全局远排做；近排是每块自有的，不进 st.backdrop。
  if (!isNear) {
    for (const o of st.backdrop) ctx.scene.remove(o);
    st.backdrop.length = 0;
  }

  const cycle = STREET.wallLen;
  if (!backdropWallMat) {
    backdropWallMat = new THREE.MeshStandardMaterial({
      map: getBackdropWallTexture(),
      roughness: 0.93,
      metalness: 0,
    });
  }
  if (!backdropBrickMat) {
    backdropBrickMat = new THREE.MeshStandardMaterial({
      map: getBackdropBrickTexture(),
      roughness: 0.95,
      metalness: 0,
    });
  }
  if (!backdropGlassMat) {
    backdropGlassMat = new THREE.MeshStandardMaterial({
      map: getBackdropGlassTexture(),
      roughness: 0.32,
      metalness: 0.2,
      // 远景楼在 300+ 单位外，深度精度不足（near=0.1/far=900），
      // 靠几何偏移不够稳，再叠一polygonOffset 把窗面稳定顶到前 polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
  }
  if (!backdropRoofMat) {
    // 屋顶配件：色全部来何顶点色（水机房/空调/管道各不相同），
    // 不贴墙贴—否则红砖楼的水会变成砖砌的
    backdropRoofMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.06,
    });
  }
  const wallMat = backdropWallMat;
  const brickMat = backdropBrickMat;
  const glassMat = backdropGlassMat;
  const roofMat = backdropRoofMat;
  const fogColor = new THREE.Color(ctx.theme.sky);
  // 低饱和城市色板（奶白/沙色/陶土/灰蓝/鼠尾灰粉）：远景，但不能成一片灰
  const palette = [
    0xd8c7ab, 0xc9a184, 0xbcc7cd, 0xc7c0ae, 0xa9b3ab, 0xcdb9b2, 0xb0a596,
  ];
  const nearLayer = {
    // 随块走（不需要视差 / 回绕）；贴赛道 x≈28，靠本块 crossZSlots 让位。
    // xJit 放到 9：让矮楼沿 x 散开一些（近侧 28~37、外沿约 34~48），
    // 去接住远排的近沿 48~52，两排之间不再留出一大片空地。
    parallax: 1,
    kinds: [0, 1],
    nearX: BACKDROP_NEAR_X,
    xJit: 9,
    gapMin: 2.5,
    gapMax: 7,
    tint: 0.18,
    brickRatio: 0.3,
  };
  const farLayer = {
    // 全局视差 0.5 + 220 回绕；放横街之外，不受随机路口影响。
    // xJit 从 10 收到 4：原来远排会随机飘到 x≈60，与近排之间拉出 20m 空档；
    // 现在稳定贴在 48~52，和近排外沿首尾相接。
    parallax: 0.5,
    kinds: [2, 3, 4],
    nearX: BACKDROP_FAR_MIN_X,
    xJit: 4,
    gapMin: 2,
    gapMax: 8,
    tint: 0.5,
    brickRatio: 0.42,
  };
  const layers = isNear ? [nearLayer] : [farLayer];

  for (const L of layers) {
    // 按楼+ 外变体」分组：每组合InstancedMesh + InstancedMesh
    const groups = new Map<
      string,
      {
        k: number;
        variant: WallVariant;
        items: Array<{ m: THREE.Matrix4; c: THREE.Color; gc: THREE.Color }>;
      }
    >();
    const groupOf = (k: number, variant: WallVariant) => {
      const key = `${k}|${variant}`;
      let g = groups.get(key);
      if (!g) {
        g = { k, variant, items: [] };
        groups.set(key, g);
      }
      return g;
    };
    // 屋顶配件按类型汇总（每种一个 InstancedMesh）
    const propGroups = new Map<
      RoofPropKind,
      Array<{ m: THREE.Matrix4; c: THREE.Color }>
    >();

    for (const side of [-1, 1]) {
      // 先生成一期的布点，再整复制到下期，保证严格周期
      const base: Array<{
        x: number;
        z: number;
        k: number;
        s: number;
        variant: WallVariant;
        c: THREE.Color;
        gc: THREE.Color;
        props: Array<{ kind: RoofPropKind; m: THREE.Matrix4; c: THREE.Color }>;
      }> = [];
      let z = 40;
      while (z > 40 - cycle) {
        const k = L.kinds[Math.floor(Math.random() * L.kinds.length)];
        const K = BACKDROP_KINDS[k];
        const s = 0.88 + Math.random() * 0.24; // 轻微尺寸抖动，避免整齐划一
        // 近排【随块生成】，所以这里能读到本块自己的路口位置，精确让位：
        // 路口 ±9 之外再各留 BACKDROP_CROSS_CLEAR，保证从主路看进横街时
        // 开口里不会冒出第二排楼，也不会压在横街的楼 / 人行道装饰上。
        // 远排是全局循环，无法按块让位（相位对不上），它靠 x 放在横街外来避让。
        if (isNear) {
          const bdHalfD = (K.d * s) / 2;
          if (
            ctx.street.crossZSlots.some(
              (c) =>
                z + bdHalfD > c.z0 - BACKDROP_CROSS_CLEAR &&
                z - bdHalfD < c.z1 + BACKDROP_CROSS_CLEAR
            )
          ) {
            z -= K.d * s + L.gapMin;
            continue;
          }
        }
        const near = L.nearX + Math.random() * L.xJit; // 近侧边缘，保证不侵入主楼
        const variant: WallVariant =
          Math.random() < L.brickRatio ? "brick" : "plaster";
        const c = new THREE.Color();
        if (variant === "brick") {
          // 砖：贴图自带红砖色，实例色接近白只做轻暗抖避免把红砖染成土
          const t = 0.9 + Math.random() * 0.2;
          c.setRGB(t, t, t);
          c.lerp(fogColor, L.tint * 0.55);
        } else {
          c.set(palette[Math.floor(Math.random() * palette.length)]);
          c.lerp(fogColor, L.tint * (0.7 + Math.random() * 0.6));
        }
        // 玻璃：接近白、只做很轻的明暗偏移，避免楼体染脏"成深色方
        const gc = new THREE.Color(1, 1, 1);
        gc.offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
        gc.lerp(fogColor, L.tint * 0.42);
        const bx = side * (near + (K.w * s) / 2);
        base.push({
          x: bx,
          z,
          k,
          s,
          variant,
          c,
          gc,
          props: makeRoofProps(K, s, bx, z),
        });
        z -= K.d * s + L.gapMin + Math.random() * (L.gapMax - L.gapMin);
      }
      // 近排随块走，每块只铺自己这一个周期即可（块长=cycle，边界由下一块接上）；
      // 远排是全局回绕的，仍需铺两个周期保证回绕前后画面完全重合。
      const reps = isNear ? 1 : 2;
      for (let rep = 0; rep < reps; rep++) {
        const dz = rep * cycle;
        for (const it of base) {
          groupOf(it.k, it.variant).items.push({
            m: new THREE.Matrix4().compose(
              new THREE.Vector3(it.x, 0, it.z - dz),
              new THREE.Quaternion(),
              new THREE.Vector3(it.s, it.s, it.s)
            ),
            c: it.c,
            gc: it.gc,
          });
          for (const p of it.props) {
            // 平移：只z 平移量，其余保持
            const m = p.m.clone();
            m.elements[14] -= dz;
            let arr = propGroups.get(p.kind);
            if (!arr) {
              arr = [];
              propGroups.set(p.kind, arr);
            }
            // 配件也随远景淡入雾色（与楼体同一条雾化曲线）
            const pc = p.c.clone();
            pc.multiply(it.gc);
            arr.push({ m, c: pc });
          }
        }
      }
    }

    // 楼体 + 窗户
    groups.forEach(({ k, variant, items }) => {
      if (!items.length) return;
      const { body, glass } = getBackdropGeometry(k);
      const bodyMat = variant === "brick" ? brickMat : wallMat;
      const wall = new THREE.InstancedMesh(body, bodyMat, items.length);
      const win = new THREE.InstancedMesh(glass, glassMat, items.length);
      for (let i = 0; i < items.length; i++) {
        wall.setMatrixAt(i, items[i].m);
        win.setMatrixAt(i, items[i].m);
        wall.setColorAt(i, items[i].c);
        win.setColorAt(i, items[i].gc);
      }
      for (const im of [wall, win]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = false; // 远景不投影：看不到影子，省一shadow pass
        im.receiveShadow = false;
        im.frustumCulled = false; // 整体平移，包围球会失效（实例数不多，直接不剔除）
        // 近排挂在块里，显隐由 chunkRoot.visible 统一控制；
        // 远排是全局的，按街头/地铁模式单独切。
        if (!isNear) im.visible = ctx.isStreetActive();
        // 几何是模块级缓存、跨块共享：近排会挂在块里被 disposeChunk 遍历到，
        // 必须标记 shared，否则块销毁时会把其它块的远景楼几何一起释放掉。
        im.geometry.userData.shared = true;
        ctx.chunkRoot.add(im);
        if (isNear) {
          // 每块自有：随块平移/销毁，不登记进全局数组、不参与视差回绕
          im.userData.chunkBackdrop = true;
        } else {
          im.userData.parallax = L.parallax;
          im.userData.cycle = cycle;
          st.backdrop.push(im);
        }
      }
    });

    // 屋顶配件（每种一个 InstancedMesh）
    propGroups.forEach((items, kind) => {
      if (!items.length) return;
      const im = new THREE.InstancedMesh(
        getRoofPropGeometry(kind),
        roofMat,
        items.length
      );
      for (let i = 0; i < items.length; i++) {
        im.setMatrixAt(i, items[i].m);
        im.setColorAt(i, items[i].c);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = false;
      im.receiveShadow = false;
      im.frustumCulled = false;
      if (!isNear) im.visible = ctx.isStreetActive();
      im.geometry.userData.shared = true;
      ctx.chunkRoot.add(im);
      if (isNear) {
        im.userData.chunkBackdrop = true;
      } else {
        im.userData.parallax = L.parallax;
        im.userData.cycle = cycle;
        st.backdrop.push(im);
      }
    });
  }
}

/**
 * 相邻块【同一侧】球场的最小世界间距（米）。
 * 球场本身约 28 长，加上两侧各 courtGapWidth(2) 的通道，挖墙缺口约 32；
 * 留足余量到 72，避免两块同侧球场的缺口 / 补片互相重叠错位。
 */
const MIN_COURT_DIST = 72;

/**
 * 上一块各侧球场的【块内局部 z】（side → z）与其所在【块序号】。
 * 跨块限距用：块与块 root 恰好相差一个 wallLen，故两球场的世界距离 =
 * (序号差 × wallLen) + 上一块 z − 本块 z。（用序号差是为了在中间某块没放
 * 球场、间隔两块时仍算对，避免误判。）
 * 每次 build() 重建场景时清空（见 StreetScene.build）。
 */
let lastCourtLocalZ: Record<number, number> = {};
let lastCourtSeqBySide: Record<number, number> = {};
/** 分块序号：每生成一块 +1（与块的先后顺序一致，且不随世界平移变化）。 */
let chunkSeq = 0;

/** 判断本块某侧球场与「最近一块同侧球场」是否间隔足够（太近则不放球场）。 */
function isCourtFarFromPrev(side: number, z: number): boolean {
  const prevZ = lastCourtLocalZ[side];
  const prevSeq = lastCourtSeqBySide[side];
  if (prevZ === undefined || prevSeq === undefined) return true;
  const dist = (chunkSeq - prevSeq) * STREET.wallLen + prevZ - z;
  return dist >= MIN_COURT_DIST;
}

/**
 * 球场补片材质缓存（按长度 0.5 米取整）。补片全部是 noGraffiti 纯砖纹，
 * 按长度跨块复用可避免每次补块都重新 loadWallTexture（异步加载图片 + canvas 重绘）。
 * build() 重建时清空。
 */
const wrapMatCache = new Map<number, THREE.MeshStandardMaterial>();
function getWrapMat(
  ctx: SceneContext,
  len: number
): THREE.MeshStandardMaterial {
  const key = Math.max(0.5, Math.round(len * 2) / 2);
  let m = wrapMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: ctx.loadWallTexture(wallTex, key / STREET.wallSegLen, 1, {
        outW: STREET.segTexW,
        outH: STREET.segTexH,
        segments: 1,
        noGraffiti: true,
      }),
      roughness: 0.9,
    });
    wrapMatCache.set(key, m);
  }
  return m;
}

/** buildBuildings 拆分用的共享计划（在左右两侧之间传递的可变状态）。 */
export interface BuildingPlan {
  zHi: number;
  zLo: number;
  segLen: number;
  maxGap: number;
  extraGap: number;
  minGap: number;
  baseScale: number;
  wallX: number;
  courtHalfSpan: number;
  courtSeamClearZ: number;
  frontDirs: THREE.Vector2[];
  courtCenters: number[];
  courtPlaced: number;
}

/**
 * 楼房/球场「准备」阶段：清空旧对象、复位墙、算常量与共享状态。
 * 返回 null 表示没有可用模型（跳过本块楼房）。
 * 左右两侧铺设与终兜底各自独立成步骤，便于分帧（见 beginChunk）。
 */
export function buildBuildingsInit(ctx: SceneContext): BuildingPlan | null {
  const st = ctx.street;
  // 本块序号 +1（用于跨块球场限距时按“序号差 × 块长”算真实距离）
  chunkSeq++;
  if (ctx.models.buildings.length === 0) return null; // 模型跳过
  // 幂等清空上一批楼球场 mesh，避免重复调用buildings 与旧球场残留
  if (st.buildings.length) {
    for (const b of st.buildings) ctx.scene.remove(b.mesh);
    st.buildings = [];
  }
  // 清除上一批球场绕行围+ 过道地砖」（重建时重新生成，避免
  for (const m of st.courtWraps) ctx.scene.remove(m);
  st.courtWraps.length = 0;
  for (const m of st.courtWalkways) ctx.scene.remove(m);
  st.courtWalkways.length = 0;
  // 复位墙（常化性与缩放），保证数可重调用
  for (const w of st.walls) {
    w.visible = true;
    // 墙是 BoxGeometry，长度沿z（ buildStreetWalls），复位须用 scale.z
    w.scale.z = (w.userData.baseScaleZ as number) ?? 1;
    w.position.z = (w.userData.baseZ as number) ?? w.position.z;
    w.userData.courtGap = false;
    // 墙体现在使用「六面材质数组（两侧贴砖纹其余纯色），需遍历处理
    // 兼单材质写法以防将来回
    const mats = Array.isArray(w.material) ? w.material : [w.material];
    for (const mm of mats) {
      const mat = mm as THREE.MeshStandardMaterial;
      if (mat?.map) mat.map.repeat.x = 1; // 贴图比例同步复位，防止切割时 repeat 残留
    }
  }
  // 楼房与段齐：z 落在墙网格上，形成「-墙交替
  const segLen = STREET.wallSegLen;
  const wallX = 10.5; // 墙所x 绝值，也是楼房临面对齐的位
  const recycleZ = 42; // 与滚动回收阈一
  const baseScale = 0.82; // 整体缩放，与行人/车辆形成合理比例
  const minGap = 22; // 同侧相邻楼房z 方向的最小间隙，杜绝重叠（含安全余量
  const maxGap = 30; // 起随机错位幅度
  const extraGap = 18; // 相邻楼之间外随机拉的间隙上限，形成错落天际
  // 关键不变量：布局跨度必须 < wallCycle。回绕会把建筑整体折回周期长度内，
  // 窗口，若布局更长，布首尾会在窗口内撞在一起（表现为跑段后固定位置重叠」）
  // 故起点上限 = recycleZ − segLen/2 − 2（不再往回绕），终点由 while 条件决定。
  const zHi = recycleZ - segLen / 2 - 2; // 约 37，起始 z 的上限
  const zLo = recycleZ - STREET.wallLen + 4; // 约 -176，布点最远下限（楼的远侧不得越过）
  // 预测每模型「门的部方单位向量)，放让门朝向赛道
  const frontDirs = ctx.models.buildings.map((m) =>
    detectBuildingFrontDir(ctx, m)
  );
  // 左右两侧各自、随机地沿铺，z 带随机偏移形成错落天际线
  // 相邻楼按真实（旋缩放后）z 半深推算间距，保证不重叠
  const courtCenters: number[] = []; // 已放球场的中心 z，用于避免两侧对称出现在同一位置
  st.courtZSlots = []; // 清空球场区间记录，供巷口避让
  // 球场近端（靠相机一侧）不得越过的 z。分块后墙有了真实端头：
  // 本块墙段只铺到局部 z≈40，上一块的墙从本块局部 z=38 起无缝续铺，
  // 但上一块不知道本块的球场、不会为它开墙缺口；球场临街围栏又与墙
  // 同在 x=±wallX 平面 —— 围栏一旦伸出 38，就会被上一块的整墙挡住
  //（表现为「球场一端被墙壁吃掉」，块随机布点靠上时才出现）。
  // 按原有设计墙要在球场端外 courtGapWidth(2) 处恢复，故限 36。
  // （远端不受影响：每块最多 2 个路口的让位级联推不到 -168 以下。）
  const COURT_SEAM_CLEAR_Z = 36;
  // 球场模型沿 z 的整场半长（含比围栏更长的贴地地面，取整盒偏保守）。
  // 放置后近端 = z + 该半长（initPos 在推导中抵消），用它反推限位。
  const courtHalfSpan = ctx.models.basketball
    ? Math.max(
        8,
        (() => {
          const cb = new THREE.Box3().setFromObject(ctx.models.basketball!);
          return (cb.max.z - cb.min.z) / 2;
        })()
      )
    : 15;
  return {
    zHi,
    zLo,
    segLen,
    maxGap,
    extraGap,
    minGap,
    baseScale,
    wallX,
    courtHalfSpan,
    courtSeamClearZ: COURT_SEAM_CLEAR_Z,
    frontDirs,
    courtCenters,
    courtPlaced: 0,
  };
}

/** 单侧铺设（原 side 循环体）。 */
function buildBuildingsSide(
  ctx: SceneContext,
  side: number,
  plan: BuildingPlan
): void {
  const st = ctx.street;
  const {
    zHi,
    zLo,
    segLen,
    maxGap,
    extraGap,
    minGap,
    baseScale,
    wallX,
    courtHalfSpan,
    courtSeamClearZ,
    frontDirs,
    courtCenters,
  } = plan;
  // 起始 z 随机错位 0~14：两侧楼的排布从不同相位开始，
  // 否则两侧同序号的位置会几乎重合（球场看起来"对称出现在同一处"）。
  let z = zHi - Math.random() * 14;
  let prevZ: number | null = null; // 上一栋（更靠近相机的）z 值
  let prevHalfD = 0; // 上一栋的 z 半深
  let placedSide = 0; // 楼位计数（球场节奏按每侧计）
  // 球场触发相位：左右错 2 位，避免异侧球场 z 对齐、隔遥遥相望。
  // 球场位置：每一侧各自在「第 1~2 栋」里随机挑一栋。
  //  · 不能用固定相位（左 1 / 右 2）—— 两侧楼的随机间隙接近，会让两侧球场落在相近的 z 上；
  //  · 也不能要求更大的序号 —— 加入路口候选位后每侧常常只放得下 1~2 栋，
  //    取到第 3 栋时右侧经常放不下，结果看起来「只有左边有球场」。
  const courtAt = 1 + Math.floor(Math.random() * 2);
  // 终止条件：楼的远侧边缘（z 减最大占位半深）不得越过 zLo。
  while (z - 20 > zLo) {
    placedSide++;
    // 球场触发：每侧在「第 1~2 栋」中随机挑一栋
    const wantCourt = !!ctx.models.basketball && placedSide === courtAt;
    let useCourt = wantCourt;
    if (wantCourt) {
      const zOrig = z;
      // 近端限位：球场只能往远侧（z 更小）挪，这里把过靠上的起点压回
      // 接缝内侧，保证 z + courtHalfSpan ≤ COURT_SEAM_CLEAR_Z。
      // 后续的随机挪移 / 防重叠 / 让位全都只往远侧推，不会突破该限。
      z = Math.min(z, courtSeamClearZ - courtHalfSpan);
      // 球场再随机往远侧挪 0~8 米：两侧即使选中同一序号，位置也不会重合
      // （后面的让位收敛会保证它不压进路口 / 别的球场）。
      z -= Math.random() * 8;
      // 兜底：若与另一侧已放好的球场 z 太近，再往下错开 18~28 米，
      // 确保不会出现"两侧对称、同一位置"的观感。
      if (courtCenters.some((c) => Math.abs(c - z) < 16)) {
        z -= 18 + Math.random() * 10;
      }
      // 跨块同侧限距：上一块同侧若已有球场，两者世界距离太近时，
      // 各自的挖墙缺口 / 补片会互相重叠、错位。太近就放弃本块这个球场
      //（改放普通楼），并恢复原 z，避免楼位被连带挪动。
      if (!isCourtFarFromPrev(side, z)) {
        useCourt = false;
        z = zOrig;
      }
    }
    if (useCourt) plan.courtPlaced++;
    let b: THREE.Object3D;
    let dir = new THREE.Vector2(0, 1); // 占位，仅楼房分支会重新赋值并使用
    let isCourt = false; // 为球场（用于下方占对齐分支
    let wbZ0 = 0; // 球场放置后的真实世界 z 下界（仅球场有效
    let wbZ1 = 0; // 球场放置后的真实世界 z 上界
    let courtHalfZ = 0; // 球场沿 z 的真实半长（用于与下一栋的间距）
    if (useCourt) {
      const court = ctx.models.basketball!; // 上面已用 !! 校验非空
      b = court.clone(true);
      isCourt = true;
      // 场长边已由校准阶段z（平行于），此无需再旋
    } else {
      const pick = Math.floor(Math.random() * ctx.models.buildings.length);
      const src = ctx.models.buildings[pick];
      b = src.clone(true);
      dir = frontDirs[pick];
    }
    // 保存克隆的初始位initPos：后position.set 替非「叠加，
    // 新包围盒 = 旧 box + (newPos − initPos)，不补偿会整体偏移 −initPos（各模型不同），
    // 导致逻辑 z 与视觉 z 错位、临街面 / 贴地对不齐，所以所有位置计算都必须带上 initPos。
    const initPos = b.position.clone();
    if (isCourt) {
      // 场渲染修复：
      // a) 地板 Plane.030 的两层（BCourt_Markngs 透明线条+ Concrete 不明地面层）
      // 且几乎共内部 z-fighting。明层不写深+ renderOrder 提后即可稳定叠加
      // b) 球场地板与地面同高（y=0），模型内部已由 a) 解决
      // c) 地板扁平投影产生 shadow acne 球场不投影
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          let hasTransparent = false;
          for (const mm of mats) {
            if (!mm) continue;
            if (mm.transparent) {
              mm.depthWrite = false; // 透明层不写深度，杜绝与地板共深度
              hasTransparent = true;
            }
          }
          if (hasTransparent) m.renderOrder = 2; // 透明 mesh 在不透明地板之后绘制
        }
      });
    } else {
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = false;
        }
      });
    }
    // 先按当前(克隆后尚状算一次基包围盒，
    // 用于场压高到围高度」的等比缩放及后位
    b.updateMatrixWorld(true);
    const baseBox = new THREE.Box3();
    b.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const tmp = _tmpBox.copy(m.geometry.boundingBox!);
        tmp.applyMatrix4(m.matrixWorld);
        baseBox.union(tmp);
      }
    });
    const baseY = Math.max(baseBox.max.y - baseBox.min.y, 0.01); // 模型原高度
    if (isCourt) {
      // 场与地面同高：底面精y=0（不再抬0.25），
      // 等比缩放使顶= 围高度 4.5，与墙顶齐平
      const wallH = 4.5;
      const s = wallH / baseY; // 等比：最终高= 4.5，底面贴地顶墙顶齐平
      b.scale.setScalar(s);
    } else {
      // 整体缩放(baseScale) + 随机高度变化，基准已在加载时缩放targetLen=16 高
      // 高度带整体上移（0.85~1.5 → 1.15~1.85）：让楼房明显高过 4.5 的围墙，
      // 露出高低错落的天际线天空，消除越过顶就片空蓝天」的空旷感
      // 随机幅度保持不变.5），故错落层次不受影响
      const h = 1.15 + Math.random() * 0.5;
      b.scale.setScalar(baseScale * h);
      // 记录「基准缩放：楼房回绕到相机后方时，会按它重新抽一度，
      // 使同条每跑220 单位，天际线的高度组合都不一样
      b.userData.baseScale = baseScale;
    }
    if (isCourt) {
      // 球场模型的正面（敞开面）固定在局部 -x 侧：
      // 右侧赛道在 -x 方向 → 不旋转即可正面朝赛道；
      // 左侧赛道在 +x 方向 → 必须旋转 180°，否则从赛道只能看到实心背面
      //（表现为「篮球场被墙挡住」）。
      b.rotation.y = side < 0 ? Math.PI : 0;
    } else {
      // 让建筑门窗的朝向向量 (fx,fz) 朝向赛道 (Tx,0)：
      // Tx = side<0 ? +1(朝 +x) : -1(朝 -x)。严格平行赛道，不加随机旋转。
      const fx = dir.x;
      const fz = dir.y; // Vector2 的 y 分量即模型局部 z 方向
      const Tx = side < 0 ? 1 : -1;
      let theta = Math.atan2(fz, fx);
      if (Tx < 0) theta += Math.PI;
      b.rotation.y = theta;
    }
    // 先按当前旋转/缩放计算模型包围盒，取得 x 方向半z 方向半深
    // 建筑整体位于墙侧（|x|>wallX），临靠赛道中心的紧贴墙，略微内移
    // 避免与共面导致的深度冲z-fighting)，从而从赛道看刚好盖住壁临街面完整展示
    b.updateMatrixWorld(true);
    // 用遍历所有网格几何的方式计算包围盒（setFromObject 更稳定，避免异常节点干扰
    const box = new THREE.Box3();
    b.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const tmp = _tmpBox.copy(m.geometry.boundingBox!);
        tmp.applyMatrix4(m.matrixWorld);
        box.union(tmp);
      }
    });
    const halfD = Math.max(box.max.z - box.min.z, 0.01) / 2; // 真实 z 半深（占位半径）
    const center = new THREE.Vector3();
    box.getCenter(center); // 模型几何（局部原点下的偏移），用于精
    // 场专计算「围栏主体的 z 范围，用于决定围墙位范围
    // 要排除两类几何：
    // a) 贴地地面(Concrete)：它 z 向比围栏更长，若按它让位，球场两露出
    // 「已位却贴地地面」的天空缝；
    // b) 敞开的围栏门(Fence_Front_Door)：门状伸向球场内**远**
    // 把包围盒多拉长约 1.05，若算进去会让位范围超出围栏
    // 表现为近丝合缝远有条天空缝」的固定不称现象
    // 故只取高且贴近临街面」的围栏竖面：排除门（远离临街面）与薄顶板（不向下延伸）
    let courtTallHalfD = halfD;
    let courtTallMinX: number | null = null;
    let courtTallMaxX: number | null = null;
    let courtTallMinZ: number | null = null; // 围栏 z 下界（远侧）
    let courtTallMaxZ: number | null = null; // 围栏 z 上界（近侧）
    if (isCourt) {
      const tallBox = new THREE.Box3();
      const tallThreshold = box.min.y + (box.max.y - box.min.y) * 0.25; // 离地 1/4 高以上算"竖直结构"
      const lowLimit = box.min.y + (box.max.y - box.min.y) * 0.3; // 向下延伸到高度以下
      // 收集候网格（先做低筛选，再统x 剔除
      const candidates: THREE.Box3[] = [];
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.geometry) return;
        // 按名称直接排除门（模型内门节点名如 Fence_Front_Door*）
        const meshName = m.name ?? "";
        const matName =
          (Array.isArray(m.material) ? m.material[0] : m.material)?.name ?? "";
        if (/door/i.test(meshName) || /door/i.test(matName)) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const tmp = m.geometry.boundingBox!.clone();
        tmp.applyMatrix4(m.matrixWorld);
        if (tmp.max.y > tallThreshold && tmp.min.y < lowLimit) {
          candidates.push(tmp);
        }
      });
      // 二校验：围栏竖面应「贴近临街面」取候选的 x 作为临面参考，
      // 剔除明显远离它的网格（伸向场内的门、架等），避免让位范围过大。
      // 临街面 = 最靠近赛道中心的那一面，且必须按 side 取对称的一侧：
      //   右侧（不旋转）：临街面在世界 -x 侧 → 取 min.x 最小；
      //   左侧（旋转 180°）：临街面在世界 +x 侧 → 取 max.x 最大。
      // 若两侧都取 min.x，左侧会取到背面，导致球场位置/朝向错位。
      if (candidates.length) {
        const xSpan = box.max.x - box.min.x;
        const xTol = xSpan * 0.12; // 允 12% 的
        // 保留【前后两道围栏】的竖面（靠两端），只剔除伸向场内的门 / 架。
        // 必须两端都保留：tallBox 的 x 跨度 = 球场真实深度，后面 buildCourtWrap
        // 用它定位远长边；若只留一侧，深度会算成围栏厚度，绕行墙就直接贴在
        // 墙后、横在缺口处把球场挡死。
        const refMinX = Math.min(...candidates.map((c) => c.min.x));
        const refMaxX = Math.max(...candidates.map((c) => c.max.x));
        for (const c of candidates) {
          if (
            Math.abs(c.min.x - refMinX) <= xTol ||
            Math.abs(c.max.x - refMaxX) <= xTol
          ) {
            tallBox.union(c);
          }
        }
      }
      if (!tallBox.isEmpty()) {
        courtTallHalfD = (tallBox.max.z - tallBox.min.z) / 2;
        courtTallMinX = tallBox.min.x; // 围栏的临街面 x（用于精齐壁）
        courtTallMaxX = tallBox.max.x;
        // 记录围栏真实 z 边界（相对模型原点）。注意这里是「局部原点下」的坐标
        // 而放置模型会平移，故最后用 (z − center.z) 换算成以逻辑 z 为中心的偏移
        courtTallMinZ = tallBox.min.z;
        courtTallMaxZ = tallBox.max.z;
      }
    }
    const pad = 1.15; // 安全系数，补偿估算偏绝不重叠
    const safeHalfD = halfD * pad;
    // 占位半深：球场沿 z(≈28) 比普通楼大得多，凡是"用它去占位 / 避让"的地方
    // 都必须用真实半深，否则它会吃掉前后邻居约 6 米的间距 ——
    // 表现就是"房子/砖墙压进球场"（前邻居）或"球场压进下一栋"（后邻居）。
    const occupyHalfD = isCourt
      ? Math.max(safeHalfD, courtTallHalfD)
      : safeHalfD;
    // 防重叠：新楼（更远，z 更小）的近侧必须 <= 上一栋远侧 − minGap
    if (prevZ !== null) {
      const prevFar = prevZ - prevHalfD; // 上一栋远离相机的 z
      const maxZ = prevFar - minGap - occupyHalfD; // z 允许的上限（含本栋真实半深）
      if (z > maxZ) z = maxZ; // 推远，杜绝与上一栋重叠
    }
    // 让位收敛：两种区都会把 z 远十字 / 已放场）
    // 而推远之后又落进另一区，以循不再重叠为（1~2 次收敛）
    // · 十字：必须彻底避 —3 段藏的，落进去的楼/球场
    // 等于直接摆在上；
    // · 球场：楼不得侵入已放球场（球场自查自己）
    // 注意存储约定：z0 = 中心 − 半深(远侧, z 更小)，z1 = 中心 + 半深(近侧, z 更大)，
    // 故跳到禁区远侧之外要用 z0 并继续减小 z。
    let guard = 0;
    for (;;) {
      // 让位：除了路口本体(±9)，还要让开横街那排楼房所占的纵深
      // （横街楼从 z≈9 一直延伸到 ~25），否则主路的二线楼房会穿进
      // 围墙 / 楼房模型里
      const cross = st.crossZSlots.find(
        (s) =>
          z + occupyHalfD > s.z0 - CROSS_BUILDING_PAD &&
          z - occupyHalfD < s.z1 + CROSS_BUILDING_PAD
      );
      const court =
        isCourt || cross
          ? undefined
          : st.courtZSlots.find(
              (s) =>
                s.side === side &&
                z + occupyHalfD > s.z0 &&
                z - occupyHalfD < s.z1
            );
      const blocked = cross ?? court;
      if (!blocked) break;
      z = blocked.z0 - minGap - occupyHalfD;
      if (guard++ > 12) break; // 兜底，防止极数下死循
    }
    let posX: number;
    // 球场临街面直接对齐沿街围墙（平面 x=±wallX）
    // 使球场紧贴赛道一侧，不留近侧通道（赛道上完全看不到球场与墙之间的空隙）
    const courtFaceX = wallX;
    // 由「新 box = 旧 box + (newPos − initPos)」反推 newPos.x，使临街边精确落在 x 上
    if (isCourt) {
      // 用【整体包围盒】做左右严格对称的贴墙放置，不再依赖「围栏临街面」识别。
      // 之前用 tallMinX/tallMaxX（围栏竖面）定位，但那一步在左右两侧容易取到
      // 不同的一侧（正面/背面），一旦判错整座球场就会错位、缺口处只剩天空。
      //   右侧（不旋转）：box.min.x（靠赛道的一侧）对齐 +wallX；
      //   左侧（旋转 180°）：box.max.x 对齐 -wallX。
      posX =
        side < 0
          ? -courtFaceX - box.max.x + initPos.x
          : courtFaceX - box.min.x + initPos.x;
    } else {
      // 楼房临街边紧贴墙根（内移 0.6 防止与墙共面 z-fighting）
      const faceX = wallX - 0.8;
      posX =
        side < 0
          ? -faceX - box.max.x + initPos.x
          : faceX - box.min.x + initPos.x;
    }
    // 精确放置：x=临街边贴墙；y=贴地(box.min.y)
    // )；z=几何落在逻辑 z（防重叠基准
    b.position.set(posX, -box.min.y + initPos.y, z - center.z + initPos.z);
    if (isCourt) {
      // 用放的真实世界包围盒】重新确定球z 跨度，作为绕行与沿街的依
      // 这样得到的范围与玩实际看到的球场边界完全一致（避免任何估算/基准
      // 球场两侧巷道宽度不等、或墙断位置与球场部错位）
      b.updateMatrixWorld(true);
      const wb = new THREE.Box3();
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          const t2 = _tmpBox.copy(m.geometry.boundingBox!);
          t2.applyMatrix4(m.matrixWorld);
          wb.union(t2);
        }
      });
      const wbCz = (wb.min.z + wb.max.z) / 2;
      const wbHalf = (wb.max.z - wb.min.z) / 2;
      wbZ0 = wbCz - wbHalf;
      wbZ1 = wbCz + wbHalf;
      // 球场布局：临侧）敞开不墙，围在球z 范围
      // 改由三绕围把球场包起来（两侧沿 x 的侧+ 后方z 的横墙）
      // 绕行范围直接用放置后的真实世界包围盒 wbZ0/wbZ1
      // 它与玩实际看到的球场部完全一致，因球场两侧巷道宽度必然相等
      // 沿墙的位置也与球场严丝合缝
      const cZ0 = wbZ0;
      const cZ1 = wbZ1;
      // 沿围的断范围【必须与 buildCourtWrap 边z 位置完全致：
      // 围墙在 courtZ0−G / courtZ1+G，因此这里也 ±G
      // 若只按球场本体（不G）断，沿街会提G 就结束短边还在 G 之
      // 正好空出 G 宽的段没有任何 —从赛道上就是出天空的缺口
      const gapZ0 = cZ0 - STREET.courtGapWidth;
      const gapZ1 = cZ1 + STREET.courtGapWidth;
      const segHalf = STREET.wallSegLen / 2;
      // 先生成绕行墙 + 通道地砖；失败（找不到砖纹）就不要挖沿街墙 ——
      // 墙保持完整（球场被墙挡着）总比「墙挖了、缺口没填充、露出一块天空」好。
      const courtDepthX =
        courtTallMinX !== null && courtTallMaxX !== null
          ? courtTallMaxX - courtTallMinX
          : box.max.x - box.min.x;
      const wrapOk = buildCourtWrap(
        ctx,
        side,
        wallX,
        courtFaceX,
        cZ0,
        cZ1,
        courtDepthX
      );
      if (wrapOk) {
        // 与缺口有重叠的墙段一律【整段隐藏】，再用「等长补片」把缺口之外
        // 的部分补回来，这样缺口比球场宽的零头不会露出天空。
        const fillers: Array<[number, number]> = [];
        for (const w of st.walls) {
          if (w.position.x > 0 !== side > 0) continue;
          // 跳过属于十字路口的墙段：它们的显隐由路口（active）控制。
          if (w.userData.crossRoad) continue;
          const sZ0 = w.position.z - segHalf;
          const sZ1 = w.position.z + segHalf;
          if (sZ1 <= gapZ0 || sZ0 >= gapZ1) continue; // 不重叠，保留整段
          w.visible = false;
          w.userData.courtGap = true;
          // 该段落在缺口【外面】的部分需要补回来
          if (sZ0 < gapZ0) fillers.push([sZ0, Math.min(sZ1, gapZ0)]);
          if (sZ1 > gapZ1) fillers.push([Math.max(sZ0, gapZ1), sZ1]);
        }
        // 补片：与沿街墙同高(4.5) / 同厚，长度取被隐藏墙段的残余长度。
        // 材质按长度走缓存（getWrapMat），避免每次补块都重新生成砖纹贴图。
        for (const [a, b] of fillers) {
          const len = b - a;
          if (len < 0.05) continue;
          const geo = new THREE.BoxGeometry(STREET.wallThickness, 4.5, len);
          const m = new THREE.Mesh(geo, getWrapMat(ctx, len));
          m.position.set(side * STREET.wallX, 2.25, (a + b) / 2);
          m.receiveShadow = true;
          m.castShadow = true;
          // 回绕阈值按自身的 z 向长度算（scrollStreet 会读这个值）
          m.userData.wrapHalf = len / 2;
          ctx.chunkRoot.add(m);
          st.courtWraps.push(m);
        }
      }
      // 记录场辑 z 区间到字段，供本侧楼房黑名单与巷口避让使保持原有 padding 约定
      // 记录球场的【真实】z 范围（wbZ0/wbZ1），而不是楼房的通用占位半深：
      // 通用半深只有 ~8，而球场沿 z 有 28 长，落在外面一点点的楼会直接压进球场。
      st.courtZSlots.push({ side, z0: cZ0, z1: cZ1 });
      courtHalfZ = Math.abs(cZ1 - cZ0) / 2;
      courtCenters.push((cZ0 + cZ1) / 2);
      // 记下本块该侧球场的局部 z 与块序号（用逻辑 z，偏移在跨块差值里会抵消），
      // 供后续块做同侧最小间距限制。
      lastCourtLocalZ[side] = z;
      lastCourtSeqBySide[side] = chunkSeq;
    }
    b.visible = false; // 由 applySceneMode 控制显示
    ctx.chunkRoot.add(b);
    st.buildings.push({
      mesh: b,
      z,
      halfD: isCourt ? Math.max(safeHalfD, courtHalfZ) : safeHalfD,
      castShadow: true,
      isCourt,
      // mesh.z = z - offZ 恒等式：滚动回绕全部基于逻辑 z（防重叠坐标系）
      // 彻底消除各模型 initPos/center 差异(δ) 对回绕顺序与落点间隔的影响
      offZ: center.z - initPos.z,
    });
    // 记录并推进到下一栋：在上栋基础上往远处推「本栋半深 + 最小间隙 + 随机额外间隙」。
    // 球场沿 z 比普通楼长得多，必须用它的真实半深推进，否则下一栋会压进球场。
    const stepHalfD = isCourt ? Math.max(safeHalfD, courtHalfZ) : safeHalfD;
    prevZ = z;
    prevHalfD = stepHalfD;
    z -= stepHalfD + minGap + Math.random() * extraGap;
  }
}

/** 终兜底：把落入球场 z 区间的楼房整体移到其远侧，确保绝无穿插。 */
export function buildBuildingsFinalize(
  ctx: SceneContext,
  plan: BuildingPlan
): void {
  const st = ctx.street;
  const minGap = plan.minGap;
  // 终兜底：强制把所有落入球场 z 区间的楼房整体移到球场远侧，确保绝无穿插。
  // 放置时的逐栋防重叠偶发偏差（随机间隙叠加、球场相邻）由这里统一纠正。
  for (const s of st.courtZSlots) {
    let again = true;
    let guard = 0;
    while (again && guard++ < 20) {
      again = false;
      for (const b of st.buildings) {
        if (b.isCourt) continue;
        const bSide = b.mesh.position.x > 0 ? 1 : -1;
        if (bSide !== s.side) continue;
        const bh = b.halfD ?? 6;
        if (b.z + bh > s.z0 && b.z - bh < s.z1) {
          // s.z0 = 中心 − 半深 = 远侧(z 更小)；移到其远侧之外需继续减小 z
          const newZ = s.z0 - bh - minGap;
          const dz = newZ - b.z;
          b.z = newZ;
          b.mesh.position.z += dz;
          again = true; // 移动后可能与更远的球楼重叠，复
        }
      }
    }
  }
}

// 生成场的「绕行围+ 通道地砖」
// 终布（以右侧 side>0 为例，x 越大越远离赛道；G = 通道宽度 courtGapWidth）：
// · 靠赛道的侧（近赛道长边）敞开不—赛道上直接看到球场内
// 球场临面直接贴在沿街围墙平courtFaceX=wallX)上，二之间没有近侧道
// · 其余三边用围墙相连，围成形把球场包住
// 两条短墙（沿 x，垂直于赛道）：z = cZ0−G 与 z = cZ1+G（球场 z 边界外扩 G），
// x 从 courtFaceX 到 courtBackX+G（正好接在沿街围墙平面，不伸入人行道）
// 远长边（沿 z，平行于赛道）：x = courtBackX+G，连接两条短边
// · 墙位= 沿墙断边界，二者相接不留空隙；
// · 球场三面（两侧短+ 后方长边）与围之间均保留 G 的道并铺人道地砖
export function buildCourtWrap(
  ctx: SceneContext,
  side: number,
  wallX: number,
  courtFaceX: number,
  courtZ0: number,
  courtZ1: number,
  courtDepthX: number
): boolean {
  const st = ctx.street;
  const wallH = 4.5;
  const G = STREET.courtGapWidth; // 球场与绕行之间的道宽度
  // 球场后沿（远长边墙）所在的 x
  const courtBackX = courtFaceX + courtDepthX;
  // 远长边的 x（球场后方再外扩 G）
  const backWallX = courtBackX + G;
  // 量：墙近赛道侧伸出点，使它与沿街【实体相交非相切
  // 沿街墙是位于 x=±wallX、厚 T 的 Box，中线在 wallX；
  // 取 2T 作为余量：让位裁剪会让墙略微位移，若余量只有 T 会出现丝级缝隙
  // 重叠（下仍露缝）；2T 定保证转角有可见的重叠体积
  const cornerLap = STREET.wallThickness * 2;
  // 墙沿 x 的范围：从球场临街面再向赛道侧伸cornerLap（插入沿街体内），
  // 到远长边 wallBackX
  const wrapX0 = courtFaceX - cornerLap;
  const wrapX1 = backWallX;
  const wrapLenX = wrapX1 - wrapX0; // 墙沿 x 的长
  // 墙的 z 位置：球z 边界再向外整整一G（即「道的沿）
  // 这样球场与短边之间保留条 G 的道（与外侧长边的巷子同理）
  // 同时该位沿围的断边界(gapZ)完全—墙恰好填住沿街的开口，
  // 二相接中间不留空隙
  // 两端各多伸 6cm（= 一块墙体厚度），插进沿街墙被挖掉的端头里：
  // 只「对接」时两块墙的端面之间有丝级缝隙，掠射角下会透出一条亮缝。
  const wrapZ0 = courtZ0 - G - 0.06;
  const wrapZ1 = courtZ1 + G + 0.06;

  // 取侧一段的贴图作为绕行纹理（保持与沿围完全致的砖纹/涂鸦风格
  let srcTex: THREE.Texture | null = null;
  for (const w of st.walls) {
    if (w.position.x > 0 === side > 0) {
      // 墙体质数组：[0]/[1] 为贴砖纹的侧面材
      const mats = Array.isArray(w.material) ? w.material : [w.material];
      for (const mm of mats) {
        const mat = mm as THREE.MeshStandardMaterial;
        if (mat?.map) {
          srcTex = mat.map;
          break;
        }
      }
      break;
    }
  }
  if (!srcTex) {
    // 找不到可用砖纹：返回 false，交由调用方【不要挖沿街墙】，
    // 保持墙完整（球场被墙挡住）总比挖出缺口后无填充、露天空好。
    console.warn(
      "[street] buildCourtWrap: 未取到砖纹贴图，跳过绕行墙（沿街墙保持完整）(side=%d, z0=%s, z1=%s)",
      side,
      courtZ0.toFixed(1),
      courtZ1.toFixed(1)
    );
    return false;
  }

  // 绕墙工厂：沿指定方向生成段（自动克隆贴图按长度repeat 保持砖纹密度致）
  // 绕墙的厚度：与沿墙统（STREET.wallThickness），保证处厚薄一致
  // 必须用有厚度Box 而非零厚Plane：短边垂直于赛道，玩从赛道上斜看
  // 看到的是它的【侧面截零厚度平面在视下几乎不
  // 视上就会在「短边与沿街之间」露出一条空隙
  const WRAP_T = STREET.wallThickness;
  const addWrapWall = (
    len: number,
    cx: number,
    cz: number,
    alongZ: boolean
  ) => {
    if (len <= 0.05) return;
    // 让长的几何都沿长度方向展，厚度方向为另一
    const geo = alongZ
      ? new THREE.BoxGeometry(WRAP_T, wallH, len)
      : new THREE.BoxGeometry(len, wallH, WRAP_T);
    const tex = srcTex!.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // 沿街墙长度 = wallSegLen 且 repeat.x = 1，据此换算以保持砖纹密度一致
    tex.repeat.x = len / STREET.wallSegLen;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.95,
      metalness: 0.05,
    });
    const m = new THREE.Mesh(geo, mat);
    // BoxGeometry 已自带朝向，无需旋转
    m.position.set(cx, wallH / 2, cz);
    m.userData.side = side;
    m.userData.courtGap = true;
    m.userData.courtWrap = true;
    m.castShadow = false;
    m.receiveShadow = false;
    ctx.chunkRoot.add(m);
    st.courtWraps.push(m);
  };

  // 两条短墙（沿 x 延伸，垂直于赛道），位于球场 z 边界外扩 G 处
  const midX = (wrapX0 + wrapX1) / 2;
  addWrapWall(wrapLenX, side * midX, wrapZ0, false);
  addWrapWall(wrapLenX, side * midX, wrapZ1, false);
  // 远长边（沿 z 延伸，平行于赛道），位于球场后方外扩 G 处，连接两条墙
  // 两各cornerLap，与墙头重叠，消除处的发丝缝
  addWrapWall(
    wrapZ1 - wrapZ0 + cornerLap * 2,
    side * wrapX1,
    (wrapZ0 + wrapZ1) / 2,
    true
  );

  // ---------- 通道地砖 ----------
  // 与人行道同贴图；每块独clone 并按其尺寸 repeat，保证砖缝密度一致
  const SW_W = 3.5;
  const SW_L = 220;
  // sidewalkTex 由构造函数在 buildCityDecor 之前创建，处必然已就绪
  const SWTex = ctx.sidewalkTex;
  const baseRX = SWTex.repeat.x || 1;
  const baseRY = SWTex.repeat.y || 1;
  const addPave = (w: number, len: number, cx: number, cz: number) => {
    if (w <= 0.05 || len <= 0.05) return;
    const tex = SWTex.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set((w / SW_W) * baseRX, (len / SW_L) * baseRY);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.95,
      metalness: 0,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, 0.04, cz); // 略高于人行道(0.035)，避免共
    m.receiveShadow = true;
    m.userData.side = side;
    m.userData.courtWalkway = true;
    ctx.chunkRoot.add(m);
    st.courtWalkways.push(m);
  };
  // 通道只有「U 形三面围合」处才有地砖，靠赛道一侧敞开不铺；宽度均为 G
  // 从 x 覆盖 [courtFaceX, backWallX]
  // 向球场内侧延伸 INNER_OVERLAP：球场模型的地面通常比围包围盒部更
  // 若地砖上边界正好停在 courtZ0/courtZ1（由整体包围盒决定）
  // 则球场地面~ courtZ0」之间会露出小条没有地板的空隙
  // 向内重叠段即上（地砖 y=0.04 高于球场地面，重叠不会穿模）
  const INNER_OVERLAP = 1.5;
  const sidePaveLen = backWallX - courtFaceX;
  const sidePaveCx = (courtFaceX + backWallX) / 2;
  for (const [pz, dir] of [
    [courtZ0, -1],
    [courtZ1, 1],
  ] as Array<[number, number]>) {
    // 通道由球场边INNER_OVERLAP」延伸到墙：随之向内
    const paveLen = G + INNER_OVERLAP;
    addPave(
      sidePaveLen,
      paveLen,
      side * sidePaveCx,
      pz + dir * (G / 2 - INNER_OVERLAP / 2)
    );
  }
  // 1) 远长边后方道：沿 z 球场宽度（位于球场后沿与远长边之间）
  // 同样向球场内侧INNER_OVERLAP，盖球场地面后~ courtBackX」的窄缝
  addPave(
    G + INNER_OVERLAP,
    courtZ1 - courtZ0,
    side * (courtBackX + G / 2 - INNER_OVERLAP / 2),
    (courtZ0 + courtZ1) / 2
  );
  return true;
}

// ==================== 玩构建与障金币/道具生成 ====================

// 创建/重建玩（含光环）GLB 模型异加载完成后可再调用以替精致角色
// ==================== 滚动与动====================

/** 街头行人动画：程序化模型摆腿摆臂 + 真实 GLB 骨骼动画推进 */
export function animateStreetPeds(ctx: SceneContext, dt: number, runT: number) {
  const st = ctx.street;
  // 程序化人摆动双腿双臂（相位错开）；真实 GLB 行人由骼动mixer)负责走动
  // 这里仅理程序化回模型
  for (let p = 0; p < st.pedestrians.length; p++) {
    const ped = st.pedestrians[p];
    if (!ped.visible) continue;
    // 主路行人沿人行道实际走动：世界本+z 滚动（每+move），
    // 这里叠加行人的速（朝镜+、背-），于是"朝你走来的人"相世界更慢
    // "背向你的相更快，都不会再原地踏步
    const wd = ped.userData.walkDir as number | undefined;
    if (wd) {
      const sp = (ped.userData.walkSpeed as number) ?? 1.15;
      ped.position.z += wd * sp * dt;
    }
    const lL = ped.getObjectByName("legL");
    const lR = ped.getObjectByName("legR");
    const aL = ped.getObjectByName("armL");
    const aR = ped.getObjectByName("armR");
    if (lL || lR || aL || aR) {
      const ph = runT * 6 + p * 1.3;
      const sw = Math.sin(ph) * 0.5;
      if (lL) lL.rotation.x = sw;
      if (lR) lR.rotation.x = -sw;
      if (aL) aL.rotation.x = -sw * 0.8;
      if (aR) aR.rotation.x = sw * 0.8;
    }
  }
  // 行人：在人道上x 方向来回走动
  // 骨/程序动画迈"，位移这里做；到掉头
  // （只decorateCrossroad 生成的人带 userData.crossWalk，主人不受影响）
  for (const ped of st.pedestrians) {
    const cw = ped.userData.crossWalk as
      | { dir: number; a: number; b: number }
      | undefined;
    if (!cw) continue;
    ped.position.x += cw.dir * dt * 1.15; // 约 1.15 单位/秒，与主路行人观感一致
    if (ped.position.x >= cw.b) {
      ped.position.x = cw.b;
      cw.dir = -1;
      ped.rotation.y = -Math.PI / 2;
    } else if (ped.position.x <= cw.a) {
      ped.position.x = cw.a;
      cw.dir = 1;
      ped.rotation.y = Math.PI / 2;
    }
  }
  // 推进有人骼动画（真实 GLB 模型的走
  for (const m of st.pedMixers) m.update(dt);
}

/** 街头场景滚动：整体平移分块容器（不再逐物体回绕） */
/**
 * 旧版「逐物体回绕」的滚动逻辑已整体移除。
 *
 * 现在世界的移动由 `StreetScene.scroll()` 完成：它只平移每个分块（chunk）的
 * Group，不在这一层做任何回绕。这里保留空函数，避免其它模块的调用点报错。
 */
export function scrollStreet(_ctx: SceneContext, _move: number) {
  // 由 StreetScene.scroll() 接管
}

/** 街头场景各物体显隐（由 applySceneMode 调用） */
export function setStreetVisible(ctx: SceneContext, visible: boolean) {
  const st = ctx.street;
  // 巷口墙（alley）与球场正面敞开段（courtGap）这两类「挖掉」的墙始终隐藏
  // 注意：这里必须显式false，不能直
  // 注意：不能直接 return —— buildBuildings 复位时会把所有墙段置为 visible=true，若此处 return，
  // 这些墙将永远保持可见（表现为地铁场冒出城市砖）
  for (const w of st.walls) {
    if (w.userData.alley || w.userData.courtGap) {
      w.visible = false;
      continue;
    }
    if (w.userData.crossRoad) {
      // 路口墙段：只有它所属的候选位【本圈被启用】时才隐藏
      const g = w.userData.crossGroup as THREE.Group | undefined;
      w.visible = visible && !(g && g.userData.active);
      continue;
    }
    w.visible = visible;
  }
  for (const a of st.alleyways) a.visible = visible; // 墙根小巷仅在街头显示
  for (const c of st.crossroads) {
    // 路口：启用的显示；未启用的显示补片（填平预先挖掉的缺口）
    c.visible = visible && !!c.userData.active;
    const fg = c.userData.filler as THREE.Group | undefined;
    if (fg) fg.visible = visible && !c.userData.active;
  }
  for (const m of st.cityDecor) m.visible = visible;
  for (const b of st.buildings) b.mesh.visible = visible;
  for (const b of st.backdrop) b.visible = visible;
  for (const w of st.courtWraps) w.visible = visible;
  for (const w of st.courtWalkways) w.visible = visible;
  for (const l of st.streetLights) l.visible = visible;
}

// ==================== 构建：沿街 ====================

/** 沿街墙的基准高度：所有造型调整都压在这条线以下，墙不会被加高 */
const WALL_H = 4.5;
/**
 * 墙装饰配色（顶点色） *
 * 取原则：**贴近砖的明*，只做同材质的线脚不色构件 * 色构件压在红砖上，远看会变成圈栏杆架 */
const WALL_TRIM = {
  cope: 0x9c948a, // 压顶石（灰，比砖亮不了 plinth: 0x847c72, // 勒脚（略压深，作根的道基座）
  box: 0x9ba1a3, // 配电箱 boxDoor: 0x6f7476, // 配电箱门
};
let wallTrimMat: THREE.MeshStandardMaterial | null = null;

/**
 * 段的饰几何（顶点色，段只多一draw call） *
 * 让墙面不再是「一块高度一致、表面全平的砖板」，同时保持远看干净：
 * · 压顶石：沿墙顶一道细石线脚，挑出量压到 1.5~3.5cm；
 * · 勒脚：墙根一道窄基座，挑出 4cm；
 * · 落水管 / 配电箱：贴临街面的小构件，制造生活痕迹。
 * **不再做/ 墙垛*：相机是贴着墙沿街看的，任何出挑的竖向构 * 在掠射角下投影会放大成一条贯穿整面的色带（面只0.4 宽，
 * 掠射时看起来1 米宽），就切成格一格的"栅栏"，前显得乱的原因 * 竖向变化交给墙的高度差，不再靠贴面构件 */
function buildWallTrim(
  h: number,
  segLen: number,
  T: number
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const addBox = (
    w: number,
    hh: number,
    d: number,
    x: number,
    y: number,
    z: number,
    hex: number
  ) => {
    const g = new THREE.BoxGeometry(w, hh, d);
    g.translate(x, y, z);
    paintGeo(g, hex);
    parts.push(g);
  };
  // 1) 压顶石：细石线脚，顶面抬 5mm 压在墙顶之上（避免与墙体顶面共面 z-fighting）
  // 出挑量很小：出挑越大，掠射角下越易在墙顶投出条粗黑带
  const capH = 0.1 + Math.random() * 0.05;
  const over = 0.015 + Math.random() * 0.02;
  addBox(
    T + over * 2,
    capH,
    segLen,
    0,
    h - capH / 2 + 0.005,
    0,
    WALL_TRIM.cope
  );
  // 墙根原本还有道勒脚石线脚、面有落水管与配电箱，
  // 现在统一去掉 —砖顶部保留条压顶石线脚，持干
  // 只有一块（压顶石）时无需 merge，直接返回，省掉一次数组合并 + 分配。
  if (parts.length === 1) return parts[0];
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * 两侧街头墙（street 模式）—— 每面长墙切成多段 mesh，
 * 每段使用「独立生成」的砖纹+涂鸦贴图（repeatU=1、初始偏移随机），
 * 因此沿墙的每一个涂鸦都独一无二、绝不重复，左右墙也各自随机混杂。
 * 墙本然是条连的墙：每首尾相接（巷房屋让位依旧 * buildAlleyways、球场位辑在这些段上挖洞，与装饰无关） *
 * 每另带套贴面饰（buildWallTrim）：通长压顶石贴地勒脚 * 偶尔根落水/电；另有约 1/5 的段矮 7~18cm 让头线不那么板 *
 * 装饰「贴面线脚：**不做任何出挑的竖向构*（曾试过壁柱/墙垛） * 因为相机墙沿街看的，竖向构件只出挑 5~9cm，在掠射视下也会
 * 放大成一条贯穿整面的暗带，看起来就像墙上出一道道缝这正是
 * 之前「围墙不连续」感的来源 */
/**
 * 复用的临时包围盒：遍历网格累加包围盒时，每个网格都 `boundingBox.clone()`
 * 会在一栋楼里产生几十个临时 Box3（GC 压力）。这里用一个模块级实例 copy 复用。
 * 仅用于「算完立即 union、不保留引用」的场景（candidates 数组那种要保留的仍 clone）。
 */
const _tmpBox = new THREE.Box3();

/**
 * 墙段几何缓存：所有墙段都是同尺寸 Box（只有高度按 0.01 精度分档），
 * 跨块/跨段复用同一份几何，避免每次补块都新建 148 个 BoxGeometry。
 * 标记 userData.shared，disposeChunk 会跳过（不会被某一块销毁）。
 */
const wallBodyGeoCache = new Map<string, THREE.BoxGeometry>();
function getWallBodyGeo(
  h: number,
  T: number,
  segLen: number
): THREE.BoxGeometry {
  const key = `${h.toFixed(2)}|${T}|${segLen}`;
  let g = wallBodyGeoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(T, h, segLen);
    g.userData.shared = true;
    wallBodyGeoCache.set(key, g);
  }
  return g;
}

/** 墙顶压顶石几何缓存（与墙段同精度分档），同样跨块共享。 */
const wallTrimGeoCache = new Map<string, THREE.BufferGeometry>();
function getWallTrimGeo(
  h: number,
  segLen: number,
  T: number
): THREE.BufferGeometry {
  const key = `${h.toFixed(2)}|${segLen}|${T}`;
  let g = wallTrimGeoCache.get(key);
  if (!g) {
    g = buildWallTrim(h, segLen, T);
    g.userData.shared = true;
    wallTrimGeoCache.set(key, g);
  }
  return g;
}

/** buildStreetWalls 的准备结果（贴图池 / 材质 / 常量），供分段铺设共享。 */
export interface WallBuildPrep {
  segLen: number;
  segCount: number;
  T: number;
  wallZ0: number;
  pool: THREE.MeshStandardMaterial[];
  edgeMat: THREE.MeshStandardMaterial;
  trimMat: THREE.MeshStandardMaterial;
}

/**
 * 墙体「准备」阶段：初始化墙顶材质、砖纹贴图池、墙侧面材质与常量。
 * 分段铺设由 buildStreetWallsRange 负责（分帧时拆成多步，避免 148 段几何
 * 构造在一帧里做完造成短促卡顿）。
 */
export function buildStreetWallsPrep(ctx: SceneContext): WallBuildPrep {
  const st = ctx.street;
  const wallLen = STREET.wallLen;
  const segLen = STREET.wallSegLen;
  const segCount = Math.ceil(wallLen / segLen);
  // 墙体改为【有厚度】的 Box（厚= 绕墙一致），使有厚统
  // 且转角方能与短边真相交（零厚度平面与短边「相切，透下即露缝）
  // 用六面材质数组：两个侧面(±x)贴砖纹，用同色纯材质避免贴图拉伸
  const T = STREET.wallThickness;
  if (!wallTrimMat) {
    wallTrimMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
    });
  }
  const trimMat = wallTrimMat;
  // ---- 砖纹贴图----
  // 以前每段当场生成一张「唯一」贴图：74 段 = 74 次 canvas 绘制 + 74 张显存。
  // 现在WALL_TEX_POOL 张供有段共并在墙回绕到相机后方时
  // 随机张（scrollStreet）更快、显存更省，且场再每 220 单位重遍
  const WALL_TEX_POOL = 18;
  // 贴图池是【全局共享】的：分块后每块都会调用本函数，
  // 已经建好就直接复用，避免每块都重新生成 18 张砖纹贴图（显存 × 块数）。
  const pool: THREE.MeshStandardMaterial[] =
    st.wallFaceMats.length > 0 ? st.wallFaceMats : [];
  for (let i = pool.length; i < WALL_TEX_POOL; i++) {
    const tex = ctx.loadWallTexture(
      wallTex,
      1, // repeatU = 1：本段只用一张，不再沿长平铺，从涂鸦不重
      1,
      {
        outW: STREET.segTexW,
        outH: STREET.segTexH,
        segments: 1, // 整张贴图作为段，涂鸦约束在整张边界内，避免墙缝切割
        // 不 brickOffset：各段砖纹相位一致，段间砖缝连续，避免滚动时砖缝跳动
      }
    );
    pool.push(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  }
  st.wallFaceMats = pool;
  // 顶面/底面/两面共用一色材原来每费）
  if (!st.wallEdgeMat) {
    st.wallEdgeMat = new THREE.MeshStandardMaterial({
      color: ctx.theme.wallL,
      roughness: 0.95,
    });
  }
  const edgeMat = st.wallEdgeMat;
  const wallZ0 = -70 + wallLen / 2 - segLen / 2; // 段中z
  return { segLen, segCount, T, wallZ0, pool, edgeMat, trimMat };
}

/** 按区间铺设墙段（供分帧：把 148 段拆成多步）。 */
function buildStreetWallsRange(
  ctx: SceneContext,
  prep: WallBuildPrep,
  side: number,
  i0: number,
  i1: number
): void {
  const st = ctx.street;
  const { segLen, T, wallZ0, pool, edgeMat, trimMat } = prep;
  for (let i = i0; i < i1; i++) {
    const faceIdx = Math.floor(Math.random() * pool.length);
    const faceMat = pool[faceIdx];
    // 墙高度：约 1/5 的落矮点点（最高仍WALL_H，不加高）
    // 落差压得很小~18cm）：墙整体看仍是连续的一整面，只头线偶尔有个小台阶
    // 取到 0.01 精度：视觉无差，但能让几何缓存命中（跨段/跨块复用）。
    const h =
      Math.round(
        (Math.random() < 0.2
          ? WALL_H - (0.07 + Math.random() * 0.11)
          : WALL_H) * 100
      ) / 100;
    // Box 材质顺序：[+x, -x, +y(顶), -y(底), +z, -z]
    // 两个侧面都贴砖纹：这样无论左右旋转方向如何，朝向赛道的那面都有砖纹
    const mesh = new THREE.Mesh(getWallBodyGeo(h, T, segLen), [
      faceMat,
      faceMat,
      edgeMat,
      edgeMat,
      edgeMat,
      edgeMat,
    ]);
    const z = wallZ0 - i * segLen;
    mesh.position.set(side * 10.5, h / 2, z);
    // 墙体装饰（压顶石 / 勒脚 / 落水/ 配电箱）：作为子物体
    // 跟随墙起滚动回绕球场让位缩放，无额同逻辑
    const trim = new THREE.Mesh(getWallTrimGeo(h, segLen, T), trimMat);
    trim.position.y = -h / 2; // 装饰几何以根为原点，这里抵消体中心偏
    trim.castShadow = false;
    trim.receiveShadow = false;
    mesh.add(trim);
    mesh.userData.side = side; // 供滚动时判断左右方向
    mesh.userData.faceIdx = faceIdx; // 当前用的砖纹贴图索引（回绕时张）
    mesh.userData.baseZ = z; // 记录原网格 z，供 buildBuildings 重算球场让位时
    mesh.userData.baseScaleZ = 1; // 长度方向（局z）的基准缩放
    st.walls.push(mesh);
    ctx.chunkRoot.add(mesh);
  }
}

/** 同步铺设整面墙（保留给需要一次性构建的调用）。 */
export function buildStreetWalls(ctx: SceneContext) {
  const prep = buildStreetWallsPrep(ctx);
  for (const side of [-1, 1]) {
    buildStreetWallsRange(ctx, prep, side, 0, prep.segCount);
  }
}

// ==================== 方 B：场封 ====================
// 说明：以上纯函数实现保持不变；下方类把它拢成「场象，
// 由 ThreeRunner 持有实例并调用 build/scroll/setVisible，实现场景解耦
// 类自SceneContext（过 public 字getter），因内部接把 `this` 传给上面的函数
/** 分帧构建中的一块：步骤队列 + 已执行进度。滚动补块不再同步一次性建完，改成分帧推进。 */
interface ChunkBuildTask {
  root: THREE.Group;
  /** 构建开始时全局行人数组的长度（用于 finish 时登记本块新增的行人） */
  pedStart: number;
  /** 构建开始时全局动画混合器数组的长度 */
  mixStart: number;
  /** 按顺序执行的构建步骤（每个步骤内部仍同步，分帧粒度 = 步骤） */
  steps: Array<{ name: string; run: () => void }>;
  /** 下一个待执行步骤的下标 */
  index: number;
}

/** 分帧构建每帧的 CPU 预算（毫秒）。单步超过预算时也会执行完，保证每帧至少有进展。 */
const CHUNK_BUILD_BUDGET_MS = 2;

/**
 * 预生成提前量（米）：当最前块距边界还差这么多时就提前分帧生成下一块，
 * 而不是等到切换瞬间才生成 —— 把一次性的大卡顿摊到正常行进的几十帧里。
 */
const CHUNK_PREGEN_MARGIN = 100;

/** 街头场景对象：持有街头专属状态，并封装构建 / 滚动 / 显隐 */
export class StreetScene implements SceneContext {
  // ---------- 共享依赖（由 ThreeRunner 注入）----------
  readonly scene: THREE.Scene;
  /**
   * 当前分块容器：街头所有物体都挂到它下面（而不是直接挂 scene）。
   * 构建期指向正在生成的那一块；滚动时整块平移，边界处销毁旧块、分帧补新块。
   */
  chunkRoot: THREE.Object3D;
  readonly theme: SceneContext["theme"];
  readonly loadWallTexture: SceneContext["loadWallTexture"];
  readonly loadRoadTexture: SceneContext["loadRoadTexture"];
  readonly sidewalkTex: THREE.CanvasTexture;
  /** 地铁隧道壁瓷砖贴图（SceneContext 要求；街头场景不使用，仅转发注入值） */
  readonly metroWallTex: THREE.Texture;
  readonly sidewalkMat: THREE.MeshStandardMaterial;
  readonly curbMat: THREE.MeshStandardMaterial;
  readonly isStreetActive: () => boolean;
  /** 模型池引用（每次返回最新值，避免持有构建时的过期快照） */
  private readonly modelsRef: () => ModelPool;
  /** 模型资源池（实现 SceneContext.models：实时转发 modelsRef） */
  get models(): ModelPool {
    return this.modelsRef();
  }

  // ---------- 街头专属状----------
  private readonly st: StreetState = {
    chunks: [],
    walls: [],
    alleyways: [],
    cityDecor: [],
    wallFaceMats: [],
    wallEdgeMat: null,
    pedestrians: [],
    pedMixers: [],
    streetLights: [],
    streetLightCount: 0,
    buildings: [],
    backdrop: [],
    courtWraps: [],
    courtWalkways: [],
    courtZSlots: [],
    crossroads: [],
    crossZSlots: [],
    crossActive: [],
  };

  /** 待分帧构建的块（滚动补块用；每帧 2ms 预算推进，见 drainChunkBuilds） */
  private readonly pendingBuilds: ChunkBuildTask[] = [];

  /**
   * 待销毁几何队列：块退役时不立刻 dispose 它的几何（一次性释放一整车几何
   * 会造成一帧尖峰），而是攒起来，每帧少量释放（见 drainGeoDispose）。
   */
  private readonly pendingGeoDispose: THREE.BufferGeometry[] = [];

  /** 街头状态（实现 SceneContext.street） */
  get street(): StreetState {
    return this.st;
  }

  /**
   * 地铁状：街头场景不使用 * 返回惰空壳以满足接口；真正的地铁状由 MetroScene 持有 */
  get metro(): MetroState {
    return emptyMetroState;
  }

  constructor(deps: SceneDeps) {
    this.scene = deps.scene;
    // 分块容器：街头所有物体都挂在它下面，移动世界 = 平移这一个 Group。
    this.chunkRoot = new THREE.Group();
    this.chunkRoot.name = "streetChunk";
    this.scene.add(this.chunkRoot);
    this.theme = deps.theme;
    this.loadWallTexture = deps.loadWallTexture;
    this.loadRoadTexture = deps.loadRoadTexture;
    this.sidewalkTex = deps.sidewalkTex;
    this.metroWallTex = deps.metroWallTex;
    this.sidewalkMat = deps.sidewalkMat;
    this.curbMat = deps.curbMat;
    this.modelsRef = deps.models;
    this.isStreetActive = deps.isStreetActive;
  }

  /**
   * 分块构建入口：建两块（当前 + 下一块），之后每越过一块就销毁旧块、补新块。
   * 墙、楼、路口、球场、街具、远景、人行道条带全部在 spawnChunk 内一次性建好。
   */
  buildWalls(): void {
    // 分块后墙不能单独建一次（要跟块走），这里留空兼容旧的调用顺序
  }

  build(): void {
    // 先清掉旧内容（重复 build 时不留残骸）
    for (const c of [...this.st.chunks]) this.disposeChunk(c);
    // 重建场景时清空「上一块球场位置」记录与块序号，避免旧记录错误地限制第一块。
    lastCourtLocalZ = {};
    lastCourtSeqBySide = {};
    chunkSeq = 0;
    // 让路口 / 补片材质缓存在重建时失效（主题或资源可能已变）。
    crossroadMatsCache = null;
    crossroadGeoTemplate = null;
    wrapMatCache.clear();
    this.spawnChunk(0);
    this.spawnChunk(-STREET.wallLen);
  }

  /**
   * 生成一块的「头部」：创建容器、切换 chunkRoot、重置每块状态，并产出构建步骤队列。
   * 远景（backdrop）只在第一次构建时入队一次，之后全局复用。
   */
  private beginChunk(z0: number): ChunkBuildTask {
    const root = new THREE.Group();
    root.position.z = z0;
    root.name = `streetChunk@${z0.toFixed(0)}`;
    this.chunkRoot = root;
    this.scene.add(root);
    this.resetChunkState();

    const pedStart = this.st.pedestrians.length;
    const mixStart = this.st.pedMixers.length;

    const steps: Array<{ name: string; run: () => void }> = [];
    const step = (name: string, fn: () => void) =>
      steps.push({ name, run: fn });
    // 墙体拆成「准备 + 4 段区间」：每块共 148 段墙，一次性构造会有 ~10ms 的
    // 单帧尖峰；分段后每步只造 ~37 段，配合 2ms 预算基本无感。
    let wallPrep: WallBuildPrep | null = null;
    const wallSegCount = Math.ceil(STREET.wallLen / STREET.wallSegLen);
    const wallSegMid = Math.ceil(wallSegCount / 2);
    step("walls:prep", () => {
      wallPrep = buildStreetWallsPrep(this);
    });
    step("walls:left:a", () => {
      if (wallPrep) buildStreetWallsRange(this, wallPrep, -1, 0, wallSegMid);
    });
    step("walls:left:b", () => {
      if (wallPrep)
        buildStreetWallsRange(this, wallPrep, -1, wallSegMid, wallSegCount);
    });
    step("walls:right:a", () => {
      if (wallPrep) buildStreetWallsRange(this, wallPrep, 1, 0, wallSegMid);
    });
    step("walls:right:b", () => {
      if (wallPrep)
        buildStreetWallsRange(this, wallPrep, 1, wallSegMid, wallSegCount);
    });
    step("planCrossroads", () => planCrossroads(this));
    // 楼房/球场拆成「准备 + 左右两侧 + 终兜底」四步：两侧各要 clone 1~2 栋楼
    // 或一个球场（含包围盒遍历），一整步偏重；拆开后单帧尖峰进一步压平。
    let buildingPlan: BuildingPlan | null = null;
    step("buildBuildings:prep", () => {
      buildingPlan = buildBuildingsInit(this);
    });
    step("buildBuildings:left", () => {
      if (buildingPlan) buildBuildingsSide(this, -1, buildingPlan);
    });
    step("buildBuildings:right", () => {
      if (buildingPlan) buildBuildingsSide(this, 1, buildingPlan);
    });
    step("buildBuildings:finalize", () => {
      if (buildingPlan) buildBuildingsFinalize(this, buildingPlan);
    });
    // 路口：材质一步 + 每个路口单独一步，避免「材质(canvas) + 多个路口的
    // 几何/装饰(clone)」挤在同一帧造成尖峰。材质跨路口复用。
    let crossMats: CrossroadMats | null = null;
    step("crossroadMats", () => {
      crossMats = makeCrossroadMats(this);
    });
    // 注意：路口数量只有 planCrossroads 执行后才知道（beginChunk 时刻
    // crossZSlots 还没规划，绝不能在这里遍历它注册步骤——那会让路口
    // 一个都建不出来）。用占位步骤在运行期把「每个路口一步 + 收尾」
    // 插到队列中它自己的位置上（crossroadMats 之后、rebuildWalkStrips 之前）。
    const spawnCrossroadSteps = {
      name: "spawnCrossroadSteps",
      run: () => {
        // 插到自身【之后】：drain 取到本步骤时已把 index 推进到它的下一位，
        // 所以第一个路口步骤必须正好落在这个 index 上，否则会被整体跳过。
        const i = steps.indexOf(spawnCrossroadSteps) + 1;
        const added: Array<{ name: string; run: () => void }> = [];
        for (const slot of this.st.crossZSlots) {
          const c = (slot.z0 + slot.z1) / 2;
          // 每个路口拆成「几何」+「装饰」两步：装饰里 12 栋楼 clone + 行人/车辆
          // 是单帧最重的一块，与几何分开可显著削掉单帧尖峰。
          let g: THREE.Group | null = null;
          added.push({
            name: `crossroad@${c.toFixed(0)}:geo`,
            run: () => {
              g = buildCrossroadGeometryAt(this, slot, crossMats!);
            },
          });
          added.push({
            name: `crossroad@${c.toFixed(0)}:static`,
            run: () => {
              if (g) decorateCrossroadStatic(this, g);
            },
          });
          added.push({
            name: `crossroad@${c.toFixed(0)}:actors`,
            run: () => {
              if (g) decorateCrossroadActors(this, g);
            },
          });
        }
        added.push({
          name: "crossroadFinalize",
          run: () => {
            // 本块的每个路口都启用（分块后不需要「候选位」那套开关）
            for (const g of this.st.crossroads) g.userData.active = true;
            applyCrossActive(this);
          },
        });
        steps.splice(i, 0, ...added);
        // 占位步骤自身留在原地即可：index 已越过它，不会再次执行。
      },
    };
    steps.push(spawnCrossroadSteps);
    step("rebuildWalkStrips", () => rebuildWalkStrips(this));
    // 第二排矮楼（近排）：【每块一份】，挂在本块 chunkRoot 下。
    // 放在 planCrossroads 之后，这样能读本块的 crossZSlots 精确让开路口；
    // 随块平移 / 销毁，块切换时天际线不会抽动（高楼远排仍是全局的）。
    step("buildBackdropNear", () => buildBackdrop(this, "near"));
    // 天际线高楼（远排）：全局只生成一次，挂 scene 下按视差平移 + 220 回绕。
    // 它不按块让位（所有块共享同一相位做不到），所以放在横街之外。
    if (this.st.backdrop.length === 0) {
      step("buildBackdropFar", () => {
        const prevRoot = this.chunkRoot;
        this.chunkRoot = this.scene;
        try {
          buildBackdrop(this, "far");
        } finally {
          // 必须还原，否则后续步骤会把物体挂到 scene 而不是本块里。
          this.chunkRoot = prevRoot;
        }
      });
    }
    // 装饰带按 z 分三段 + 路灯独立，避免整条装饰带（含行人 clone）挤在一帧。
    step("clearCityDecor", () => clearCityDecor(this));
    // 装饰带切成 6 段（原来 3 段）：每段 ~5~35 米，槽位更少，
    // 单步里的装饰/行人 clone 更少，配合 2ms 预算更平滑。
    step("cityDecorSpan@-130", () => buildCityDecorSpan(this, -130, -95));
    step("cityDecorSpan@-95", () => buildCityDecorSpan(this, -95, -60));
    step("cityDecorSpan@-60", () => buildCityDecorSpan(this, -60, -30));
    step("cityDecorSpan@-30", () => buildCityDecorSpan(this, -30, 0));
    step("cityDecorSpan@0", () => buildCityDecorSpan(this, 0, 10));
    step("cityDecorSpan@10", () => buildCityDecorSpan(this, 10, 20));
    step("buildStreetLights", () => buildStreetLights(this));

    return { root, pedStart, mixStart, steps, index: 0 };
  }

  /** 块步骤执行完毕后收尾：登记行人/动画、点亮本块物体。 */
  private finishChunk(t: ChunkBuildTask): void {
    this.st.chunks.push({
      root: t.root,
      peds: this.st.pedestrians.slice(t.pedStart),
      mixers: this.st.pedMixers.slice(t.mixStart),
    });
    t.root.visible = this.isStreetActive();
    // 块内很多物体（楼、部分街具）在构建时是隐藏的，靠这一步按“街头模式”点亮。
    try {
      setStreetVisible(this, this.isStreetActive());
    } catch (e) {
      console.error("[street] applyChunkVisibility failed:", e);
    }
  }

  /** 同步生成一块（开场建两块用，允许一次卡顿）。 */
  private spawnChunk(z0: number): void {
    const t = this.beginChunk(z0);
    while (t.index < t.steps.length) {
      const s = t.steps[t.index++];
      try {
        s.run();
      } catch (e) {
        console.error(`[street] ${s.name} failed:`, e);
      }
    }
    this.finishChunk(t);
  }

  /** 入队一块，交给每帧 2ms 预算的分帧循环构建（滚动补块用，避免边界卡顿）。 */
  private enqueueChunk(z0: number): void {
    this.pendingBuilds.push(this.beginChunk(z0));
  }

  /** 每帧推进分帧构建：在 budgetMs 预算内尽量多执行步骤，保证边界切换不卡顿。 */
  private drainChunkBuilds(budgetMs: number): void {
    if (this.pendingBuilds.length === 0) return;
    const deadline = performance.now() + budgetMs;
    while (this.pendingBuilds.length > 0 && performance.now() < deadline) {
      const t = this.pendingBuilds[0];
      while (t.index < t.steps.length) {
        const s = t.steps[t.index++];
        try {
          s.run();
        } catch (e) {
          console.error(`[street] ${s.name} failed:`, e);
        }
        if (performance.now() >= deadline) break;
      }
      if (t.index >= t.steps.length) {
        this.finishChunk(t);
        this.pendingBuilds.shift();
      }
    }
  }

  /** 清空「每块」的状态数组（行人 / 动画混合器是运行时数组，保留） */
  private resetChunkState(): void {
    const st = this.st;
    st.walls = [];
    st.buildings = [];
    // st.backdrop 不清空：只保存【全局远排】；近排挂在各块 chunkRoot 下，
    // 不登记进全局数组（否则会被视差循环二次平移，且数组会无限增长）。
    st.courtWraps = [];
    st.courtWalkways = [];
    st.courtZSlots = [];
    st.crossroads = [];
    st.crossZSlots = [];
    st.crossActive = [];
    st.cityDecor = [];
    st.streetLights = [];
    st.streetLightCount = 0;
    st.alleyways = [];
  }

  /** 销毁一块：停动画、从全局数组剔除、从场景移除（几何由 Stage 4 统一释放） */
  private disposeChunk(c: StreetChunk): void {
    for (const m of c.mixers) {
      m.stopAllAction();
      const i = this.st.pedMixers.indexOf(m);
      if (i >= 0) this.st.pedMixers.splice(i, 1);
    }
    for (const p of c.peds) {
      const list = this.st.pedestrians as THREE.Object3D[];
      const i = list.indexOf(p);
      if (i >= 0) list.splice(i, 1);
    }
    // 释放本块【自己创建】的几何（墙段、路口、球场绕行墙、街具、条带、远景…）。
    // 模型池里的 GLB 几何在加载完成时被标记为 userData.shared，跳过它们，
    // 否则会把共享几何销毁，导致其它块 / 玩家模型变黑。
    c.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = m.geometry;
      // 不在这里直接 dispose（一整车几何一次性释放会造成一帧尖峰）：
      // 攒进队列，由每帧的 drainGeoDispose 少量释放。
      if (geo && !geo.userData.shared) this.pendingGeoDispose.push(geo);
      // 近排远景用的 InstancedMesh：几何是共享的（上面已跳过），但
      // instanceMatrix / instanceColor 是每块独立的 GPU buffer，必须释放，
      // 否则长时间滚动会持续泄漏。
      if (
        o.userData.chunkBackdrop &&
        (o as THREE.InstancedMesh).isInstancedMesh
      ) {
        (o as THREE.InstancedMesh).dispose();
      }
    });
    c.root.removeFromParent();
    const i = this.st.chunks.indexOf(c);
    if (i >= 0) this.st.chunks.splice(i, 1);
  }

  /** 每帧少量释放待销毁几何，避免一次性 dispose 造成一帧尖峰。 */
  private drainGeoDispose(max = 48): void {
    const q = this.pendingGeoDispose;
    for (let i = 0; i < max && q.length > 0; i++) q.pop()!.dispose();
  }

  /** 每帧滚动：分帧构建推进 + 整块平移 + 生命周期管理 */
  scroll(move: number): void {
    if (!this.isStreetActive()) return;
    // 先推进分帧构建（每帧 2ms 预算），再平移/切换。
    this.drainChunkBuilds(CHUNK_BUILD_BUDGET_MS);
    // 顺带少量释放退役块的几何（每帧几十个，避免集中释放的尖峰）。
    this.drainGeoDispose();
    const chunks = this.st.chunks;
    if (chunks.length === 0) return;
    for (const c of chunks) c.root.position.z += move;
    // 构建中的块（pendingBuilds 里还没 finish 的）也必须跟着平移！
    // 否则它在分帧构建的那几帧~几十帧里原地不动，而其它块一直在后退，
    // 建成加入时会落后「构建时长 × 速度」的位移 —— 速度越快落后越多，
    // 与相邻块之间裂开越来越大的空隙（正是「跑得越快空隙越大」的成因）。
    for (const t of this.pendingBuilds) t.root.position.z += move;

    // 远景层（全局，只生成一次）：按视差平移 + 220 回绕。
    // 它不属于任何块，所以块切换时天际线保持不变，不会出现“抽动”。
    for (const o of this.st.backdrop) {
      const k = (o.userData.parallax as number) ?? 1;
      const cyc = (o.userData.cycle as number) ?? STREET.wallLen;
      o.position.z += move * k;
      if (o.position.z >= cyc) o.position.z -= cyc;
    }

    let front = chunks[0];
    for (const c of chunks) {
      if (c.root.position.z > front.root.position.z) front = c;
    }
    let backZ = Infinity;
    for (const c of chunks) backZ = Math.min(backZ, c.root.position.z);

    // 提前预生成：front 距边界还差 CHUNK_PREGEN_MARGIN 米时就开始分帧建下一块，
    // 让生成开销摊到切换前的多帧里（避免切换瞬间一次性卡顿）。
    // 只有「恰好 2 块、且没有未完成的预生成」时才启动，避免重复入队。
    if (
      this.pendingBuilds.length === 0 &&
      chunks.length === 2 &&
      front.root.position.z >= STREET.wallLen - CHUNK_PREGEN_MARGIN
    ) {
      this.enqueueChunk(backZ - STREET.wallLen);
    }

    if (front.root.position.z < STREET.wallLen) return;

    // 若下一块还在构建中，先别销毁最前块：chunks 掉到只剩 1 块时，
    // 前方会短暂出现没有任何覆盖的空洞。等它建好（pending 清空、
    // chunks 恢复 2 块）再切换。
    if (this.pendingBuilds.length > 0) return;

    // 边界切换：销毁最前块。预生成的块已就绪（在 chunks 里），无需重复入队；
    // 只有既无预生成又只剩一块的异常情况才兜底补一块。
    this.disposeChunk(front);
    if (chunks.length < 2) {
      let bz = Infinity;
      for (const c of chunks) bz = Math.min(bz, c.root.position.z);
      this.enqueueChunk(bz - STREET.wallLen);
    }
  }

  /** 街头各物体显隐：切块容器 + 全局远景（远景不在块里） */
  setVisible(visible: boolean): void {
    for (const c of this.st.chunks) c.root.visible = visible;
    for (const b of this.st.backdrop) b.visible = visible;
  }

  /** 行人动画（需要 dt 与全局动画相位 runT） */
  animatePeds(dt: number, runT: number): void {
    animateStreetPeds(this, dt, runT);
  }

  /** 运行期装饰回收 + 远端补充 */
  recycleDecor(move: number): void {
    recycleCityDecor(this, move);
  }

  /** 生成球场绕行围墙与通道地砖（供 buildBuildings 调用） */
  buildCourtWrap(
    side: number,
    wallX: number,
    courtFaceX: number,
    courtZ0: number,
    courtZ1: number,
    courtDepthX: number
  ): void {
    buildCourtWrap(
      this,
      side,
      wallX,
      courtFaceX,
      courtZ0,
      courtZ1,
      courtDepthX
    );
  }

  /** 修复球场标线 UV */
  fixCourtMarkingUV(root: THREE.Object3D): void {
    fixCourtMarkingUV(this, root);
  }

  /** 查询 (side,z) 是否与某栋楼房重叠（装饰避让用） */
  isOccupiedByBuilding(side: number, z: number, halfDepth = 2): boolean {
    return isOccupiedByBuilding(this, side, z, halfDepth);
  }

  /** 查询 (side,z) 是否落在球场两侧巷道口（装饰避让用） */
  isInCourtAlley(side: number, z: number, margin = 0): boolean {
    return isInCourtAlley(this, side, z, margin);
  }
}
