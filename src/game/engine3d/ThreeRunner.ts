// ============================================================
// StreetFire 3D Runner —— 基于 Three.js 的伪 3D 无限跑酷
// 风格参考地铁跑酷：三轨道 + 第三人称跟随相机 + 程序化低多边形
// 美术：波普街头卡通风（程序化纹理 + 卡通描边，零外部 3D 资产）
// ============================================================
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

// 程序化 Canvas 纹理与描边工具（抽到独立模块，保持本文件聚焦游戏逻辑）
import {
  addOutline,
  makeCloudTexture,
  makeSidewalkTexture,
  makeSkyTexture,
  makeSpeedLineTexture,
  makeTieTexture,
} from "./textures";
// 场景模块：街头/地铁各自封装为场景对象（见 scenes/）。
// ThreeRunner 作为协调器：只负责生命周期、帧循环与模式切换调度。
import { MetroScene } from "./scenes/metroScene";
import { StreetScene } from "./scenes/streetScene";
import {
  STREET,
  type MetroState,
  type SceneDeps,
  type StreetState,
} from "./scenes/types";
// 常量与类型定义已抽到独立模块（见 constants.ts / types.ts）
import {
  BEST_KEY,
  CAM_LOOK_Y,
  CAM_Y,
  DESPAWN_BEHIND,
  GRAVITY,
  JUMP_V,
  LANES,
  MAGNET_RANGE,
  MAGNET_SPEED_BOOST,
  MAX_SPEED,
  PLAYER_VH,
  PLAYER_Z,
  POWERUP_DURATION,
  POWERUP_GAP_MAX,
  POWERUP_GAP_MIN,
  SPAWN_AHEAD,
  SPEED_RAMP,
  START_SPEED,
} from "./constants";
import type {
  Obstacle,
  Pickup,
  Powerup,
  PowerupKind,
  RunnerState,
  RunnerStats,
  RunnerTheme3D,
} from "./types";
// 资源加载实现（用别名导入，避免与同名私有方法混淆）
import {
  loadMetroWallTexture as loadMetroWallTextureImpl,
  loadModels as loadModelsImpl,
  loadRoadTexture as loadRoadTextureImpl,
  loadWallTexture as loadWallTextureImpl,
} from "./loaders";

// 对外导出类型（保持既有导入路径 @/game/engine3d/ThreeRunner 可用）
export type {
  Obstacle,
  Pickup,
  Powerup,
  PowerupKind,
  RunnerState,
  RunnerStats,
  RunnerTheme3D,
};

export class ThreeRunner {
  // ==================== 渲染核心：画布 / 场景 / 相机 ====================
  private canvas: HTMLCanvasElement;
  private theme: RunnerTheme3D;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private alive = false; // 渲染循环是否常驻（构造即启动）
  private playing = false; // 逻辑（物理/滚动/生成）是否推进

  // ==================== 玩家：位置 / 姿态 / 角色模型与动画 ====================
  private player!: THREE.Group;
  private playerAura!: THREE.Group; // 角色光环（护盾/无敌之躯/磁铁生效时的视觉提示）
  private playerAuraMat!: THREE.MeshBasicMaterial; // 三段光环共享的半透明材质
  private playerLane = 1;
  private playerTargetX = 0;
  private playerY = 0;
  private playerVY = 0;
  private onGround = true;
  private runT = 0;
  private scarf!: THREE.Mesh;
  private armL!: THREE.Mesh;
  private armR!: THREE.Mesh;
  private playerModel: THREE.Object3D | null = null; // 预加载的精致角色 GLB（character.glb）
  private playerAnims: any[] = []; // 角色 GLB 的动画剪辑（run/jump 等）
  private playerMixer: THREE.AnimationMixer | null = null; // 角色骨骼动画播放器
  private playerActionRun: THREE.AnimationAction | null = null; // 奔跑动作
  private playerActionJump: THREE.AnimationAction | null = null; // 跳跃动作
  private playerActionCur: "run" | "jump" = "run"; // 当前播放的动作

  // ==================== 赛道实体：障碍 / 金币 / 道具 / 楼房 ====================
  private obstacles: Obstacle[] = [];
  private pickups: Pickup[] = [];
  private powerups: Powerup[] = []; // 道具（磁铁/护盾/无敌之躯），在跑道随机低频出现
  private buildingModels: THREE.Object3D[] = []; // 预加载的楼房模型集合（随机复用）
  // ==================== 场景环境：地面 / 墙 / 人行道 / 天空 / 粒子 ====================
  private worldGroup: THREE.Group;
  private ground!: THREE.Mesh;
  private groundTex!: THREE.Texture;
  private sidewalks: THREE.Mesh[] = []; // 两侧人行道
  private curbs: THREE.Mesh[] = []; // 红色路缘石
  private sidewalkTex!: THREE.CanvasTexture;
  // ==================== 场景对象（方案 B） ====================
  // 街头/地铁各自封装为一个场景对象，持有本方状态并提供 build/scroll/setVisible。
  // 通过 getter 暴露状态字段，使既有 `this.street.xxx` / `this.metro.xxx` 访问保持不变。
  private streetSceneObj!: StreetScene;
  private metroSceneObj!: MetroScene;
  /** 街头场景专属状态（委托给 StreetScene） */
  private get street(): StreetState {
    return this.streetSceneObj.street;
  }
  /** 地铁场景专属状态（委托给 MetroScene） */
  private get metro(): MetroState {
    return this.metroSceneObj.metro;
  }
  private skyPlane!: THREE.Mesh;
  // 云层：独立平面（贴在天空平板上画的云无法随跑动滚动），随世界做慢速视差滚动
  private clouds: Array<{
    mesh: THREE.Mesh;
    baseOpacity: number;
    speed: number;
  }> = [];
  private cloudDim = 1; // 天色亮度 → 云的明显程度（夜间收敛，避免深蓝夜空刷白云）
  private particleSys: THREE.Points;
  private particleData: { life: number; vx: number; vy: number; vz: number }[] =
    [];
  private speedLines: THREE.Mesh[] = []; // 速度线（沿视野飞过，强化速度感）

  // ==================== 街头装饰与预加载模型池 ====================
  private carModels: THREE.Object3D[] = []; // 预加载的车辆模型集合（clone 随机复用）
  private mercedesModel: THREE.Object3D | null = null; // Mercedes 190E（人行道随机停靠）
  private carEnvMap: THREE.Texture | null = null; // Mercedes 车漆用的环境反射贴图（IBL，懒加载）
  private bmxModel: THREE.Object3D | null = null; // 预加载的 BMX 模型（独立缩放，尺寸小）
  private palmModel: THREE.Object3D | null = null; // 预加载的棕榈树模型
  private streetLightModel: THREE.Object3D | null = null; // 预加载的路灯模型
  private barrierModels: THREE.Object3D[] = []; // 预加载的路障模型（barrier1/2.glb，clone 随机复用）
  private pedModels: THREE.Object3D[] = []; // 预加载的行人模型（man/beachMan/punk，clone 随机复用）
  private coinModel: THREE.Object3D | null = null; // 预加载的得分金币模型（coin.glb）
  private hydrantModel: THREE.Object3D | null = null; // 预加载的消防栓模型（fireHydrant.glb）
  private benchModel: THREE.Object3D | null = null; // 预加载的长椅模型（bench.glb）
  private stopModel: THREE.Object3D | null = null; // 预加载的 STOP 标识牌模型（stopSign.glb）
  private basketballModel: THREE.Object3D | null = null; // 预加载的篮球场模型（basketballCourt.glb）

  // ==================== 游戏状态：计分 / 生成节奏 / 道具计时 ====================
  private stats: RunnerStats;
  private spawnAcc = 0;
  private nextGap = 14;
  private camShake = 0;
  private gameTime = 0; // 累计游戏时间（秒），用于道具到期判定
  private powerupAcc = 0; // 道具生成累加器（与障碍互不干扰，保证低频）
  private nextPowerupGap = 22; // 道具出现间隔（世界单位），偏大以保证低频
  private magnetUntil = 0; // 磁铁生效截止时间（gameTime）
  private shieldUntil = 0; // 护盾生效截止时间
  private invincibleUntil = 0; // 无敌之躯生效截止时间
  // ==================== 场景模式：街头 / 地铁 ====================
  private sceneMode: "street" | "metro" = "street"; // 默认街头场景
  private playerShadow!: THREE.Mesh; // 角色脚下软阴影
  private sunLight!: THREE.DirectionalLight; // 投射阴影的主光（固定世界坐标，不跟随角色）
  private sunTarget!: THREE.Object3D; // 主光目标锚点（固定在赛道中段，使阴影视锥覆盖整条赛道）

  // 事件回调：jump / pickup / crash / move，供外部接入音效
  onEvent: ((type: "jump" | "pickup" | "crash" | "move") => void) | null = null;

  // ==================== 生命周期：构造 / 帧循环 / 销毁 ====================

  constructor(canvas: HTMLCanvasElement, theme: RunnerTheme3D) {
    this.canvas = canvas;
    this.theme = theme;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(theme.sky);
    // 雾色=天空色：远景（墙/楼房/任何远处物体）淡出时溶入蓝天，天然无硬边。
    // near 取较远、far 放长：保留远处楼群的淡剪影（而不是被早早洗白成纯天空色），
    // 让街道纵深有内容、不显空旷；同时仍保证最远端完全溶入天空、无硬边。
    this.scene.fog = new THREE.Fog(theme.sky, 50, 150);

    // 相机抬高、略俯视，并后移，避免角色起跳时遮挡镜头。
    // far 需容纳天空平板的四角（平板在 z=−160、尺寸 900×500，角点距相机最远约 560），
    // 否则天空平板四角会被远裁剪面裁掉、露出背景色，形成色块。
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
    this.camera.position.set(0, CAM_Y, PLAYER_Z + 8.0);
    this.camera.lookAt(0, CAM_LOOK_Y, PLAYER_Z - 6);

    // 灯光：晴朗白天的明亮日光
    const amb = new THREE.AmbientLight(0xffffff, 0.95);
    const key = new THREE.DirectionalLight(0xfff4e0, 1.35); // 暖白阳光（投射阴影）
    // 光源与 target 固定在世界坐标系（不跟随玩家），阴影视锥静态覆盖整条赛道纵深，
    // 否则阴影相机会随玩家平移，远处建筑落到贴图边缘外，出现「跑近才缓缓出现影子」。
    // 位置放在正上方略偏后、仅少量 +X 偏移（偏置过大会导致近处左侧物体阴影消失）。
    key.position.set(14, 60, 36);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); // 2048 配下方较窄视锥，精度接近 4096 且开销降至 1/4
    // 阴影相机以「光源→target」为轴：target 固定在 z≈-30，视锥向两侧对称延伸，
    // 保证近处到跟前与远处都有投影；left/right=±30 覆盖赛道宽；far/top/bottom 收窄，
    // 既能覆盖玩家附近区域（会投影物体已按距相机 <75 动态开关），又显著降低每帧阴影开销。
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 300;
    key.shadow.camera.left = -30;
    key.shadow.camera.right = 30;
    key.shadow.camera.top = 90;
    key.shadow.camera.bottom = -150; // 覆盖近处(玩家身后)到中远处
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.18; // 提高 normalBias 消除斜射光下的 shadow acne 闪烁（经过建筑时尤为明显）
    key.shadow.camera.updateProjectionMatrix();
    this.sunLight = key;
    const fillM = new THREE.DirectionalLight(theme.magenta, 0.18); // 轻微撞色补光，保留波普味
    fillM.position.set(-12, 6, 4);
    const fillC = new THREE.DirectionalLight(theme.cyan, 0.15);
    fillC.position.set(12, 5, -6);
    this.scene.add(amb, key, fillM, fillC);

    // 晴朗天空
    // 尺寸必须足够大：天空平板若尺寸有限，其【边缘之外】会露出 scene.background
    // 的纯色，而平板内部是带半调网点的贴图，两者在平板边缘交界处会形成明显的
    // 明暗色带（速度感起来、视野更广时尤其显眼）。
    // 这里放大到远超 fog 远端 + 相机可视范围，保证边缘永远落在屏幕之外；
    // 纹理用 ClampToEdge，即使极端视角下露出边缘，取到的也是边缘像素色（与天空基色一致）。
    const skyTex = makeSkyTexture(theme.sky, theme.fog);
    skyTex.wrapS = skyTex.wrapT = THREE.ClampToEdgeWrapping;
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.skyPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 500),
      new THREE.MeshBasicMaterial({
        map: skyTex,
        depthWrite: false,
        fog: false, // 天空自身不参与雾计算，避免被雾色二次染色产生色差
      })
    );
    this.skyPlane.position.set(0, 34, -160);
    this.skyPlane.renderOrder = -10; // 作为最远背景最先绘制，避免覆盖天际线等远景
    this.scene.add(this.skyPlane);

    // 云层（独立平面，随跑动做视差滚动；见 buildClouds）
    this.buildClouds(theme);

    // 地面（街头 road.png / 地铁枕木，随场景切换，随世界滚动）
    this.groundTex = this.loadRoadTexture();
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(14.0, 220),
      new THREE.MeshStandardMaterial({
        map: this.groundTex,
        roughness: 0.95,
        metalness: 0.05,
      })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.z = -70;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // 两侧人行道 + 红色路缘石（街头模式）
    this.sidewalkTex = makeSidewalkTexture("#d8c8b0");
    const swGeo = new THREE.PlaneGeometry(3.5, 220);
    const swMat = new THREE.MeshStandardMaterial({
      map: this.sidewalkTex,
      roughness: 0.95,
    });
    const curbGeo = new THREE.BoxGeometry(0.22, 0.12, 220);
    const curbMat = new THREE.MeshStandardMaterial({
      color: theme.red,
      roughness: 0.7,
    });
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(swGeo, swMat);
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(side * 8.75, 0.035, -70);
      sw.receiveShadow = true;
      this.scene.add(sw);
      this.sidewalks.push(sw);
      const curb = new THREE.Mesh(curbGeo, curbMat);
      curb.position.set(side * 7.0, 0.06, -70);
      curb.receiveShadow = true;
      this.scene.add(curb);
      this.curbs.push(curb);
    }

    // 创建两个场景对象（此刻 scene / theme / sidewalkTex 均已就绪）。
    // 它们各自持有本方状态，后续构建/滚动/显隐都通过实例调用。
    const sceneDeps: SceneDeps = {
      scene: this.scene,
      theme,
      loadWallTexture: this.loadWallTexture.bind(this),
      loadRoadTexture: this.loadRoadTexture.bind(this),
      sidewalkTex: this.sidewalkTex,
      // 地铁隧道壁瓷砖贴图（从 metroStation.glb 提取，随构建打包；异步填充 image）
      metroWallTex: loadMetroWallTextureImpl(),
      // 以访问器形式提供模型池：单个模型字段在异步加载完成后才被赋值，
      // 若此处传快照对象，场景实例将永远读到 null（篮球场等依赖模型的內容不会被构建）。
      models: () => ({
        buildings: this.buildingModels,
        cars: this.carModels,
        mercedes: this.mercedesModel,
        peds: this.pedModels,
        barriers: this.barrierModels,
        palm: this.palmModel,
        bmx: this.bmxModel,
        streetLight: this.streetLightModel,
        hydrant: this.hydrantModel,
        bench: this.benchModel,
        stop: this.stopModel,
        coin: this.coinModel,
        basketball: this.basketballModel,
      }),
      isStreetActive: () => this.sceneMode === "street",
    };
    this.streetSceneObj = new StreetScene(sceneDeps);
    this.metroSceneObj = new MetroScene(sceneDeps);

    // 两侧街头墙（street 模式）
    this.streetSceneObj.buildWalls();

    // 地铁隧道主体 / 装饰 / 站台（不依赖外部模型，先同步构建）
    this.metroSceneObj.build();

    // 墙后实体楼房在模型异步加载完成后由 loadModels().finally 中 streetSceneObj.build() 构建
    // 街道路边装饰依赖异步加载的警车模型：先启动加载，完成后再构建（失败也有回退）
    this.loadModels();

    // 世界容器
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);

    // 角色（若 GLB 模型尚未加载完，先以程序化角色占位；加载完成后在 loadModels.finally 中重建）
    this.setupPlayer();

    // 角色脚下软阴影（随横移/起跳贴地，增强真实落地感）
    this.playerShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      })
    );
    this.playerShadow.rotation.x = -Math.PI / 2;
    this.playerShadow.position.set(0, 0.02, PLAYER_Z);
    this.scene.add(this.playerShadow);

    // 主光目标锚定在赛道中段偏玩家侧(z≈-30)，不随玩家漂移。
    // 这样阴影视锥静态覆盖从玩家身后到远处整条赛道，近处(到跟前)与远处建筑都有稳定投影，
    // 不会等玩家跑近才「缓缓浮现」，也不会在到跟前时影子消失。玩家自身软阴影仍由 playerShadow 负责。
    this.sunTarget = new THREE.Object3D();
    this.sunTarget.position.set(0, 0, -30);
    this.scene.add(this.sunTarget);
    this.sunLight.target = this.sunTarget;

    // 粒子
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(360 * 3), 3)
    );
    const pMat = new THREE.PointsMaterial({
      color: theme.yellow,
      size: 0.35,
      sizeAttenuation: true,
    });
    this.particleSys = new THREE.Points(pGeo, pMat);
    this.scene.add(this.particleSys);

    // 速度线：横向白色条纹，沿视野快速飞过，速度越快越明显
    const lineTex = makeSpeedLineTexture();
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 0.5),
        new THREE.MeshBasicMaterial({
          map: lineTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        })
      );
      m.rotation.y = Math.PI / 2; // 朝向相机（横向条纹）
      this.resetSpeedLine(m);
      this.scene.add(m);
      m.visible = false; // 速度线不显示（保留逻辑，需要时置 true 即可启用）
      this.speedLines.push(m);
    }

    this.stats = {
      state: "ready",
      score: 0,
      coins: 0,
      speed: START_SPEED,
      best: Number(localStorage.getItem(BEST_KEY) || 0),
      powerups: [],
    };

    this.resize();
    // 构造即启动常驻渲染循环：即使处于 ready 状态也持续渲染 3D 场景，
    // 否则 renderer.render 从未被调用，canvas 会一直空白（只显示 CSS 宣传画）。
    this.applySceneMode(this.sceneMode, false);
    this.alive = true;
    this.raf = requestAnimationFrame(this.loop);
  }

  // ==================== 资源加载：纹理 / 模型 ====================

  // 加载用户提供的墙面贴图并生成「一段」墙的纹理（实现已抽到 loaders.ts）
  private loadWallTexture(
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
    return loadWallTextureImpl(url, repeatU, repeatV, opts);
  }

  // 加载用户提供的马路贴图（实现已抽到 loaders.ts）
  private loadRoadTexture(): THREE.Texture {
    return loadRoadTextureImpl();
  }

  // 异步加载外部 3D 模型（.obj/.mtl/.glb），实现已抽到 loaders.ts。
  // 加载结果写入本类模型池字段；任意模型失败仅跳过，不阻断游戏。
  private async loadModels() {
    const result = await loadModelsImpl((model) => {
      // 篮球场模型加载完成后的后处理：修复标线 UV
      this.streetSceneObj.fixCourtMarkingUV(model);
    });
    // 写入模型池字段（供场景构建复用）
    this.carModels = result.carModels;
    // 低模车材质升级（Phong 纯色 → 带环境反射的 PBR）：必须在 clone 之前做，
    // 材质是共享的，之后克隆出来的车会直接使用升级后的材质。
    this.polishLowPolyCars(this.carModels);
    this.mercedesModel = result.mercedesModel;
    // 该车走「镜面高光」工作流，必须补环境反射，否则车漆塌成近黑色（见方法注释）
    if (this.mercedesModel) this.applyCarEnvMap(this.mercedesModel);
    this.buildingModels = result.buildingModels;
    this.pedModels = result.pedModels;
    this.barrierModels = result.barrierModels;
    this.palmModel = result.palmModel;
    this.bmxModel = result.bmxModel;
    this.streetLightModel = result.streetLightModel;
    this.hydrantModel = result.hydrantModel;
    this.benchModel = result.benchModel;
    this.stopModel = result.stopModel;
    this.coinModel = result.coinModel;
    this.basketballModel = result.basketballModel;
    this.playerModel = result.playerModel;
    this.playerAnims = result.playerAnims;

    // 街头内容构建（顺序与容错封装在 StreetScene.build 内部）：
    //   先楼房 → 再路边装饰 → 巷口 → 清理巷口装饰。
    this.streetSceneObj.build();
    // 铁轨模型就绪时替换地铁的程序化几何钢轨（失败则保留几何回退）
    this.metroSceneObj.setRailwayModel(result.railwayTrack);
    // 列车模型就绪时注入地铁场景（未加载成功则不出现列车）
    this.metroSceneObj.setTrainModel(result.train);
    // 精致角色模型已就绪时，重建玩家以替换为 GLB
    if (this.playerModel) this.setupPlayer();
    this.applySceneMode(this.sceneMode, false); // 重新应用可见性，使新建楼房按当前模式显示
    // 场景内容发生变化，重置 idle 标记，让静止态再渲染一帧以反映新模型
    this.idleRendered = false;
  }

  /**
   * 构建「户外天空 + 太阳」的 HDR 环境球，供车辆金属漆反射使用。
   *
   * 为什么不用 RoomEnvironment：它是一间灰白室内棚，辐射度低且缺少明暗对比，
   * 实测车漆反射出来只有一层死灰；这里改成天空亮、地平线更亮、地面为街道灰，
   * 并带一颗 HDR 太阳亮斑，车身才会出现金属漆特有的明暗反射条带。
   */
  private buildCarEnvScene(): THREE.Scene {
    const s = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float t = d.y;
          // 天空(上) → 地平线 → 地面(街道反射光)
          vec3 c = mix(vec3(0.32, 0.31, 0.30), vec3(0.72, 0.84, 1.05),
                       smoothstep(-0.30, 0.60, t));
          c += vec3(0.55) * exp(-pow((t - 0.02) * 8.0, 2.0)); // 地平线亮带
          float sd = max(dot(d, normalize(vec3(-0.50, 0.55, 0.66))), 0.0);
          c += vec3(1.30) * pow(sd, 10.0);  // 太阳周围光晕
          c += vec3(9.00) * pow(sd, 300.0); // 太阳本体（亮斑 → 车身高光条）
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), mat));
    return s;
  }

  /**
   * 给精细车辆模型（Mercedes 190E）套用环境反射 + 金属漆参数。
   *
   * 背景：w201.glb 用的是「镜面高光」工作流——所有材质 metalness=0，走
   * KHR_materials_specular，车漆 albedo 只是平均 RGB(47,47,47) 的暗基底，
   * 车身那层银色金属质感**完全来自对环境（天空/地面/周围）的镜面反射**。
   * 本场景没有任何 environment（只有环境光 + 方向光），镜面反射无内容可反射，
   * 于是暗基底直接呈现出近黑色 + 无光泽的「塑料感」。
   *
   * 实测（本地 headless 渲染对比多组参数）结论：
   *   · 仅挂 envMap 不够——metalness=0 时镜面反射率被物理地板压在 4%，几乎不可见；
   *   · 必须把车漆转成「金属漆」近似：metalness≈0.9 + 提亮底色（albedo×3）+
   *     低粗糙度 + 强环境强度，才能在游戏光照下呈现亮银金属；
   *   · 其余件（镀铬/轮毂/玻璃）本就靠反射，给中等强度即可；轮胎/内饰只补环境光。
   * 材质在 clone 之间共享，设置一次即对全部实例生效；其它物体材质不动，
   * 以免破坏街头既有的卡通美术风格。
   */
  /** 懒加载车辆环境反射贴图（Mercedes 与低模车共用同一套） */
  private ensureCarEnvMap(): THREE.Texture {
    if (!this.carEnvMap) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = this.buildCarEnvScene();
      this.carEnvMap = pmrem.fromScene(envScene, 0.02).texture;
      pmrem.dispose();
      envScene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          (m.material as THREE.Material | undefined)?.dispose?.();
        }
      });
    }
    return this.carEnvMap;
  }

  private applyCarEnvMap(root: THREE.Object3D) {
    const env = this.ensureCarEnvMap();
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat || seen.has(mat)) continue;
        seen.add(mat);
        const pbr = mat as THREE.MeshStandardMaterial;
        if (!("envMap" in pbr)) continue; // 仅 PBR 材质支持环境反射
        const name = (pbr.name || "").toLowerCase();
        pbr.envMap = env;
        if (/paint/.test(name)) {
          // 车漆 → 金属银漆近似（原始 albedo 过暗，提亮后作为金属反射率 F0）
          pbr.envMapIntensity = 3.5;
          if (typeof pbr.roughness === "number")
            pbr.roughness = Math.min(pbr.roughness, 0.08);
          pbr.metalness = 0.9;
          if (!pbr.userData.__carPaintLifted) {
            pbr.color.multiplyScalar(3);
            pbr.userData.__carPaintLifted = true;
          }
        } else if (/chrome|rim|mirror|badge|glass/.test(name)) {
          // 镀铬件/轮毂/镜面/玻璃：强反射
          pbr.envMapIntensity = 1.4;
          if (typeof pbr.roughness === "number")
            pbr.roughness = Math.min(pbr.roughness, 0.18);
        } else {
          // 轮胎/内饰等：只补一点环境光，避免整体发亮失真
          pbr.envMapIntensity = 0.6;
        }
        // 各向异性过滤：斜视角度看车身时，车牌/徽标/木纹等贴图不再糊成一团
        for (const key of Object.keys(pbr)) {
          if (key === "envMap") continue; // PMREM 环境贴图不参与各向异性
          const tex = (pbr as any)[key] as THREE.Texture | undefined;
          if (!tex || !tex.isTexture) continue;
          if (tex.anisotropy === maxAniso) continue;
          tex.anisotropy = maxAniso;
          tex.needsUpdate = true;
        }
        pbr.needsUpdate = true;
      }
    });
  }

  /**
   * 低模车（OBJ + MTL）质感提升。
   *
   * 现状：这些车只有 MTL 里的纯色 Kd（MTLLoader 产出的是 MeshPhongMaterial），
   * 既没有贴图也没有任何环境反射，在本场景的直射光下就是几块死板的塑料板——
   * 之前那种「低像素」观感主要来自这里，而不是面数。
   *
   * 做法：统一换成 MeshStandardMaterial（保留原色与材质名），按材质名区分
   * 车漆 / 车窗 / 前灯 / 尾灯 / 轮胎轮毂，各给一套金属度-粗糙度，并套上与
   * Mercedes 相同的环境反射；前后灯补自发光，左侧车道迎面停的车灯就会亮起来。
   * 材质在 clone 之间共享，处理一次即对所有实例生效。
   */
  private polishLowPolyCars(models: THREE.Object3D[]) {
    if (models.length === 0) return;
    const env = this.ensureCarEnvMap();
    const cache = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const convert = (mat: THREE.Material): THREE.MeshStandardMaterial => {
      const hit = cache.get(mat);
      if (hit) return hit;
      const src = mat as THREE.MeshPhongMaterial;
      const std = new THREE.MeshStandardMaterial({
        name: src.name,
        color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
        side: src.side,
        transparent: src.transparent,
        opacity: src.opacity ?? 1,
        envMap: env,
      });
      const n = (src.name || "").toLowerCase();
      if (/window|glass/.test(n)) {
        // 车窗：接近黑玻璃 + 强反射（低模车没有内饰细节，靠反射出环境才不闷）
        std.color.setRGB(0.05, 0.07, 0.09);
        std.roughness = 0.06;
        std.metalness = 0.9;
        std.envMapIntensity = 2.4;
      } else if (/tail/.test(n)) {
        // 尾灯：暗红自发光
        std.color.multiplyScalar(1.5);
        std.emissive = new THREE.Color(0x8e160f);
        std.emissiveIntensity = 0.9;
        std.roughness = 0.35;
        std.metalness = 0.2;
        std.envMapIntensity = 1.2;
      } else if (/head/.test(n)) {
        // 前灯：暖白自发光（对面车道的车头等于是亮的）
        std.color.multiplyScalar(1.6);
        std.emissive = new THREE.Color(0xffd7a3);
        std.emissiveIntensity = 1.1;
        std.roughness = 0.3;
        std.metalness = 0.2;
        std.envMapIntensity = 1.2;
      } else if (/black|grey|gray|tire|tyre|rim|wheel|bumper/.test(n)) {
        // 轮胎 / 保险杠 / 轮毂：哑光，不抢漆面的反光
        std.color.multiplyScalar(1.15); // 原色接近纯黑，提一点避免糊成一团
        std.roughness = 0.6;
        std.metalness = 0.25;
        std.envMapIntensity = 0.8;
      } else {
        // 车漆：金属漆近似（低粗糙度 + 中等金属度 + 环境反射）
        std.color.multiplyScalar(1.06);
        std.roughness = 0.26;
        std.metalness = 0.45;
        std.envMapIntensity = 1.5;
      }
      cache.set(mat, std);
      return std;
    };
    for (const root of models) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.material) return;
        m.material = Array.isArray(m.material)
          ? m.material.map((x) => convert(x))
          : convert(m.material);
      });
      // 用「前灯网格」判定这辆车的车头在哪一侧（各车型 OBJ 的建模朝向并不统一）。
      // 结果写到 userData.frontZ（+1 / -1），摆放到赛道时据此决定要不要转 180°，
      // 否则会出现"一半车迎面、一半车倒着停"的混乱。
      root.updateMatrixWorld(true);
      const whole = new THREE.Box3();
      const head = new THREE.Box3();
      let hasHead = false;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.geometry) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
        whole.union(bb);
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        if (mats.some((x) => /head/i.test(x?.name || ""))) {
          head.union(bb);
          hasHead = true;
        }
      });
      if (hasHead && !whole.isEmpty() && !head.isEmpty()) {
        const cz = (whole.min.z + whole.max.z) / 2;
        const hz = (head.min.z + head.max.z) / 2;
        root.userData.frontZ = hz >= cz ? 1 : -1;
      }
    }
  }

  // ==================== 云层 ====================

  /** 云的近端回收线（越过即回收到远端）与循环跨度 */
  private static readonly CLOUD_NEAR_Z = -108;
  private static readonly CLOUD_SPAN = 132;

  /**
   * 云层：一组独立平面，位于天空平板之前、远景楼之后。
   *
   * 为什么不做进天空贴图：画在 z=−160 静态平板上的云，跑动时永远钉在同一处，
   * 完全没有位移；做成独立平面后可以按 <1 的系数随世界后移，形成"云在缓慢后退"的纵深，
   * 速度感起来时天空也会跟着有变化，而不是一张不动的背景图。
   */
  private buildClouds(theme: RunnerTheme3D) {
    const near = ThreeRunner.CLOUD_NEAR_Z;
    const span = ThreeRunner.CLOUD_SPAN;
    // 3 张形状不同的云贴图轮换使用：同一张图反复出现会强化「贴图重复」的假感
    const texes = [1, 2, 3].map((seed) => makeCloudTexture(seed));
    for (let i = 0; i < 15; i++) {
      const w = 110 + Math.random() * 150;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, w * (0.4 + Math.random() * 0.18)),
        new THREE.MeshBasicMaterial({
          map: texes[i % texes.length],
          transparent: true,
          depthWrite: false,
          fog: false, // 云属于天空层，不吃雾，否则会被洗成雾色
          opacity: 0,
          // 水平翻转用 scale.x = -1 实现，会反转三角形绕序，需双面渲染
          side: THREE.DoubleSide,
        })
      );
      // 水平翻转 + 轻微旋转：让同一张贴图也呈现出不同的云形
      mesh.scale.x = Math.random() > 0.5 ? -1 : 1;
      mesh.rotation.z = (Math.random() - 0.5) * 0.14;
      const z = near - Math.random() * span;
      mesh.position.set(
        (Math.random() - 0.5) * 320,
        40 + Math.random() * 42,
        z
      );
      mesh.renderOrder = -9; // 紧随天空之后绘制
      this.scene.add(mesh);
      this.clouds.push({
        mesh,
        baseOpacity: 0.58 + Math.random() * 0.37,
        speed: ThreeRunner.cloudSpeedFor(z, near, span),
      });
    }
    this.cloudDim = ThreeRunner.cloudDimFor(theme.sky);
    this.updateClouds(0); // 先算一次透明度：待机（未开始跑）时云也要可见
  }

  /** 云的视差速度：越近（z 越大）越快、越远越慢，形成层次而不是整齐平移 */
  private static cloudSpeedFor(z: number, near: number, span: number) {
    const depth = Math.min(1, Math.max(0, (near - z) / span)); // 0=最近 1=最远
    return 0.5 - depth * 0.36;
  }

  /** 天色亮度 → 云的明显程度（深蓝夜空上刷白云非常假，夜间必须收敛） */
  private static cloudDimFor(sky: string): number {
    const c = new THREE.Color(sky);
    const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    return Math.min(1, Math.max(0.12, lum * 1.7));
  }

  /** 0→1 平滑过渡（云的淡入淡出用） */
  private static smooth01(a: number, b: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /**
   * 云层滚动：各自按系数随世界后移，越过近端后回收到远端并重新随机位置。
   * 近端淡出、远端淡入，坐标跳变只发生在完全透明时，看不出来。
   */
  private updateClouds(move: number) {
    const near = ThreeRunner.CLOUD_NEAR_Z;
    const span = ThreeRunner.CLOUD_SPAN;
    for (const c of this.clouds) {
      const p = c.mesh.position;
      p.z += move * c.speed;
      if (p.z > near) {
        p.z -= span;
        p.x = (Math.random() - 0.5) * 320;
        p.y = 40 + Math.random() * 42;
        c.speed = ThreeRunner.cloudSpeedFor(p.z, near, span); // 换位后按新深度取速度
      }
      const fadeOut = 1 - ThreeRunner.smooth01(near - 30, near, p.z);
      const fadeIn = ThreeRunner.smooth01(near - span, near - span + 34, p.z);
      (c.mesh.material as THREE.MeshBasicMaterial).opacity =
        c.baseOpacity * this.cloudDim * fadeIn * fadeOut;
    }
  }

  // ==================== 场景搭建：街头装饰 / 巷口 / 路灯 / 楼房 ====================

  // 街头路边装饰（棕榈树 / 警车 / BMX 小轮车 / 电线杆路灯 / 垃圾桶 / 涂鸦海报 / 行人），
  // 放在墙的轨道内侧（x≈±6.2），随世界滚动。LA 90 年代街头风格。
  // 装饰采用「动态持续生成 + 回收」：初始填充一段后，滚动时把越过相机的移除，

  // ==================== 玩家构建与障碍/金币/道具生成 ====================

  // 创建/重建玩家（含光环）。GLB 模型异步加载完成后可再次调用以替换为精致角色，
  // 替换时会移除旧玩家并复用当前车道/高度状态。
  private setupPlayer() {
    if (this.player) {
      this.scene.remove(this.player); // 移除旧玩家（连带其下光环）
      this.player = undefined as any; // 标记待重建
    }
    const p = this.buildPlayer();
    p.position.set(LANES[this.playerLane], this.playerY, PLAYER_Z);
    this.scene.add(p);
    this.player = p;

    // 角色光环：道具生效时的视觉提示（护盾=奶白、无敌=品红、磁铁=青）。
    // 改为「三段式」半透明有立体感的光环：三段环弧均匀分布在身体腰部、彼此留有间隙不相交，
    // 整体缓慢旋转，呈现环绕角色的光环效果（不再用球体包裹身体）。
    this.playerAuraMat = new THREE.MeshBasicMaterial({
      color: this.theme.cream,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.playerAura = new THREE.Group();
    const AURA_RADIUS = 0.95; // 光环环绕身体的半径
    const AURA_TUBE = 0.09; // 环管粗细，提供立体厚度感
    const AURA_ARC = Math.PI * 0.55; // 每段弧长（约 99°），与相邻段留有空隙不相交
    const segCount = 3;
    for (let i = 0; i < segCount; i++) {
      const arc = new THREE.Mesh(
        // torus 默认在 XY 平面，rotation.x=PI/2 使其水平环绕身体(Y 轴)
        new THREE.TorusGeometry(AURA_RADIUS, AURA_TUBE, 10, 28, AURA_ARC),
        this.playerAuraMat
      );
      arc.rotation.x = Math.PI / 2;
      // 三段均匀分布：每段占 AURA_ARC，间隙均匀相位错开保证不相交
      arc.rotation.z = (i * (Math.PI * 2)) / segCount;
      this.playerAura.add(arc);
    }
    this.playerAura.position.y = 1.0; // 环绕身体腰部
    this.player.add(this.playerAura);
  }

  private buildPlayer(): THREE.Group {
    const g = new THREE.Group();

    // 优先使用精致角色 GLB（character.glb，含骨骼动画）；加载失败时回退到程序化角色
    if (this.playerModel) {
      const model = skeletonClone(this.playerModel) as THREE.Object3D;
      // 仅用网格几何包围盒计算尺寸/居中/贴地，避免 SkinnedMesh 骨骼节点干扰
      const meshBox = (root: THREE.Object3D) => {
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
      const targetH = 2.1; // 角色目标身高，调大一点使其更显眼（此前 1.7 偏小）
      const raw = new THREE.Vector3();
      meshBox(model).getSize(raw);
      const scale = raw.y > 0 ? targetH / raw.y : 1;
      model.scale.setScalar(scale);
      // 缩放后重新计算居中（水平居中）与贴地（底部 y=0）
      const box2 = meshBox(model);
      const c2 = new THREE.Vector3();
      box2.getCenter(c2);
      model.position.x -= c2.x;
      model.position.z -= c2.z;
      model.position.y -= box2.min.y;
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = false;
        }
      });
      // 内 wrapper：承载朝向校正。跑酷中角色应面朝前进方向 -z（即背对镜头）。
      // 多数角色 GLB 默认面朝 +z（朝向相机），绕 Y 轴转 180° 使其背对镜头（面朝 -z）。
      const inner = new THREE.Group();
      inner.rotation.y = Math.PI;
      inner.add(model);
      g.add(inner);

      // 骨骼动画：匹配 run / jump 动作，缺失时回退到可用动作
      if (this.playerAnims.length > 0) {
        this.playerMixer = new THREE.AnimationMixer(model);
        const findClip = (re: RegExp) =>
          this.playerAnims.find((a) => re.test(a.name));
        // run：优先 Robot_Running（跑酷），其次 Robot_Walking；务必排除 Idle/Standing 等静止动作
        // 注意：子串匹配 /run/i 也会命中 Running，但数组里 Idle 在前会被误选，故用「含 Running 或 Walking
        // 且不含 Idle/Stand/Sit」的精准正则，确保选到真正的移动动作。
        const runClip =
          findClip(/(running|walk(?!jump))/i) ||
          findClip(/run|walk/i) ||
          this.playerAnims[0];
        // jump：优先 Robot_Jump（纯跳），其次 Robot_WalkJump；排除其它动作
        const jumpClip =
          findClip(/jump/i) ||
          (this.playerAnims.length > 1 ? this.playerAnims[1] : runClip);
        this.playerActionRun = this.playerMixer.clipAction(runClip);
        this.playerActionJump = this.playerMixer.clipAction(jumpClip);
        this.playerActionRun.enabled = true;
        this.playerActionRun.reset().play();
        this.playerActionCur = "run";
      } else {
        console.warn("[streetFire] 角色模型未携带任何动画片段");
      }
      return g;
    }

    const ink = this.theme.ink;
    const mat = (c: string, opts: { rough?: number; metal?: number } = {}) =>
      new THREE.MeshStandardMaterial({
        color: c,
        roughness: opts.rough ?? 0.55,
        metalness: opts.metal ?? 0,
      });
    // 整体缩小到接近真人比例，避免起跳时遮挡镜头
    const S = 0.62;
    // 身体
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 0.8, 6, 12),
      mat(this.theme.red)
    );
    body.position.y = 1.1;
    addOutline(body, ink);
    // 头
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.95, 0.95),
      mat(this.theme.yellow)
    );
    head.position.y = 2.15;
    addOutline(head, ink);
    // 黑框眼镜
    const glasses = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.28, 0.12),
      mat(ink)
    );
    glasses.position.set(0, 2.2, 0.48);
    // 帽子（波普小帽）
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.3, 1.1),
      mat(this.theme.magenta)
    );
    cap.position.y = 2.7;
    addOutline(cap, ink);
    // 手臂
    this.armL = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.85, 0.22),
      mat(ink)
    );
    this.armL.position.set(-0.62, 1.2, 0);
    this.armR = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.85, 0.22),
      mat(ink)
    );
    this.armR.position.set(0.62, 1.2, 0);
    // 腿
    const legGeo = new THREE.BoxGeometry(0.3, 0.95, 0.3);
    const legL = new THREE.Mesh(legGeo, mat(ink));
    legL.position.set(-0.25, 0.48, 0);
    legL.name = "legL";
    const legR = new THREE.Mesh(legGeo, mat(ink));
    legR.position.set(0.25, 0.48, 0);
    legR.name = "legR";
    // 飘动围巾（品红）
    this.scarf = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 1.4),
      mat(this.theme.magenta)
    );
    this.scarf.position.set(0, 1.7, -0.6);
    addOutline(this.scarf, ink);
    g.add(
      body,
      head,
      glasses,
      cap,
      this.armL,
      this.armR,
      legL,
      legR,
      this.scarf
    );
    g.scale.setScalar(S);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
    return g;
  }

  private makeObstacle(kind: Obstacle["kind"], lane: number): Obstacle {
    const group = new THREE.Group();
    const ink = this.theme.ink;
    // 停/坏在赛道上的车辆：复用已加载的车辆模型（精细 Mercedes 概率更高，其余随机低模车）。
    // 车比路障长得多：判定半长单独给（halfZ），否则用路障的 1.0 窗口会在车头刚贴到
    // 人物时还没判定、等人跑到车身中间才触发，视觉上就是"穿过车头"。
    if (kind === "car") {
      const src =
        this.mercedesModel && Math.random() < 0.35
          ? this.mercedesModel
          : this.carModels.length > 0
          ? this.carModels[Math.floor(Math.random() * this.carModels.length)]
          : null;
      if (src) {
        const car = src.clone(true);
        car.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = false;
          }
        });
        // 朝向按车道区分：最左车道迎面朝玩家（看得到前灯），中间/最右车道朝前方。
        // 车头原本朝哪一侧由前灯网格判定（polishLowPolyCars 写入 userData.frontZ），
        // 各车型建模朝向不统一也能摆正。
        const frontZ = (src.userData.frontZ as number) ?? 1;
        const yawAway = frontZ > 0 ? Math.PI : 0; // 车头朝 -z（车尾对镜头）
        car.rotation.y = lane === 0 ? yawAway + Math.PI : yawAway;
        group.add(car);
      } else {
        // 模型未就绪时的回退：极简低模车（车身 + 车顶 + 四个轮子）
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 0.62, 4.2),
          new THREE.MeshStandardMaterial({
            color: this.theme.cream,
            roughness: 0.35,
            metalness: 0.5,
          })
        );
        body.position.y = 0.55;
        const cabin = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 0.5, 1.9),
          new THREE.MeshStandardMaterial({
            color: this.theme.ink,
            roughness: 0.25,
            metalness: 0.4,
          })
        );
        cabin.position.set(0, 1.05, -0.2);
        group.add(body, cabin);
        for (const wx of [-0.85, 0.85])
          for (const wz of [-1.4, 1.4]) {
            const wheel = new THREE.Mesh(
              new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12),
              new THREE.MeshStandardMaterial({
                color: 0x141414,
                roughness: 0.7,
              })
            );
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(wx, 0.38, wz);
            group.add(wheel);
          }
      }
      group.position.set(LANES[lane], 0, SPAWN_AHEAD);
      return {
        mesh: group,
        lane,
        z: SPAWN_AHEAD,
        topY: 1.45, // 车顶高度：起跳能越过，跑步撞上
        halfZ: 2.2, // 车身半长
        kind: "car",
      };
    }
    // 优先使用真实 barrier 模型（barrier1/2.glb），未加载时回退到程序化几何
    if (this.barrierModels.length > 0) {
      const src =
        this.barrierModels[
          Math.floor(Math.random() * this.barrierModels.length)
        ];
      const mesh = src.clone(true);
      group.add(mesh);
      group.position.set(LANES[lane], 0, SPAWN_AHEAD);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      return { mesh: group, lane, z: SPAWN_AHEAD, topY: 1.0, kind: "cone" };
    }
    if (kind === "cone") {
      // 雪糕筒：主体 + 两道反光条 + 底座，塑料微光泽
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.62, 1.15, 16),
        new THREE.MeshStandardMaterial({
          color: this.theme.magenta,
          roughness: 0.35,
          metalness: 0.1,
        })
      );
      cone.position.y = 0.58;
      addOutline(cone, ink);
      const stripe1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.52, 0.26, 16),
        new THREE.MeshStandardMaterial({
          color: this.theme.cream,
          emissive: this.theme.cream,
          emissiveIntensity: 0.15,
        })
      );
      stripe1.position.y = 0.62;
      const stripe2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.46, 0.56, 0.22, 16),
        new THREE.MeshStandardMaterial({
          color: this.theme.cream,
          emissive: this.theme.cream,
          emissiveIntensity: 0.15,
        })
      );
      stripe2.position.y = 0.92;
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.12, 1.2),
        new THREE.MeshStandardMaterial({
          color: this.theme.magenta,
          roughness: 0.5,
        })
      );
      base.position.y = 0.06;
      group.add(cone, stripe1, stripe2, base);
      group.position.set(LANES[lane], 0, SPAWN_AHEAD);
      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      return { mesh: group, lane, z: SPAWN_AHEAD, topY: 1.15, kind };
    } else {
      // 消防栓：金属红柱 + 球冠 + 两道凸环 + 底座法兰 + 出水口，金属高光
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.42, 1.25, 16),
        new THREE.MeshStandardMaterial({
          color: this.theme.red,
          roughness: 0.3,
          metalness: 0.65,
        })
      );
      post.position.y = 0.63;
      addOutline(post, ink);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 16, 16),
        new THREE.MeshStandardMaterial({
          color: this.theme.red,
          roughness: 0.3,
          metalness: 0.65,
        })
      );
      cap.position.y = 1.32;
      addOutline(cap, ink);
      const ring1 = new THREE.Mesh(
        new THREE.TorusGeometry(0.44, 0.09, 8, 18),
        new THREE.MeshStandardMaterial({
          color: this.theme.ink,
          roughness: 0.5,
        })
      );
      ring1.rotation.x = Math.PI / 2;
      ring1.position.y = 0.5;
      const ring2 = new THREE.Mesh(
        new THREE.TorusGeometry(0.4, 0.08, 8, 18),
        new THREE.MeshStandardMaterial({
          color: this.theme.ink,
          roughness: 0.5,
        })
      );
      ring2.rotation.x = Math.PI / 2;
      ring2.position.y = 0.95;
      // 两侧出水口
      for (const sx of [-1, 1]) {
        const noz = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8),
          new THREE.MeshStandardMaterial({
            color: 0x9a9a9a,
            roughness: 0.4,
            metalness: 0.7,
          })
        );
        noz.rotation.z = Math.PI / 2;
        noz.position.set(sx * 0.42, 0.78, 0);
        group.add(noz);
      }
      const flange = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.55, 0.12, 16),
        new THREE.MeshStandardMaterial({
          color: this.theme.red,
          roughness: 0.4,
          metalness: 0.6,
        })
      );
      flange.position.y = 0.06;
      group.add(post, cap, ring1, ring2, flange);
      group.position.set(LANES[lane], 0, SPAWN_AHEAD);
      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      return { mesh: group, lane, z: SPAWN_AHEAD, topY: 1.5, kind };
    }
  }

  private makePickup(lane: number, z: number, y: number): Pickup {
    // 优先使用真实金币模型（coin.glb），未加载时回退到程序化八面体
    if (this.coinModel) {
      const mesh = this.coinModel.clone(true);
      mesh.position.set(LANES[lane], y, z);
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          // 增强金币亮度：金属材质在缺少环境贴图时会偏暗，
          // 这里加金色自发光 + 适度金属/粗糙，使其始终明亮醒目
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            const sm = mat as THREE.MeshStandardMaterial;
            if (sm && "emissive" in sm) {
              sm.emissive = new THREE.Color(0xffd24a);
              sm.emissiveIntensity = 0.55;
              sm.metalness = Math.min(sm.metalness ?? 1, 0.6);
              sm.roughness = Math.max(sm.roughness ?? 0.5, 0.35);
              sm.needsUpdate = true;
            }
          }
        }
      });
      return { mesh, lane, z, taken: false };
    }
    // 缩小体积 + 半透明，避免遮挡后方障碍物视野
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34),
      new THREE.MeshStandardMaterial({
        color: this.theme.cyan,
        emissive: this.theme.cyan,
        emissiveIntensity: 0.7,
        roughness: 0.25,
        metalness: 0.2,
        transparent: true,
        opacity: 0.55,
      })
    );
    addOutline(mesh, this.theme.ink);
    mesh.position.set(LANES[lane], y, z);
    return { mesh, lane, z, taken: false };
  }

  setTheme(theme: RunnerTheme3D) {
    this.theme = theme;
    (this.scene.background as THREE.Color).set(theme.sky);
    (this.scene.fog as THREE.Fog).color.set(theme.sky); // 雾色=天空色，远景淡出无硬边
    // 云层亮度随天色调整（夜跑不应该有扎眼的白云）
    this.cloudDim = ThreeRunner.cloudDimFor(theme.sky);
    // 天空平板贴图按新主题重绘（渐变/云/地平线都取自天空色，不重绘会残留旧主题天色）
    const skyMat = this.skyPlane?.material as THREE.MeshBasicMaterial | undefined;
    if (skyMat) {
      skyMat.map?.dispose();
      const tex = makeSkyTexture(theme.sky, theme.fog);
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      skyMat.map = tex;
      skyMat.needsUpdate = true;
    }
    // 街头墙壁使用用户提供的砖墙贴图（图片资源，setTheme 时无需重设）
    (this.particleSys.material as THREE.PointsMaterial).color.set(theme.yellow);
    this.applySceneMode(this.sceneMode, false);
  }

  // ==================== 场景模式切换 / 重置 ====================

  // 切换街头 / 地铁场景
  // 切换场景视为「换一张地图」：重置整局游戏（障碍/金币/道具全部重新随机生成、
  // 分数归零、角色回到中间赛道），避免上一场景残留的赛道道具错位。
  // 顺序必须是：先切换场景显隐 → 再 reset（reset 内的 openingRun 依赖当前场景）。
  setSceneMode(mode: "street" | "metro") {
    if (mode === this.sceneMode) return;
    this.sceneMode = mode;
    this.applySceneMode(mode, true);
    // 重置并重新开始（无论此前是进行中 / 已结束 / 未开始；reset 内含列车回收）
    this.reset();
    // 保持原状态语义：若此前正在游玩则继续游玩，否则停在 ready（由外部 start 控制）
    if (this.playing) {
      this.stats.state = "playing";
      this.clock.getDelta(); // 丢弃切换期间累积的时间，避免切场景后瞬移一大步
    } else {
      this.stats.state = "ready";
    }
    this.idleRendered = false;
  }

  private applySceneMode(mode: "street" | "metro", rebuildTex: boolean) {
    const isMetro = mode === "metro";
    // 地面纹理：街头用 road.png，地铁用程序化枕木
    if (isMetro) {
      this.groundTex = makeTieTexture("#3a2f26", "#6b4a32");
    } else {
      this.groundTex = this.loadRoadTexture();
    }
    this.ground.material = new THREE.MeshStandardMaterial({
      map: this.groundTex,
      roughness: isMetro ? 1 : 0.95,
      metalness: isMetro ? 0 : 0.05,
    });
    // 街头 / 地铁场景各物体显隐（各自封装在场景对象内部）
    this.streetSceneObj.setVisible(!isMetro);
    this.sidewalks.forEach((s) => (s.visible = !isMetro));
    this.curbs.forEach((c) => (c.visible = !isMetro));
    this.metroSceneObj.setVisible(isMetro);
    this.skyPlane.visible = !isMetro; // 地铁内不显示天空
    for (const c of this.clouds) c.mesh.visible = !isMetro; // 云层与天空同步显隐
    if (isMetro) {
      this.scene.background = new THREE.Color("#1b1b22");
      (this.scene.fog as THREE.Fog).color.set("#23232c");
      (this.scene.fog as THREE.Fog).near = 18;
      (this.scene.fog as THREE.Fog).far = 70;
    } else {
      this.scene.background = new THREE.Color(this.theme.sky);
      (this.scene.fog as THREE.Fog).color.set(this.theme.sky); // 雾色=天空色，远景淡出无硬边（与constructor/setTheme一致）
      (this.scene.fog as THREE.Fog).near = 50;
      (this.scene.fog as THREE.Fog).far = 150;
    }
    // 场景可见性/纹理发生变化，重置 idle 标记，让静止态再渲染一帧以反映变更
    this.idleRendered = false;
  }

  // ==================== 对外 API：尺寸 / 状态 / 输入 / 销毁 ====================

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 960;
    const h = rect.height || 540;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 尺寸变化后需重渲染一帧，否则静止态会停留在旧画面
    this.idleRendered = false;
  }

  getStats() {
    return this.stats;
  }

  start() {
    this.reset();
    this.stats.state = "playing";
    this.playing = true;
    this.clock.getDelta();
  }

  private reset() {
    this.obstacles.forEach((o) => this.worldGroup.remove(o.mesh));
    this.pickups.forEach((p) => this.worldGroup.remove(p.mesh));
    this.powerups.forEach((pu) => this.worldGroup.remove(pu.mesh));
    this.obstacles = [];
    this.pickups = [];
    this.powerups = [];
    this.spawnAcc = 0;
    this.nextGap = 18;
    this.powerupAcc = 0;
    this.nextPowerupGap = 22;
    // 清除在场列车并重新计时（列车挂在 scene 而非 worldGroup，需单独回收）
    this.metroSceneObj.resetTrain();
    this.gameTime = 0;
    this.magnetUntil = 0;
    this.shieldUntil = 0;
    this.invincibleUntil = 0;
    this.stats.powerups = [];
    if (this.playerAura) this.playerAuraMat.opacity = 0;
    this.playerLane = 1;
    this.playerTargetX = LANES[1];
    this.playerY = 0;
    this.playerVY = 0;
    this.onGround = true;
    // 开局预铺一段由近及远的赛道内容：否则所有障碍/金币都从统一的远端生成点
    // (SPAWN_AHEAD=-110) 出现，玩家要跑很久才遇到第一波，缺乏参与感。
    // 预铺后起点附近立刻有金币串与障碍，同时远端也已有内容衔接常规生成。
    this.openingRun();
    // 重置角色动画：回到奔跑动作，时间缩放归位
    if (this.playerMixer && this.playerActionRun) {
      this.playerActionRun.timeScale = 1.0;
      this.playerActionRun.reset().play();
      this.playerActionCur = "run";
    }
    this.stats.score = 0;
    this.stats.coins = 0;
    this.stats.speed = START_SPEED;
    this.camShake = 0;
    this.particleData = [];
    const pos = this.particleSys.geometry.getAttribute(
      "position"
    ) as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, 0, -999, 0);
    pos.needsUpdate = true;
  }

  pause() {
    if (this.stats.state !== "playing") return;
    this.stats.state = "paused";
    this.playing = false;
  }

  resume() {
    if (this.stats.state !== "paused") return;
    this.stats.state = "playing";
    this.playing = true;
    this.clock.getDelta();
  }

  jump() {
    if (this.stats.state === "ready" || this.stats.state === "over") {
      this.start();
      return;
    }
    if (this.stats.state === "paused") {
      this.resume();
      return;
    }
    if (this.stats.state === "playing" && this.onGround) {
      this.playerVY = JUMP_V;
      this.onGround = false;
      this.onEvent?.("jump");
    }
  }

  moveLeft() {
    if (this.stats.state !== "playing") return;
    this.playerLane = Math.max(0, this.playerLane - 1);
    this.playerTargetX = LANES[this.playerLane];
    this.onEvent?.("move");
  }

  moveRight() {
    if (this.stats.state !== "playing") return;
    this.playerLane = Math.min(LANES.length - 1, this.playerLane + 1);
    this.playerTargetX = LANES[this.playerLane];
    this.onEvent?.("move");
  }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.carEnvMap?.dispose();
    this.carEnvMap = null;
    this.renderer.dispose();
  }

  private loop = () => {
    if (!this.alive) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.playing) {
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    } else {
      // 未开始游戏（ready/over/paused）时，场景是静止的：
      // 只在模型异步加载完成后的首帧渲染一次，之后停手，避免每帧重渲染
      // 整个城市场景 + 2048² 阴影贴图造成的空转卡顿（这正是刷新后偶发卡顿的主因）。
      if (!this.idleRendered) {
        this.renderer.render(this.scene, this.camera);
        this.idleRendered = true;
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  // 标记"静止态是否已完成首帧渲染"。任意会改变场景内容的操作
  // （模型加载完成、场景模式切换、主题切换）后应置 false 触发重渲染一次。
  private idleRendered = false;

  // ==================== 帧更新：世界滚动 / 生成 / 碰撞 ====================

  private update(dt: number) {
    if (this.stats.state !== "playing") return;

    this.gameTime += dt;
    this.updatePowerups(dt); // 磁铁吸附 / 到期回落速度
    this.updateAura(dt); // 护盾/无敌/磁铁的角色光环提示
    this.syncPowerupStats(); // 将生效道具同步给 HUD

    // 速度自然爬升，但上限取决于是否处于「无敌之躯」强化态：
    // 无敌期间允许达到 MAX_SPEED * MAGNET_SPEED_BOOST（如 200%/300%），否则封顶为 MAX_SPEED
    const speedCap =
      this.gameTime < this.invincibleUntil
        ? MAX_SPEED * MAGNET_SPEED_BOOST
        : MAX_SPEED;
    this.stats.speed = Math.min(speedCap, this.stats.speed + SPEED_RAMP * dt);
    const move = this.stats.speed * dt;
    this.stats.score += move * 0.6;

    // 地面纹理滚动：系数 = repeat.v / 平面长度，确保纹理滑动速度与物体一致（贴地感）
    const texPerUnit = this.groundTex.repeat.y / 220;
    this.groundTex.offset.y += move * texPerUnit;
    this.sidewalkTex.offset.y += move * (22 / 220);
    // 天空云层：随跑动做慢速视差滚动（速度越快，云后退越明显）
    this.updateClouds(move);
    // 道床碎石纹理滚动：与地面同法（系数 = repeat.v / 道床长度），使两侧碎石随人物跑动流动
    if (this.metro.bedTex) {
      this.metro.bedTex.offset.y += move * (this.metro.bedTex.repeat.y / 220);
    }
    // 钢轨随世界滚动（枕木纹理已随地面，钢轨为实体需移动）
    if (this.metro.rails.visible) {
      this.metro.rails.position.z = (this.metro.rails.position.z + move) % 5;
    }

    // 角色横移
    const px = this.player.position.x;
    this.player.position.x =
      px + (this.playerTargetX - px) * Math.min(1, dt * 12);

    // 跳跃物理
    this.runT += dt;
    if (!this.onGround) {
      this.playerVY -= GRAVITY * dt;
      this.playerY += this.playerVY * dt;
      if (this.playerY <= 0) {
        this.playerY = 0;
        this.playerVY = 0;
        this.onGround = true;
      }
    }
    this.player.position.y = this.playerY;

    // 角色骨骼动画（精致 GLB 模型）：推进 mixer，并按腾空状态在 run / jump 间平滑切换
    if (this.playerMixer) {
      this.playerMixer.update(dt);
      if (this.playerActionRun && this.playerActionJump) {
        // 跑步动画速度随当前奔跑速度提升而加快：speed 16→40 映射 run timeScale 1.0→2.1
        const sp = this.stats.speed;
        const t = THREE.MathUtils.clamp(
          (sp - START_SPEED) / (MAX_SPEED - START_SPEED),
          0,
          1
        );
        const runScale = 1.0 + t * 1.1;

        const want: "run" | "jump" = this.onGround ? "run" : "jump";
        if (want !== this.playerActionCur) {
          const from =
            this.playerActionCur === "run"
              ? this.playerActionRun
              : this.playerActionJump;
          const to =
            want === "run" ? this.playerActionRun : this.playerActionJump;
          if (to !== from) {
            to.reset().play();
            // 加长过渡（0.18 → 0.32），减轻起跳/落地的「抽出」突兀感
            from.crossFadeTo(to, 0.32, false);
          }
          this.playerActionCur = want;
        }

        if (this.playerActionJump === this.playerActionRun) {
          // 无独立跳跃动作：腾空用更高 timeScale 模拟（在跑步速度基础上再加速）
          this.playerActionRun.timeScale = this.onGround
            ? runScale
            : runScale * 1.4;
        } else {
          // 有独立跳跃动作：跑步随速度加快；跳跃保持自然速度，避免被拉快而显得「抽出」
          this.playerActionRun.timeScale = runScale;
          this.playerActionJump.timeScale = 1.0;
        }
      }
    }

    // 跑动动画：腿、手臂、围巾飘动、倾斜
    const moving = this.onGround;
    const swing = moving ? Math.sin(this.runT * 16) * 0.6 : 0.2;
    const legL = this.player.getObjectByName("legL");
    const legR = this.player.getObjectByName("legR");
    if (legL) legL.rotation.x = swing;
    if (legR) legR.rotation.x = -swing;
    if (this.armL) this.armL.rotation.x = -swing * 0.8;
    if (this.armR) this.armR.rotation.x = swing * 0.8;
    if (this.scarf) {
      this.scarf.rotation.x =
        Math.sin(this.runT * 12) * 0.25 + (moving ? 0.2 : 0.4);
    }
    this.player.rotation.z =
      (this.playerTargetX - this.player.position.x) * 0.18;

    // 街头行人动画（程序化摆动 + 骨骼动画）
    this.streetSceneObj.animatePeds(dt, this.runT);

    // 世界物体朝相机移动
    this.obstacles.forEach((o) => {
      o.z += move;
      o.mesh.position.z = o.z;
      // 被撞过的车辆：横向甩出车道并带一点甩尾旋转（车辆不能像路锥那样凭空消失）
      if (o.knockDir) {
        o.mesh.position.x += o.knockDir * dt * 8;
        o.mesh.rotation.y += o.knockDir * dt * 2.5;
      }
    });
    this.pickups.forEach((p) => {
      p.z += move;
      p.mesh.position.z = p.z;
      p.mesh.rotation.y += dt * 3;
      p.mesh.position.y += Math.sin(this.runT * 4 + p.z) * 0.004;
    });
    // 道具（磁铁/护盾/无敌之躯）沿世界移动，并做上下浮动 + 水晶自转 + 图标朝向相机
    this.powerups.forEach((pu) => {
      pu.z += move;
      pu.mesh.position.z = pu.z;
      // 整体上下轻微浮动（基准高度 + 正弦）
      pu.mesh.position.y =
        pu.baseY + Math.sin(this.runT * 2.2 + pu.z * 0.15) * 0.18;
      // 图标始终朝向相机（billboard），保证从任意角度都能看清
      const icon = pu.mesh.userData.icon as THREE.Mesh | undefined;
      if (icon) icon.lookAt(this.camera.position);
    });

    // 天际线现为纯色块（无贴图），无需滚动；纯色无纹理参照，切换跑道时不会眩晕。
    // （若后续换回实体楼房/贴图，可在此恢复视差滚动逻辑。）

    // 场景滚动：各自封装在场景对象内部；仅在对应模式下执行，保持与原实现一致
    // （street 的滚动逻辑内部没有模式判断，故此处必须显式区分，否则隐藏场景也会滚动回绕）。
    if (this.sceneMode === "street") {
      this.streetSceneObj.scroll(move);
    } else {
      this.metroSceneObj.scroll(move);
      // 列车：出场调度 / 缓缓驶来 / 驶过玩家后回收（仅地铁场景）
      this.metroSceneObj.updateTrain(move, dt);
    }

    // 角色软阴影：跟随横移，起跳时缩小变淡（脱离地面）
    this.playerShadow.position.x = this.player.position.x;
    const shScale = 1 - Math.min(1, this.playerY / 2.6) * 0.55;
    this.playerShadow.scale.setScalar(shScale);
    (this.playerShadow.material as THREE.MeshBasicMaterial).opacity =
      0.28 * shScale;

    // 生成
    this.spawnAcc += move;
    if (this.spawnAcc >= this.nextGap) {
      this.spawnAcc = 0;
      this.nextGap = 11 + Math.random() * 9;
      this.spawnWave();
    }
    // 道具低频独立生成（与障碍节奏解耦，避免过密）
    // 关键：只要当前有任意道具在生效（10 秒窗口内），就不再刷出新道具
    this.powerupAcc += move;
    if (
      this.powerupAcc >= this.nextPowerupGap &&
      !this.hasActivePowerup() &&
      this.powerups.length === 0
    ) {
      this.powerupAcc = 0;
      this.nextPowerupGap =
        POWERUP_GAP_MIN + Math.random() * (POWERUP_GAP_MAX - POWERUP_GAP_MIN);
      this.spawnPowerup();
    }

    // 回收
    this.obstacles = this.obstacles.filter((o) => {
      if (o.z > DESPAWN_BEHIND) {
        this.worldGroup.remove(o.mesh);
        return false;
      }
      return true;
    });
    this.pickups = this.pickups.filter((p) => {
      const gone = p.taken || p.z > DESPAWN_BEHIND;
      if (gone) this.worldGroup.remove(p.mesh);
      return !gone;
    });
    this.powerups = this.powerups.filter((pu) => {
      const gone = pu.taken || pu.z > DESPAWN_BEHIND;
      if (gone) this.worldGroup.remove(pu.mesh);
      return !gone;
    });

    this.handleCollisions();
    this.updateParticles(dt);
    this.updateSpeedLines(dt, move);
    // 街头装饰：动态回收 + 远端持续补充新随机装饰（绝不重复固定组合）
    this.streetSceneObj.recycleDecor(move);
    // 楼房滚动与墙同周期(wallCycle)，保持与墙段网格对齐。
    // 滚动/回绕必须基于「逻辑 z」(b.z)——防重叠(courtZSlots/链式 minGap)所用的坐标系；
    // 视觉位置用恒等式 mesh.z = z − offZ 同步，回绕间隔才能精确保持初始防重叠间隔。
    if (this.street.buildings[0]?.mesh.visible) {
      const camZ = this.camera.position.z; // 相机固定在 PLAYER_Z+8≈12
      for (const b of this.street.buildings) {
        b.z += move;
        if (b.z - STREET.wallSegLen / 2 > this.street.buildingRecycleZ) {
          b.z -= this.street.buildingCycle;
        }
        b.mesh.position.z = b.z - (b.offZ ?? 0); // 视觉位置恒等于逻辑 z，与防重叠坐标严格一致
        // 远端性能优化：物体离相机超过约 80 单位(已沉入 fog 远端)时关闭阴影投射，
        // 进入约 70 单位内再开启，滞回避免边界抖动。远处本就被雾盖住看不清影子，关掉省 GPU。
        const dist = camZ - b.z;
        const wantShadow = dist < 75;
        if (!!b.castShadow !== wantShadow) {
          b.castShadow = wantShadow;
          b.mesh.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) m.castShadow = wantShadow;
          });
        }
      }
    }

    // 相机随速度拉伸 + 高速抖动 + 冲击恢复（强化速度感）
    const speedRatio = this.stats.speed / MAX_SPEED;
    const targetFov = 60 + speedRatio * 18; // 高速时广角拉伸
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();
    if (this.camShake > 0) {
      this.camShake = Math.max(0, this.camShake - dt * 3);
    }
    // 高速时持续轻微抖动，增强冲击
    const hi = speedRatio > 0.7 ? (speedRatio - 0.7) * 0.5 : 0;
    const s = this.camShake * 0.4 + hi * 0.25;
    // 相机 x 严格跟随玩家横向位置，使镜头始终处于人物正后方、人物与障碍金币居中于画面
    const followX = this.player.position.x;
    this.camera.position.x = followX + (Math.random() - 0.5) * s;
    this.camera.position.y = CAM_Y + (Math.random() - 0.5) * s;
    // 视线目标同步横移，保证朝向正对跑道而非偏移
    this.camera.lookAt(followX, CAM_LOOK_Y, PLAYER_Z - 6);
  }

  // ==================== 视觉反馈：速度线 / 粒子 / 相机抖动 ====================

  private resetSpeedLine(m: THREE.Mesh) {
    // 分布在玩家前方视野内，x 随机、y 高处，向相机方向飞
    const side = Math.random() < 0.5 ? -1 : 1;
    m.position.set(
      side * (3 + Math.random() * 5),
      1.5 + Math.random() * 5,
      -10 - Math.random() * 55
    );
    m.scale.x = 0.5 + Math.random() * 1.5;
  }

  private updateSpeedLines(dt: number, move: number) {
    const speedRatio = this.stats.speed / MAX_SPEED;
    const opacity = Math.max(0, (speedRatio - 0.25) * 0.9); // 速度过半才明显
    for (const m of this.speedLines) {
      m.position.z += move * 1.15; // 比世界略快，强化风驰感
      if (m.position.z > PLAYER_Z + 10) this.resetSpeedLine(m);
      (m.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
  }

  private spawnWave() {
    // 列车占用赛道时，该赛道暂不生成障碍物（避免与列车穿模/冲突）。
    // 三轨道同时仅一台列车；列车在场期间其所在赛道从候选集中剔除。
    const trainLane = this.metroSceneObj.activeTrainLane;
    const allLanes = [0, 1, 2];
    const lanes = allLanes
      .filter((l) => l !== trainLane)
      .sort(() => Math.random() - 0.5);
    const obstacleCount = 1 + (Math.random() < 0.45 ? 1 : 0);
    for (let i = 0; i < obstacleCount && i < lanes.length; i++) {
      const lane = lanes[i];
      // 障碍种类：街头模式约 20% 是「停在车道上的车」（体型大、必须换道或起跳），
      // 地铁隧道里不放车；其余在路锥/消防栓之间平分。
      const r = Math.random();
      const kind: Obstacle["kind"] =
        this.sceneMode === "street" && r < 0.2
          ? "car"
          : r < 0.6
          ? "cone"
          : "hydrant";
      const o = this.makeObstacle(kind, lane);
      this.worldGroup.add(o.mesh);
      this.obstacles.push(o);
    }
    // 空闲车道：优先在非列车赛道中选（列车赛道不铺金币，保持净空）
    const freeLane = lanes[obstacleCount] ?? lanes[0] ?? (trainLane === 1 ? 0 : 1);
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      // 低空（地面可取）与高空（需起跳）混排，让跳跃更有意义
      const y = Math.random() < 0.5 ? 0.8 : 2.3 + Math.random() * 0.3;
      const p = this.makePickup(freeLane, SPAWN_AHEAD - i * 2.2, y);
      this.worldGroup.add(p.mesh);
      this.pickups.push(p);
    }
  }

  // 开局预铺赛道：从玩家跟前（z≈-22）一路铺到远端生成点，
  // 让游戏一开始就有金币可吃、有障碍可躲，避免"跑很久才有参与感"。
  // 间距沿路程由密到疏：近处（-22 起）密集、快速进入节奏，远处过渡到
  // 常规生成的稀疏节奏（11~20），衔接自然。仅生成点位置不同，波次结构与
  // 常规 spawnWave 完全一致（障 1~2 个 + 空闲道一串金币）。
  private openingRun() {
    const START_Z = -22; // 起点：已在雾外（距相机约 34 < fog near 50），立刻可见却不突兀
    let z = START_Z;
    while (z > SPAWN_AHEAD) {
      const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
      const obstacleCount = 1 + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < obstacleCount; i++) {
        const lane = lanes[i];
        // 开局这段车少一些（0.12），先让玩家熟悉路锥/消防栓的节奏
        const r = Math.random();
        const kind: Obstacle["kind"] =
          this.sceneMode === "street" && r < 0.12
            ? "car"
            : r < 0.56
            ? "cone"
            : "hydrant";
        const o = this.makeObstacle(kind, lane);
        o.mesh.position.z = z; // makeObstacle 默认生成在 SPAWN_AHEAD，此处改到本波 z
        o.z = z;
        this.worldGroup.add(o.mesh);
        this.obstacles.push(o);
      }
      // 空闲车道铺一串金币（与常规 spawnWave 的波次结构一致）
      const freeLane = lanes[obstacleCount] ?? 1;
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const y = Math.random() < 0.5 ? 0.8 : 2.3 + Math.random() * 0.3;
        const p = this.makePickup(freeLane, z - i * 2.2, y);
        this.worldGroup.add(p.mesh);
        this.pickups.push(p);
      }
      // 波次间隔：近端密（≈14）→ 远端疏（≈22），自然过渡到常规节奏（11~20）。
      const t = (START_Z - z) / (START_Z - SPAWN_AHEAD); // 0=最近 → 1=最远
      z -= 14 + t * 8 + Math.random() * 6;
    }
    // 预铺已铺满到远端生成点，重置累加器，使常规生成接着当前进度走，
    // 而不是立刻再刷一波造成开局过密。
    this.spawnAcc = 0;
    this.nextGap = 11 + Math.random() * 9;
  }

  // 在随机一条跑道上生成一个道具（磁铁/护盾/无敌之躯），低频出现
  private spawnPowerup() {
    const lane = Math.floor(Math.random() * 3);
    const kinds: PowerupKind[] = ["magnet", "shield", "invincible"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const pu = this.makePowerup(kind, lane, SPAWN_AHEAD);
    this.worldGroup.add(pu.mesh);
    this.powerups.push(pu);
  }

  // 程序化生成一个道具：半透明发光光圈（包裹图标）+ 中央对应图标，无需外部资源
  private makePowerup(kind: PowerupKind, lane: number, z: number): Powerup {
    // 与 HUD（GamePage POWERUP_META）一致的标识色：护盾用显眼的金黄而非白色
    const color =
      kind === "magnet" ? 0x16d1c4 : kind === "shield" ? 0xffd23a : 0xff3da6;
    const baseY = 1.3; // 抬高基准，避免光球下半部穿入地面（y=0）
    // 整体用一个 Group 承载，方便做上下浮动而不影响内部定位
    const mesh = new THREE.Group();
    mesh.position.set(LANES[lane], baseY, z);

    // 1) 半透明发光光球：整体同色、外圈不再分色，包裹住中央图标
    const R = 0.95; // 光球半径，底部 = baseY - R - 浮动 ≈ 0.17，不穿地
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(R, 32, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4, // 半透明发光的球，内部图标隐约可见
        depthWrite: false, // 半透明不写深度，避免遮挡图标
      })
    );
    orb.castShadow = true; // 光球投射阴影，增强落地感（半透明不影响阴影深度图）
    mesh.add(orb);

    // 2) 中央对应图标（与 HUD 倒计时框相同的 emoji 图标），位于光球内部中央、略偏前
    const icon = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.2),
      new THREE.MeshBasicMaterial({
        map: this.makePowerupIcon(kind),
        transparent: true, // 仅背景透明，图标本身为实心 emoji
        depthWrite: false,
      })
    );
    icon.position.z = 0.15; // 球心略前方，被半透明光球包裹
    mesh.add(icon);

    // 记录子节点，便于动画（图标朝向相机、整体浮动）
    mesh.userData.icon = icon;

    return { mesh, kind, lane, z, taken: false, baseY };
  }

  // 用 Canvas 把与 HUD 倒计时框相同的 emoji 图标绘制成纹理（🧲 磁铁 / 🛡️ 护盾 / ⚡ 无敌）
  private makePowerupIcon(kind: PowerupKind): THREE.CanvasTexture {
    const s = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, s, s);
    // 与 GamePage.vue 中 POWERUP_META.icon 完全一致的 emoji
    const emoji = kind === "magnet" ? "🧲" : kind === "shield" ? "🛡️" : "⚡";
    g.font = `${Math.floor(
      s * 0.72
    )}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(emoji, s / 2, s / 2 + 4);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  // 拾取道具后激活对应效果（持续时间统一 POWERUP_DURATION 秒）
  private applyPowerup(kind: PowerupKind) {
    const now = this.gameTime;
    if (kind === "magnet") {
      this.magnetUntil = now + POWERUP_DURATION;
    } else if (kind === "shield") {
      this.shieldUntil = now + POWERUP_DURATION;
    } else if (kind === "invincible") {
      this.invincibleUntil = now + POWERUP_DURATION;
      // 拾取瞬间速度拉满到最大速度的 MAGNET_SPEED_BOOST 倍（150%）
      this.stats.speed = MAX_SPEED * MAGNET_SPEED_BOOST;
    }
  }

  // 当前是否有任意道具处于生效期间（10 秒窗口内）
  private hasActivePowerup(): boolean {
    return (
      this.gameTime < this.magnetUntil ||
      this.gameTime < this.shieldUntil ||
      this.gameTime < this.invincibleUntil
    );
  }

  // 每帧处理道具持续效果：磁铁吸附金币、无敌之躯到期后速度回落到原本上限
  private updatePowerups(dt: number) {
    // 磁铁：把附近（玩家前方一定范围内）的金币拉向玩家所在车道与可吃高度
    if (this.gameTime < this.magnetUntil) {
      const px = this.player.position.x;
      for (const p of this.pickups) {
        if (p.taken) continue;
        const dz = p.z - PLAYER_Z; // 负=前方
        if (dz < -MAGNET_RANGE || dz > 2) continue;
        // 横向缓慢吸向玩家车道
        p.mesh.position.x += (px - p.mesh.position.x) * Math.min(1, dt * 6);
        // 竖直对齐到玩家当前高度附近的可吃中心：跳跃时也跟着上浮，保证跳起照样能吃
        const targetY = this.playerY + 1.1;
        p.mesh.position.y +=
          (targetY - p.mesh.position.y) * Math.min(1, dt * 6);
        // 纵向也略微拉向玩家（缩短吃到的距离感）
        p.z += (PLAYER_Z - p.z) * Math.min(1, dt * 1.5);
        p.mesh.position.z = p.z;
        // 关键：金币被吸到玩家车道后，必须同步 lane，否则拾取判定 p.lane===playerLane 会拒绝吃掉
        p.lane = this.playerLane;
      }
    }
    // 无敌之躯到期：速度从 150% 回落到原本的自然上限（MAX_SPEED），不突变
    if (this.gameTime >= this.invincibleUntil && this.stats.speed > MAX_SPEED) {
      this.stats.speed = Math.max(
        MAX_SPEED,
        this.stats.speed - MAX_SPEED * (MAGNET_SPEED_BOOST - 1) * dt
      );
    }
  }

  // 角色光环：根据当前生效道具显示不同颜色的光晕（护盾=奶白 / 无敌=品红 / 磁铁=青）
  private updateAura(dt: number) {
    const auraMat = this.playerAuraMat;
    let color: string | null = null;
    if (this.gameTime < this.invincibleUntil) color = this.theme.magenta;
    else if (this.gameTime < this.shieldUntil) color = this.theme.cream;
    else if (this.gameTime < this.magnetUntil) color = this.theme.cyan;

    if (color) {
      auraMat.color.set(color);
      // 计算当前所有生效道具中「最小剩余时间」，用于触发最后 3 秒闪烁
      const remains: number[] = [];
      if (this.gameTime < this.magnetUntil)
        remains.push(this.magnetUntil - this.gameTime);
      if (this.gameTime < this.shieldUntil)
        remains.push(this.shieldUntil - this.gameTime);
      if (this.gameTime < this.invincibleUntil)
        remains.push(this.invincibleUntil - this.gameTime);
      const minRemain = Math.min(...remains);
      let opacity: number;
      if (minRemain <= 3) {
        // 最后 3 秒：高频方波闪烁，强烈提示即将到期
        opacity = Math.sin(this.gameTime * 30) > 0 ? 0.5 : 0.0;
      } else {
        // 正常呼吸式脉动，提示道具生效中
        opacity = 0.22 + 0.12 * (0.5 + 0.5 * Math.sin(this.gameTime * 6));
      }
      auraMat.opacity = opacity;
      // 缓慢旋转光环，强化立体环绕观感
      this.playerAura.rotation.y += dt * 1.2;
      // 无敌之躯时略微放大，强化"强化态"观感
      const scale = this.gameTime < this.invincibleUntil ? 1.12 : 1.0;
      this.playerAura.scale.setScalar(scale);
    } else {
      auraMat.opacity = 0; // 无道具：光环隐藏
    }
  }

  // 将当前生效的道具及剩余时间同步到 stats，供外部 HUD 显示倒计时
  private syncPowerupStats() {
    const list: { kind: PowerupKind; remain: number }[] = [];
    if (this.gameTime < this.magnetUntil)
      list.push({ kind: "magnet", remain: this.magnetUntil - this.gameTime });
    if (this.gameTime < this.shieldUntil)
      list.push({ kind: "shield", remain: this.shieldUntil - this.gameTime });
    if (this.gameTime < this.invincibleUntil)
      list.push({
        kind: "invincible",
        remain: this.invincibleUntil - this.gameTime,
      });
    this.stats.powerups = list;
  }

  // 核心碰撞：玩家实体与障碍实体是否相交
  // 玩家占据 y∈[playerY, playerY+2.6]，障碍占据 y∈[0, topY]
  // 相交 ⟺ 玩家脚底低于障碍顶（没跳过去）→ 撞飞该障碍，但不死亡（游戏继续）
  private handleCollisions() {
    // 列车碰撞（地铁场景专属）：列车是实体动态障碍，撞上即死。
    // 判定为「玩家与列车处于同一赛道，且列车车体当前覆盖玩家所在 z」。
    // 列车车体沿 z 长 32（中心 trainZ，半长 16）；玩家占 z≈PLAYER_Z。
    // 处于无敌之躯状态时免疫（与其它危险机制一致），护盾不免疫（列车为实体冲撞）。
    if (this.sceneMode === "metro") {
      const trainLane = this.metroSceneObj.activeTrainLane;
      const trainZ = this.metroSceneObj.trainZ;
      if (
        trainLane === this.playerLane &&
        !Number.isNaN(trainZ) &&
        Math.abs(trainZ - PLAYER_Z) < 16 + 0.7
      ) {
        if (this.gameTime < this.invincibleUntil) {
          // 无敌：撞开但不死（列车保持，仅给予反馈）
          this.camShake = Math.max(this.camShake, 0.6);
        } else {
          this.gameOver();
          return;
        }
      }
    }
    for (const o of this.obstacles) {
      if (o.lane !== this.playerLane) continue;
      if (o.knockDir) continue; // 已被撞飞的车辆不再重复判定
      // 判定窗口按障碍自身沿 z 的半长算：车辆 4.4 长，若仍用路障的 1.0 窗口，
      // 车头贴到人物身上时还没判定，要等人跑到车身中间才触发——看起来像穿模。
      // 路障缺省 halfZ=0.5，等价于原来的 |Δz| < 1.0 窗口，不改变既有手感。
      const reach = (o.halfZ ?? 0.5) + 0.5;
      if (Math.abs(o.z - PLAYER_Z) > reach) continue;
      if (this.playerY >= o.topY - 0.1) continue; // 脚底高于障碍顶 = 跳过去了
      if (o.kind === "car") {
        // 车辆不消失：给一个横向甩出车道的方向，车身继续随世界滚动离开画面。
        // （碰撞死亡机制当前关闭；将来开启时，这里替换为 this.gameOver() 即可）
        o.knockDir = this.player.position.x > o.mesh.position.x ? 1 : -1;
        this.camShake = Math.max(this.camShake, 0.55);
        this.onEvent?.("crash");
      } else {
        // 撞到障碍不死亡：直接把该障碍撞飞移除，并给出镜头/音效反馈，游戏继续
        // （无论是否处于护盾/无敌状态，均不死）
        this.worldGroup.remove(o.mesh);
        o.z = DESPAWN_BEHIND + 999; // 标记移出，待回收过滤移除
        this.camShake = Math.max(this.camShake, 0.4);
        this.onEvent?.("crash");
      }
    }
    for (const p of this.pickups) {
      if (p.taken || p.lane !== this.playerLane) continue;
      if (Math.abs(p.z - PLAYER_Z) < 1.2) {
        // 竖直方向也必须重叠：高空方块（中心高 ~2.3）只有起跳后角色够到才能吃到
        const py = p.mesh.position.y;
        const pBot = py - 0.34;
        const pTop = py + 0.34;
        const plBot = this.playerY;
        const plTop = this.playerY + PLAYER_VH;
        if (plTop > pBot && plBot < pTop) {
          p.taken = true;
          this.stats.coins += 1;
          this.onEvent?.("pickup");
          // 注：不播放吃金币爆裂粒子——磁铁吸附时金币密集，特效会遮挡视野
        }
      }
    }
    // 道具拾取（磁铁/护盾/无敌之躯）
    for (const pu of this.powerups) {
      if (pu.taken || pu.lane !== this.playerLane) continue;
      if (Math.abs(pu.z - PLAYER_Z) < 1.2) {
        const py = pu.mesh.position.y;
        const plBot = this.playerY;
        const plTop = this.playerY + PLAYER_VH;
        if (plTop > py - 0.5 && plBot < py + 0.5) {
          pu.taken = true;
          this.applyPowerup(pu.kind);
          this.burst(
            this.player.position.x,
            this.playerY + 1,
            PLAYER_Z,
            pu.kind === "magnet"
              ? this.theme.cyan
              : pu.kind === "shield"
              ? this.theme.cream
              : this.theme.magenta,
            16,
            5
          );
        }
      }
    }
  }

  private burst(
    x: number,
    y: number,
    z: number,
    color: string,
    count = 12,
    speed = 4
  ) {
    const pos = this.particleSys.geometry.getAttribute(
      "position"
    ) as THREE.BufferAttribute;
    let spawned = 0;
    for (let i = 0; i < pos.count && spawned < count; i++) {
      if (this.particleData[i] && this.particleData[i].life > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random());
      pos.setXYZ(i, x, y, z);
      this.particleData[i] = {
        life: 0.6,
        vx: Math.cos(a) * s,
        vy: 2 + Math.random() * 4,
        vz: Math.sin(a) * s * 0.5,
      };
      spawned++;
    }
    pos.needsUpdate = true;
    (this.particleSys.material as THREE.PointsMaterial).color.set(color);
  }

  private updateParticles(dt: number) {
    const pos = this.particleSys.geometry.getAttribute(
      "position"
    ) as THREE.BufferAttribute;
    let dirty = false;
    for (let i = 0; i < pos.count; i++) {
      const d = this.particleData[i];
      if (!d || d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 12 * dt;
      const x = pos.getX(i) + d.vx * dt;
      const y = pos.getY(i) + d.vy * dt;
      const z = pos.getZ(i) + d.vz * dt;
      if (d.life <= 0) pos.setXYZ(i, 0, -999, 0);
      else pos.setXYZ(i, x, y, z);
      dirty = true;
    }
    if (dirty) pos.needsUpdate = true;
  }

  private gameOver() {
    this.stats.state = "over";
    this.playing = false;
    const final = Math.floor(this.stats.score);
    if (final > this.stats.best) {
      this.stats.best = final;
      localStorage.setItem(BEST_KEY, String(final));
    }
    this.camShake = 1;
    // 彩色碎片爆裂
    this.burst(
      this.player.position.x,
      this.playerY + 1.5,
      PLAYER_Z,
      this.theme.red,
      30,
      6
    );
    this.burst(
      this.player.position.x,
      this.playerY + 1.5,
      PLAYER_Z,
      this.theme.magenta,
      30,
      6
    );
    this.burst(
      this.player.position.x,
      this.playerY + 1.5,
      PLAYER_Z,
      this.theme.cyan,
      30,
      6
    );
  }
}
