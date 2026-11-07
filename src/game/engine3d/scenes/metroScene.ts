import * as THREE from "three";
import { PLAYER_Z } from "../constants";
import { makeBallastTexture } from "../textures";
import {
  emptyStreetState,
  METRO,
  type MetroState,
  type ModelPool,
  type SceneContext,
  type SceneDeps,
  type StreetState,
} from "./types";

/**
 * 地铁场景：隧道壁 / 天花板 / 灯带 / 钢轨 / 隧道装饰 / 站台（含外扩候车厅）。
 *
 * 本模块为「方案 A：静态拆分」的产物——把原 ThreeRunner 中地铁专属的方法
 * 搬到这里，改成接收 SceneContext 的纯函数。后续方案 B 时，
 * 这些函数可直接收进 MetroScene 类（ctx.metro 整块变成 this）。
 */

// ==================== 构建：隧道主体（壁 / 天花板 / 灯带 / 钢轨） ====================

/**
 * 构建隧道壁、天花板、灯带与钢轨。
 * 隧道壁与天花板均为「滚动分段」：带位置信息后，站台段可隐藏对应的几段、
 * 由站台自带的候车厅墙体接管，从而实现「场景向外延伸」。
 */
export function buildMetroTunnel(
  ctx: SceneContext,
  theme: SceneContext["theme"]
) {
  const m = ctx.metro;
  const scene = ctx.scene;
  const mSegLen = METRO.wallSegLen;
  const mSegCount = Math.ceil(METRO.tunnelLen / mSegLen);
  m.wallCycle = mSegCount * mSegLen; // 回绕周期（段实体平移用）

  // 隧道壁：瓷砖墙贴图（从 metroStation.glb 提取的真实墙面贴图，见 loadMetroWallTexture）。
  // 贴图异步加载（TextureLoader 回调填充 image）。
  //
  // 每块墙段的方向随机：若所有段共用同一 Material/Texture，UV 变换全局共享，
  // 每块砖面会长得一模一样、循环起来非常规律。做法是每段用独立纹理 + 随机翻转/偏移，
  // 但因贴图此时尚未加载完成（image 为 null），这里先挂统一占位材质，
  // 待贴图就绪后由 applyRandomWallTextures() 一次性为每段分配随机变体。
  // 起始 z：从隧道近端(z=40)往远端铺，首段中心 = 近端 - 半段长
  const nearZ = METRO.tunnelCenterZ + METRO.tunnelLen / 2;
  // 可见墙面为「地面 y=0 ~ 天花板 y=CEIL_Y」，砖墙应在这个区间上下居中：
  // 让墙段高度与可见高度一致，砖面（贴图内缩 5.5% 后的部分）自然上下各留等宽水泥边。
  const CEIL_Y = 8.6;
  const wallH = CEIL_Y;
  const metroWallGeo = new THREE.BoxGeometry(1, wallH, mSegLen);
  // 注意：每段必须使用【独立材质】——若像之前那样所有段共享同一个 Material 实例，
  // applyRandomWallTextures 里逐段设置 map 实际改的是同一个材质，只有最后一次生效，
  // 结果所有墙段仍是同一张贴图（看起来方向一致）。故这里每段 new 一个材质。
  for (const side of [-1, 1]) {
    for (let i = 0; i < mSegCount; i++) {
      const segMat = new THREE.MeshStandardMaterial({
        color: 0x9a9aa0, // 贴图就绪前的占位水泥色（避免纯白闪烁）
        roughness: 1,
      });
      const seg = new THREE.Mesh(metroWallGeo, segMat);
      const z = nearZ - mSegLen / 2 - i * mSegLen;
      seg.position.set(side * 9.9, wallH / 2, z);
      seg.userData.side = side;
      seg.userData.baseZ = z; // 记录原始网格 z，供重建时复位
      seg.visible = false;
      scene.add(seg);
      m.walls.push(seg);
    }
  }
  m.wallTexApplied = false; // 标记：待贴图就绪后应用随机纹理

  // 天花板：每段是一块 20 宽的平面（朝下），随世界滚动、越过相机后回绕
  const ceilMatFlat = new THREE.MeshStandardMaterial({
    color: 0x5a5a64,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const ceilGeo = new THREE.PlaneGeometry(20, mSegLen);
  for (let i = 0; i < mSegCount; i++) {
    const seg = new THREE.Mesh(ceilGeo, ceilMatFlat);
    seg.rotation.x = Math.PI / 2; // 平面朝下，作为天花板
    const z = nearZ - mSegLen / 2 - i * mSegLen;
    seg.position.set(0, 8.6, z);
    seg.userData.baseZ = z;
    seg.visible = false;
    scene.add(seg);
    m.ceilings.push(seg);
  }

  // 天花板灯带（发光长条），随天花板一起滚动，强烈体现移动感。
  // 分布须铺满整个回绕周期，否则回绕后会出现「一段没灯」的空档。
  const ceilMat = new THREE.MeshStandardMaterial({
    color: 0xfff6c0,
    emissive: 0xffe066,
    emissiveIntensity: 1.0,
  });
  const ceilLightZ0 = 42;
  for (let z = ceilLightZ0; z > ceilLightZ0 - m.wallCycle; z -= 12) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 6), ceilMat);
    light.position.set(0, 7.7, z);
    light.visible = false;
    scene.add(light);
    m.ceilingLights.push(light);
  }

  // 钢轨：每条赛道各一对（轨距 ±0.7），与地面纹理上的「轨道带」严格对齐。
  // 赛道中心 x = -4.5 / 0 / 4.5（见 constants.LANES）。
  m.rails = new THREE.Group();
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xb8b8c0,
    roughness: 0.4,
    metalness: 0.7,
  });
  const RAIL_GAUGE = 0.7; // 半轨距（两条钢轨间距 1.4，与枕木带半宽 1.35 匹配）
  for (const lx of [-4.5, 0, 4.5]) {
    for (const rx of [lx - RAIL_GAUGE, lx + RAIL_GAUGE]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, METRO.tunnelLen),
        railMat
      );
      rail.position.set(rx, 0.08, METRO.tunnelCenterZ);
      m.rails.add(rail);
    }
  }
  m.rails.visible = false;
  scene.add(m.rails);

  // 等距枕木：程序化生成，沿 z 间距严格相等（避免 glb 自带枕木疏密不均、拼缝不齐的问题）。
  // 三条赛道各铺一条枕木带，用单一 InstancedMesh 承载，性能开销极小。
  buildMetroTies(ctx);

  // 道床：主地面（宽 14，|x|≤7）与隧道壁内表面（|x|=9.4）之间有一段 2.4 宽的空隙。
  // 街头模式下这段由人行道覆盖；地铁模式隐藏人行道后，空隙会露出深色背景，
  // 在赛道两侧形成明显黑边。这里铺一条碎石道砟长条（|x| 7~9.5）填满该空隙。
  m.bed = new THREE.Group();
  // 碎石道砟材质（程序化纹理）：取代原先的纯色平面，消除「死色块」观感。
  // 纹理 offset.y 由 ThreeRunner 每帧驱动，产生随人物跑动的碎石流动感（与地面纹理同法）。
  const ballastTex = makeBallastTexture();
  ballastTex.repeat.set(1, 60); // 沿 z 密铺，碎石颗粒尺度合理
  m.bedTex = ballastTex;
  const bedMat = new THREE.MeshStandardMaterial({
    map: ballastTex,
    color: 0xffffff,
    roughness: 1,
  });
  const bedInner = 7.0; // 与主地面边缘对齐
  const bedOuter = 9.5; // 越过壁内表面(9.4)，确保与墙根无缝
  const bedWidth = bedOuter - bedInner;
  for (const side of [-1, 1]) {
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(bedWidth, 0.2, METRO.tunnelLen),
      bedMat
    );
    // 顶面贴合主地面(y=0)：中心下移半个厚度
    bed.position.set(
      side * ((bedInner + bedOuter) / 2),
      -0.1,
      METRO.tunnelCenterZ
    );
    bed.receiveShadow = true;
    m.bed.add(bed);
  }
  m.bed.visible = false;
  scene.add(m.bed);

  buildMetroTrackFittings(ctx, theme);
}

/**
 * 等距枕木：三条赛道各铺一条枕木带，沿 z 的间距严格相等。
 *
 * 为什么程序化生成而非用 railwayTrack.glb 自带的枕木：该模型内部枕木间距
 * 在 0.21~0.70 间无规律波动，且整个模型只有单一材质、无法只提取钢轨，
 * 平铺后接缝处必然出现疏密不均。改为程序化生成可保证「所有枕木等距」，
 * 同时性能更好（单一 InstancedMesh）。
 *
 * 实现：用 InstancedMesh 承载全部枕木；实例位置沿 z 等距分布，随世界滚动时
 * 逐实例平移并回绕一个「整周期」（= 间距 × 数量），保证任意时刻等距无缝。
 */
const METRO_TIE = {
  /** 枕木沿 z 的间距（世界单位）：越小越密 */
  gap: 1,
  /** 枕木横跨赛道的宽度 */
  width: 2.4,
  /** 枕木厚度（沿 z） */
  depth: 0.28,
  /** 枕木高度（沿 y） */
  height: 0.12,
};
function buildMetroTies(ctx: SceneContext) {
  const m = ctx.metro;
  // 覆盖整条隧道（多铺一档以兜住接缝），周期 = 间距 × 数量
  const perLane = Math.ceil(METRO.tunnelLen / METRO_TIE.gap) + 1;
  const lanes = [-4.5, 0, 4.5];
  const total = perLane * lanes.length;
  const nearZ = METRO.tunnelCenterZ + METRO.tunnelLen / 2;

  const geo = new THREE.BoxGeometry(
    METRO_TIE.width,
    METRO_TIE.height,
    METRO_TIE.depth
  );
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a3a2e, // 深褐木质
    roughness: 0.95,
  });
  const inst = new THREE.InstancedMesh(geo, mat, total);
  inst.castShadow = true;
  inst.receiveShadow = true;
  const mat4 = new THREE.Matrix4();
  const positions: THREE.Vector3[] = [];
  let idx = 0;
  for (const lx of lanes) {
    for (let i = 0; i < perLane; i++) {
      const z = nearZ - i * METRO_TIE.gap;
      positions.push(new THREE.Vector3(lx, METRO_TIE.height / 2, z));
      mat4.makeTranslation(lx, METRO_TIE.height / 2, z);
      inst.setMatrixAt(idx++, mat4);
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.visible = false;
  ctx.scene.add(inst);
  // 保存每个实例的基准位置，滚动时据此平移（InstancedMesh 位置必须逐实例更新）
  m.ties = inst;
  m.tiePositions = positions;
  m.tiePerLane = perLane;
  m.tieCycle = perLane * METRO_TIE.gap;
}

/**
 * 墙根金属构件：排水沟 + 黄色维护标识条 + 第三轨（供电轨）+ 电缆托架。
 * 这些元素贴在道床与隧道壁交界处，把原本空白的墙根变成有内容的细节，
 * 同时「第三轨」是地铁隧道最强的辨识符号。
 * 全部并入 m.trackFittings，随世界一起滚动。
 */
function buildMetroTrackFittings(
  ctx: SceneContext,
  theme: SceneContext["theme"]
) {
  const m = ctx.metro;
  const nearZ = METRO.tunnelCenterZ + METRO.tunnelLen / 2;

  // 排水沟与第三轨的 x 位置（隧道壁内表面在 ±9.4）
  const drainX = 9.15; // 贴墙根的排水沟
  const thirdRailX = 8.4; // 第三轨（供电轨），位于道床上、靠墙一侧

  const drainMat = new THREE.MeshStandardMaterial({
    color: 0x2c2c33,
    roughness: 0.9,
  });
  const warnMat = new THREE.MeshStandardMaterial({
    color: theme.yellow,
    emissive: theme.yellow,
    emissiveIntensity: 0.12,
    roughness: 0.7,
  });
  const thirdRailMat = new THREE.MeshStandardMaterial({
    color: 0x6a5a4a, // 供电轨为锈褐色，区别于下部行车钢轨的冷银
    roughness: 0.5,
    metalness: 0.6,
  });
  const bracketMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a42,
    roughness: 0.7,
    metalness: 0.4,
  });

  for (const side of [-1, 1]) {
    // ---- 1) 排水沟：沿 z 贯通的深色凹槽（略低于道床） ----
    const drain = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.12, METRO.tunnelLen),
      drainMat
    );
    drain.position.set(side * drainX, -0.06, METRO.tunnelCenterZ);
    m.trackFittings.push(drain);

    // ---- 2) 黄色维护标识条：沿排水沟内缘的一条细亮线 ----
    const warn = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.02, METRO.tunnelLen),
      warnMat
    );
    warn.position.set(side * (drainX - 0.32), 0.012, METRO.tunnelCenterZ);
    m.trackFittings.push(warn);

    // ---- 3) 第三轨：沿 z 贯通的一根供电轨 + 绝缘底座 ----
    const thirdRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.14, METRO.tunnelLen),
      thirdRailMat
    );
    thirdRail.position.set(side * thirdRailX, 0.22, METRO.tunnelCenterZ);
    m.trackFittings.push(thirdRail);
    const thirdRailBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.3, METRO.tunnelLen),
      bracketMat
    );
    thirdRailBase.position.set(side * thirdRailX, 0.06, METRO.tunnelCenterZ);
    m.trackFittings.push(thirdRailBase);

    // ---- 4) 电缆托架：沿 z 每 6 单位一个，挂在隧道壁上（带一小段电缆） ----
    for (let z = nearZ; z > nearZ - m.wallCycle; z -= 6) {
      const bracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.06, 0.12),
        bracketMat
      );
      bracket.position.set(side * (9.4 - 0.25), 1.4, z);
      m.trackFittings.push(bracket);
      // 托架上的电缆（沿 z 的细圆柱，用短段模拟连续走线）
      const cable = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 6, 6),
        bracketMat
      );
      cable.rotation.x = Math.PI / 2;
      cable.position.set(side * (9.4 - 0.25), 1.5, z - 3);
      m.trackFittings.push(cable);
    }
  }

  for (const o of m.trackFittings) {
    o.visible = false;
    ctx.scene.add(o);
  }
}

// ==================== 构建：隧道装饰 ====================

/**
 * 地铁隧道装饰（发光灯带 / 管道 / 站牌 / 应急箱），贴在隧道壁内表面（x=±6.9，
 * 壁内表面在 x=±7），随世界滚动，强化隧道速度感。
 * 注意：必须落在壁内表面轨道侧，否则被墙包裹不可见。
 */
export function buildMetroDecor(
  ctx: SceneContext,
  theme: SceneContext["theme"]
) {
  const m = ctx.metro;
  const len = 130;
  let z = -len;
  let i = 0;
  while (z < 20) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * 6.9; // 壁内表面（x=±7）的轨道侧，确保可见
    const type = i % 4;
    // type===0 原为「顶部发光灯带」，仅出现在左侧（i 为 4 的倍数 ⇒ side 恒为 -1），
    // 按需求去掉左侧天花板的灯，故该类型不再生成任何物体。
    if (type === 0) {
      z += 7 + Math.random() * 4;
      i++;
      continue;
    }
    let mesh: THREE.Object3D;
    if (type === 1) {
      // 墙面管道
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 4, 10),
        new THREE.MeshStandardMaterial({
          color: 0x6a6a72,
          roughness: 0.7,
          metalness: 0.5,
        })
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, 1.6, 0);
    } else if (type === 2) {
      // 站牌（发光色块）
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1.4, 1.2),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? theme.cyan : theme.magenta,
          emissive: i % 2 ? theme.cyan : theme.magenta,
          emissiveIntensity: 0.5,
        })
      );
      mesh.position.set(x, 3.4, 0);
    } else {
      // 应急箱（红/黄小柜，贴壁）
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.9, 0.7),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? theme.red : theme.yellow,
          roughness: 0.6,
        })
      );
      mesh.position.set(x, 1.2, 0);
    }
    mesh.position.z = z;
    mesh.visible = false;
    ctx.scene.add(mesh);
    m.decor.push(mesh);
    z += 7 + Math.random() * 4;
    i++;
  }
}

// ==================== 构建：站台（带向外扩展的候车厅） ====================

/**
 * 每隔 platformCycle 在一侧出现一座车站，随世界滚动。场景向隧道壁【外侧】延伸：
 *   · 隧道壁内表面 x=±9.4，可跑区约 |x| ≤ 5.5 —— 赛道边界不变；
 *   · 车站把隧道壁在此处「向外折开」：月台(6.2~9.4)之外继续向外建候车厅(9.4~19.4)，
 *     由站台自带的后墙/端墙/天花板围合；同时把该 z 段内的全局隧道壁隐藏让位。
 *   · 月台 y=1.0（真实站台高度）；候车厅地板同高，与月台连成一片。
 * 站台内容：月台面+安全线+边缘立面、外扩候车厅地板/后墙/端墙/天花板、
 *           支撑柱、顶部灯板+点光源、发光站牌、长椅、广告灯箱。
 */
export function buildMetroPlatforms(
  ctx: SceneContext,
  theme: SceneContext["theme"]
) {
  const m = ctx.metro;
  const WALL_IN = 9.4; // 隧道壁内表面
  const INNER_X = 6.2; // 月台靠赛道一侧（不侵入赛道可跑区）
  const HALL_OUT = 19.4; // 候车厅后墙所在 x（向外扩展的边界）
  const PLAT_Y = 1.0; // 月台/候车厅地板高度
  const H = 8.6; // 天花板高度
  const len = m.platformLength;
  // 候车厅沿 z 比月台更长：让位是按整段墙（wallSegLen=6）隐藏的，
  // 站台长 28 需让位 5 段=30，会多出约 2（每端 1）。候车厅端墙必须包住这段多出的洞口，
  // 否则端墙外侧会露出缺口。取 len + wallSegLen 保证足够覆盖。
  const hallLen = len + METRO.wallSegLen;
  const midX = (WALL_IN + INNER_X) / 2;
  const width = WALL_IN - INNER_X;

  const colMat = new THREE.MeshStandardMaterial({
    color: 0x55555f,
    roughness: 0.6,
    metalness: 0.4,
  });
  // 候车厅室内墙面（比隧道壁更亮、更「室内」）
  const hallWallMat = new THREE.MeshStandardMaterial({
    color: 0x8f8f9c,
    roughness: 0.85,
  });

  // 左右两侧各一座，相位错开半周期（异侧交替经过，任意时刻视野内最多一座）
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? 1 : -1;
    const g = new THREE.Group();
    const z0 = -m.platformCycle * (k === 0 ? 1 : 0.5);
    g.position.set(0, 0, z0);

    // ---------- 月台部分（|x| 在 6.2~9.4，与隧道壁内表面齐平） ----------
    // 1) 月台面
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.25, len),
      new THREE.MeshStandardMaterial({ color: 0x9a9aa4, roughness: 0.9 })
    );
    deck.position.set(side * midX, PLAT_Y - 0.125, 0);
    g.add(deck);

    // 2) 月台边缘立面（封闭台面下方悬空）
    // 注意：立面必须完全位于月台面（deck，底面在 y=PLAT_Y-0.25）下方，二者不得重叠——
    // 否则同宽的实心 Box 侧面共面会触发 Z-fighting（运动时表现为底部边缘闪烁）。
    // 为此：高度取 PLAT_Y-0.25、宽度比 deck 略窄 0.04，且顶面恰好接触 deck 底面。
    const DECK_H = 0.25;
    const faceH = PLAT_Y - DECK_H;
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.04, faceH, len - 0.04),
      new THREE.MeshStandardMaterial({ color: 0x6e6e78, roughness: 0.95 })
    );
    face.position.set(side * midX, faceH / 2, 0);
    g.add(face);

    // 3) 黄色安全线（月台靠赛道边缘）
    const warnLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.03, len - 1),
      new THREE.MeshStandardMaterial({
        color: theme.yellow,
        emissive: theme.yellow,
        emissiveIntensity: 0.15,
        roughness: 0.7,
      })
    );
    warnLine.position.set(side * (INNER_X + 0.5), PLAT_Y + 0.015, 0);
    g.add(warnLine);

    // ---------- 向外扩展的候车厅（|x| 在 9.4~19.4） ----------
    const hallMidX = (WALL_IN + HALL_OUT) / 2;
    const hallWidth = HALL_OUT - WALL_IN;

    // 4) 候车厅地板（与月台同高，向外铺开）
    const hallFloor = new THREE.Mesh(
      new THREE.BoxGeometry(hallWidth, 0.25, hallLen),
      new THREE.MeshStandardMaterial({ color: 0xa7a7b2, roughness: 0.9 })
    );
    hallFloor.position.set(side * hallMidX, PLAT_Y - 0.125, 0);
    g.add(hallFloor);

    // 5) 候车厅地板下方立面（封闭悬空，避免从赛道斜看穿帮）
    // 同月台立面：必须完全位于地板（hallFloor，底面 y=PLAT_Y-0.25）下方，
    // 高度取 PLAT_Y-0.25、宽/长各窄 0.04，避免同宽实心 Box 侧面共面导致的 Z-fighting。
    const hallBaseH = PLAT_Y - 0.25;
    const hallBase = new THREE.Mesh(
      new THREE.BoxGeometry(hallWidth - 0.04, hallBaseH, hallLen - 0.04),
      new THREE.MeshStandardMaterial({ color: 0x6e6e78, roughness: 0.95 })
    );
    hallBase.position.set(side * hallMidX, hallBaseH / 2, 0);
    g.add(hallBase);

    // 6) 候车厅后墙（沿 z，位于扩展边界处）
    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, H, hallLen),
      hallWallMat
    );
    backWall.position.set(side * HALL_OUT, H / 2, 0);
    g.add(backWall);

    // 7) 候车厅两端端墙（沿 x，封住扩展空间的前后两头）
    for (const ez of [-hallLen / 2, hallLen / 2]) {
      const endWall = new THREE.Mesh(
        new THREE.BoxGeometry(hallWidth, H, 0.4),
        hallWallMat
      );
      endWall.position.set(side * hallMidX, H / 2, ez);
      g.add(endWall);
    }

    // 8) 候车厅天花板（覆盖扩展空间，与全局天花板同高）
    const hallCeil = new THREE.Mesh(
      new THREE.BoxGeometry(hallWidth + 0.4, 0.3, hallLen),
      new THREE.MeshStandardMaterial({ color: 0x5a5a64, roughness: 1 })
    );
    hallCeil.position.set(side * (hallMidX + 0.2), H, 0);
    g.add(hallCeil);

    // 9) 支撑柱（沿 z 均布 4 根，位于月台边缘附近）
    const colH = H - PLAT_Y - 0.3;
    const colCount = 4;
    for (let i = 0; i < colCount; i++) {
      const cz = -len / 2 + 2 + (i * (len - 4)) / (colCount - 1);
      const col = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, colH, 0.45),
        colMat
      );
      col.position.set(side * (WALL_IN - 0.6), PLAT_Y + colH / 2, cz);
      g.add(col);
    }

    // 10) 顶部照明灯板（暖白发光）+ 点光源（每座 1 盏，控制动态光源数量）
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff6d8,
      emissive: 0xffe8a8,
      emissiveIntensity: 1.2,
    });
    for (let i = 0; i < 3; i++) {
      const lz = -len / 2 + 4 + (i * (len - 8)) / 2;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.18, 5), lampMat);
      lamp.position.set(side * (WALL_IN + 1.6), H - 0.5, lz);
      g.add(lamp);
    }
    const pl = new THREE.PointLight(0xffe8b0, 16, 24, 2);
    pl.position.set(side * (hallMidX - 1), H - 1.2, 0);
    g.add(pl);

    // 11) 发光站牌（双色，站名标识），立于月台边缘
    const signPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3.0, 8),
      colMat
    );
    signPost.position.set(side * (INNER_X + 0.9), PLAT_Y + 1.5, len / 2 - 4);
    g.add(signPost);
    const signBoard = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 1.0, 2.2),
      new THREE.MeshStandardMaterial({
        color: theme.cyan,
        emissive: theme.cyan,
        emissiveIntensity: 0.7,
      })
    );
    signBoard.position.set(side * (INNER_X + 0.9), PLAT_Y + 3.2, len / 2 - 4);
    g.add(signBoard);
    const signAccent = new THREE.Mesh(
      new THREE.BoxGeometry(0.19, 0.28, 2.2),
      new THREE.MeshStandardMaterial({
        color: theme.magenta,
        emissive: theme.magenta,
        emissiveIntensity: 0.7,
      })
    );
    signAccent.position.set(side * (INNER_X + 0.9), PLAT_Y + 3.2, len / 2 - 4);
    g.add(signAccent);

    // 12) 长椅（靠候车厅后墙摆放）
    const benchMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a54,
      roughness: 0.8,
    });
    for (let i = 0; i < 2; i++) {
      const bz = -len / 4 + i * (len / 2);
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.12, 2.4),
        benchMat
      );
      seat.position.set(side * (HALL_OUT - 1.1), PLAT_Y + 0.5, bz);
      g.add(seat);
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.6, 2.4),
        benchMat
      );
      back.position.set(side * (HALL_OUT - 0.78), PLAT_Y + 0.8, bz);
      g.add(back);
      for (const lz of [bz - 1.0, bz + 1.0]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.5, 0.1),
          benchMat
        );
        leg.position.set(side * (HALL_OUT - 1.1), PLAT_Y + 0.25, lz);
        g.add(leg);
      }
    }

    // 13) 广告灯箱（贴在候车厅后墙上的发光竖版，参考图中的亮牌）
    for (let i = 0; i < 2; i++) {
      const lz = -len / 4 + i * (len / 2);
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 2.6, 1.4),
        new THREE.MeshStandardMaterial({
          color: theme.magenta,
          emissive: theme.magenta,
          emissiveIntensity: 0.55,
        })
      );
      panel.position.set(side * (HALL_OUT - 0.35), PLAT_Y + 2.0, lz);
      g.add(panel);
    }

    g.visible = false;
    g.userData.side = side; // 记录侧别：用于「同侧墙段让位」判断（Group 的 x 恒为 0）
    ctx.scene.add(g);
    m.platforms.push(g);
  }
}

// ==================== 列车 ====================

/** 列车运行参数 */
const METRO_TRAIN = {
  /** 远端出现位置（负值=远离相机；与障碍生成点一致，保证在雾外生成） */
  spawnZ: -110,
  /**
   * 列车车体沿 z 的长度（与 loaders 中 TARGET_TRAIN_LEN 一致）。
   * 用于回收判定：必须等「车尾」完全驶出镜头才回收，否则车尾会在画面中突然消失。
   */
  bodyLen: 32,
  /** 相机所在 z（= PLAYER_Z + 8，见 ThreeRunner 构造函数）；车尾越过此值即已离开镜头 */
  cameraZ: PLAYER_Z + 8,
  /** 回收阈值：列车中心越过此 z 时，车尾（中心 − bodyLen/2）已在相机后方足够远处 */
  despawnZ: PLAYER_Z + 8 + 32 / 2 + 6,
  /** 列车自发行进速度（相对赛道），单位/秒：越小越「缓缓驶来」 */
  speed: 9,
  /** 两次发车的间隔（秒），在此区间随机（越小出现越频繁） */
  cooldownMin: 5,
  cooldownMax: 10,
};

/**
 * 设置列车模型（加载完成后由 ThreeRunner 调用）。
 * 模型已在 loaders 中校准；这里仅保存引用，实际出场由 updateMetroTrain 调度。
 */
export function setMetroTrainModel(ctx: SceneContext, model: THREE.Object3D | null) {
  const m = ctx.metro;
  m.trainModel = model;
  // 首次加载完成后，给一个较短倒计时，让玩家尽快见到第一台列车
  if (model) m.trainCooldown = 3;
}

/**
 * 列车更新：出场调度 / 行进 / 回收。
 * 同一时刻至多一台列车；从远端缓缓向近端（玩家）驶来，驶过玩家后回收。
 * 列车所在赛道的障碍物生成会被抑制（由 ThreeRunner.spawnWave 读取 trainLane 判断）。
 *
 * @param move 本帧世界向相机移动的量（列车额外叠加自身速度，因而逐帧追上玩家）
 */
export function updateMetroTrain(ctx: SceneContext, move: number, dt: number) {
  const m = ctx.metro;
  if (!m.trainModel) return; // 模型未加载：不生成列车

  if (!m.train) {
    // 无列车：倒计时结束后发车
    m.trainCooldown -= dt;
    if (m.trainCooldown <= 0) {
      spawnMetroTrain(ctx);
    }
    return;
  }

  // 有列车：世界滚动量 + 列车自身行进速度，使列车相对玩家逐帧逼近
  const m4 = m.train;
  m.trainZ += move + m.trainSpeed * dt;
  m4.position.z = m.trainZ;

  // 驶过玩家 → 回收，进入下次倒计时（并随机换一条赛道）
  if (m.trainZ > METRO_TRAIN.despawnZ) {
    ctx.scene.remove(m4);
    m.train = null;
    m.trainCooldown =
      METRO_TRAIN.cooldownMin +
      Math.random() * (METRO_TRAIN.cooldownMax - METRO_TRAIN.cooldownMin);
  }
}

/** 发车：在随机赛道的远端生成一台列车 */
function spawnMetroTrain(ctx: SceneContext) {
  const m = ctx.metro;
  if (!m.trainModel) return;
  const lane = Math.floor(Math.random() * 3);
  const obj = m.trainModel.clone(true);
  const laneX = [-4.5, 0, 4.5][lane];
  m.trainLane = lane;
  m.trainZ = METRO_TRAIN.spawnZ;
  // 缓缓加速到目标速度，避免瞬移到全速
  m.trainSpeed = METRO_TRAIN.speed;
  obj.position.set(laneX, 0.02, m.trainZ);
  // 列车灯光（模型本身无自发光/灯光，此处程序化补光）：
  // 车头朝 +z（面向玩家驶来），在车头两侧加发光前照灯 + 一盏照向前方轨道的聚光灯。
  attachTrainLights(obj);
  obj.visible = true;
  ctx.scene.add(obj);
  m.train = obj;
}

/**
 * 给列车补程序化灯光：模型本身不带发光材质与灯光，这里在其局部坐标下挂载「车头光源」。
 * 位置依据模型校准后的尺寸估算（车长约 32、车宽约 6.8、车高约 8.2）：
 * 车头位于 +z 端，底部贴地在 y=0。
 * 说明：不再添加发光的「白色灯球」面片（观感突兀），仅保留照亮前方轨道的聚光灯
 * 与车厢内暖光，形成自然的车头照明效果。
 */
function attachTrainLights(train: THREE.Object3D) {
  const zFront = 16; // 车头（+z 端，半车长 32/2）
  const headY = 2.2; // 车头灯高度

  // 1) 车头聚光灯：照向前方（+z）的轨道，形成明显光锥与地面亮斑
  const spot = new THREE.SpotLight(0xfff0c8, 8, 60, Math.PI / 5, 0.5, 1.2);
  spot.position.set(0, headY + 0.6, zFront);
  spot.target.position.set(0, 0, zFront + 30); // 射向前方地面
  train.add(spot);
  train.add(spot.target);

  // 2) 车厢内暖光：勾勒车身轮廓，随车移动，增强存在感
  const inner = new THREE.PointLight(0xffe9b0, 3.5, 22, 2);
  inner.position.set(0, 3.2, 0);
  train.add(inner);
}

// ==================== 滚动 ====================

/**
 * 地铁场景滚动：隧道壁 / 天花板 / 灯带 / 装饰 / 站台（含让位）。
 * 由 ThreeRunner 的 update() 每帧调用一次。
 *
 * @param move 本帧世界向相机移动的量
 * @param active 是否处于地铁模式（非地铁时全部隐藏且不滚动）
 */
export function scrollMetro(ctx: SceneContext, move: number, active: boolean) {
  const m = ctx.metro;

  // 瓷砖贴图为异步加载：就绪后为每块墙段分配随机方向（只执行一次）
  applyRandomWallTextures(ctx);

  // 装饰：随世界滚动 + 显隐（地铁下显示）
  for (const o of m.decor) {
    o.visible = active;
    if (!active) continue;
    o.position.z += move;
    if (o.position.z > 18) o.position.z -= 130;
  }

  if (!active) {
    // 非地铁：隐藏所有隧道物体，停止滚动
    for (const w of m.walls) w.visible = false;
    for (const c of m.ceilings) c.visible = false;
    for (const l of m.ceilingLights) l.visible = false;
    for (const p of m.platforms) p.visible = false;
    if (m.railway) m.railway.visible = false;
    if (m.train) m.train.visible = false;
    return;
  }
  // 地铁模式下，若列车在场则保持可见
  if (m.train) m.train.visible = true;

  // 隧道壁 / 天花板 / 灯带：统一用 wallCycle 回绕，保持彼此对齐。
  // 注意：不能用「某个墙段的 visible」作开关 —— 站台让位会隐藏部分墙段（包括可能的 0 号段），
  // 若以其可见性作判断会导致整块停止滚动。
  const recycleZ = 42; // 段中心越过此 z 即已穿过相机，回收到远端

  // 墙根金属构件（第三轨/电缆架等）：随世界滚动。
  // 整条构件长度 = 回绕周期，整体后移一个周期后与原位完全重合，故可统一回绕；
  // 离散的托架/电缆则以 6 为步长分布，回绕周期为 wallCycle，保证分布在任意时刻均匀。
  for (const o of m.trackFittings) {
    o.visible = true;
    o.position.z += move;
    if (o.position.z > recycleZ) o.position.z -= m.wallCycle;
  }

  for (const w of m.walls) {
    w.position.z += move;
    if (w.position.z - METRO.wallSegLen / 2 > recycleZ) {
      w.position.z -= m.wallCycle;
    }
  }
  for (const c of m.ceilings) {
    c.position.z += move;
    if (c.position.z - METRO.wallSegLen / 2 > recycleZ) {
      c.position.z -= m.wallCycle;
    }
  }
  for (const l of m.ceilingLights) {
    l.position.z += move;
    if (l.position.z > recycleZ) l.position.z -= m.wallCycle;
  }

  // 模型版铁轨：逐段随世界滚动，越过相机后回绕一个「总周期」（段数 × 步长）。
  // 段以 step 平铺，回绕周期取总长，保证任意时刻铺满整条隧道、无空档、无重叠。
  if (m.railway) {
    const segLen = (m.railway.userData.segLen as number) || 7;
    const cycle = (m.railway.userData.cycle as number) || segLen * 32;
    for (const seg of m.railway.children) {
      seg.position.z += move;
      if (seg.position.z - segLen / 2 > recycleZ) seg.position.z -= cycle;
    }
  }

  // 等距枕木：逐实例平移并回绕一个整周期（间距 × 单条数量），保证任何时刻等距无缝。
  if (m.ties) {
    const m4 = new THREE.Matrix4();
    const cycle = m.tieCycle || m.tiePerLane * METRO_TIE.gap;
    let i = 0;
    for (const p of m.tiePositions) {
      p.z += move;
      if (p.z > recycleZ) p.z -= cycle;
      m4.makeTranslation(p.x, p.y, p.z);
      m.ties.setMatrixAt(i++, m4);
    }
    m.ties.instanceMatrix.needsUpdate = true;
  }

  // 站台滚动 + 隧道壁让位
  scrollMetroPlatforms(ctx, move);
}

// ==================== 方案 B：场景类封装 ====================
// 说明：以上纯函数实现保持不变；下方类把它们收拢成「场景对象」，
// 由 ThreeRunner 持有实例并调用 build/scroll/setVisible，实现场景间的解耦。
// 类自身实现 SceneContext（通过 public 字段与 getter），因此内部可直接把 `this` 传给上面的函数。

/** 地铁场景对象：持有地铁专属状态，并封装构建/滚动/显隐。 */
export class MetroScene implements SceneContext {
  // ---------- 共享依赖（由 ThreeRunner 注入） ----------
  readonly scene: THREE.Scene;
  /** 地铁场景不分块：容器直接就是 scene（接口要求） */
  get chunkRoot(): THREE.Object3D {
    return this.scene;
  }
  readonly theme: SceneContext["theme"];
  readonly loadWallTexture: SceneContext["loadWallTexture"];
  readonly loadRoadTexture: SceneContext["loadRoadTexture"];
  readonly sidewalkTex: THREE.CanvasTexture;
  // 主人行道 / 路缘石材质：地铁场景用不到，仅用于满足 SceneContext
  readonly sidewalkMat: THREE.MeshStandardMaterial;
  readonly curbMat: THREE.MeshStandardMaterial;
  readonly metroWallTex: THREE.Texture;
  readonly isStreetActive: () => boolean;
  /** 模型池访问器（每次返回最新值，避免持有构造时的过期快照） */
  private readonly modelsRef: () => ModelPool;
  /** 模型资源池（实现 SceneContext.models：实时转调 modelsRef） */
  get models(): ModelPool {
    return this.modelsRef();
  }

  // ---------- 地铁专属状态 ----------
  private readonly st: MetroState = {
    walls: [],
    ceilings: [],
    ceilingLights: [],
    decor: [],
    platforms: [],
    rails: undefined as unknown as THREE.Group, // 由 build() 赋值
    railway: null, // 已停用 glb 铁轨，恒为 null
    ties: null, // 由 buildMetroTies() 赋值
    tiePositions: [],
    tiePerLane: 0,
    tieCycle: 0,
    bed: undefined as unknown as THREE.Group, // 由 build() 赋值
    bedTex: null,
    trackFittings: [],
    trainModel: null,
    train: null,
    trainLane: 1,
    trainZ: 0,
    trainSpeed: 0,
    trainCooldown: 0,
    wallCycle: 0,
    wallTexApplied: false,
    // 站台出现周期。约束：必须 ≤ 隧道壁长度(220)，否则回绕后站台会落到隧道壁范围之外、
    // 悬在没有墙/天花板的虚空里。两侧各一座、相位错开半周期，
    // 使得任意时刻视野内最多只出现一座（另一座远在雾外），即「很长一段距离才见一次」。
    platformCycle: 200,
    platformLength: 28,
  };

  /** 地铁状态（实现 SceneContext.metro） */
  get metro(): MetroState {
    return this.st;
  }

  /**
   * 街头状态：地铁场景不使用。
   * 返回一个惰性空壳，避免误访问时报错；真正的街头状态由 StreetScene 持有。
   */
  get street(): StreetState {
    return emptyStreetState;
  }

  constructor(deps: SceneDeps) {
    this.scene = deps.scene;
    this.theme = deps.theme;
    this.loadWallTexture = deps.loadWallTexture;
    this.loadRoadTexture = deps.loadRoadTexture;
    this.sidewalkTex = deps.sidewalkTex;
    this.sidewalkMat = deps.sidewalkMat;
    this.curbMat = deps.curbMat;
    this.metroWallTex = deps.metroWallTex;
    this.modelsRef = deps.models;
    this.isStreetActive = deps.isStreetActive;
  }

  /** 构建隧道主体 / 装饰 / 站台（同步，不依赖外部模型） */
  build(): void {
    buildMetroTunnel(this, this.theme);
    buildMetroDecor(this, this.theme);
    buildMetroPlatforms(this, this.theme);
  }

  /**
   * 【已停用】用 railwayTrack.glb 模型替换程序化轨道。
   *
   * 放弃 glb 的原因（实测数据）：
   *   · 该模型自带枕木沿轨道的间距在 0.21~0.70 之间无规律波动，无法做到「所有枕木等距」；
   *   · 整个模型只有 1 个 mesh / 1 个材质，枕木与钢轨不可分离，无法只提取钢轨。
   * 现改用「程序化钢轨（buildMetroTunnel 中的 m.rails）+ 程序化等距枕木（buildMetroTies）」，
   * 间距完全可控、性能更优（枕木为单一 InstancedMesh）。此方法保留为空实现以维持调用链。
   */
  setRailwayModel(_model: THREE.Object3D | null): void {
    // 不再采用 glb 铁轨：程序化方案已提供等距枕木与钢轨。
  }

  /** 设置列车模型（加载完成后由 ThreeRunner 调用） */
  setTrainModel(model: THREE.Object3D | null): void {
    setMetroTrainModel(this, model);
  }

  /** 每帧更新列车（出场调度 / 行进 / 回收） */
  updateTrain(move: number, dt: number): void {
    updateMetroTrain(this, move, dt);
  }

  /** 重置列车（重开游戏时清除在场列车并重新计时） */
  resetTrain(): void {
    const m = this.st;
    if (m.train) {
      this.scene.remove(m.train);
      m.train = null;
    }
    m.trainCooldown = m.trainModel ? 3 : 0;
  }

  /** 当前列车占用的赛道；无列车时返回 -1（供障碍生成抑制使用） */
  get activeTrainLane(): number {
    return this.st.train ? this.st.trainLane : -1;
  }

  /** 列车当前 z 位置；无列车时返回 NaN（供碰撞判定使用） */
  get trainZ(): number {
    return this.st.train ? this.st.trainZ : NaN;
  }

  /** 每帧滚动（仅在模式匹配时由 ThreeRunner 调用；此处 active 恒为 true） */
  scroll(move: number): void {
    scrollMetro(this, move, true);
  }

  /** 地铁各物体显隐 */
  setVisible(visible: boolean): void {
    setMetroVisible(this, visible);
  }
}

/**
 * 为每块墙段分配「随机方向」的瓷砖贴图（贴图异步就绪后只执行一次）。
 *
 * 每段使用独立纹理（clone 原纹理，共享底层 image、仅复制 UV 变换），随机决定是否
 * 水平镜像（repeat.x = -1, offset.x = 1；不镜像则 offset.x = 0）。
 *
 * 注意：**不做随机偏移**。随机的 offset 会让相邻墙段的砖缝起点各不相同，
 * 视觉上「砖块/水泥框的间距」忽宽忽窄。这里只允许整块贴图左右翻转，
 * 翻转前后砖缝节奏完全一致，因此各段砖块间距保持均匀，仅方向不同。
 */
function applyRandomWallTextures(ctx: SceneContext) {
  const m = ctx.metro;
  if (m.wallTexApplied) return;
  const base = ctx.metroWallTex;
  if (!base.image) return; // 贴图尚未加载完成，等下一帧再试
  for (const seg of m.walls) {
    const segTex = base.clone();
    if (Math.random() < 0.5) {
      // 水平翻转：镜像需 wrapS=RepeatWrapping 且 offset.x=1 才能正确显示
      segTex.wrapS = THREE.RepeatWrapping;
      segTex.repeat.x = -1;
      segTex.offset.x = 1;
    } else {
      // 不翻转：offset 归零，保证砖缝起点与其它段一致（间距均匀）
      segTex.offset.x = 0;
    }
    segTex.needsUpdate = true;
    (seg.material as THREE.MeshStandardMaterial).map = segTex;
    (seg.material as THREE.MeshStandardMaterial).color.set(0xffffff);
    (seg.material as THREE.MeshStandardMaterial).needsUpdate = true;
  }
  m.wallTexApplied = true;
}

/** 站台滚动与让位（供 scrollMetro 内部调用） */
function scrollMetroPlatforms(ctx: SceneContext, move: number) {
  const m = ctx.metro;
  // 候车厅沿 z 比月台长（见 buildMetroPlatforms 中的 hallLen），
  // 回绕判断须用候车厅的半长，否则端墙尚未越过相机就回绕、会突然消失。
  const halfLenZ = m.platformLength / 2 + METRO.wallSegLen / 2;
  for (const p of m.platforms) {
    p.visible = true;
    p.position.z += move;
    if (p.position.z - halfLenZ > 18) {
      p.position.z -= m.platformCycle;
    }
  }

  // 让位：站台 z 范围内的墙体隐藏。
  // half 与候车厅端墙严格对齐（不加余量）——多出的一截会让洞口比候车厅宽、
  // 在端墙外侧露出缺口；墙段本身按中心网格对齐，允许半个段长的边界误差。
  const half = m.platformLength / 2;
  for (const w of m.walls) {
    const side = w.userData.side as number;
    const segHalf = METRO.wallSegLen / 2;
    let yielded = false;
    for (const p of m.platforms) {
      if ((p.userData.side as number) !== side) continue; // 只让同侧
      const z0 = p.position.z - half;
      const z1 = p.position.z + half;
      // 段与站台 z 区间有重叠 → 让位
      if (w.position.z + segHalf > z0 && w.position.z - segHalf < z1) {
        yielded = true;
        break;
      }
    }
    w.userData.yielded = yielded;
    w.visible = !yielded;
  }
}

/** 地铁场景各物体的显隐（供 applySceneMode 调用） */
export function setMetroVisible(ctx: SceneContext, visible: boolean) {
  const m = ctx.metro;
  // 隧道壁：显示状态额外取决于「是否被站台让位」（yielded），不能一刀切
  for (const w of m.walls) w.visible = visible && !w.userData.yielded;
  for (const c of m.ceilings) c.visible = visible;
  for (const l of m.ceilingLights) l.visible = visible;
  for (const d of m.decor) d.visible = visible;
  for (const p of m.platforms) p.visible = visible;
  // 轨道：程序化钢轨 + 等距枕木（glb 铁轨已停用，仅在其存在时显示）
  m.rails.visible = visible && !m.railway;
  if (m.railway) m.railway.visible = visible;
  if (m.ties) m.ties.visible = visible;
  m.bed.visible = visible;
  for (const o of m.trackFittings) o.visible = visible;
}
