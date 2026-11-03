import * as THREE from "three";

/**
 * 场景构建/滚动的共享上下文。
 *
 * 设计约定（为后续「方案 B：面向对象重构」预留）：
 *   · 顶层字段 = 场景无关的共享依赖（scene / theme / 工具函数 / 模型资源池）；
 *   · `street` / `metro` 命名空间 = 各场景【专属】的状态字段；
 *   · 迁移到 OOP 时，`ctx.street` / `ctx.metro` 可整块搬进对应 Scene 子类的 `this`，
 *     无需逐个字段挑拣。
 */
export interface SceneContext {
  /** 主场景（所有物体挂载于此） */
  scene: THREE.Scene;
  /** 主题色板（只读） */
  theme: ThemeColors;
  /** 共享工具：加载「一段」砖纹+涂鸦墙贴图 */
  loadWallTexture: LoadWallTexture;
  /** 共享工具：加载马路贴图 */
  loadRoadTexture: () => THREE.Texture;
  /** 人行道贴图（人行道构建与球场通道地砖复用；由 ThreeRunner 在构造时创建） */
  sidewalkTex: THREE.CanvasTexture;
  /** 地铁隧道壁贴图（瓷砖墙，从 metroStation.glb 提取；由 ThreeRunner 注入，异步填充 image） */
  metroWallTex: THREE.Texture;
  /** 共享模型资源池（由 loadModels 异步填充，street 场景消费） */
  models: ModelPool;
  /** 当前是否处于街头模式（构建时用来决定新建物体的初始显隐） */
  isStreetActive: () => boolean;

  /** 街头场景专属状态 */
  street: StreetState;
  /** 地铁场景专属状态 */
  metro: MetroState;
}

export type ThemeColors = {
  sky: string;
  ground: string;
  wallL: string;
  wallR: string;
  ink: string;
  yellow: string;
  magenta: string;
  red: string;
  blue: string;
  cyan: string;
  cream: string;
  fog: string;
};

/** 生成一段砖纹+（可选）涂鸦墙贴图的签名 */
export type LoadWallTexture = (
  url: string,
  repeatU: number,
  repeatV: number,
  opts?: {
    outW?: number;
    outH?: number;
    segments?: number;
    noGraffiti?: boolean;
    brickOffset?: number;
  }
) => THREE.Texture;

/** 异步加载的模型资源池（street 场景消费；模型的缩放/朝向校准已在加载时完成） */
export interface ModelPool {
  buildings: THREE.Object3D[];
  cars: THREE.Object3D[];
  /** Mercedes-Benz 190E（mercedes/source/w201.glb，自带 PBR 贴图；人行道停车位随机出现） */
  mercedes: THREE.Object3D | null;
  peds: THREE.Object3D[];
  barriers: THREE.Object3D[];
  palm: THREE.Object3D | null;
  bmx: THREE.Object3D | null;
  streetLight: THREE.Object3D | null;
  hydrant: THREE.Object3D | null;
  bench: THREE.Object3D | null;
  stop: THREE.Object3D | null;
  coin: THREE.Object3D | null;
  basketball: THREE.Object3D | null;
}

/** 街头场景专属状态 */
export interface StreetState {
  /** 沿街墙（左右各切成多段独立 mesh，每段涂鸦唯一） */
  walls: THREE.Mesh[];
  /** 墙根小巷透视 Group（与墙段一一绑定，存于 wall.userData.alley） */
  alleyways: THREE.Group[];
  /** 路边随机装饰 */
  cityDecor: THREE.Object3D[];
  /** 街头行人（带行走动画） */
  pedestrians: THREE.Group[];
  /** 行人骨骼动画播放器 */
  pedMixers: THREE.AnimationMixer[];
  /** 规律间隔路灯带 */
  streetLights: THREE.Object3D[];
  /** 路灯生成计数（决定左右交替相位） */
  streetLightCount: number;
  /** 墙后实体楼房 */
  buildings: BuildingBox[];
  /** 墙外远景层（近排填缝 + 远排天际线，程序化盒子，按视差系数滚动） */
  backdrop: THREE.Object3D[];
  /** 篮球场绕行围墙 */
  courtWraps: THREE.Object3D[];
  /** 球场通道地砖 */
  courtWalkways: THREE.Mesh[];
  /** 篮球场 z 区间（供巷口避让） */
  courtZSlots: Array<{ side: number; z0: number; z1: number }>;
  /** 墙段回绕周期 */
  wallCycle: number;
  /** 楼房回绕周期（与墙一致） */
  buildingCycle: number;
  /** 楼房回收阈值 */
  buildingRecycleZ: number;
}

/** 墙后楼房/球场的数据结构 */
export interface BuildingBox {
  mesh: THREE.Object3D;
  z: number;
  halfD?: number;
  castShadow?: boolean;
  isCourt?: boolean;
  offZ?: number;
}

/** 地铁场景专属状态（构建出的物体 + 回绕参数） */
export interface MetroState {
  /** 隧道壁（滚动分段） */
  walls: THREE.Mesh[];
  /** 天花板（滚动分段） */
  ceilings: THREE.Mesh[];
  /** 天花板灯带（滚动） */
  ceilingLights: THREE.Mesh[];
  /** 隧道装饰（灯带/管道/站牌/应急箱） */
  decor: THREE.Object3D[];
  /** 站台（含向外扩展的候车厅） */
  platforms: THREE.Object3D[];
  /** 钢轨 */
  rails: THREE.Group;
  /** 模型版铁轨（railwayTrack.glb 平铺而成；为空时使用程序化几何 rails 回退） */
  railway: THREE.Group | null;
  /** 等距枕木（InstancedMesh，间距严格相等） */
  ties: THREE.InstancedMesh | null;
  /** 各枕木实例的基准位置（滚动时据此逐实例平移） */
  tiePositions: THREE.Vector3[];
  /** 单条赛道的枕木数量 */
  tiePerLane: number;
  /** 枕木回绕周期（= 间距 × 单条数量） */
  tieCycle: number;
  /** 隧道道床（铺满地面到墙根之间的空隙，消除赛道两侧黑边） */
  bed: THREE.Group;
  /** 道床碎石纹理（滚动时驱动 offset.y 产生贴地移动感，与地面纹理同法） */
  bedTex: THREE.Texture | null;
  /** 第三轨 + 电缆托架等墙根金属构件（随世界滚动） */
  trackFittings: THREE.Object3D[];
  /** 列车模型（已校准：车长沿 z、底部贴地、水平居中；未加载时为 null） */
  trainModel: THREE.Object3D | null;
  /** 当前驶入的列车实例（同一时刻至多一台；为空表示无列车） */
  train: THREE.Object3D | null;
  /** 列车占用赛道（0/1/2） */
  trainLane: number;
  /** 列车当前 z 位置（负值=前方，随驶来逐渐增大） */
  trainZ: number;
  /** 列车自发向前（相对赛道）的速度，单位/秒 */
  trainSpeed: number;
  /** 距下次发车的倒计时（秒） */
  trainCooldown: number;
  /** 隧道壁回绕周期（段数 × 段长） */
  wallCycle: number;
  /** 墙段随机纹理是否已应用（贴图异步加载，就绪后只应用一次） */
  wallTexApplied: boolean;
  /** 站台回绕周期 */
  platformCycle: number;
  /** 站台沿 z 的长度 */
  platformLength: number;
}

/** 街头场景常量 */
export const STREET = {
  /** 墙长（世界单位） */
  wallLen: 220,
  /** 单段墙长（决定沿墙分段数） */
  wallSegLen: 6,
  /** 每段墙贴图分辨率 */
  segTexW: 512,
  segTexH: 384,
  /** 墙所在 x 绝对值，也是楼房临街面要对齐的位置 */
  wallX: 10.5,
  /** 墙体厚度（沿街墙与绕行墙统一使用，保证转角处厚薄一致且能真正相交）。
   *  取值很薄（接近纸片），但必须 > 0：零厚度平面只能与转角墙「相切」，透视下会露缝。 */
  wallThickness: 0.06,
  /** 球场与绕行墙之间的通道宽度 */
  courtGapWidth: 2.0,
} as const;

/** 地铁场景常量（构建与滚动共用，避免两处硬编码不一致） */
export const METRO = {
  /** 单段隧道壁长度（与街头墙一致） */
  wallSegLen: 6,
  /** 隧道总长（用于计算段数与回绕周期） */
  tunnelLen: 220,
  /** 隧道中心 z（构图基准） */
  tunnelCenterZ: -70,
} as const;

/**
 * 场景对象的构造依赖（由 ThreeRunner 注入）。
 * 与 SceneContext 的共享部分一致，但不含 street/metro 状态——那由各自场景实例持有。
 *
 * 注意：`models` 必须以 **getter** 形式注入（见下方 ModelPoolRef 说明），
 * 否则场景实例会持有构造那一刻的过期快照。
 */
export interface SceneDeps {
  scene: THREE.Scene;
  theme: ThemeColors;
  loadWallTexture: LoadWallTexture;
  loadRoadTexture: () => THREE.Texture;
  sidewalkTex: THREE.CanvasTexture;
  /** 地铁隧道壁贴图（瓷砖墙，异步填充 image） */
  metroWallTex: THREE.Texture;
  /**
   * 模型资源池访问器。必须是【每帧读取最新值】的访问器而非快照对象：
   * ThreeRunner 的模型池里，数组字段用 push（引用稳定），
   * 但单个模型字段（palm/bmx/basketball/...）是**加载完成后直接赋值**的；
   * 若在构造时快照，场景会永远看到 null → 依赖这些模型的内容（如篮球场）不会被构建。
   */
  models: () => ModelPool;
  isStreetActive: () => boolean;
}

/**
 * 空的街头状态占位。
 * 供「非街头」场景（如 MetroScene）满足 SceneContext.street 的结构要求：
 * 它不会被真正使用，只是一份惰性空壳，避免跨场景误访问时报错。
 */
export const emptyStreetState: StreetState = {
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

/**
 * 空的地铁状态占位。
 * 供「非地铁」场景（如 StreetScene）满足 SceneContext.metro 的结构要求；
 * `rails` 用 null 占位（不会被真正使用）。
 */
export const emptyMetroState: MetroState = {
  walls: [],
  ceilings: [],
  ceilingLights: [],
  decor: [],
  platforms: [],
  rails: null as unknown as THREE.Group,
  railway: null,
  ties: null,
  tiePositions: [],
  tiePerLane: 0,
  tieCycle: 0,
  bed: null as unknown as THREE.Group,
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
  platformCycle: 200,
  platformLength: 28,
};
