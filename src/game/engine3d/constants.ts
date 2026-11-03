// ============================================================
// StreetFire 3D Runner —— 常量与可调参数
// 集中定义，避免在游戏逻辑中散落魔法数字。
// ============================================================

/** 左/中/右三条轨道的 x 坐标（路面宽14按 road.png 三等分，车道中心约±4.7/0/4.7） */
export const LANES = [-4.5, 0, 4.5];

export const GRAVITY = 24; // 单位/秒^2
export const JUMP_V = 9.8; // 起跳初速度（最大跳高 ≈ v²/2g ≈ 2.0，配合缩小角色不挡镜头）
export const START_SPEED = 16; // 世界向相机移动速度（单位/秒）
export const MAX_SPEED = 40;
export const SPEED_RAMP = 0.8; // 加速更明显，后期更刺激

// 障碍/金币/道具的生成 z（负值=相机前方多远）。必须「深于」雾的 near，让它们
// 在玩家看不清的雾中就已生成、随滚动逐渐显影，而不是在眼皮底下硬生生冒出来。
// 相机固定在 PLAYER_Z+8≈12，雾 near=50 → 可见起点约 z≈-38；取 -110 留足雾中余量
// （该距离处物体仍被雾明显淡化，不会显得凭空出现）。
export const SPAWN_AHEAD = -110;

export const DESPAWN_BEHIND = 14; // 越过相机后回收
export const PLAYER_Z = 4; // 角色固定 z

// 相机高度与视线目标高度（constructor 与每帧 updateCamera 共用，避免两处硬编码不一致）。
// 相机降低后视线更平缓、越过围墙顶部看到墙外空白区域更少。
export const CAM_Y = 4.2; // 相机离地高度（原 5.6，已降低以增强围墙遮挡）
export const CAM_LOOK_Y = 0.6; // 视线目标高度（原 1.0，同步降低以保持俯视赛道的手感）

// ===== 道具系统可配置参数 =====
export const POWERUP_GAP_MIN = 22; // 道具最小生成间隔（世界单位），越大越稀有
export const POWERUP_GAP_MAX = 40; // 道具最大生成间隔（世界单位）
export const POWERUP_DURATION = 10; // 道具持续时间（秒）
export const MAGNET_RANGE = 12; // 磁铁吸附金币的前方有效距离（世界单位）
export const MAGNET_SPEED_BOOST = 2.0; // 无敌之躯触发时的速度倍率（相对 MAX_SPEED），即 200%
export const PLAYER_VH = 1.7; // 角色竖直高度（含 0.62 缩放后的顶部高度），用于拾取竖直判定
export const BEST_KEY = "streetfire_3d_best";
