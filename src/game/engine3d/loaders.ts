// ============================================================
// StreetFire 3D Runner —— 资源加载
// 纹理与模型（GLB/OBJ）的加载与预处理。与游戏状态无关，只负责产出资源。
// ============================================================
import * as THREE from "three";
import roadTex from "@/assets/road.png";
import metroWallTile from "@/assets/metro-wall-tile.jpg";
import {
  addCementFrame,
  applyGraffitiToWall,
  makeSeamlessTexture,
} from "./textures";
import { USE_MERCEDES } from "./scenes/types";

/**
 * 加载用户提供的墙面贴图并生成「一段」墙的纹理：会把砖纹重绘到指定尺寸的小 canvas，
 * 叠加唯一随机涂鸦（repeatU=1，本段不沿墙长平铺），再设置随机砖纹偏移避免段间砖缝对齐。
 * 每段调用都独立随机，因此沿整面墙的涂鸦各不相同、完全不重复。
 * noGraffiti=true 时只生成纯砖纹（用于巷子外侧等不需要涂鸦的面），避免额外绘制。
 */
export function loadWallTexture(
  url: string,
  repeatU: number,
  repeatV: number,
  opts?: {
    outW?: number;
    outH?: number;
    segments?: number;
    brickOffset?: number;
    noGraffiti?: boolean;
  }
): THREE.Texture {
  const t = new THREE.Texture();
  new THREE.TextureLoader().load(
    url,
    (loaded) => {
      // 砖纹无缝处理（原图尺寸），随后缩绘到目标尺寸的小 canvas，节省内存
      const seamless = makeSeamlessTexture(loaded.image as HTMLImageElement);
      const outW = opts?.outW ?? 1024;
      const outH = opts?.outH ?? 1024;
      const cv = document.createElement("canvas");
      cv.width = outW;
      cv.height = outH;
      const ctx = cv.getContext("2d")!;
      ctx.drawImage(seamless.image as CanvasImageSource, 0, 0, outW, outH);
      // 叠加唯一写实喷漆涂鸦（分段稀疏布局），每段随机内容（noGraffiti 时跳过）
      if (!opts?.noGraffiti) {
        applyGraffitiToWall(ctx, outW, outH, { segments: opts?.segments });
      }
      t.image = cv;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeatU, repeatV);
      // 砖纹起点固定为 0：各段相位一致，段间砖缝连续，滚动时不跳动
      t.offset.x = opts?.brickOffset ?? 0;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    },
    undefined,
    () => console.error("[streetFire] 墙壁贴图加载失败:", url)
  );
  return t;
}

/** 加载用户提供的马路贴图：图片纵向对应世界 z 轴，沿 z 平铺滚动。 */
export function loadRoadTexture(): THREE.Texture {
  const t = new THREE.Texture();
  new THREE.TextureLoader().load(
    roadTex,
    (loaded) => {
      t.image = loaded.image;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1, 8);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    },
    undefined,
    () => console.error("[streetFire] 马路贴图加载失败:", roadTex)
  );
  return t;
}

/**
 * 加载地铁隧道壁贴图（瓷砖墙）。
 * 贴图来源：从 metroStation.glb 中提取的墙面瓷砖贴图（原 image#2 / 材质 tile_tile），
 * 已导出为 src/assets/metro-wall-tile.jpg 并随构建打包（不再依赖原 glb）。
 * 该贴图需在墙面双向平铺（横向沿 z 反复、纵向沿墙高反复），故做无缝处理并设 Repeat。
 */
export function loadMetroWallTexture(): THREE.Texture {
  const t = new THREE.Texture();
  new THREE.TextureLoader().load(
    metroWallTile,
    (loaded) => {
      // 双向无缝处理：消除平铺时砖缝硬切
      const seamless = makeSeamlessTexture(
        loaded.image as HTMLImageElement,
        512,
        0.1
      );
      // 四周加水泥边框：平铺后每块砖墙之间有水泥间隔（水泥框 + 砖面），
      // 类似 metroStation 原模型里每段墙板被水泥缝分隔的效果。
      const framed = addCementFrame(seamless.image, 512, 0.055, "#7d7d82");
      t.image = framed.image;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      // 墙段尺寸为 1(宽) × 9(高) × 6(长)，可见主面为「高 9 × 长 6」。
      // 平铺 1 次即呈现一整块「水泥框 + 砖面」；如需更小块墙板可增大该值。
      t.repeat.set(0.5, 1);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    },
    undefined,
    () => console.error("[streetFire] 地铁壁贴图加载失败:", metroWallTile)
  );
  return t;
}

/** 模型加载结果（模型池） */
export interface LoadResult {
  carModels: THREE.Object3D[];
  /** Mercedes-Benz 190E（mercedes/source/w201.glb；单独存放，供人行道随机停靠使用） */
  mercedesModel: THREE.Object3D | null;
  buildingModels: THREE.Object3D[];
  pedModels: THREE.Object3D[];
  barrierModels: THREE.Object3D[];
  palmModel: THREE.Object3D | null;
  bmxModel: THREE.Object3D | null;
  streetLightModel: THREE.Object3D | null;
  hydrantModel: THREE.Object3D | null;
  benchModel: THREE.Object3D | null;
  stopModel: THREE.Object3D | null;
  /** 交通信号灯（trafficLight.glb） */
  trafficLightModel: THREE.Object3D | null;
  /** 井盖（manholeLid.glb；平贴地面，可出现在赛道或人行道） */
  manholeModel: THREE.Object3D | null;
  /** 垃圾箱（dumpster.glb；背靠墙壁摆放） */
  dumpsterModel: THREE.Object3D | null;
  /** 垃圾袋（trashBag.glb；垃圾箱旁固定出现 2 个） */
  trashBagModel: THREE.Object3D | null;
  coinModel: THREE.Object3D | null;
  basketballModel: THREE.Object3D | null;
  playerModel: THREE.Object3D | null;
  playerAnims: THREE.AnimationClip[];
  /** 地铁铁轨模型（railwayTrack.glb，已校准为沿 z 平放、按目标长度缩放） */
  railwayTrack: THREE.Object3D | null;
  /** 地铁列车模型（train1.glb，已校准为车长沿 z、底部贴地、水平居中） */
  train: THREE.Object3D | null;
}

/**
 * 清理列车模型自带的「异常凸块」几何（仅保留正常车身）。
 *
 * 背景：train1.glb 存在建模/导出缺陷，除正常车身外壳外还夹带了大量错位的零碎几何
 * （登车踏板、裙板、装饰条、车钩等），裸露并遮挡正常外观。实测这些异常几何共同特征：
 *   位于「车身两侧下半部之外」——即 |x| 超出车厢外壳内收后的宽度，且 z 处于车底高度；
 *   或位于车端最外侧（|y|≥7.3）的居中小块（车钩类）。
 *
 * 做法：在网格局部坐标系下，剔除「三个顶点都落判定盒内」的三角形并重建索引。
 * 判定盒（依据实测几何；局部坐标 x=车宽 ±1.565、y=车长 ±7.5、z=车高 0~3.82）：
 *   A. 车侧下部凸出物：|x| ∈ [0.62, 1.00] 且 z ∈ [-0.05, 1.00]
 *      （车厢外壳在该高度是内收的裙边，正常不会有几何凸出到 |x|>0.62）
 *   B. 车端下方居中凸出件：|x| ≤ 0.45 且 |y| ≥ 7.30 且 z ∈ [-0.05, 1.05]
 *   C. 车头侧面穿壁长条（斜跨门框的蓝色条）：|x| ∈ [1.15, 1.42] 且 y ∈ [5.95, 6.75]
 * 车身主体外壳跨越整个车身，不会整块落入这些小盒，故不会误删车身。
 */
function cleanTrainSideBlocks(mesh: THREE.Mesh) {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return;
  const idx = geo.getIndex();

  // A. 车侧下部凸出物：车底高度的错位零碎件（登车踏板/裙板/装饰条等）
  const inSideBlock = (x: number, z: number) =>
    Math.abs(x) >= 0.62 && Math.abs(x) <= 1.0 && z >= -0.05 && z <= 1.0;
  // B. 车端下方居中凸出件：车钩/排障器类
  const inEndBlock = (x: number, y: number, z: number) =>
    Math.abs(x) <= 0.45 && Math.abs(y) >= 7.3 && z >= -0.05 && z <= 1.05;
  // C. 车头侧面「穿壁而出」的长条凸出物：位于车身内壁与外壁之间(|x| 1.15~1.42)、
  //    车头附近(y 5.95~6.75)，从车底斜向延伸到上部——即镜头里那根斜跨门框的蓝色条。
  //    正常车门外表面在最外(|x|≈1.565)，此处(|x|<1.42)属模型内部穿出的错位几何。
  const inFrontSideStreak = (x: number, y: number) =>
    Math.abs(x) >= 1.15 && Math.abs(x) <= 1.42 && y >= 5.95 && y <= 6.75;
  const inBlock = (x: number, y: number, z: number) =>
    inSideBlock(x, z) || inEndBlock(x, y, z) || inFrontSideStreak(x, y);

  if (idx) {
    const src = idx.array as ArrayLike<number>;
    const keep: number[] = [];
    for (let i = 0; i < src.length; i += 3) {
      const a = src[i],
        b = src[i + 1],
        c = src[i + 2];
      if (
        inBlock(pos.getX(a), pos.getY(a), pos.getZ(a)) &&
        inBlock(pos.getX(b), pos.getY(b), pos.getZ(b)) &&
        inBlock(pos.getX(c), pos.getY(c), pos.getZ(c))
      ) {
        continue; // 判为异常凸块，剔除该三角形
      }
      keep.push(a, b, c);
    }
    if (keep.length === 0) return; // 全被剔除则保守放弃（避免网格空掉）
    if (keep.length === src.length) return; // 无变化则跳过，省开销
    const NewIndex = src.length > 65535 ? Uint32Array : Uint16Array;
    geo.setIndex(new THREE.BufferAttribute(new NewIndex(keep), 1));
    // 同步重算包围盒/球（属性按顶点保留，仅索引被裁剪）
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
}

/**
 * 加载所有装饰/角色模型（GLB/OBJ），返回模型池。
 * 单个模型加载失败仅跳过，不阻断其余装饰构建。
 * @param onBasketballLoaded 篮球场模型加载完成后的后处理回调（修复标线 UV）
 */
export async function loadModels(
  onBasketballLoaded: (model: THREE.Object3D) => void
): Promise<LoadResult> {
  const result: LoadResult = {
    carModels: [],
    mercedesModel: null,
    buildingModels: [],
    pedModels: [],
    barrierModels: [],
    palmModel: null,
    bmxModel: null,
    streetLightModel: null,
    hydrantModel: null,
    benchModel: null,
    stopModel: null,
    trafficLightModel: null,
    manholeModel: null,
    dumpsterModel: null,
    trashBagModel: null,
    coinModel: null,
    basketballModel: null,
    playerModel: null,
    playerAnims: [],
    railwayTrack: null,
    train: null,
  };
  try {
    const { OBJLoader } = await import(
      "three/examples/jsm/loaders/OBJLoader.js"
    );
    const { MTLLoader } = await import(
      "three/examples/jsm/loaders/MTLLoader.js"
    );
    // 各车型目录与文件名（注意大小写，HTTP 路径区分大小写）
    // targetLen：缩放目标车长；kind："car" 进 carModels，"bmx" 单独存 bmxModel（尺寸小）
    const defs = [
      {
        folder: "models/street/vehicles/car1",
        obj: "NormalCar1.obj",
        mtl: "NormalCar1.mtl",
        targetLen: 4.4,
        kind: "car" as const,
      },
      {
        folder: "models/street/vehicles/car2",
        obj: "NormalCar2.obj",
        mtl: "NormalCar2.mtl",
        targetLen: 4.4,
        kind: "car" as const,
      },
      {
        folder: "models/street/vehicles/policeCar",
        obj: "Cop.obj",
        mtl: "Cop.mtl",
        targetLen: 4.4,
        kind: "car" as const,
      },
      {
        folder: "models/street/vehicles/sportsCar1",
        obj: "sportsCar1.obj",
        mtl: "sportsCar1.mtl",
        targetLen: 4.4,
        kind: "car" as const,
      },
      {
        folder: "models/street/vehicles/sportsCar2",
        obj: "sportsCar2.obj",
        mtl: "sportsCar2.mtl",
        targetLen: 4.4,
        kind: "car" as const,
      },
      {
        folder: "models/street/vehicles/suv",
        obj: "suv.obj",
        mtl: "suv.mtl",
        targetLen: 4.4,
        kind: "car" as const,
      },
      {
        folder: "models/street/vehicles/taxi",
        obj: "taxi.obj",
        mtl: "taxi.mtl",
        targetLen: 4.4,
        kind: "car" as const,
      },
      {
        // Mercedes-Benz 190E 1988（用户提供的精细模型，GLB 内嵌全部贴图）
        folder: "models/street/vehicles/mercedes/source",
        obj: "",
        mtl: "",
        glb: "w201.glb",
        targetLen: 4.5,
        kind: "mercedes" as const,
      },
      {
        folder: "models/street/vehicles/bmx",
        obj: "bmx.obj",
        mtl: "bmx.mtl",
        targetLen: 1.4,
        kind: "bmx" as const,
      },
      {
        folder: "models/street/props/palmTree",
        obj: "PalmyraPalmTree.obj",
        mtl: "PalmyraPalmTree.mtl",
        targetLen: 5.0,
        kind: "palm" as const,
      },
      {
        folder: "models/street/props/streetLight",
        obj: "model.obj",
        mtl: "materials.mtl",
        targetLen: 5.0,
        kind: "streetlight" as const,
      },
      {
        folder: "models/shared/barrier1",
        obj: "",
        mtl: "",
        glb: "barrier1.glb",
        targetLen: 1.2,
        kind: "barrier" as const,
      },
      {
        folder: "models/shared/barrier2",
        obj: "",
        mtl: "",
        glb: "barrier2.glb",
        targetLen: 1.2,
        kind: "barrier" as const,
      },
      {
        folder: "models/street/peds/man",
        obj: "",
        mtl: "",
        glb: "man.glb",
        targetLen: 1.8,
        kind: "ped" as const,
      },
      {
        folder: "models/street/peds/beachMan",
        obj: "",
        mtl: "",
        glb: "beachMan.glb",
        targetLen: 1.8,
        kind: "ped" as const,
      },
      {
        folder: "models/street/peds/punk",
        obj: "",
        mtl: "",
        glb: "punk.glb",
        targetLen: 1.8,
        kind: "ped" as const,
      },
      {
        folder: "models/shared/coin",
        obj: "",
        mtl: "",
        glb: "coin.glb",
        targetLen: 0.5,
        kind: "coin" as const,
      },
      {
        folder: "models/street/buildings/building1",
        obj: "",
        mtl: "",
        glb: "building1.glb",
        targetLen: 16,
        kind: "building" as const,
      },
      {
        folder: "models/street/buildings/building2",
        obj: "",
        mtl: "",
        glb: "building2.glb",
        targetLen: 16,
        kind: "building" as const,
      },
      {
        folder: "models/street/buildings/building3",
        obj: "",
        mtl: "",
        glb: "building3.glb",
        targetLen: 16,
        kind: "building" as const,
      },
      {
        folder: "models/street/props/fireHydrant",
        obj: "",
        mtl: "",
        glb: "fireHydrant.glb",
        targetLen: 1.1, // 消防栓约 1.1m 高
        kind: "hydrant" as const,
      },
      {
        folder: "models/street/props/bench",
        obj: "",
        mtl: "",
        glb: "bench.glb",
        targetLen: 2.0, // 长椅长约 2m（长边沿马路方向）
        kind: "bench" as const,
      },
      {
        folder: "models/street/props/stopSign",
        obj: "",
        mtl: "",
        glb: "stopSign.glb",
        targetLen: 2.2, // STOP 牌含立杆约 2.2m 高
        kind: "stop" as const,
      },
      {
        folder: "models/street/props/trafficLight",
        obj: "",
        mtl: "",
        glb: "trafficLight.glb",
        targetLen: 3.4, // 交通信号灯（含立杆）约 3.4m 高
        kind: "trafficlight" as const,
      },
      {
        // 井盖：平贴地面的圆盘，按水平直径缩放（走“水平”分支）
        folder: "models/street/props/manholeLid",
        obj: "",
        mtl: "",
        glb: "manholeLid.glb",
        targetLen: 1.15, // 井盖直径约 1.15m（比常见井盖略大，跑动中更易看见）
        kind: "manhole" as const,
      },
      {
        // 垃圾箱：背靠墙壁摆放（竖直物体，按高度缩放）
        folder: "models/street/props/dumpster",
        obj: "",
        mtl: "",
        glb: "dumpster.glb",
        targetLen: 1.4, // 垃圾箱高约 1.4m
        kind: "dumpster" as const,
      },
      {
        // 垃圾袋：垃圾箱旁固定出现 2 个（竖直物体，按高度缩放）
        folder: "models/street/props/trashBag",
        obj: "",
        mtl: "",
        glb: "trashBag.glb",
        targetLen: 0.75, // 垃圾袋高约 0.75m
        kind: "trashbag" as const,
      },
      {
        folder: "models/street/court/basketballCourt",
        obj: "",
        mtl: "",
        glb: "basketballCourt.glb",
        targetLen: 28, // 篮球场沿马路方向(z)长度基准；高度在 buildBuildings 中压到围墙高
        kind: "basketball" as const,
      },
    ].filter((d) => USE_MERCEDES || d.kind !== "mercedes"); // 关闭开关时跳过 w201.glb 的加载
    const loadOne = async (d: (typeof defs)[number]) => {
      const base = `/${d.folder}/`;
      let obj: THREE.Object3D;
      if (d.glb) {
        // GLB 单文件（模型+材质+贴图打包），路径大小写仍需精确匹配
        const { GLTFLoader } = await import(
          "three/examples/jsm/loaders/GLTFLoader.js"
        );
        const gltf = await new GLTFLoader().setPath(base).loadAsync(d.glb);
        obj = gltf.scene;
        // 保存动画剪辑到 wrapper，供后续行人播放骨骼行走动画
        (obj as any).__animations = gltf.animations;
      } else {
        // MTL/纹理加载失败不应阻断 OBJ 显示：单独容错，失败时 obj 仅用默认材质
        let mtl: any = null;
        try {
          mtl = await new MTLLoader().setPath(base).loadAsync(d.mtl);
          mtl.preload();
        } catch (e) {
          // MTL/纹理加载失败不阻断 OBJ 显示，使用基础材质
        }
        const objLoader = new OBJLoader().setPath(base);
        if (mtl) objLoader.setMaterials(mtl);
        obj = await objLoader.loadAsync(d.obj);
      }
      // 校准：所有校准都施加在内部 obj 上，再用一个 wrapper Group 包裹返回，
      // 这样 buildCityDecor 设置 wrapper 的 position/rotation（朝向）时不会破坏内部校准。
      // 用「仅遍历 Mesh 几何包围盒」计算尺寸（而非 setFromObject），
      // 避免带骨骼动画(SkinnedMesh)的模型因骨骼节点被算入包围盒而产生奇异尺寸/偏移。
      const calcMeshBox = (root: THREE.Object3D) => {
        const box = new THREE.Box3();
        root.updateMatrixWorld(true);
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry) {
            if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
            const tmp = m.geometry.boundingBox!.clone();
            tmp.applyMatrix4(m.matrixWorld);
            box.union(tmp);
          }
        });
        return box;
      };
      const rawSize = new THREE.Vector3();
      calcMeshBox(obj).getSize(rawSize);
      if (d.kind === "manhole") {
        // 井盖：平贴地面的圆盘。若模型是立着建的（最长轴为 y），先绕 X 转平；
        // 再按水平最大尺寸缩放到 targetLen（直径），最后水平居中、底部贴地。
        if (rawSize.y > Math.max(rawSize.x, rawSize.z)) {
          obj.rotation.x = -Math.PI / 2;
        }
        const flatSize = new THREE.Vector3();
        calcMeshBox(obj).getSize(flatSize);
        const dia = Math.max(flatSize.x, flatSize.z);
        const s = dia > 0 ? d.targetLen / dia : 1;
        obj.scale.setScalar(s);
        const b2 = calcMeshBox(obj);
        const c2 = new THREE.Vector3();
        b2.getCenter(c2);
        obj.position.x -= c2.x;
        obj.position.z -= c2.z;
        obj.position.y -= b2.min.y;
      } else if (
        d.kind === "palm" ||
        d.kind === "streetlight" ||
        d.kind === "barrier" ||
        d.kind === "ped" ||
        d.kind === "coin" ||
        d.kind === "building" ||
        d.kind === "hydrant" ||
        d.kind === "stop" ||
        d.kind === "trafficlight" ||
        d.kind === "dumpster" ||
        d.kind === "trashbag"
      ) {
        // 竖直物体（树/路灯）：保持竖直，按高度(y)缩放到 targetLen，底部贴地、水平居中
        const targetH = d.targetLen;
        const scale = rawSize.y > 0 ? targetH / rawSize.y : 1;
        obj.scale.setScalar(scale);
        const box3 = calcMeshBox(obj);
        const c3 = new THREE.Vector3();
        box3.getCenter(c3);
        obj.position.x -= c3.x;
        obj.position.z -= c3.z;
        obj.position.y -= box3.min.y;
      } else {
        // 车/BMX：最长水平轴对齐 z（车长沿行进方向），车长缩放到 targetLen，底部贴地、水平居中
        const dims = [
          { axis: "x", len: rawSize.x },
          { axis: "y", len: rawSize.y },
          { axis: "z", len: rawSize.z },
        ].sort((a, b) => b.len - a.len);
        const calY = dims[0].axis === "x" ? Math.PI / 2 : 0; // 最长轴对齐 z
        obj.rotation.y = calY;
        const size2 = new THREE.Vector3();
        new THREE.Box3().setFromObject(obj).getSize(size2);
        const targetLen = d.targetLen;
        const longestLen = Math.max(size2.x, size2.z); // 水平方向车长
        const scale = longestLen > 0 ? targetLen / longestLen : 1;
        obj.scale.setScalar(scale);
        const box3 = calcMeshBox(obj);
        const c3 = new THREE.Vector3();
        box3.getCenter(c3);
        obj.position.x -= c3.x;
        obj.position.z -= c3.z;
        obj.position.y -= box3.min.y;
      }
      const brighten = d.kind === "barrier";
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = false;
          // 路障提亮：轻微提高基础色亮度、降低粗糙度，避免阴影下过暗但不失真；
          // 车辆保持原始材质不处理
          if (brighten && m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) {
              const sm = mat as THREE.MeshStandardMaterial;
              if (sm.color) {
                sm.color.offsetHSL(0, 0, 0.05); // 轻微提亮
              }
              if (typeof sm.roughness === "number")
                sm.roughness = Math.max(0.4, sm.roughness - 0.12);
              sm.needsUpdate = true;
            }
          }
        }
      });
      const wrapper = new THREE.Group();
      wrapper.add(obj);
      // 把动画剪辑挂到 wrapper 上，供行人播放骨骼行走动画使用
      if ((obj as any).__animations)
        wrapper.userData.animations = (obj as any).__animations;
      return wrapper;
    };
    const results = await Promise.allSettled(defs.map(loadOne));
    for (let k = 0; k < results.length; k++) {
      const res = results[k];
      if (res.status === "fulfilled") {
        const kind = defs[k].kind;
        if (kind === "bmx") result.bmxModel = res.value;
        else if (kind === "palm") result.palmModel = res.value;
        else if (kind === "streetlight") result.streetLightModel = res.value;
        else if (kind === "barrier") result.barrierModels.push(res.value);
        else if (kind === "ped") {
          // 加载完成后先更新世界矩阵，确保 SkinnedMesh 的骨骼/绑定矩阵就绪，
          // 之后 skeletonClone 才能正确复制骨架（否则克隆体可能退化不可见）
          res.value.updateMatrixWorld(true);
          result.pedModels.push(res.value);
        } else if (kind === "coin") result.coinModel = res.value;
        else if (kind === "hydrant") result.hydrantModel = res.value;
        else if (kind === "bench") result.benchModel = res.value;
        else if (kind === "stop") result.stopModel = res.value;
        else if (kind === "trafficlight") result.trafficLightModel = res.value;
        else if (kind === "basketball") {
          // 修复球场线条层白块：Markngs 层 UV 退化为常量 (0,0)（建模导出缺陷），
          // 整面只采样贴图左上角纯白像素 → 线区显示为白块。按包围盒重建 UV 即可。
          onBasketballLoaded(res.value);
          result.basketballModel = res.value;
        } else if (kind === "building") result.buildingModels.push(res.value);
        else if (kind === "mercedes") result.mercedesModel = res.value;
        else if (kind === "manhole") result.manholeModel = res.value;
        else if (kind === "dumpster") result.dumpsterModel = res.value;
        else if (kind === "trashbag") result.trashBagModel = res.value;
        else result.carModels.push(res.value);
      } else {
        // 单个模型加载失败仅跳过、不阻断其余构建；这里打印出来便于排查路径/文件名。
        console.warn(
          `[street] 模型加载失败（kind=${defs[k].kind}, glb=${
            defs[k].glb || defs[k].obj
          }）:`,
          res.reason
        );
      }
    }
    // 加载精致角色模型（character.glb，含 run/jump 骨骼动画）
    try {
      const { GLTFLoader } = await import(
        "three/examples/jsm/loaders/GLTFLoader.js"
      );
      const gltf = await new GLTFLoader()
        .setPath("/models/shared/character/")
        .loadAsync("character.glb");
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      result.playerModel = root;
      result.playerAnims = gltf.animations || [];
      // 诊断：统计角色模型三角面数，便于判断其体积是否过大导致卡顿
      let tris = 0;
      let meshes = 0;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) {
          meshes++;
          const idx = m.geometry.getIndex();
          const pos = m.geometry.getAttribute("position");
          tris += idx ? idx.count / 3 : pos ? pos.count / 3 : 0;
        }
      });
    } catch (e) {
      // 角色模型加载失败则回退到程序化角色，不阻断游戏
      result.playerModel = null;
      result.playerAnims = [];
    }
    // 【已停用】地铁铁轨模型 railwayTrack.glb 的加载。
    // 放弃原因（实测数据）：该模型自带枕木沿轨道的间距在 0.21~0.70 间无规律波动，
    // 无法满足「所有枕木等距」；且整个模型仅 1 个 mesh / 1 个材质，枕木与钢轨不可分离。
    // 现地铁轨道改用「程序化钢轨 + 程序化等距枕木」（见 metroScene.ts 的 buildMetroTies），
    // 故不再发起这 4.2MB 的模型请求。railwayTrack 保持 null。
    result.railwayTrack = null;

    // 加载地铁列车模型（train1.glb）。
    // 该模型为 Sketchfab 导出的电车：局部车长沿 y、车宽沿 x、车高沿 z，且根节点自带旋转矩阵。
    // 处理方式与铁轨一致——按「加载后的实际世界包围盒」自动判断朝向：
    //   · 水平面(x,z)内最长轴 = 车长方向 → 对齐到 z（行进方向），若是 x 则绕 y 转 90°；
    //   · 竖直方向按高度比例缩放，底部贴地、水平居中。
    // 另移除模型自带的灯光节点（Hemi），避免污染场景光照。
    try {
      const { GLTFLoader } = await import(
        "three/examples/jsm/loaders/GLTFLoader.js"
      );
      const gltf = await new GLTFLoader()
        .setPath("/models/metro/train/train1/")
        .loadAsync("train1.glb");
      const root = gltf.scene;
      // 移除自带灯光/相机等非网格节点
      const toRemove: THREE.Object3D[] = [];
      root.traverse((o) => {
        const anyO = o as any;
        if (anyO.isLight || anyO.isCamera) toRemove.push(o);
      });
      // 移除「转向架/底盘总成」网格（Sneltram.Draaistel.001_0）：
      // 其贴图为车轮/弹簧/螺栓等机械零件，但几何高度达 3.64（几乎与车厢等高），
      // 正常转向架应贴地且很矮，属建模/导出缺陷——裸露在车底并遮挡车身，整体剔除。
      root.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh && /draaistel/i.test(mm.name)) toRemove.push(o);
      });
      toRemove.forEach((o) => o.parent?.remove(o));
      // 清理车厢网格里夹带的错位零碎几何（车侧下部凸出物 / 车端下方居中凸出件）
      root.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh && mm.geometry) cleanTrainSideBlocks(mm);
      });
      root.updateMatrixWorld(true);

      const measureBox = (obj: THREE.Object3D) => {
        const b = new THREE.Box3();
        obj.updateMatrixWorld(true);
        obj.traverse((o) => {
          const mm = o as THREE.Mesh;
          if (mm.isMesh && mm.geometry) {
            if (!mm.geometry.boundingBox) mm.geometry.computeBoundingBox();
            const tmp = mm.geometry.boundingBox!.clone();
            tmp.applyMatrix4(mm.matrixWorld);
            b.union(tmp);
          }
        });
        return b;
      };

      const rawBox = measureBox(root);
      const rawSize = new THREE.Vector3();
      rawBox.getSize(rawSize);

      const alongX = rawSize.x >= rawSize.z;
      const horizontalLen = Math.max(rawSize.x, rawSize.z);
      // 目标车长（沿 z）：地铁车厢取约 32 单位（跨度长，与轨道比例协调、视觉冲击强）
      const TARGET_TRAIN_LEN = 32;
      const scale =
        horizontalLen > 0.001 ? TARGET_TRAIN_LEN / horizontalLen : 1;

      const wrapper = new THREE.Group();
      const align = new THREE.Group();
      if (alongX) align.rotation.y = Math.PI / 2;
      align.add(root);
      wrapper.add(align);
      align.scale.setScalar(scale);
      wrapper.updateMatrixWorld(true);

      const box = measureBox(wrapper);
      const c = new THREE.Vector3();
      box.getCenter(c);
      align.position.x -= c.x;
      align.position.z -= c.z;
      align.position.y -= box.min.y;

      root.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh) {
          mm.castShadow = true;
          mm.receiveShadow = false;
        }
      });
      result.train = wrapper;
    } catch (e) {
      // 列车模型加载失败仅跳过（地铁场景将不出现列车），不阻断游戏
      result.train = null;
    }
  } catch (e) {
    console.error("[streetFire] 模型加载失败:", e);
  }
  return result;
}
