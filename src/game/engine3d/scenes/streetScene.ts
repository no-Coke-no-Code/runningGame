import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import wallTex from "@/assets/wall.png";
import { addOutline, makeBrickTexture, makeFacadeTexture } from "../textures";
import {
  emptyMetroState,
  STREET,
  type MetroState,
  type ModelPool,
  type SceneContext,
  type SceneDeps,
  type StreetState,
} from "./types";

/**
 * 街头（street）场景：沿街墙 / 巷口 / 路灯 / 随机装饰 / 墙后楼房 / 篮球场。
 *
 * 本模块为「方案 A：静态拆分」的产物——把原 ThreeRunner 中街头专属的方法
 * 搬到这里，改成接收 SceneContext 的纯函数。后续方案 B 时，
 * 这些函数可直接收进 StreetScene 类（ctx.street 整块变成 this）。
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
// 否则会堵住"通往另一条街"的开口）。
// 注意：必须读「实时」巷口位置——巷口随其绑定的墙段一起滚动并回绕，
// 用建巷时记录的静态 z 会在滚动后失效。故直接遍历 alleyways，
// 且把回绕周期(wallCycle)也纳入比较，覆盖跨周期边界的相邻性。
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
    // 比较 z 与巷口中心的最小环形距离（考虑回绕）
    let d = Math.abs(a.position.z - z) % cycle;
    if (d > cycle / 2) d = cycle - d;
    if (d < half) return true;
  }
  return false;
}

// 判断某侧、某 z 是否落在【篮球场两侧的巷道口】范围内。
// 球场两端各有一条通往球场内部的通道（宽 courtGapWidth），是"进出球场"的开口，
// 不应摆放长椅/BMX 等占地装饰，否则会把通道堵住。
// courtZSlots 记录的是球场模型（含地面）的整体 z 区间，其范围已略大于球场本体，
// 再向外各扩一个通道宽即可完整覆盖两条巷道口。
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

// 清除落在巷口范围内的人行道装饰（含行人）。
// 时序说明：巷口随机生成且依赖已建楼群，无法在 buildCityDecor 时预知，
// 故在 buildAlleyways 之后执行本方法，把已生成但恰好压在巷口的装饰移除。
// 移走后该处留空是合理的——巷口本就不该有东西；运行期补充时也会跳过巷口。
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
  // 兜底：清除压在【篮球场两侧巷道口】的长椅 / BMX。
  // 装饰是先行生成的，而球场巷道位置依赖球场模型的识别结果，可能晚于装饰生成；
  // 这里按类型再筛一遍，确保通道口不被占地装饰堵住（其余类型装饰保持不动）。
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

export function buildCityDecor(ctx: SceneContext) {
  const st = ctx.street;
  // 重建前清空旧装饰、行人与其骨骼动画播放器，避免累积/重复播放
  for (const m of st.cityDecor) ctx.scene.remove(m);
  st.cityDecor.length = 0;
  st.pedestrians.length = 0;
  st.pedMixers.length = 0;
  // 初始填充：从远处到相机前方铺满一段装饰带
  let z = -130;
  while (z < 20) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const mesh = makeRandomDecor(ctx, side, z);
    mesh.visible = false; // 由 applySceneMode 控制显示
    ctx.scene.add(mesh);
    st.cityDecor.push(mesh);
    z += 7 + Math.random() * 3.5;
  }
  // 独立规律路灯带（固定间隔、左一个右一个交替）
  buildStreetLights(ctx);
}

// 垂直小巷透视：随机间隔地把某一段墙隐藏（露出墙上的缺口=巷口），
// 并在缺口处向墙后深处横切一段暗巷地面 + 巷尾暖光，制造垂直于人行道、通向墙后的纵深感。
// 仅隐藏墙段、不影响墙后建筑；与墙同周期(wallCycle)滚动复用；仅在 street 模式显示、不参与碰撞。
export function buildAlleyways(ctx: SceneContext) {
  const st = ctx.street;
  for (const m of st.alleyways) ctx.scene.remove(m);
  st.alleyways.length = 0;
  const wallX = 10.5; // 墙所在的 x 绝对值
  const depth = 70; // 暗巷向墙后（x 方向）延伸深度：足够长，使巷尾沉入远景雾中，看不到尽头
  const segLen = STREET.wallSegLen; // 巷口宽 = 一段墙长度，与缺口对齐
  // 墙后建筑禁区：巷口不要正好开在楼临街面正中央（避免洞口被楼正面正对挡死、
  // 视觉重叠打架）。只避开楼正面前后一小段（±6），远小于楼间空隙(≥22)，
  // 保证楼与楼之间的空隙处仍能开出巷口，不会因禁区连片而一条都没有。
  // 用真实占位半深(b.halfD) + 一整段墙长(segLen)余量，确保巷口与任何建筑/球场之间
  // 至少隔着一段实心墙，避免巷口紧贴楼/球场、从赛道看像是「楼房侵入巷子」。
  const blocked = st.buildings.map((b) => {
    const h = (b.halfD ?? 6) + segLen + 2;
    return { lo: b.z - h, hi: b.z + h };
  });
  const inBlocked = (z: number) => blocked.some((r) => z >= r.lo && z <= r.hi);
  // 跳过落在篮球场区间（及其两侧余量）的墙段，避免巷口开在球场处、暗巷穿透球场；
  // 余量扩大为一段墙长(segLen)，确保球场缺口两侧各留一段实心墙，暗巷不会紧贴球场缺口
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
  // 沿墙段随机间隔挑选巷口：每次开完后随机决定「下一段间隔多少段」(randGap∈[4,10])，
  // 间隔长短不一、完全无规律；左右侧各自独立，避免两侧巷口贴在一起。
  const randGap = () => 4 + Math.floor(Math.random() * 7); // 4~10 段随机间隔
  const since: Record<number, number> = { [-1]: 0, [1]: randGap() }; // 左右起始错开
  const nextGap: Record<number, number> = { [-1]: randGap(), [1]: randGap() };
  let passed = 0; // 通过建筑避让过滤的墙段数
  let created = 0; // 实际创建的巷口数
  for (const w of st.walls) {
    const side: number = w.position.x > 0 ? 1 : -1;
    const z = w.position.z;
    // 跳过落在墙后建筑禁区内的墙段，确保巷口不与楼体重叠
    if (inBlocked(z)) continue;
    // 跳过落在篮球场区间的墙段，避免巷口开在球场处、暗巷穿透球场
    if (inCourt(z, side)) continue;
    passed++;
    since[side]++;
    // 达到随机间隔后尝试开巷口；若因建筑避让未能开成，则顺延到下一段再判断
    if (since[side] >= nextGap[side]) {
      w.visible = false; // 去掉这一段墙，露出缺口
      const g = new THREE.Group();
      g.position.set(0, 0, z); // Group 仅承载滚动平移，子物体用相对坐标
      // 暗巷地面：沿 z 长 = segLen（对准缺口），向墙后 x 方向延伸 depth
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(depth, segLen),
        floorMat
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(side * (wallX + depth / 2), 0.01, 0);
      floor.receiveShadow = false;
      g.add(floor);
      // 不再设置明确的「巷尾亮块」：暗巷直接延伸至远景雾中（depth=70），
      // 尽头被雾吞没，玩家看不到底，纵深感更真实。
      // 巷子两侧夹墙：沿 z 方向、位于暗巷两条边（z = ±segLen/2），向墙后延伸 depth
      // 高度与主墙一致(4.5)。内侧（面向巷子内）贴涂鸦（砖纹+涂鸦），外侧贴纯砖纹（无涂鸦）。
      // 贴图沿深度方向平铺 repeat.x=depth/segLen，使砖纹比例正确、不被拉伸。
      const alleyWallTex = ctx.loadWallTexture(wallTex, depth / segLen, 1, {
        outW: STREET.segTexW,
        outH: STREET.segTexH,
        segments: 1,
      });
      const alleyWallMat = new THREE.MeshStandardMaterial({
        map: alleyWallTex,
        roughness: 0.9,
      }); // 内面：涂鸦
      // 外侧：纯砖纹（无涂鸦），同样按深度平铺避免拉伸
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
        // Box 材质索引：0=+x,1=-x,2=+y,3=-y,4=+z,5=-z
        // 内面 = 朝巷子中心(z=0)的那一面：ez<0 时内面为 +z(索引4)，ez>0 时内面为 -z(索引5)
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
      // 巷口两侧路缘（提示开口边界）
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
      ctx.scene.add(g);
      st.alleyways.push(g);
      w.userData.alley = g; // 绑定到墙段，随该墙段一起滚动/回收
      since[side] = 0; // 重置该侧计数
      nextGap[side] = randGap(); // 随机决定下一次间隔，消除规律感
      created++;
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

// ==================== 路灯带 ====================

/**
 * 路灯柱与停靠车辆都立在人行道上（灯柱 x=±7.7、停车 x=±8.2，横向必然重叠），
 * 所以只能在 z 方向错开：灯柱与车身中心的距离小于这个值就换位置，
 * 否则灯柱会从车头/车尾插进车模型。车身半长约 2.4，再留 1 米余量。
 */
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
function isNearStreetLight(ctx: SceneContext, side: number, z: number): boolean {
  return ctx.street.streetLights.some((m) => {
    const ms = m.position.x > 0 ? 1 : -1;
    return ms === side && Math.abs(m.position.z - z) < LAMP_CAR_CLEAR_Z;
  });
}

// 规律路灯带：沿街两侧固定间隔（STREETLIGHT_GAP）交替出现（左一个、右一个），
// 灯头始终朝马路中心，营造整齐的街道照明节奏感。
export function buildStreetLights(ctx: SceneContext) {
  const st = ctx.street;
  for (const m of st.streetLights) ctx.scene.remove(m);
  st.streetLights.length = 0;
  st.streetLightCount = 0; // 重置交替相位计数
  const gap = 22; // 相邻路灯（含左右）间距，密度适中
  let z = -130;
  while (z < 20) {
    const side = st.streetLightCount % 2 === 0 ? -1 : 1;
    if (isNearParkedCar(ctx, side, z)) {
      // 这一档正好停着车：放弃灯柱，但消耗一个相位，保持左右交替的节奏不乱
      st.streetLightCount++;
    } else {
      const mesh = makeStreetLight(ctx, z);
      mesh.visible = false; // 由 applySceneMode 控制显示
      ctx.scene.add(mesh);
      st.streetLights.push(mesh);
    }
    z += gap;
  }
}

// 生成一个路灯，左右由全局计数器（streetLightCount）决定，保证严格交替
export function makeStreetLight(ctx: SceneContext, z: number): THREE.Object3D {
  const st = ctx.street;
  const side = st.streetLightCount % 2 === 0 ? -1 : 1; // 偶数左、奇数右
  st.streetLightCount++;
  const x = side * 7.7; // 墙内侧步道，避免被墙遮挡
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
    // 将模型内容在 x 方向居中到原点，确保 mesh.position.x 能精确控制左右位置
    // （GLB 模型原点可能不在灯柱中心，否则左右交替会失效）
    const box = new THREE.Box3().setFromObject(mesh);
    const cx = (box.min.x + box.max.x) / 2;
    mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.position.x -= cx;
    });
  } else {
    // 回退：电线杆 + 路灯头
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

// 规律路灯带动态回收：随世界滚动，越过相机后方的移除，在最远处持续补充，
// 始终保持固定间隔、左右交替的节奏。
export function recycleStreetLights(ctx: SceneContext, move: number) {
  const st = ctx.street;
  for (const m of st.streetLights) {
    m.position.z += move;
    if (m.position.z > 18) ctx.scene.remove(m);
  }
  st.streetLights = st.streetLights.filter((m) => m.position.z <= 18);
  // 在最远处补充，直到达到目标纵深
  let minZ = Infinity;
  for (const m of st.streetLights) if (m.position.z < minZ) minZ = m.position.z;
  if (!isFinite(minZ)) minZ = 20;
  const gap = 22;
  while (minZ > -130) {
    const nz = minZ - gap;
    // 左右由全局计数器自动决定，与初始段严格连续交替
    const side = st.streetLightCount % 2 === 0 ? -1 : 1;
    if (isNearParkedCar(ctx, side, nz)) {
      st.streetLightCount++; // 该档有停靠车辆：不立灯柱，只消耗相位
    } else {
      const mesh = makeStreetLight(ctx, nz);
      mesh.visible = ctx.isStreetActive();
      ctx.scene.add(mesh);
      st.streetLights.push(mesh);
    }
    minZ = nz;
  }
}

/**
 * 人行道「停靠车辆」开关。
 *
 * 车辆现在只作为赛道障碍物出现在马路上（见 ThreeRunner.makeObstacle 的 car 分支），
 * 人行道停车功能暂时停用。恢复：把它改回 true 即可，下面的分支代码原样保留。
 */
const PARKED_CARS_ENABLED = false;

// 随机生成一个街头装饰（含行人）。注意：路灯不再由本函数生成，
// 改由独立的规律路灯带（buildStreetLights）负责，保证固定间隔左右交替。
// 行人会 push 到 st.pedestrians / st.pedMixers（由调用方负责清空）。
export function makeRandomDecor(
  ctx: SceneContext,
  side: number,
  z: number
): THREE.Object3D {
  const st = ctx.street;
  const x = side * 8.5; // 墙内侧步道(7.0~10.5)，避免被墙遮挡
  const r = Math.random();
  const ink = ctx.theme.ink;
  const tagColors = [
    ctx.theme.magenta,
    ctx.theme.cyan,
    ctx.theme.yellow,
    ctx.theme.red,
  ];
  let mesh: THREE.Object3D;
  let placed = false; // 行人分支自行完成定位（避免被通用定位逻辑覆盖/旋转）

  if (r < 0.16) {
    // 棕榈树：优先使用真实模型（PalmyraPalmTree.obj/.mtl），加载失败回退到程序化
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
      // 回退：细长树干 + 几片下垂叶
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
    // 路边停靠车辆：约一半概率用 Mercedes 190E（精细模型），否则随机选低模车；
    // 都无模型时回退到程序化 lowrider。位置由下方通用定位放到人行道停车位。
    // （当前 PARKED_CARS_ENABLED = false，本分支不生效，见文件上方常量注释）
    const useMercedes = !!ctx.models.mercedes && Math.random() < 0.5;
    const src = useMercedes
      ? ctx.models.mercedes
      : ctx.models.cars.length > 0
      ? ctx.models.cars[Math.floor(Math.random() * ctx.models.cars.length)]
      : null;
    if (
      isInAlleyMouth(ctx, side, z, 2.5) ||
      isInCourtAlley(ctx, side, z, 2.5) ||
      // 该处已经立着路灯：不停车，否则灯柱会插进车身（两者横向位置重叠）
      isNearStreetLight(ctx, side, z)
    ) {
      // 巷口/球场通道口/路灯处不停车
      mesh = new THREE.Group();
      placed = true;
    } else if (src) {
      mesh = src.clone(true);
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = false;
        // Mercedes 自带 PBR 贴图，保持原材质（调亮会污染贴图色相/质感）
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
      // 回退：Lowrider 老式长车
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
    // 停靠车辆停用期间的占位：这一段概率留空（人行道此处不放东西），
    // 这样不会把这段占比挤给别的装饰（否则 BMX/消防栓会突然变多）。
    mesh = new THREE.Group();
    mesh.position.set(side * 8.5, 0, z);
    placed = true;
  } else if (r < 0.46) {
    // BMX 小轮车：优先使用真实模型（bmx.obj/.mtl），加载失败回退到程序化
    // 限制：不得出现在楼房/球场临街位置（沿 z 与任意建筑区间重叠则跳过，避免穿模）
    //     也不得出现在篮球场两侧的巷道口（会堵住进出球场的通道）
    if (
      isOccupiedByBuilding(ctx, side, z, 1.2) ||
      isInCourtAlley(ctx, side, z, 1.2)
    ) {
      mesh = new THREE.Group(); // 空占位，不渲染
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
    mesh.userData.decorKind = "bmx"; // 供「球场巷道口清理」按类型识别
  } else if (r < 0.55) {
    // 消防栓：随机加在人行道（通用 x=±8.5），朝向随机不影响（近轴对称）
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
    // 长椅：方向与马路平行（长边沿 z 行进方向），放在人行道中后侧
    // 限制：长椅不得出现在楼房/球场临街位置（沿 z 与任意建筑区间重叠则跳过，避免穿模）
    //     也不得出现在篮球场两侧的巷道口（会堵住进出球场的通道）
    if (
      isOccupiedByBuilding(ctx, side, z, 1.5) ||
      isInCourtAlley(ctx, side, z, 1.5)
    ) {
      mesh = new THREE.Group(); // 空占位，不渲染长椅
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
    // 长椅长边沿 z（马路方向），坐面统一朝向赛道中心：
    // 模型默认正面朝左(-x)，故左侧(side=-1)需转 180° 使坐面朝 +x(中心)，
    // 右侧(side=+1)默认正面朝 -x 即已朝向中心，无需旋转。
    // 位置紧贴墙壁（墙在 ±10.5），略微内移避免与墙共面 z-fighting。
    mesh.rotation.y = side < 0 ? Math.PI : 0;
    mesh.position.set(side * 9.9, 0, z);
    mesh.userData.decorKind = "bench"; // 供「球场巷道口清理」按类型识别
    placed = true; // 自行定位，跳过通用定位逻辑
  } else if (r < 0.74) {
    // STOP 标识牌：靠近马路（x=±7.2），面向镜头（rotation.y=0，牌面朝 +z/-z 即朝向赛道）
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
    mesh.rotation.y = -Math.PI / 2; // 模型默认牌面朝 +x，转 -90° 使牌面朝镜头（赛道方向）
    mesh.position.set(side * 7.2, 0, z);
    placed = true; // 自行定位，跳过通用定位逻辑
  } else if (r >= 0.8 && r < 0.86) {
    // 绿色垃圾桶（带盖）
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
  } else {
    // 其余槽位不生成装饰（降低路边垃圾桶等密度）
    mesh = new THREE.Group();
  }
  // 行人分支：以随机概率在某装饰槽位生成马路边行走的行人
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
      // 回退：程序化街头青年
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
    ped.scale.setScalar(1.12); // 行人稍微调大一点点（与玩家/车辆比例更协调）
    const px = side * 8.8;
    ped.position.set(px, 0, z);
    ped.rotation.y = Math.random() < 0.5 ? 0 : Math.PI;
    st.pedestrians.push(ped);
    mesh = ped;
    placed = true;
  } else {
    mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  }
  // 通用定位（行人已在分支内自行定位，跳过）
  if (!placed && r < 0.34) {
    mesh.rotation.y += Math.random() < 0.5 ? 0 : Math.PI;
    mesh.position.set(side * 8.2, 0, z);
    mesh.userData.decorKind = "car"; // 供「路灯避让停车位」识别
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

// 动态回收 + 补充：把越过相机后方的装饰移除，并在最远处持续补新随机装饰，
// 保证装饰带不断向前涌现，绝不重复固定组合。
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
  // 移除越界的（用 filter 重建数组）
  st.cityDecor = st.cityDecor.filter((m) => m.position.z <= 18);
  // 在远端补充新装饰，直到最远的装饰达到目标纵深（-130 左右）
  let minZ = Infinity;
  for (const m of st.cityDecor) if (m.position.z < minZ) minZ = m.position.z;
  if (!isFinite(minZ)) minZ = 20;
  while (minZ > -130) {
    const step = 7 + Math.random() * 3.5;
    const nz = minZ - step;
    const side = Math.random() < 0.5 ? -1 : 1;
    // 巷口范围内不放任何人行道装饰（会堵住"通往另一条街"的开口）→ 跳过该位置
    if (
      isInAlleyMouth(ctx, side, nz, 0.5) ||
      isInCourtAlley(ctx, side, nz, 1.2)
    ) {
      minZ = nz;
      continue;
    }
    const mesh = makeRandomDecor(ctx, side, nz);
    mesh.visible = ctx.isStreetActive();
    ctx.scene.add(mesh);
    st.cityDecor.push(mesh);
    minZ = nz;
  }
  // 规律路灯带同步回收 + 补充
  recycleStreetLights(ctx, move);
}

// 墙后实体楼房（替代原天际线占位）：两侧墙后各排一列楼房，沿街滚动。
// 楼房用 building1~4.glb 随机复用，随机高度缩放与左右侧，作为街头远景天际线。
// 检测建筑模型「门面」的局部方向(单位向量, 以 x/z 为分量)：
// 优先用材质名含 door 的网格顶点平均位置定位门；其次 window；
// 都没有则退化为面积法(取面积最大的立面所在正轴)。放置时让该方向朝向马路。
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
    // 量化到最近的水平主轴(X 或 Z)，保证建筑严格平行于马路（旋转后立面平行街道），
    // 避免因门/窗几何略微不对称导致方向偏斜、建筑不平行。
    if (Math.abs(front.x) >= Math.abs(front.y)) {
      return new THREE.Vector2(Math.sign(front.x) || 1, 0);
    }
    return new THREE.Vector2(0, Math.sign(front.y) || 1);
  }
  // 兜底：面积法确定主导水平轴，取正方向
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

// 修复篮球场「球场线」层(Markngs)的 UV 退化缺陷：
// 该层是覆盖整场的单个 quad，全部顶点 UV=(0,0)（FBX→glTF 导出时丢失），
// 导致只采样线稿贴图左上角的纯白不透明像素 → 线区整面显示为白块。
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
    // 确认退化：所有 UV 严格为同一常量
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
    // 平面在局部 XY 面内（POSITION z 恒 0），XY 归一化重建 UV。
    // 贴图为「竖画」的半场线稿：u 轴 = 球场长轴(局部 y)，v 轴 = 短轴(局部 x)，
    // 且底线在 u=0、中线在 u=1（三分弧顶 u≈0.47、禁区 u≈0.2~0.36）。
    // 用 u = 2t + MirroredRepeat 拼出完整球场：
    //   远半场(正放)：底线(0) → 三分弧 → 中线(1)；近半场(镜像)：中线 → 三分弧 → 底线。
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const w = Math.max(bb.max.x - bb.min.x, 1e-6);
    const h = Math.max(bb.max.y - bb.min.y, 1e-6);
    const newUV = new Float32Array(posAttr.count * 2);
    for (let i = 0; i < posAttr.count; i++) {
      newUV[i * 2] = ((posAttr.getY(i) - bb.min.y) / h) * 2; // u = 2t（镜像平铺，底线在 u=0）
      newUV[i * 2 + 1] = (posAttr.getX(i) - bb.min.x) / w; // v ← 短轴 x
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(newUV, 2));
    uvAttr.needsUpdate = true;
    // 半场线稿需要「镜像平铺」才能拼出完整球场（REPEAT 只能平移重复，方向会对不齐）。
    // 注意：wrapS 是 GPU sampler 状态，three.js 仅在纹理（重）上传时应用——
    // 必须置 needsUpdate=true 触发重传，否则仍是 glTF sampler 的 REPEAT，
    // 表现为「三分线出现在中缝、远半场整体颠倒」（镜像平铺完全未生效）。
    for (const mm of mats) {
      if (mm instanceof THREE.MeshStandardMaterial && mm.map) {
        mm.map.wrapS = THREE.MirroredRepeatWrapping;
        mm.map.wrapT = THREE.MirroredRepeatWrapping;
        mm.map.needsUpdate = true; // 关键：触发 sampler 重传，否则修改被静默忽略
      }
    }
  });
}

// ==================== 墙外远景层（视差纵深） ====================

/**
 * 远景楼外墙贴图（模块级缓存）：复用灰泥质感贴图，**不含窗户**。
 *
 * 关键改动：窗户从「墙贴图里的深色方块」改为独立的玻璃几何（见 buildBackdropWindowQuads）。
 * 之前窗户画在墙贴图上，而整张贴图会被每个实例的 instanceColor 相乘染色，
 * 于是窗洞被"墙色 × 深灰"压成纯黑一块，远看就是一个个黑方格。拆开之后，
 * 玻璃用自己的浅蓝灰贴图与自己的实例色，永远比墙亮，才像玻璃。
 */
let backdropWallTex: THREE.Texture | null = null;
function getBackdropWallTexture(): THREE.Texture {
  if (!backdropWallTex) backdropWallTex = makeFacadeTexture("wall");
  return backdropWallTex;
}

/** 远景楼外墙变体：灰泥涂料 / 红砖。砖墙用自带颜色的贴图，配色只做明暗抖动 */
type WallVariant = "plaster" | "brick";
let backdropBrickTex: THREE.Texture | null = null;
function getBackdropBrickTexture(): THREE.Texture {
  if (!backdropBrickTex) backdropBrickTex = makeBrickTexture();
  return backdropBrickTex;
}

/**
 * 远景楼玻璃贴图（贴在窗四边形上，UV 0..1 不再平铺）：
 * 中心是带上亮下暗天空反射的浅蓝灰玻璃，四周压一圈深色窗框，底部一条亮窗台。
 * 远景里这圈深框读作「凹进去的窗洞」，比纯黑方块柔和得多。
 */
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
  // 窗框：深蓝灰，向内收一圈。**必须细**：侧立面在街道尽头会被透视压成细条，
  // 粗窗框会把玻璃挤没，只剩半个"框"，看上去就像断掉的窗。
  c.strokeStyle = "rgba(56,66,78,0.85)";
  c.lineWidth = 3;
  c.strokeRect(1.5, 1.5, S - 3, S - 3);
  // 中竖梃：一扇窗分成两格，远景也有结构感
  c.fillStyle = "rgba(62,72,84,0.55)";
  c.fillRect(S / 2 - 1, 3, 2, S - 6);
  // 窗台高光：下沿一道亮线，强化"窗"的识别度
  c.fillStyle = "rgba(255,255,255,0.7)";
  c.fillRect(1.5, S - 6, S - 3, 3);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  backdropGlassTex = t;
  return t;
}

/** 远景楼型：5 档固定尺寸（宽/高/深 + 是否有女儿墙），几何在模块级缓存复用 */
type BackdropKind = { w: number; h: number; d: number; parapet: boolean };
const BACKDROP_KINDS: BackdropKind[] = [
  { w: 7, h: 8, d: 9, parapet: true }, // 矮
  { w: 9, h: 12, d: 10, parapet: false }, // 中
  { w: 10, h: 16, d: 11, parapet: true }, // 中高
  { w: 11, h: 21, d: 12, parapet: false }, // 高
  { w: 9, h: 27, d: 11, parapet: true }, // 超高
];
/** 墙贴图一格对应的世界尺寸（灰泥/红砖纹理重复密度） */
const BACKDROP_TILE = 6;
/** 立面开窗模数：层高 / 前后开间 / 侧向开间 / 窗洞尺寸 */
const BD_FLOOR_H = 3;
const BD_BAY_Z = 2.6;
const BD_BAY_X = 3.4;
const BD_WIN_W = 1.45;
const BD_WIN_H = 1.7;
/** 女儿墙：高 / 单边厚 */
const BD_PARAPET_H = 0.8;
const BD_PARAPET_T = 0.4;

let backdropWallMat: THREE.MeshStandardMaterial | null = null;
let backdropBrickMat: THREE.MeshStandardMaterial | null = null;
let backdropGlassMat: THREE.MeshStandardMaterial | null = null;
let backdropRoofMat: THREE.MeshStandardMaterial | null = null;
/** 楼体 / 窗几何缓存（两套材质 → 两个 InstancedMesh；屋顶配件另算） */
const backdropBodyGeos: (THREE.BufferGeometry | undefined)[] = [];
const backdropGlassGeos: (THREE.BufferGeometry | undefined)[] = [];

/** 把 BoxGeometry 每个面的 UV 按世界尺寸缩放，使贴图密度与楼体尺寸无关（否则纹理被拉长） */
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
 * 远景楼窗户四边形：按「层高 3 单位 + 开间」的模数，在四个立面上排窗。
 *
 * 注意侧立面（±x）在街道尽头的楼上是接近侧视的，窗户会被透视压成细条；
 * 因此玻璃贴图的窗框刻意做得很细（见 getBackdropGlassTexture），
 * 压扁后读到的是"一扇窄窗"而不是"断掉的窗框"。
 */
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
  const OUT = 0.06; // 贴在墙外一点点，避免与楼体共面 z-fighting
  // 前后立面（法线 ±z）：沿 x 排开间
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
        if (Math.random() < 0.06) continue; // 少量开间是实墙，避免整面一模一样
        add(x, cy, z, BD_WIN_W, BD_WIN_H, rotY);
      }
    }
  }
  // 侧立面（法线 ±x）：沿 z 排开间（开间略宽，侧视压扁后仍有明显窗形）
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

/** 取（并缓存）某个楼型的几何：楼体 + 女儿墙（墙材质）、窗四边形（玻璃材质） */
function getBackdropGeometry(k: number): {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
} {
  const K = BACKDROP_KINDS[k];
  let body = backdropBodyGeos[k];
  if (!body) {
    const parts: THREE.BufferGeometry[] = [];
    const box = new THREE.BoxGeometry(K.w, K.h, K.d);
    box.translate(0, K.h / 2, 0); // 几何底部贴地，实例只需按 y=0 摆放
    scaleBoxUV(box, K.w, K.h, K.d);
    parts.push(box);
    if (K.parapet) {
      // 女儿墙属于墙体本身（该和墙同砖同色），仍走墙材质
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
// 以前屋顶只有「水箱」一种，而且形状/颜色/位置全部写死：同一个楼型的每个实例，
// 水箱都在同一个位置、同一个大小、同一个颜色，一眼就能看出是复制粘贴。
// 现在改成"配件库 + 随机摆放"：
//   · 7 种配件（水塔/机房/空调机组/排气管/天线/太阳能板/烟囱）；
//   · 每个楼顶 1 个主件，45% 概率再加 1 个小件；
//   · 位置在屋顶范围内随机、朝向随机、整体比例随机、实例色微随机；
//   · 水箱还会在"木桶（暖棕）"和"镀锌钢罐（冷灰）"之间随机。
// 配件各自独立成 InstancedMesh（一套顶点色材质），画质不变、开销只有几次 draw call。

/** 屋顶装饰物种类 */
type RoofPropKind =
  | "tank" // 屋顶水塔
  | "hut" // 楼梯间 / 屋顶机房
  | "hvac" // 空调机组
  | "pipe" // 排气管
  | "antenna" // 电视天线
  | "solar" // 太阳能板
  | "chimney"; // 烟囱

/** 配件配色（顶点色）：配件是"外挂件"，不能跟着墙体贴图走 */
const ROOF_COLOR = {
  steel: 0x6f6a63, // 钢支架 / 平台 / 横撑
  tank: 0x8a6b52, // 木质水箱罐体（做旧棕）
  tankBand: 0x6b5340, // 加强箍
  tankCap: 0x7a5c46, // 锥形顶盖
  concrete: 0xb8b4ab, // 楼梯间 / 屋顶机房
  door: 0x54504a, // 出屋面门
  pipe: 0x8d8a84, // 排气管 / 天线杆
  ac: 0xa9aeb0, // 空调机组外壳
  acDark: 0x8b9092, // 空调风扇口
  solar: 0x33465c, // 太阳能板
  chimney: 0x8d7a68, // 烟囱砖体
};

const roofPropGeos: Partial<Record<RoofPropKind, THREE.BufferGeometry>> = {};

/** 取（并缓存）某种屋顶配件的几何：原点居中、底面在 y=0，便于直接摆在屋顶面上 */
function getRoofPropGeometry(kind: RoofPropKind): THREE.BufferGeometry {
  const cached = roofPropGeos[kind];
  if (cached) return cached;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: number) => {
    paintGeo(g, color);
    parts.push(g);
  };
  if (kind === "tank") {
    // 水塔：四腿钢架 + 平台 + 略收口罐体 + 两道铁箍 + 锥顶
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
    // 楼梯间 / 屋顶机房：混凝土方盒 + 门 + 出挑檐口
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
    // 空调机组：矮方箱 + 顶部风扇口 + 侧边管
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
    // 排气管：一粗一细两根 + 顶部防雨帽
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
    // 电视天线：细杆 + 三根递减横杆 + 底座
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
    // 太阳能板：一块倾斜面板 + 四根矮支架
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
    // 烟囱：砖体 + 顶帽
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

/** 主件权重表（水塔仍是最常见的 LA 楼顶剪影） */
const ROOF_PROP_WEIGHTS: Array<[RoofPropKind, number]> = [
  ["tank", 0.22],
  ["hut", 0.18],
  ["hvac", 0.17],
  ["pipe", 0.14],
  ["antenna", 0.11],
  ["solar", 0.1],
  ["chimney", 0.08],
];
/** 附带的小件（整体更小、不抢主件） */
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
  c.offsetHSL((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.2);
  if (kind === "tank" && Math.random() < 0.38) {
    // 钢罐：压暗红/绿通道，整体偏冷灰
    c.r *= 0.82;
    c.g *= 0.9;
    c.b *= 1.05;
  }
  return c;
}

/**
 * 为一栋楼随机生成屋顶配件（世界坐标）。
 * 位置在「屋顶可用范围」内随机，所以同一个楼型的每栋楼摆放都不一样。
 */
function makeRoofProps(
  K: BackdropKind,
  s: number,
  bx: number,
  bz: number
): Array<{ kind: RoofPropKind; m: THREE.Matrix4; c: THREE.Color }> {
  const out: Array<{ kind: RoofPropKind; m: THREE.Matrix4; c: THREE.Color }> = [];
  const inset = K.parapet ? BD_PARAPET_T + 0.35 : 0.35;
  const halfW = Math.max(0.4, K.w / 2 - inset);
  const halfD = Math.max(0.4, K.d / 2 - inset);
  const place = (kind: RoofPropKind, scaleMul = 1) => {
    // 占地按缩放后的实际尺寸算，保证配件整体压在屋顶范围内、不悬空到楼外
    const foot = ROOF_PROP_FOOT[kind] * scaleMul;
    const hx = Math.max(0, halfW - foot);
    const hz = Math.max(0, halfD - foot);
    const px = bx + (Math.random() * 2 - 1) * hx * s;
    const pz = bz + (Math.random() * 2 - 1) * hz * s;
    const rotY = Math.random() * Math.PI * 2;
    // 竖直比例随机：水塔有时矮胖、有时瘦高
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
  // 小件：缩到 75%。机房占地大，再塞小件容易穿模，跳过
  if (main !== "hut" && Math.random() < 0.45) {
    place(ROOF_SMALL_PROPS[Math.floor(Math.random() * ROOF_SMALL_PROPS.length)], 0.75);
  }
  return out;
}

/**
 * 墙外远景层：两排程序化楼群，按 <1 的系数滚动形成视差纵深。
 *   · 近排（x≈28，8~12 高）：填补主楼之间的大缝隙，避免隔着缝直接看到天空；
 *   · 远排（x≈44，16~27 高）：城市天际线剪影，颜色向雾色混合，产生空气透视。
 *
 * 三个关键点：
 *  1) 楼体与窗户用两套材质：楼体灰泥/红砖墙 + 实例染色，窗户独立玻璃，
 *     因此窗户永远是亮的，不会像以前那样被染色成黑块；
 *  2) 屋顶装饰物走"配件库 + 随机摆放"（见 makeRoofProps），
 *     不再是一模一样的水塔复制粘贴；
 *  3) 布点铺【两个】回绕周期。远景是整体平移的，只铺一个周期时，平移超过
 *     (周期 − 可视深度) 后远端就会空出来，回绕瞬间又整片补回；加速道具下
 *     表现为"远处房子突然冒出来"。铺两个周期后任何平移量下远端都有覆盖，
 *     且两周期内容严格相同，回绕前后画面完全重合。
 */
export function buildBackdrop(ctx: SceneContext) {
  const st = ctx.street;
  // 幂等：只从场景摘除（几何/材质是模块级缓存，跨重建复用，不在这里释放）
  for (const o of st.backdrop) ctx.scene.remove(o);
  st.backdrop.length = 0;

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
      // 靠几何偏移不够稳，再叠一层 polygonOffset 把窗面稳定顶到墙面之前。
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
  }
  if (!backdropRoofMat) {
    // 屋顶配件：颜色全部来自几何顶点色（水塔/机房/空调/管道各不相同），
    // 不贴墙贴图 —— 否则红砖楼的水箱会变成砖砌的。
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
  // 低饱和城市色板（奶白/沙色/陶土/灰蓝/鼠尾草/灰粉）：远景要"退后"，但不能退成一片灰白
  const palette = [
    0xd8c7ab, 0xc9a184, 0xbcc7cd, 0xc7c0ae, 0xa9b3ab, 0xcdb9b2, 0xb0a596,
  ];
  const layers = [
    // 近排：矮楼填缝
    {
      parallax: 0.78,
      kinds: [0, 1],
      nearX: 28,
      xJit: 5,
      gapMin: 2.5,
      gapMax: 7,
      tint: 0.18,
      brickRatio: 0.3, // 红砖楼占比
    },
    // 远排：高楼天际线
    {
      parallax: 0.5,
      kinds: [2, 3, 4],
      nearX: 44,
      xJit: 10,
      gapMin: 2,
      gapMax: 8,
      tint: 0.5,
      brickRatio: 0.42,
    },
  ];

  for (const L of layers) {
    // 按「楼型 + 外墙变体」分组：每种组合一个楼体 InstancedMesh + 一个窗户 InstancedMesh
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
    // 屋顶配件按种类汇总（每类一个 InstancedMesh）
    const propGroups = new Map<
      RoofPropKind,
      Array<{ m: THREE.Matrix4; c: THREE.Color }>
    >();

    for (const side of [-1, 1]) {
      // 先生成一个周期的布点，再整段复制到下一个周期，保证严格周期一致
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
        const near = L.nearX + Math.random() * L.xJit; // 近侧边缘，保证不侵入主楼
        const variant: WallVariant =
          Math.random() < L.brickRatio ? "brick" : "plaster";
        const c = new THREE.Color();
        if (variant === "brick") {
          // 砖墙：贴图自带红砖色，实例色接近白、只做轻微明暗抖动，避免把红砖染成土色
          const t = 0.9 + Math.random() * 0.2;
          c.setRGB(t, t, t);
          c.lerp(fogColor, L.tint * 0.55);
        } else {
          c.set(palette[Math.floor(Math.random() * palette.length)]);
          c.lerp(fogColor, L.tint * (0.7 + Math.random() * 0.6));
        }
        // 玻璃：接近白、只做很轻的明暗偏移，避免被楼体色"染脏"成深色方块
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
      for (let rep = 0; rep < 2; rep++) {
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
            // 平移副本：只改 z 平移量，其余保持一致
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
        im.castShadow = false; // 远景不投影：看不到影子，省一次 shadow pass
        im.receiveShadow = false;
        im.frustumCulled = false; // 整体平移，包围球会失效（实例数不多，直接不裁剪）
        im.visible = ctx.isStreetActive();
        im.userData.parallax = L.parallax;
        im.userData.cycle = cycle;
        ctx.scene.add(im);
        st.backdrop.push(im);
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
      im.visible = ctx.isStreetActive();
      im.userData.parallax = L.parallax;
      im.userData.cycle = cycle;
      ctx.scene.add(im);
      st.backdrop.push(im);
    });
  }
}

export function buildBuildings(ctx: SceneContext) {
  const st = ctx.street;
  if (ctx.models.buildings.length === 0) return; // 模型未就绪则跳过
  // 幂等清空上一批楼房/球场 mesh，避免重复调用导致 buildings 累积与旧球场残留。
  if (st.buildings.length) {
    for (const b of st.buildings) ctx.scene.remove(b.mesh);
    st.buildings = [];
  }
  // 清除上一批球场「绕行围墙 + 过道地砖」（重建时重新生成，避免累积）
  for (const m of st.courtWraps) ctx.scene.remove(m);
  st.courtWraps.length = 0;
  for (const m of st.courtWalkways) ctx.scene.remove(m);
  st.courtWalkways.length = 0;
  // 复位墙段（正常化可见性与缩放），保证本函数可重复调用。
  for (const w of st.walls) {
    w.visible = true;
    // 墙是 BoxGeometry，长度沿局部 z（见 buildStreetWalls），复位须用 scale.z
    w.scale.z = (w.userData.baseScaleZ as number) ?? 1;
    w.position.z = (w.userData.baseZ as number) ?? w.position.z;
    w.userData.courtGap = false;
    // 墙体现在使用「六面材质数组」（两侧贴砖纹、其余纯色），需遍历处理；
    // 兼容单材质写法以防将来回退。
    const mats = Array.isArray(w.material) ? w.material : [w.material];
    for (const mm of mats) {
      const mat = mm as THREE.MeshStandardMaterial;
      if (mat?.map) mat.map.repeat.x = 1; // 贴图比例同步复位，防切割 repeat 残留
    }
  }
  // 楼房与墙段对齐：z 落在墙段中心网格上，形成「墙-楼-墙」交替街景。
  const segLen = STREET.wallSegLen;
  const wallX = 10.5; // 墙所在 x 绝对值，也是楼房临街面要对齐的位置
  const recycleZ = 42; // 与墙滚动回收阈值一致
  const baseScale = 0.82; // 整体缩放，与行人/车辆形成合理比例
  const minGap = 22; // 同侧相邻楼房在 z 方向的最小间隙，杜绝重叠（含安全余量）
  const maxGap = 30; // 起始随机错位幅度
  const extraGap = 18; // 相邻楼之间额外随机拉开的间隙上限，形成错落天际线
  // 关键不变量：布局跨度必须 < wallCycle。回绕会把建筑折叠进长度 = wallCycle 的
  // 窗口，若布局更长，布局首尾会在窗口内撞在一起（表现为「跑一段后固定位置重叠」）。
  // 故起点上限 = recycleZ − segLen/2 − 2（不开局即回绕），终点下限见 while 条件。
  const zHi = recycleZ - segLen / 2 - 2; // ≈37，起始 z 上限
  const zLo = recycleZ - STREET.wallLen + 4; // ≈-176，布局远端下限（楼远侧不得越过）
  // 预检测每个源模型「门面」的局部方向(单位向量)，放置时让门朝向赛道中心。
  const frontDirs = ctx.models.buildings.map((m) =>
    detectBuildingFrontDir(ctx, m)
  );
  // 左右两侧各自独立、随机地沿街铺设，z 带随机偏移形成错落天际线；
  // 相邻楼按真实（旋转+缩放后）z 半深推算间距，保证不重叠。
  let courtPlaced = 0; // 本批生成中篮球场触发的累计次数（两侧合计）
  st.courtZSlots = []; // 清空球场区间记录，供巷口避让
  for (const side of [-1, 1]) {
    let z = zHi - Math.random() * maxGap; // 起始 z 随机错位（向下偏移，保证 < 回绕阈值）
    let prevZ: number | null = null; // 上一栋（更靠近相机的）z 中心
    let prevHalfD = 0; // 上一栋的 z 半深
    let placedSide = 0; // 本侧楼位计数（球场节奏按每侧独立计）
    // 球场触发相位：左右错开 2 个楼位，避免异侧球场 z 对齐、隔着马路遥遥相对。
    const courtPhase = side < 0 ? 2 : 4;
    // 终止条件：楼的「远侧边缘」(z−20，20≈最大占位半深) 不得越过 zLo。
    while (z - 20 > zLo) {
      placedSide++;
      // 球场触发：每侧每 5 个楼位 1 个，配合左右相位错开，任两个球场都保持足够距离。
      const useCourt = !!ctx.models.basketball && placedSide % 5 === courtPhase;
      if (useCourt) courtPlaced++;
      let b: THREE.Object3D;
      let dir = new THREE.Vector2(0, 1); // 占位，仅楼房分支会重新赋值并使用
      let isCourt = false; // 本栋是否为篮球场（用于下方占位/对齐分支）
      let wbZ0 = 0; // 球场放置后的真实世界 z 下界（仅球场有效）
      let wbZ1 = 0; // 球场放置后的真实世界 z 上界
      if (useCourt) {
        const court = ctx.models.basketball!; // 上面已用 !! 校验非空
        b = court.clone(true);
        isCourt = true;
        // 篮球场长边已由校准阶段对齐 z（平行于马路），此处无需再旋转。
      } else {
        const pick = Math.floor(Math.random() * ctx.models.buildings.length);
        const src = ctx.models.buildings[pick];
        b = src.clone(true);
        dir = frontDirs[pick];
      }
      // 保存克隆自带的初始位置 initPos：后续 position.set 是「替换」而非「叠加」，
      // 新包围盒 = 旧box + (newPos − initPos)，不补偿会整体偏移 −initPos（各模型不同），
      // 导致逻辑 z 与视觉 z 错位、临街面/贴地对不齐。所有位置计算都必须带上 initPos。
      const initPos = b.position.clone();
      if (isCourt) {
        // 篮球场渲染修复：
        // a) 地板是同一 Plane.030 的两层（BCourt_Markngs 透明线条层 + Concrete 不透明地面层）
        //    且几乎共面 → 内部 z-fighting。透明层不写深度 + renderOrder 提后即可稳定叠加。
        // b) 球场地板与地面同高（y=0），模型内部闪烁已由 a) 解决。
        // c) 地板是大扁平面，投影只会产生 shadow acne → 球场不投影。
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
                mm.depthWrite = false; // 透明层不写深度，杜绝与地板共面争深度
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
      // 先按当前(克隆后、尚未放置)状态计算一次基础包围盒，
      // 用于篮球场「压高到围墙高度」的等比缩放及后续精确占位。
      b.updateMatrixWorld(true);
      const baseBox = new THREE.Box3();
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          const tmp = m.geometry.boundingBox!.clone();
          tmp.applyMatrix4(m.matrixWorld);
          baseBox.union(tmp);
        }
      });
      const baseY = Math.max(baseBox.max.y - baseBox.min.y, 0.01); // 模型原始高度
      if (isCourt) {
        // 篮球场与地面同高：底面精确落在 y=0（不再抬高 0.25），
        // 等比缩放使顶面 = 围墙高度 4.5，与墙顶齐平。
        const wallH = 4.5;
        const s = wallH / baseY; // 等比：最终高度 = 4.5，底面贴地、顶面与墙顶齐平
        b.scale.setScalar(s);
      } else {
        // 整体缩放(baseScale) + 随机高度变化，基准已在加载时缩放到 targetLen=16 高。
        // 高度带整体上移（0.85~1.5 → 1.15~1.85）：让楼房明显高出 4.5 的围墙，
        // 露出高低错落的天际线填充天空，消除「越过墙顶就是一片空蓝天」的空旷感。
        // 随机幅度保持不变（0.5），故错落层次不受影响。
        const h = 1.15 + Math.random() * 0.5;
        b.scale.setScalar(baseScale * h);
      }
      if (isCourt) {
        // 篮球场长边已沿 z（平行于马路），wrapper 不旋转
        b.rotation.y = 0;
      } else {
        // 让建筑门面(局部门方向向量 fx,fz)朝向赛道中心 (Tx,0)：
        // Tx = side<0 ? +1(朝+x) : -1(朝-x)。严格平行赛道、不加随机旋转。
        const fx = dir.x;
        const fz = dir.y; // Vector2 的 y 分量即模型局部 z 方向
        const Tx = side < 0 ? 1 : -1;
        let theta = Math.atan2(fz, fx);
        if (Tx < 0) theta += Math.PI;
        b.rotation.y = theta;
      }
      // 先按当前旋转/缩放计算模型包围盒，取得 x 方向半宽与 z 方向半深，
      // 建筑整体位于墙外侧（|x|>wallX），临街面(最靠赛道中心的一侧)紧贴墙，略微内移
      // 避免与墙共面导致的深度冲突(z-fighting)，从而从赛道看刚好盖住墙壁、临街面完整展示。
      b.updateMatrixWorld(true);
      // 用遍历所有网格几何的方式计算可靠包围盒（比 setFromObject 更稳定，避免空/异常节点干扰）
      const box = new THREE.Box3();
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          const tmp = m.geometry.boundingBox!.clone();
          tmp.applyMatrix4(m.matrixWorld);
          box.union(tmp);
        }
      });
      const halfD = Math.max(box.max.z - box.min.z, 0.01) / 2; // 真实 z 半深（占位半径）
      const center = new THREE.Vector3();
      box.getCenter(center); // 模型几何中心（局部原点下的偏移），用于精确居中放置
      // 篮球场专用：计算「围栏主体」的 z 范围，用于决定围墙让位范围。
      // 需要排除两类几何：
      //  a) 贴地地面(Concrete)：它 z 向比围栏更长，若按它让位，球场两端会露出
      //     「墙已让位、却只有贴地地面」的天空缝；
      //  b) 敞开的围栏门(Fence_Front_Door)：门是打开状态、伸向球场内部，只在**远端**
      //     把包围盒多拉长约 1.05，若算进去会让位范围超出围栏端，
      //     表现为「近端严丝合缝、远端总有一条天空缝」的固定不对称现象。
      // 故只取「高且贴近临街面」的围栏竖面：排除门（远离临街面）与薄顶板（不向下延伸）。
      let courtTallHalfD = halfD;
      let courtTallMinX: number | null = null;
      let courtTallMaxX: number | null = null;
      let courtTallMinZ: number | null = null; // 围栏 z 下界（远侧）
      let courtTallMaxZ: number | null = null; // 围栏 z 上界（近侧）
      if (isCourt) {
        const tallBox = new THREE.Box3();
        const tallThreshold = box.min.y + (box.max.y - box.min.y) * 0.25; // 离地 1/4 高以上算"竖直结构"
        const lowLimit = box.min.y + (box.max.y - box.min.y) * 0.3; // 需向下延伸到此高度以下
        // 收集候选网格（先做高/低筛选，再统一按 x 剔除门）
        const candidates: THREE.Box3[] = [];
        b.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !m.geometry) return;
          // 按名称直接排除门（模型内门节点名为 Fence_Front_Door*）
          const meshName = m.name ?? "";
          const matName =
            (Array.isArray(m.material) ? m.material[0] : m.material)?.name ??
            "";
          if (/door/i.test(meshName) || /door/i.test(matName)) return;
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          const tmp = m.geometry.boundingBox!.clone();
          tmp.applyMatrix4(m.matrixWorld);
          if (tmp.max.y > tallThreshold && tmp.min.y < lowLimit) {
            candidates.push(tmp);
          }
        });
        // 二次校验：围栏竖面应「贴近临街面」。取候选的最小 x 作为临街面参考，
        // 剔除明显远离它的网格（如伸向场内的门、篮架等），避免让位范围被撑大。
        if (candidates.length) {
          const refMinX = Math.min(...candidates.map((c) => c.min.x));
          const xSpan = box.max.x - box.min.x;
          const xTol = xSpan * 0.12; // 允许 12% 的容差
          for (const c of candidates) {
            if (Math.abs(c.min.x - refMinX) <= xTol) tallBox.union(c);
          }
        }
        if (!tallBox.isEmpty()) {
          courtTallHalfD = (tallBox.max.z - tallBox.min.z) / 2;
          courtTallMinX = tallBox.min.x; // 围栏的临街面 x（用于精确对齐墙壁）
          courtTallMaxX = tallBox.max.x;
          // 记录围栏真实 z 边界（相对模型原点）。注意这里是「局部原点下」的坐标，
          // 而放置后模型会平移，故后续用 (值 - center.z) 换算成「以逻辑 z 为中心」的偏移。
          courtTallMinZ = tallBox.min.z;
          courtTallMaxZ = tallBox.max.z;
        }
      }
      const pad = 1.15; // 安全系数，补偿估算偏差，确保绝不重叠
      const safeHalfD = halfD * pad;
      // 防重叠：新楼（更远，z 更小）的近侧 必须 <= 上一栋远侧 - minGap
      // 用真实世界区间比较，避免模型中心偏移导致的误判
      if (prevZ !== null) {
        const prevFar = prevZ - prevHalfD; // 上一栋远离相机的一侧 z
        const maxZ = prevFar - minGap - safeHalfD; // 本栋中心 z 允许的上限（含安全余量）
        if (z > maxZ) z = maxZ; // 推远，杜绝与上一栋 z 重叠
      }
      // 硬阻止楼房侵入本侧已放置的篮球场：若本栋 z 区间与任一球场 slot 重叠，
      // 强制跳到该 slot 的「远相机侧之外」。注意存储约定：z0 = 中心 - 半深(远侧, z 更小)，
      // z1 = 中心 + 半深(近侧, z 更大)，故跳到远侧之外应使用 z0 并继续减小(z -= ...)。
      // 用 while 循环反复排除，确保即使同侧有多个球场也能彻底避开（而非仅处理第一个）。
      if (!isCourt) {
        let guard = 0;
        let overlapping = true;
        while (overlapping && guard++ < 8) {
          overlapping = false;
          for (const s of st.courtZSlots) {
            if (s.side !== side) continue;
            if (z + safeHalfD > s.z0 && z - safeHalfD < s.z1) {
              z = s.z0 - minGap - safeHalfD; // 跳过整个球场，落到球场远侧之外(z 更小/更远)
              overlapping = true; // 推远后可能落入更远的另一个球场区间，需再次检查
            }
          }
        }
      }
      let posX: number;
      // 球场临街面位置：直接对齐沿街围墙所在平面(x=±wallX)，
      // 使球场紧贴赛道一侧，不留近侧通道（赛道上完全看不到球场与墙之间的空隙）。
      const courtFaceX = wallX;
      // 由「新 box = 旧box + (newPos − initPos)」反推 newPos.x，使临街边精确贴目标 x。
      if (isCourt) {
        // 按「围栏(竖直结构)」的临街面对齐 courtFaceX。
        // 用围栏而非整个 box 对齐：模型地面比围栏更靠外，若按 box 对齐，
        // 贴通道边的会是地面、围栏悬在更远处，斜看会露出退距空隙。
        const tallMinX = courtTallMinX ?? box.min.x;
        const tallMaxX = courtTallMaxX ?? box.max.x;
        posX =
          side < 0
            ? -courtFaceX - tallMaxX + initPos.x
            : courtFaceX - tallMinX + initPos.x;
      } else {
        // 楼房临街边紧贴墙根（内移 0.6 防与墙共面 z-fighting）
        const faceX = wallX - 0.8;
        posX =
          side < 0
            ? -faceX - box.max.x + initPos.x
            : faceX - box.min.x + initPos.x;
      }
      // 精确放置：x=临街边贴目标；y=贴地(box.min.y→0)；z=几何中心落在逻辑 z（防重叠基准）
      b.position.set(posX, -box.min.y + initPos.y, z - center.z + initPos.z);
      if (isCourt) {
        // 用【放置后的真实世界包围盒】重新确定球场 z 跨度，作为绕行墙与沿街墙断开的依据。
        // 这样得到的范围与玩家实际看到的球场边界完全一致（避免任何估算/基准差导致
        // 球场两侧巷道宽度不等、或墙断开位置与球场端部错位）。
        b.updateMatrixWorld(true);
        const wb = new THREE.Box3();
        b.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry) {
            if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
            const t2 = m.geometry.boundingBox!.clone();
            t2.applyMatrix4(m.matrixWorld);
            wb.union(t2);
          }
        });
        const wbCz = (wb.min.z + wb.max.z) / 2;
        const wbHalf = (wb.max.z - wb.min.z) / 2;
        wbZ0 = wbCz - wbHalf;
        wbZ1 = wbCz + wbHalf;
        // 球场布局：正面（临街侧）敞开不设墙，围墙在球场 z 范围断开，
        // 改由三段绕行围墙把球场包起来（两侧沿 x 的侧墙 + 后方沿 z 的横墙）。
        // 绕行范围直接用【放置后的真实世界包围盒】(wbZ0/wbZ1)：
        // 它与玩家实际看到的球场端部完全一致，因此球场两侧巷道宽度必然相等，
        // 沿街墙的断开位置也与球场端部严丝合缝。
        const cZ0 = wbZ0;
        const cZ1 = wbZ1;
        // 沿街围墙的断开范围【必须与 buildCourtWrap 中短边墙的 z 位置完全一致】：
        // 短边墙在 courtZ0−G / courtZ1+G，因此这里也要 ±G。
        // 若只按球场本体（不外扩 G）断开，沿街墙会提前 G 就结束、而短边墙还在 G 之外，
        // 中间正好空出 G 宽的一段没有任何墙 —— 从赛道上就是一个露出天空的缺口。
        const gapZ0 = cZ0 - STREET.courtGapWidth;
        const gapZ1 = cZ1 + STREET.courtGapWidth;
        const segHalf = STREET.wallSegLen / 2;
        for (const w of st.walls) {
          if (w.position.x > 0 !== side > 0) continue;
          let fullHidden = false;
          const sZ0 = w.position.z - segHalf;
          const sZ1 = w.position.z + segHalf;
          if (sZ1 <= gapZ0 || sZ0 >= gapZ1) continue; // 不重叠，保留整段
          const ovZ0 = Math.max(sZ0, gapZ0);
          const ovZ1 = Math.min(sZ1, gapZ1);
          if (ovZ1 - ovZ0 >= sZ1 - sZ0) {
            w.visible = false; // 整段落在球场范围内 → 隐藏（正面敞开）
            fullHidden = true;
          } else {
            // 部分重叠：保留球场范围之外的外侧子段（末端贴住绕行范围边界）
            const keepZ0 = sZ0 < gapZ0 ? sZ0 : gapZ1;
            const keepZ1 = sZ0 < gapZ0 ? gapZ0 : sZ1;
            const keepLen = keepZ1 - keepZ0;
            if (keepLen < 0.05) {
              w.visible = false;
            } else {
              const k = keepLen / STREET.wallSegLen;
              // 墙是 BoxGeometry(T, 4.5, segLen)：【长度沿局部 z、厚度沿局部 x】，
              // 因此裁剪必须缩放 scale.z。若误用 scale.x 会缩掉墙厚（0.06→更薄、看不见），
              // 而墙长保持 6 米不变 —— 长度与 position 不匹配，墙段整体错位、露出空隙。
              w.scale.z = k;
              w.position.z = (keepZ0 + keepZ1) / 2;
              // 墙体是材质数组，需遍历同步贴图比例
              const mats = Array.isArray(w.material)
                ? w.material
                : [w.material];
              for (const mm of mats) {
                const mat = mm as THREE.MeshStandardMaterial;
                if (mat?.map) mat.map.repeat.x = k;
              }
            }
          }
          // 仅【整段隐藏】的墙段才标记 courtGap：该标记会让场景模式切换时强制保持隐藏。
          // 若把「裁剪后仍保留一段」的墙段也标记，那些本应可见的墙段会被一起隐藏，
          // 在球场两侧各露出一个空隙（缺口宽度甚至大于通道宽）。
          if (fullHidden) w.userData.courtGap = true;
        }
        // 生成绕行围墙（两短边 + 远长边）与通道地砖。
        // 传入球场的【真实】z 范围(cZ0/cZ1)，绕行墙即立于这些边界上。
        // 深度须与「围栏」基准一致（courtFaceX 按围栏对齐）：
        // 若用整个 box 的深度，会把模型地面外探的部分也算进去，导致远长边墙偏外。
        const courtDepthX =
          courtTallMinX !== null && courtTallMaxX !== null
            ? courtTallMaxX - courtTallMinX
            : box.max.x - box.min.x;
        buildCourtWrap(ctx, side, wallX, courtFaceX, cZ0, cZ1, courtDepthX);
        // 记录本球场逻辑 z 区间到字段，供本侧楼房黑名单与巷口避让使用（保持原有 padding 约定）
        st.courtZSlots.push({ side, z0: z - safeHalfD, z1: z + safeHalfD });
      }
      b.visible = false; // 由 applySceneMode 控制显示
      ctx.scene.add(b);
      st.buildings.push({
        mesh: b,
        z,
        halfD: safeHalfD,
        castShadow: true,
        isCourt,
        // mesh.z = z - offZ 恒等式：滚动回绕全部基于逻辑 z（防重叠坐标系），
        // 彻底消除各模型 initPos/center 差异(δ)对回绕次序与落点间隔的侵蚀
        offZ: center.z - initPos.z,
      });
      // 记录并推进到下一栋：在上一栋基础上往远处拉一个「本栋半深 + 最小间隙 + 随机额外间隙」
      prevZ = z;
      prevHalfD = safeHalfD;
      z -= safeHalfD + minGap + Math.random() * extraGap;
    }
  }
  // 最终兜底：强制把所有落入球场 z 区间的楼房整体移到该球场远侧之外，确保绝无穿插。
  // 放置时的逐栋防重叠偶发偏差（如随机间隙叠加、多球场相邻）由这里一次性纠正。
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
          // s.z0 = 中心 - 半深 = 远侧(z 更小)；移到其远侧之外(继续减小 z)
          const newZ = s.z0 - bh - minGap;
          const dz = newZ - b.z;
          b.z = newZ;
          b.mesh.position.z += dz;
          again = true; // 移动后可能与更远的球场/楼重叠，需复检
        }
      }
    }
  }
  st.buildingCycle = STREET.wallLen; // 楼房滚动周期与墙一致，保持网格对齐
  st.buildingRecycleZ = recycleZ;
}

// 生成篮球场的「绕行围墙 + 通道地砖」。
// 最终布局（以右侧 side>0 为例，x 越大越远离赛道；G = 通道宽度 courtGapWidth）：
//   · 靠赛道的一侧（近赛道长边）敞开不设墙 —— 赛道上直接看到球场内部；
//     球场临街面直接贴在沿街围墙平面(courtFaceX=wallX)上，二者之间没有近侧通道；
//   · 其余三边用围墙相连，围成一个矩形把球场包住：
//       两条短边墙（沿 x，垂直于赛道）：z = cZ0−G 与 z = cZ1+G（球场 z 边界外扩 G），
//         x 从 courtFaceX 到 courtBackX+G（近端正好接在沿街围墙平面上，不伸入人行道）；
//       远长边墙（沿 z，平行于赛道）：x = courtBackX+G，连接两条短边墙；
//   · 短边墙位置 = 沿街墙断开边界，二者相接不留空隙；
//   · 球场三面（两侧短边 + 后方长边）与围墙之间均保留宽 G 的通道并铺人行道地砖。

export function buildCourtWrap(
  ctx: SceneContext,
  side: number,
  wallX: number,
  courtFaceX: number,
  courtZ0: number,
  courtZ1: number,
  courtDepthX: number
) {
  const st = ctx.street;
  const wallH = 4.5;
  const G = STREET.courtGapWidth; // 球场与绕行墙之间的通道宽度
  // 球场后沿（远长边墙所在的 x）
  const courtBackX = courtFaceX + courtDepthX;
  // 远长边墙的 x（球场后方再外扩 G）
  const backWallX = courtBackX + G;
  // 转角搭接量：短边墙近端向赛道侧多伸出一点，使它与沿街墙【实体相交】而非相切。
  // 沿街墙是位于 x=±wallX、厚度 T 的 Box，中线在 wallX；
  // 取 2T 作为搭接量：让位裁剪会让墙段略微位移，若搭接量只留 T，裁剪后可能只剩丝级
  // 重叠（透视下仍露缝）；留 2T 可稳定保证转角处有可见的重叠体积。
  const cornerLap = STREET.wallThickness * 2;
  // 短边墙沿 x 的范围：从球场临街面再向赛道侧伸出 cornerLap（插入沿街墙体内），
  // 到远长边墙(backWallX)止
  const wrapX0 = courtFaceX - cornerLap;
  const wrapX1 = backWallX;
  const wrapLenX = wrapX1 - wrapX0; // 短边墙沿 x 的长度
  // 短边墙的 z 位置：球场 z 边界再向外整整一个 G（即「通道的外沿」）。
  // 这样球场短边与短边墙之间保留一条宽 G 的通道（与外侧长边的巷子同理）；
  // 同时该位置与沿街围墙的断开边界(gapZ)完全一致 —— 短边墙恰好填住沿街墙的开口，
  // 二者相接、中间不留空隙。
  const wrapZ0 = courtZ0 - G;
  const wrapZ1 = courtZ1 + G;

  // 取该侧一段墙的贴图作为绕行墙纹理（保持与沿街围墙完全一致的砖纹/涂鸦风格）
  let srcTex: THREE.Texture | null = null;
  for (const w of st.walls) {
    if (w.position.x > 0 === side > 0) {
      // 墙体是材质数组：[0]/[1] 为贴砖纹的侧面材质
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
  if (!srcTex) return;

  // 绕行墙段工厂：沿指定方向生成一段墙（自动克隆贴图、按长度设 repeat 保持砖纹密度一致）
  // 绕行墙的厚度：与沿街墙统一（STREET.wallThickness），保证转角处厚薄一致。
  // 必须用有厚度的 Box 而非零厚度 Plane：短边墙垂直于赛道，玩家从赛道上斜看时
  // 看到的是它的【侧面截面】——零厚度平面在该视角下几乎不可见，
  // 视觉上就会在「短边墙与沿街墙之间」露出一条空隙。
  const WRAP_T = STREET.wallThickness;
  const addWrapWall = (
    len: number,
    cx: number,
    cz: number,
    alongZ: boolean
  ) => {
    if (len <= 0.05) return;
    // 让长边/短边的几何都沿「长度方向」展开，厚度方向为另一轴
    const geo = alongZ
      ? new THREE.BoxGeometry(WRAP_T, wallH, len)
      : new THREE.BoxGeometry(len, wallH, WRAP_T);
    const tex = srcTex!.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // 沿街墙段长度 = wallSegLen 时 repeat.x = 1，据此换算保持砖纹密度一致
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
    ctx.scene.add(m);
    st.courtWraps.push(m);
  };

  // 两条短边墙（沿 x 延伸，垂直于赛道），位于球场 z 边界外扩 G 处
  const midX = (wrapX0 + wrapX1) / 2;
  addWrapWall(wrapLenX, side * midX, wrapZ0, false);
  addWrapWall(wrapLenX, side * midX, wrapZ1, false);
  // 远长边墙（沿 z 延伸，平行于赛道），位于球场后方外扩 G 处，连接两条短边墙。
  // 两端各外伸 cornerLap，与短边墙端头重叠，消除转角处的发丝缝。
  addWrapWall(
    wrapZ1 - wrapZ0 + cornerLap * 2,
    side * wrapX1,
    (wrapZ0 + wrapZ1) / 2,
    true
  );

  // ---------- 通道地砖 ----------
  // 与人行道同款贴图；每块独立 clone 并按其尺寸设 repeat，保证砖缝密度一致。
  const SW_W = 3.5;
  const SW_L = 220;
  // sidewalkTex 由构造函数在 buildCityDecor 之前创建，此处必然已就绪
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
    m.position.set(cx, 0.04, cz); // 略高于人行道(0.035)，避免共面
    m.receiveShadow = true;
    m.userData.side = side;
    m.userData.courtWalkway = true;
    ctx.scene.add(m);
    st.courtWalkways.push(m);
  };
  // 通道呈 U 形（三面围合处才有通道，靠赛道一侧敞开不铺）；宽均为 G。
  // 0) 两条短边侧通道：位于球场 z 边界与短边墙之间（即那条「巷子」），
  //    沿 x 覆盖 [courtFaceX, backWallX]。
  //    向球场内侧多延伸 INNER_OVERLAP：球场模型的地面通常比围栏/包围盒端部更短，
  //    若地砖上边界正好停在 courtZ0/courtZ1（由整体包围盒决定），
  //    则「球场地面端部 ~ courtZ0」之间会露出一小条没有地板的空隙。
  //    向内重叠一段即可补上（地砖 y=0.04 高于球场地面，重叠不会穿模）。
  const INNER_OVERLAP = 1.5;
  const sidePaveLen = backWallX - courtFaceX;
  const sidePaveCx = (courtFaceX + backWallX) / 2;
  for (const [pz, dir] of [
    [courtZ0, -1],
    [courtZ1, 1],
  ] as Array<[number, number]>) {
    // 通道由「球场边界 − INNER_OVERLAP」延伸到短边墙：中心随之向内移
    const paveLen = G + INNER_OVERLAP;
    addPave(
      sidePaveLen,
      paveLen,
      side * sidePaveCx,
      pz + dir * (G / 2 - INNER_OVERLAP / 2)
    );
  }
  // 1) 远长边后方通道：沿 z 横贯球场宽度（位于球场后沿与远长边墙之间）。
  //    同样向球场内侧多铺 INNER_OVERLAP，覆盖「球场地面后沿 ~ courtBackX」的窄缝。
  addPave(
    G + INNER_OVERLAP,
    courtZ1 - courtZ0,
    side * (courtBackX + G / 2 - INNER_OVERLAP / 2),
    (courtZ0 + courtZ1) / 2
  );
}

// ==================== 玩家构建与障碍/金币/道具生成 ====================

// 创建/重建玩家（含光环）。GLB 模型异步加载完成后可再次调用以替换为精致角色，

// ==================== 滚动与动画 ====================

/** 街头行人动画：程序化模型摆腿摆臂 + 真实 GLB 骨骼动画推进 */
export function animateStreetPeds(ctx: SceneContext, dt: number, runT: number) {
  const st = ctx.street;
  // 程序化行人摆动双腿双臂（相位错开）；真实 GLB 行人由骨骼动画(mixer)负责自然走动，
  // 这里仅处理程序化回退模型。
  for (let p = 0; p < st.pedestrians.length; p++) {
    const ped = st.pedestrians[p];
    if (!ped.visible) continue;
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
  // 推进所有行人骨骼动画（真实 GLB 模型的走动）
  for (const m of st.pedMixers) m.update(dt);
}

/** 街头场景滚动：墙段 / 巷口 / 球场绕行墙与地砖（含回绕） */
export function scrollStreet(ctx: SceneContext, move: number) {
  const st = ctx.street;
  // 街头墙：墙体本身沿 +z 实体平移（向相机移动），涂鸦烧死在贴图里不滚动，
  // 因此涂鸦永远固定在所属墙段上、由远及近，绝不实时变化。
  // 移过相机后回收到最远端循环复用（纹理不变，仍是独一无二的那张）。
  if (st.walls.length > 0 && ctx.isStreetActive()) {
    const recycleZ = 42; // 段中心越过此 z 即已穿过相机，回收到远端
    for (const w of st.walls) {
      w.position.z += move;
      if (w.position.z - STREET.wallSegLen / 2 > recycleZ) {
        w.position.z -= STREET.wallLen;
      }
      // 暗巷跟随其绑定的墙段同步滚动/回收，巷口始终对准缺口。
      // 可见性由 applySceneMode 统一控制（巷口墙段恒为隐藏），此处只同步位置。
      const a = w.userData.alley as THREE.Group | undefined;
      if (a) a.position.z = w.position.z;
    }
    // 球场「绕行围墙 + 过道地砖」与墙段同一坐标系滚动/回绕。
    // 它们整体随球场移动，用自身 z 向半长判断回绕，保证整块完全越过回收线后才回绕。
    // 注意：绕行墙与地砖的 z 向尺寸差异较大（侧墙沿 x 很短、后横墙与地砖较长），
    // 统一用「几何 z 向尺寸的一半」计算其回绕阈值。
    const wrapHalfZ = (o: THREE.Object3D): number => {
      const g = (o as THREE.Mesh).geometry as THREE.PlaneGeometry | undefined;
      if (!g?.parameters) return 2;
      // 统一按「实际世界 z 向尺寸」的一半计算，兼容三种朝向：
      //   · 短边墙（沿 x，rotation.y=0）：z 向≈0，取极小值；
      //   · 远长边墙（沿 z，rotation.y=±π/2）：z 向 = 几何 width；
      //   · 通道地砖（rotation.x=−π/2，未绕 y 旋转）：z 向 = 几何 height。
      const alongY = Math.abs(Math.abs(o.rotation.y) - Math.PI / 2) < 0.1; // 绕 y 转 90°(沿 z)
      const flat = Math.abs(o.rotation.x) > 1; // 平铺地砖(绕 x 转 90°)
      if (alongY) return g.parameters.width / 2;
      if (flat) return g.parameters.height / 2;
      return 0.5; // 短边墙：z 向极薄
    };
    for (const o of [...st.courtWraps, ...st.courtWalkways]) {
      const half = wrapHalfZ(o);
      o.position.z += move;
      if (o.position.z - half > st.buildingRecycleZ) {
        o.position.z -= st.buildingCycle;
      }
    }
  }
  // 墙外远景层：整体按视差系数平移（<1 比近景慢，形成纵深），
  // 布点长度等于回绕周期，回绕前后画面完全重合。
  for (const o of st.backdrop) {
    const k = (o.userData.parallax as number) ?? 1;
    const cyc = (o.userData.cycle as number) ?? STREET.wallLen;
    o.position.z += move * k;
    if (o.position.z >= cyc) o.position.z -= cyc;
  }
}

/** 街头场景各物体显隐（供 applySceneMode 调用） */
export function setStreetVisible(ctx: SceneContext, visible: boolean) {
  const st = ctx.street;
  // 巷口墙段（alley）与球场正面敞开段（courtGap）这两类「被挖掉」的墙段始终隐藏。
  // 注意：这里必须显式设为 false，不能直接 return ——
  // buildBuildings 复位时会把所有墙段置为 visible=true，若此处 return，
  // 这些墙段将永远保持可见（表现为地铁场景里冒出城市砖墙）。
  for (const w of st.walls) {
    if (w.userData.alley || w.userData.courtGap) {
      w.visible = false;
      continue;
    }
    w.visible = visible;
  }
  for (const a of st.alleyways) a.visible = visible; // 墙根小巷仅在街头显示
  for (const m of st.cityDecor) m.visible = visible;
  for (const b of st.buildings) b.mesh.visible = visible;
  for (const b of st.backdrop) b.visible = visible;
  for (const w of st.courtWraps) w.visible = visible;
  for (const w of st.courtWalkways) w.visible = visible;
  for (const l of st.streetLights) l.visible = visible;
}

// ==================== 构建：沿街墙 ====================

/** 沿街墙的基准高度：所有造型调整都压在这条线以下，墙不会被加高 */
const WALL_H = 4.5;
/**
 * 墙段装饰配色（顶点色）。
 *
 * 取值原则：**贴近砖墙本身的明度**，只做「同材质的线脚」而不是亮色构件。
 * 亮白色构件压在红砖上，远看会变成一圈栏杆骨架。
 */
const WALL_TRIM = {
  cope: 0x9c948a, // 压顶石（中性灰，比砖亮不了太多）
  plinth: 0x847c72, // 勒脚（略压深，读作墙根的一道基座）
  pipe: 0x87857f, // 落水管
  box: 0x9ba1a3, // 配电箱外壳
  boxDoor: 0x6f7476, // 配电箱门板
};
let wallTrimMat: THREE.MeshStandardMaterial | null = null;

/**
 * 一段墙的装饰几何（顶点色，一段只多一次 draw call）。
 *
 * 目的：让墙面不再是「一块高度一致、表面全平的砖板」，同时保持远看干净：
 *   · 压顶石：沿墙顶一道细石线脚，挑出量压到 1.5~3.5cm；
 *   · 勒脚：墙根一道窄基座，挑出 4cm；
 *   · 落水管 / 配电箱：贴临街面的小构件，制造生活痕迹。
 *
 * **不再做「壁柱 / 墙垛」**：相机是贴着墙沿街看的，任何横向出挑的竖向构件
 * 在掠射视角下投影会被放大成一条贯穿整面墙的宽色带（正面只有 0.4 宽，
 * 掠射时看起来有 1 米多宽），墙就被切成一格一格的"栅栏"，正是之前显得乱的原因。
 * 竖向变化交给墙段本身的高度差，不再靠贴面构件。
 */
function buildWallTrim(
  h: number,
  segLen: number,
  T: number,
  streetSide: number
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
  // 1) 压顶石：细石线脚，顶面抬 5mm 压在墙顶之上（避免与墙体顶面共面 z-fighting）。
  //    出挑量很小：出挑越大，掠射视角下越容易在墙顶投出一条粗黑带。
  const capH = 0.1 + Math.random() * 0.05;
  const over = 0.015 + Math.random() * 0.02;
  addBox(T + over * 2, capH, segLen, 0, h - capH / 2 + 0.005, 0, WALL_TRIM.cope);
  // 2) 勒脚：只做一道贴地的窄基座，出挑 4cm。
  //    长度必须取满 segLen（不留缺口），相邻两段的基座才能拼接成一条连续的通长线脚。
  if (Math.random() < 0.6) {
    const ph = 0.2 + Math.random() * 0.08;
    addBox(T + 0.04, ph, segLen, 0, ph / 2, 0, WALL_TRIM.plinth);
  }
  // 以下构件都贴在「临街面」上：墙在 x=±10.5，赛道在 x=0 一侧，故法线朝 -streetSide
  const faceX = -streetSide * (T / 2);
  // 4) 落水管（略微嵌进墙面，不留缝也不与墙面共面）
  if (Math.random() < 0.3) {
    const ph = h - 0.25;
    const pipe = new THREE.CylinderGeometry(0.055, 0.055, ph, 8);
    pipe.translate(
      faceX - streetSide * 0.05,
      ph / 2 + 0.08,
      (Math.random() - 0.5) * (segLen - 1.2)
    );
    paintGeo(pipe, WALL_TRIM.pipe);
    parts.push(pipe);
  }
  // 5) 配电箱（箱体 + 略突出的门板）：贴得比较平，避免掠射时投出一大块黑影
  if (Math.random() < 0.15) {
    const by = 1.4 + Math.random() * 0.6;
    const bz = (Math.random() - 0.5) * (segLen - 1.4);
    addBox(0.12, 0.62, 0.44, faceX - streetSide * 0.05, by, bz, WALL_TRIM.box);
    addBox(0.04, 0.52, 0.34, faceX - streetSide * 0.12, by, bz, WALL_TRIM.boxDoor);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * 两侧街头墙（street 模式）—— 每面长墙切成多段独立 mesh，
 * 每段使用「独立生成」的砖纹+涂鸦贴图（repeatU=1、初始偏移随机），
 * 因此沿墙的每一个涂鸦都独一无二、绝不重复，左右墙也各自随机混杂。
 *
 * 墙本身仍然是一条【连续】的墙：每段首尾相接（巷口/篮球场/房屋让位依旧由
 * buildAlleyways、球场让位逻辑在这些墙段上挖洞，与装饰无关）。
 *
 * 每段另带一套贴面装饰（见 buildWallTrim）：通长压顶石、贴地勒脚、
 * 偶尔一根落水管/一个配电箱；另有约 1/5 的墙段矮 7~18cm 让墙头线不那么死板。
 *
 * 装饰只做「贴面线脚」：**不做任何横向出挑的竖向构件**（曾试过壁柱/墙垛）。
 * 因为相机是贴着墙沿街看的，竖向构件哪怕只出挑 5~9cm，在掠射视角下也会被
 * 放大成一条贯穿整面墙的宽暗带，看起来就像墙上被切出一道道缝——这正是
 * 之前「围墙不连续」观感的来源。
 */
export function buildStreetWalls(ctx: SceneContext) {
  const st = ctx.street;
  const wallLen = STREET.wallLen;
  const segLen = STREET.wallSegLen;
  const segCount = Math.ceil(wallLen / segLen);
  st.wallCycle = segCount * segLen; // 段实体平移的回绕周期
  // 墙体改为【有厚度】的 Box（厚度 = 绕行墙一致），使所有墙厚统一，
  // 且转角处方能与短边墙真正相交（零厚度平面只能与短边墙「相切」，透视下即露缝）。
  // 用六面材质数组：两个侧面(±x)贴砖纹，顶/底/端面用同色纯材质避免贴图拉伸。
  const T = STREET.wallThickness;
  if (!wallTrimMat) {
    wallTrimMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
    });
  }
  const trimMat = wallTrimMat;
  const wallZ0 = -70 + wallLen / 2 - segLen / 2; // 第一段中心 z
  for (const side of [-1, 1]) {
    for (let i = 0; i < segCount; i++) {
      // 每段独立贴图：唯一涂鸦 + 随机砖纹偏移
      const tex = ctx.loadWallTexture(
        wallTex,
        1, // repeatU = 1：本段只用一张，不再沿墙长平铺，从而涂鸦不重复
        1,
        {
          outW: STREET.segTexW,
          outH: STREET.segTexH,
          segments: 1, // 整张贴图作为一段，涂鸦约束在整张边界内，避免被墙缝切割
          // 不设 brickOffset：各段砖纹相位一致，段间砖缝连续，避免滚动时砖缝跳动
        }
      );
      const faceMat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.9,
      });
      // 顶面/底面/两端面：取砖墙主色调的纯材质，避免贴图在这些窄面上被拉花
      const edgeMat = new THREE.MeshStandardMaterial({
        color: ctx.theme.wallL,
        roughness: 0.95,
      });
      // 墙段高度：约 1/5 的段落矮一点点（最高仍是 WALL_H，不加高）。
      // 落差压得很小（7~18cm）：墙整体看仍是连续的一整面，只是墙头线偶尔有个小台阶。
      const h =
        Math.random() < 0.2 ? WALL_H - (0.07 + Math.random() * 0.11) : WALL_H;
      // Box 材质顺序：[+x, -x, +y(顶), -y(底), +z, -z]
      // 两个侧面都贴砖纹：这样无论左右墙旋转方向如何，朝向赛道的那面都有砖纹。
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(T, h, segLen), [
        faceMat,
        faceMat,
        edgeMat,
        edgeMat,
        edgeMat,
        edgeMat,
      ]);
      const z = wallZ0 - i * segLen;
      mesh.position.set(side * 10.5, h / 2, z);
      // 墙体装饰（压顶石 / 勒脚 / 落水管 / 配电箱）：作为子物体，
      // 跟随墙段一起滚动、回绕、被球场让位缩放，无需额外同步逻辑。
      const trim = new THREE.Mesh(buildWallTrim(h, segLen, T, side), trimMat);
      trim.position.y = -h / 2; // 装饰几何以墙根为原点，这里抵消墙体中心偏移
      trim.castShadow = false;
      trim.receiveShadow = false;
      mesh.add(trim);
      mesh.userData.side = side; // 供滚动时判断左右方向
      mesh.userData.baseZ = z; // 记录原始网格 z，供 buildBuildings 重算球场让位时复位
      mesh.userData.baseScaleZ = 1; // 长度方向（局部 z）的基准缩放
      st.walls.push(mesh);
      ctx.scene.add(mesh);
    }
  }
}

// ==================== 方案 B：场景类封装 ====================
// 说明：以上纯函数实现保持不变；下方类把它们收拢成「场景对象」，
// 由 ThreeRunner 持有实例并调用 build/scroll/setVisible，实现场景间的解耦。
// 类自身实现 SceneContext（通过 public 字段与 getter），因此内部可直接把 `this` 传给上面的函数。

/** 街头场景对象：持有街头专属状态，并封装构建/滚动/显隐。 */
export class StreetScene implements SceneContext {
  // ---------- 共享依赖（由 ThreeRunner 注入） ----------
  readonly scene: THREE.Scene;
  readonly theme: SceneContext["theme"];
  readonly loadWallTexture: SceneContext["loadWallTexture"];
  readonly loadRoadTexture: SceneContext["loadRoadTexture"];
  readonly sidewalkTex: THREE.CanvasTexture;
  readonly isStreetActive: () => boolean;
  /** 模型池访问器（每次返回最新值，避免持有构造时的过期快照） */
  private readonly modelsRef: () => ModelPool;
  /** 模型资源池（实现 SceneContext.models：实时转调 modelsRef） */
  get models(): ModelPool {
    return this.modelsRef();
  }

  // ---------- 街头专属状态 ----------
  private readonly st: StreetState = {
    walls: [],
    alleyways: [],
    cityDecor: [],
    pedestrians: [],
    pedMixers: [],
    streetLights: [],
    streetLightCount: 0,
    buildings: [],
    backdrop: [],
    courtWraps: [],
    courtWalkways: [],
    courtZSlots: [],
    wallCycle: 0,
    buildingCycle: 0,
    buildingRecycleZ: 42,
  };

  /** 街头状态（实现 SceneContext.street） */
  get street(): StreetState {
    return this.st;
  }

  /**
   * 地铁状态：街头场景不使用。
   * 返回惰性空壳以满足接口；真正的地铁状态由 MetroScene 持有。
   */
  get metro(): MetroState {
    return emptyMetroState;
  }

  constructor(deps: SceneDeps) {
    this.scene = deps.scene;
    this.theme = deps.theme;
    this.loadWallTexture = deps.loadWallTexture;
    this.loadRoadTexture = deps.loadRoadTexture;
    this.sidewalkTex = deps.sidewalkTex;
    this.modelsRef = deps.models;
    this.isStreetActive = deps.isStreetActive;
  }

  /**
   * 构建沿街墙。必须最先调用：后续内容（机场/楼房/装饰）依赖墙段网格，
   * 且球场的「让位」以墙段为操作对象。
   */
  buildWalls(): void {
    buildStreetWalls(this);
  }

  /**
   * 模型异步加载完成后的构建。顺序关键：
   *   先楼房 → 再装饰（装饰通过 isOccupiedByBuilding 读取楼房位置做避让）→ 巷口 → 清理巷口装饰。
   * 每步独立 try/catch：任一失败都不应阻断其余部分的构建。
   */
  build(): void {
    try {
      buildBuildings(this);
    } catch (e) {
      console.error("[street] buildBuildings failed:", e);
    }
    try {
      buildBackdrop(this);
    } catch (e) {
      console.error("[street] buildBackdrop failed:", e);
    }
    try {
      buildCityDecor(this);
    } catch (e) {
      console.error("[street] buildCityDecor failed:", e);
    }
    try {
      buildAlleyways(this);
    } catch (e) {
      console.error("[street] buildAlleyways failed:", e);
    }
    try {
      clearDecorInAlleyMouths(this);
    } catch (e) {
      console.error("[street] clearDecorInAlleyMouths failed:", e);
    }
  }

  /** 每帧滚动：墙段 / 巷口 / 球场绕行墙与地砖 */
  scroll(move: number): void {
    scrollStreet(this, move);
  }

  /** 街头各物体显隐 */
  setVisible(visible: boolean): void {
    setStreetVisible(this, visible);
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
    buildCourtWrap(this, side, wallX, courtFaceX, courtZ0, courtZ1, courtDepthX);
  }

  /** 修正球场标线 UV */
  fixCourtMarkingUV(root: THREE.Object3D): void {
    fixCourtMarkingUV(this, root);
  }

  /** 查询 (side,z) 是否与某栋楼房重叠（装饰避让用） */
  isOccupiedByBuilding(side: number, z: number, halfDepth = 2): boolean {
    return isOccupiedByBuilding(this, side, z, halfDepth);
  }

  /** 查询 (side,z) 是否落在篮球场两侧巷道口（装饰避让用） */
  isInCourtAlley(side: number, z: number, margin = 0): boolean {
    return isInCourtAlley(this, side, z, margin);
  }
}
