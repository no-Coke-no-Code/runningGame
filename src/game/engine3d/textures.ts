// ============================================================
// StreetFire 程序化 Canvas 纹理与描边工具
// 纯函数（仅依赖 three + 浏览器 canvas），不依赖 ThreeRunner 实例，
// 被 ThreeRunner 在场景搭建时调用。
// ============================================================
import * as THREE from "three";

/** 给网格添加卡通描边（不响应射线，避免干扰拾取） */
export function addOutline(mesh: THREE.Mesh, color: string) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 25);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color })
  );
  line.raycast = () => {};
  mesh.add(line);
}

/**
 * 天空平板贴图：竖直渐变（顶部略深 → 地平线提亮）。
 *
 * 云不再画在这张静态贴图上，而是由 ThreeRunner 用独立的云层平面承载，
 * 这样云才能随跑动做视差滚动（贴着静态平板画的云永远是"钉死"的）。
 * 纹理比例刻意贴近平板的 900×500，避免渐变被拉出横向条带。
 */
function makeSkyTexture(sky: string, dot: string): THREE.CanvasTexture {
  const W = 1024;
  const H = 568;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  const mix = (a: string, b: string, t: number) =>
    "#" +
    new THREE.Color(a)
      .lerp(new THREE.Color(b), t)
      .getHexString();
  // 天色亮度 → 地平线亮带强度：白天明显，夜间收敛（否则夜天会发白）
  const c0 = new THREE.Color(sky);
  const lum = 0.299 * c0.r + 0.587 * c0.g + 0.114 * c0.b;
  const day = Math.min(1, Math.max(0.12, lum * 1.7));
  // 顶部压向更深的蓝、越接近地平线越亮（雾色方向），形成空气感；
  // 天顶偏蓝还有一个作用：白云落在深蓝上才够醒目，否则与近地平线的淡雾色糊在一起。
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mix(sky, "#2a6aa8", 0.42 * day));
  g.addColorStop(0.5, sky);
  g.addColorStop(0.82, mix(sky, dot, 0.55));
  g.addColorStop(1, mix(sky, "#ffffff", 0.42 * day));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return new THREE.CanvasTexture(cv);
}

/**
 * 云朵贴图（透明底 + 柔边白团），供可滚动的云层平面复用。
 *
 * 观感要点（旧版「切图感」的成因与对策）：
 *  1. 旧版云体只有 3 组光斑 + 一个**硬边矩形**压暗条，矩形左右两端就是两条笔直的
 *     明暗分界线，平铺到大面积天空上非常显眼。现改为纯径向渐变做云底阴影，不再画矩形。
 *  2. 旧版光斑 alpha 从 0.98 直接掉到 0，边缘衰减太快 → 看起来像贴纸剪影。
 *     现改为多级缓慢衰减（0.55→0.34→0.12→0），云体边缘本身就是羽化的。
 *  3. 用 destination-out 在云体轮廓上「啃」出不规则缺口，打散规整的椭圆轮廓，形成丝絮感。
 *  4. 最后用椭圆径向 mask（destination-in）把整张画布四周压到 alpha=0，
 *     保证平面上永远看不到贴图的矩形边界——这是消除「切图线」最关键的一步。
 *  5. 云底压一点冷灰（source-atop 只作用于已有云体），避免整朵云是纯白棉花糖。
 *
 * seed 不同 → 云的形状/分布不同；生成多张轮换使用，避免同一朵云重复出现显得假。
 */
function makeCloudTexture(seed = 1): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  // 线性同余随机：同一 seed 产出同一朵云（便于复现），且不依赖 Math.random 全局状态
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const cx = W * 0.5;
  const cy = H * 0.52;

  // 1) 云体：先沿横向排若干个「云瓣」，每个云瓣由数团柔光堆成，
  //    这样轮廓是有起伏的花椰菜状，而不是一个平滑的大椭圆。
  const softPuff = (px: number, py: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.42, `rgba(255,255,255,${a * 0.66})`);
    g.addColorStop(0.72, `rgba(255,255,255,${a * 0.26})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // 1a) 云坯：一个大而极柔的椭圆打底，把下面的云瓣连成整体（否则会是「一串珠子」）
  const baseRX = W * 0.34;
  const baseRY = H * 0.2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, baseRY / baseRX);
  const baseG = ctx.createRadialGradient(0, 0, 0, 0, 0, baseRX);
  baseG.addColorStop(0, "rgba(255,255,255,0.55)");
  baseG.addColorStop(0.55, "rgba(255,255,255,0.34)");
  baseG.addColorStop(0.82, "rgba(255,255,255,0.1)");
  baseG.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = baseG;
  ctx.beginPath();
  ctx.arc(0, 0, baseRX, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 1b) 云瓣：横向排布，中间最高、两端渐低，形成有起伏的花椰菜轮廓
  const lobes = 6 + Math.floor(rnd() * 3);
  for (let i = 0; i < lobes; i++) {
    const t = (i / (lobes - 1)) * 2 - 1; // -1..1
    const lx = cx + t * W * 0.23 * (0.9 + rnd() * 0.25);
    // 中部偶尔长出一个更高的「云塔」，避免整排云瓣等高、轮廓过于规整
    const ly =
      cy +
      (1 - Math.cos((t * Math.PI) / 2)) * H * 0.05 -
      (Math.abs(t) < 0.5 && rnd() < 0.45 ? H * (0.03 + rnd() * 0.05) : 0);
    const lr = H * (0.14 + rnd() * 0.07) * (1 - Math.abs(t) * 0.35);
    const sub = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < sub; k++) {
      softPuff(
        lx + (rnd() - 0.5) * lr * 1.3,
        ly + (rnd() - 0.6) * lr * 0.6,
        lr * (0.75 + rnd() * 0.45),
        0.42 + rnd() * 0.2
      );
    }
  }

  // 2) 丝絮：沿云体轮廓椭圆「啃」出缺口，打散规整边缘（destination-out）
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 22; i++) {
    const ang = rnd() * Math.PI * 2;
    const k = 0.92 + rnd() * 0.28; // 沿轮廓内外小幅浮动
    const px = cx + Math.cos(ang) * baseRX * k;
    const py = cy + Math.sin(ang) * baseRY * k;
    const r = H * (0.05 + rnd() * 0.09);
    const a = 0.14 + rnd() * 0.24;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(0.6, `rgba(0,0,0,${a * 0.4})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3) 全画布椭圆羽化：四周 alpha 归零（消除平面矩形边界）
  ctx.globalCompositeOperation = "destination-in";
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, H / W); // 把正圆压成与画布同比例的椭圆
  const mask = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.5);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.7, "rgba(0,0,0,1)");
  mask.addColorStop(0.88, "rgba(0,0,0,0.6)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = mask;
  ctx.beginPath();
  ctx.arc(0, 0, W * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 4) 云底冷灰阴影：只落在已有云体上（source-atop），上白下灰才有体积感
  ctx.globalCompositeOperation = "source-atop";
  const vg = ctx.createLinearGradient(0, cy - H * 0.16, 0, cy + H * 0.24);
  vg.addColorStop(0, "rgba(255,255,255,0)");
  vg.addColorStop(0.45, "rgba(186,199,222,0.3)");
  vg.addColorStop(1, "rgba(126,141,172,0.66)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  // 5) 顶部补一点高光，让受光面更亮（同样是 atop，不外溢）
  const hg = ctx.createLinearGradient(0, cy - H * 0.3, 0, cy);
  hg.addColorStop(0, "rgba(255,255,255,0.22)");
  hg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/**
 * 楼房外墙贴图（程序化、可无缝平铺）。
 *
 * 为什么需要：楼房 GLB 只有纯色材质（灰白墙 + 亮青窗 + 深蓝边框），
 * 放大到街景尺度就是「毛坯房 / 战地废墟」观感——完全没有表面质感。
 * 这里生成一张「只含明暗、不含色相」的灰泥质感贴图，颜色交给材质的 color 决定，
 * 于是同一张贴图可以被染成米黄 / 沙色 / 陶土红 / 灰绿等不同楼体，成本极低。
 *
 * 所有图案都按 3×3 九宫格重复绘制，因此平铺时不会出现接缝硬边。
 */
function makeFacadeTexture(style: "wall" | "roof"): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  // 底色略低于纯白：给 color 染色留出正常区间（贴图 × color = 最终色）
  ctx.fillStyle = style === "roof" ? "#8f8c86" : "#efece6";
  ctx.fillRect(0, 0, S, S);

  // 九宫格重复绘制：任何跨边界的图案都会从对侧补回来，平铺无接缝
  const draw9 = (fn: (ox: number, oy: number) => void) => {
    for (let ix = -1; ix <= 1; ix++)
      for (let iy = -1; iy <= 1; iy++) fn(ix * S, iy * S);
  };

  // 1) 大块明暗斑：灰泥吸水不均 / 修补补丁（屋面则是沥青斑驳）
  const blotches = style === "roof" ? 120 : 26;
  for (let i = 0; i < blotches; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r =
      style === "roof" ? 5 + Math.random() * 16 : 26 + Math.random() * 86;
    const dark = Math.random() > 0.42;
    const a =
      style === "roof" ? 0.1 + Math.random() * 0.2 : 0.02 + Math.random() * 0.05;
    draw9((ox, oy) => {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, dark ? `rgba(72,70,66,${a})` : `rgba(255,255,252,${a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (style === "wall") {
    // 2) 顺墙流下的雨痕：细长竖向渐变，宽度很窄、几乎透明，只在大面积上才读得出来
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const h = 60 + Math.random() * 220;
      const w = 2 + Math.random() * 7;
      draw9((ox, oy) => {
        const g = ctx.createLinearGradient(x + ox, y + oy, x + ox, y + oy + h);
        g.addColorStop(0, "rgba(96,92,84,0.16)");
        g.addColorStop(0.4, "rgba(96,92,84,0.08)");
        g.addColorStop(1, "rgba(96,92,84,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x + ox, y + oy, w, h);
      });
    }
  }

  // 3) 细颗粒：灰泥/沥青的粗糙颗粒（密度高、单点极淡）
  const grains = style === "roof" ? 12000 : 7000;
  for (let i = 0; i < grains; i++) {
    const v = Math.random() > 0.5 ? 255 : 30;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.07})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * 红砖外墙贴图（可无缝平铺），供远景楼群的"砖楼"变体使用。
 *
 * 与灰泥贴图不同，这张贴图**自带颜色**：砖缝的明暗对比很细，如果再乘一层冷暖不同的
 * 实例色就会糊成一片。因此砖墙实例只用接近白的实例色（见 buildBackdrop 的 variant 分支），
 * 由贴图本身呈现红砖本色。
 *
 * 砖块绘制时越过画布左右边界重复一次，保证平铺时接缝处砖缝连续。
 */
function makeBrickTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  const BW = 32; // 单块砖宽（像素）；S=512 时一层贴图里有 16 块砖宽
  const BH = 16; // 单块砖高
  const M = 2; // 灰浆缝宽
  // 灰浆底
  ctx.fillStyle = "#c2b8a8";
  ctx.fillRect(0, 0, S, S);
  const rows = S / BH;
  const cols = S / BW;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (BW / 2); // 错缝砌法
    for (let c = -1; c <= cols; c++) {
      const x = c * BW + offset;
      const y = r * BH;
      const t = Math.random();
      // 主色 + 少量过火深砖 / 偏亮砖，避免整面一个红
      ctx.fillStyle = t < 0.12 ? "#8e4530" : t < 0.88 ? "#a9553f" : "#b96a4f";
      ctx.fillRect(x + M / 2, y + M / 2, BW - M, BH - M);
      // 砖面颗粒
      for (let i = 0; i < 7; i++) {
        const v = Math.random() > 0.5 ? 255 : 40;
        ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.09})`;
        ctx.fillRect(
          x + M / 2 + Math.random() * (BW - M),
          y + M / 2 + Math.random() * (BH - M),
          1.6,
          1.6
        );
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 人行道：水泥底色 + 污渍 + 裂缝方块线，纯地面质感（不画涂鸦，涂鸦只在墙上）
function makeSidewalkTexture(base: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  // 细微噪点污渍
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  // 人行道裂缝方块线
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 2;
  for (let x = 0; x <= 128; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 22);
  return tex;
}
// 地铁地面纹理：纯碎石道砟底，不绘制枕木（枕木由 railwayTrack.glb 轨道模型自带）。
// 纹理横向(uv.x) 1:1 铺满整幅地面（宽 14，x∈[-7,7]），纵向(uv.y) 沿 z 重复。
// 三条赛道处仅压一层略深的「碎石路基」底衬，与轨道模型自然融合。
function makeTieTexture(base: string, _tie: string): THREE.CanvasTexture {
  const W = 128; // 横向：对应地面宽度 14 → 每像素 = 14/128 ≈ 0.109
  const H = 128; // 纵向：一段纹理对应 z 方向 tileLen 单位
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  // 底色：深色道砟
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  // 道砟噪点（全幅）
  for (let i = 0; i < 1400; i++) {
    const v = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  // 三条赛道：世界 x → 纹理像素 x 的换算
  const LANES_X = [-4.5, 0, 4.5];
  const HALF_W = 7; // 地面对应 |x| ≤ 7
  const xToPx = (x: number) => ((x + HALF_W) / (HALF_W * 2)) * W;
  const TIE_HALF_WORLD = 1.35; // 轨道带半宽（世界单位），与模型轨距匹配
  for (const lx of LANES_X) {
    const px0 = xToPx(lx - TIE_HALF_WORLD);
    const pw = xToPx(lx + TIE_HALF_WORLD) - px0;
    // 碎石路基底衬：略深，与外侧道砟区分（枕木不再绘制，由轨道模型提供）
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(px0, 0, pw, H);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // 横向只铺 1 次（精确对齐三条赛道），纵向沿 z 重复铺满
  tex.repeat.set(1, 26);
  return tex;
}
// 速度线纹理（横向白色半透明条纹，沿行进方向飞过）
function makeSpeedLineTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 16;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 16);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(0, 6, 64, 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}
/**
 * 地铁道床道砟（ballast）纹理：深灰碎石底 + 大量深浅不一的多边形碎石。
 * 用于铺满主地面(±7)与隧道壁内表面(±9.4)之间的空隙，取代纯色道床的「死平面」观感。
 * 只取颜色与明暗，不画方向性图案，因此纵向平铺无接缝感。
 */
function makeBallastTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  // 底色：深灰偏冷，与隧道水泥壁同色系但更暗
  ctx.fillStyle = "#3c3c44";
  ctx.fillRect(0, 0, S, S);
  // 底层大颗碎石：暗色打底，营造凹凸的暗部
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 3 + Math.random() * 6;
    const shade = 40 + Math.random() * 30; // 深灰 ~ 中灰
    ctx.fillStyle = `rgb(${shade},${shade},${shade + 6})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // 上层亮面碎石：少量高光颗粒，制造颗粒感与反光点
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 2 + Math.random() * 4;
    const shade = 95 + Math.random() * 55; // 中灰 ~ 亮灰
    ctx.fillStyle = `rgb(${shade},${shade},${shade + 4})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // 细砂噪点：填缝，避免大色块之间的平整感
  for (let i = 0; i < 2600; i++) {
    const v = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // repeat 由调用方按道床尺寸设置（横向只铺一次、纵向密铺）
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 将任意图片处理为「双向无缝平铺」纹理：把右边缘淡入左边缘、下边缘淡入上边缘，
// 消除 RepeatWrapping 在图块接缝处的硬切（割裂感）。
// square=true 时拉伸铺满 size×size（墙面等各方向都重复的场景）；
// square=false 时保持原图宽高比（地面等横向只铺一次、纵向重复的场景），避免车道线被压缩变形。
function makeSeamlessTexture(
  img: HTMLImageElement,
  size = 1024,
  blendFrac = 0.18,
  square = true
): THREE.CanvasTexture {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  let cw: number, ch: number;
  if (square) {
    cw = ch = size;
  } else {
    const maxSide = size;
    if (iw >= ih) {
      cw = maxSide;
      ch = Math.max(1, Math.round((maxSide * ih) / iw));
    } else {
      ch = maxSide;
      cw = Math.max(1, Math.round((maxSide * iw) / ih));
    }
  }
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(img, 0, 0, cw, ch); // 基础铺底（保持比例或正方形）
  const bw = Math.max(4, Math.round(Math.min(cw, ch) * blendFrac));

  // 把「一条边缘」抽到临时画布，仅在该条带上做渐变 alpha，再贴回对侧，
  // 避免直接对整图用 destination-in 把非蒙版区域擦成透明。
  const edge = (
    sw: number,
    sh: number,
    sx: number,
    sy: number,
    dx: number,
    dy: number,
    horizontal: boolean
  ) => {
    const tmp = document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    const tctx = tmp.getContext("2d")!;
    tctx.drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh); // 取对侧边缘
    tctx.globalCompositeOperation = "destination-in";
    const g = horizontal
      ? tctx.createLinearGradient(0, 0, sw, 0)
      : tctx.createLinearGradient(0, 0, 0, sh);
    // 贴回侧(0) 用对侧内容完全覆盖，向内切侧渐隐，与原边缘自然过渡
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    tctx.fillStyle = g;
    tctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(tmp, dx, dy); // 默认 source-over 贴回
  };

  // 水平：取右边缘(sx=cw-bw) 贴到左边缘(dx=0)
  if (cw > bw * 2) edge(bw, ch, cw - bw, 0, 0, 0, true);
  // 垂直：取下边缘(sy=ch-bw) 贴到上边缘(dy=0)
  if (ch > bw * 2) edge(cw, bw, 0, ch - bw, 0, 0, false);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * 给砖墙贴图四周加一圈「水泥边框」，使其平铺后形成一块块独立墙板
 * （水泥框 + 内部砖面），类似真实车站砌块墙的勾缝分隔。
 *
 * 做法：读入已无缝处理的墙贴图 → 画到画布 → 四周留出 frameFrac 比例宽度的边框，
 * 填入带噪点的水泥灰；砖面内缩到框内。平铺时相邻贴图的边框会合并成一条较宽的水泥缝，
 * 因此单边宽度取目标缝宽的一半。
 *
 * @param img      源图（已无缝处理的 canvas / image）
 * @param size     输出画布边长
 * @param frameFrac 单边边框占边长的比例（0.05 ≈ 目标缝宽 10%）
 * @param cement   水泥基色
 */
function addCementFrame(
  img: HTMLImageElement | HTMLCanvasElement,
  size = 512,
  frameFrac = 0.055,
  cement = "#7d7d82"
): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;

  const f = Math.max(2, Math.round(size * frameFrac));
  const inner = size - f * 2;

  // 1) 水泥底：铺满整幅（作为边框底色）
  ctx.fillStyle = cement;
  ctx.fillRect(0, 0, size, size);
  // 水泥颗粒噪点：避免纯色死板，模拟水泥的粗糙感
  for (let i = 0; i < 5200; i++) {
    const v = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.07})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.6, 1.6);
  }

  // 2) 砖面：内缩到边框以内（砖面与水泥之间不做描边，保持自然过渡）
  ctx.drawImage(img, 0, 0, inner, inner, f, f, inner, inner);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 在已有（已无缝处理过的）墙 canvas 上叠加写实喷漆涂鸦。
// - 横向分成若干独立段，每段各自随机布局，避免同一图案沿墙长高频重复；
// - 密度稀疏（约半数段留白），颜色取自做旧喷漆调色板（低饱和、带灰），非卡通撞色；
// - 通过多层半透明 spray + 颗粒噪点模拟真实喷漆质感。左右墙各自调用一次自然混着来。
function applyGraffitiToWall(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts?: { palette?: string[]; segments?: number }
): void {
  // 鲜艳高饱和喷漆罐色系（实色、街头感强、远看也显眼）
  const palette = opts?.palette ?? [
    "#111111", // 近黑（描边/对比）
    "#ffffff", // 纯白（少量亮色做对比）
    "#ff1a1a", // 电光红
    "#0a6bff", // 亮宝蓝
    "#00c23a", // 荧光绿
    "#ffcc00", // 亮黄
    "#b026ff", // 亮紫
    "#ff6a00", // 亮橙
  ];
  const segments = opts?.segments ?? 24;
  const segW = w / segments;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = () => palette[Math.floor(Math.random() * palette.length)];
  // 多元混搭的街头 tag 词库：缩写、数字、罗马数字、整词、小写 slang 等
  const TAGS = [
    "LA", "OG", "KRW", "213", "XIII", "SIN", "BFD", "VEN", "TCW", "KILLA",
    "ACE", "ZOE", "NYC", "97", "DBK", "RIP", "LOCO", "VATO", "K.O.", "HELL",
    "GANG", "CREW", "flux", "nox", "vibe", "echo", "dusk", "rico", "maz",
    "XO", "FKR", "ODB", "WST", "SOS", "3RD", "MTV", "TKO",
  ];

  // 多层半透明圆叠加，模拟喷漆雾面（提高单层 alpha 让色块更实更显眼）
  const spray = (x: number, y: number, r: number, col: string) => {
    ctx.save();
    for (let k = 0; k < 2; k++) {
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(
        x + rnd(-r * 0.25, r * 0.25),
        y + rnd(-r * 0.25, r * 0.25),
        r * (1 - k * 0.22),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
  };
  // 颗粒噪点（喷漆飞溅/墙面质感）
  const grain = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    col: string,
    n: number
  ) => {
    ctx.save();
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++)
      ctx.fillRect(rnd(x0, x1), rnd(y0, y1), 1.4, 1.4);
    ctx.restore();
  };

  // 以下绘制函数均以 (0,0) 为中心，由外层 translate+rotate 放置（支持打斜/不规则）
  // 多元字体风格：每张涂鸦随机选一种，使同一面墙上的 tag 字体各不相同。
  // 偏向粗黑、窄体、紧凑无衬线（街头 throw-up / tag 常见调性），保留少量手写体增加混搭。
  const TAG_STYLES = [
    { font: `"Arial Black", Impact, sans-serif`, weight: 900, casing: "upper" as const },
    { font: `Impact, "Arial Black", sans-serif`, weight: 900, casing: "upper" as const },
    { font: `"Haettenschweiler", "Arial Narrow", sans-serif`, weight: 900, casing: "upper" as const },
    { font: `"Franklin Gothic Heavy", "Arial Black", sans-serif`, weight: 900, casing: "upper" as const },
    { font: `"Brush Script MT", "Segoe Script", cursive`, weight: 700, casing: "mixed" as const },
    { font: `"Trebuchet MS", sans-serif`, weight: 800, casing: "upper" as const },
    { font: `"Verdana", sans-serif`, weight: 900, casing: "lower" as const },
    { font: `"Comic Sans MS", "Arial", sans-serif`, weight: 700, casing: "mixed" as const },
  ];
  const applyCasing = (t: string, c: "upper" | "lower" | "mixed") =>
    c === "upper" ? t.toUpperCase() : c === "lower" ? t.toLowerCase() : t;

  const drawTag = (col: string, s: number) => {
    const txt = applyCasing(TAGS[Math.floor(Math.random() * TAGS.length)], "mixed"); // 基础词
    const st = TAG_STYLES[Math.floor(Math.random() * TAG_STYLES.length)];
    const out = applyCasing(txt, st.casing); // 按风格决定大小写
    // 整词先倾斜（街头 tag 常见的大角度甩动），再逐字符抖动绘制，营造潦草手写感
    const baseSlant = rnd(-0.28, 0.28); // 整体甩角
    ctx.save();
    ctx.rotate(baseSlant);
    ctx.font = `${st.weight} ${s}px ${st.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 1;
    // 先量出整词宽度，逐字符从 -w/2 排到 +w/2，每字符独立旋转/错位
    const widths = [...out].map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = -total / 2;
    const chars: { ch: string; cx: number; ry: number; dy: number }[] = [];
    for (let i = 0; i < out.length; i++) {
      const cx = x + widths[i] / 2;
      chars.push({
        ch: out[i],
        cx,
        ry: rnd(-0.22, 0.22), // 每字符随机旋转
        dy: rnd(-s * 0.12, s * 0.12), // 每字符上下错位
      });
      x += widths[i];
    }
    // 先统一粗黑描边（叠在所有字符之下，避免字符间描边互相覆盖显脏）
    ctx.lineJoin = "round";
    ctx.lineWidth = s * 0.14;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    for (const c of chars) {
      ctx.save();
      ctx.translate(c.cx, c.dy);
      ctx.rotate(c.ry);
      ctx.strokeText(c.ch, 0, 0);
      ctx.restore();
    }
    // 再填色（每个字符独立旋转/错位 → 潦草涂鸦感）
    ctx.fillStyle = col;
    for (const c of chars) {
      ctx.save();
      ctx.translate(c.cx, c.dy);
      ctx.rotate(c.ry);
      ctx.fillText(c.ch, 0, 0);
      ctx.restore();
    }
    // 滴漆：从词底随机滴下
    ctx.fillStyle = col;
    const drips = 1 + Math.floor(Math.random() * 3);
    for (let d = 0; d < drips; d++) {
      const dx = rnd(-total / 2, total / 2);
      const dl = rnd(s * 0.1, s * 0.55);
      ctx.beginPath();
      ctx.arc(dx, s * 0.45, Math.max(1.5, s * 0.03), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(dx - Math.max(1, s * 0.02), s * 0.45, Math.max(1.5, s * 0.04), dl);
    }
    ctx.restore();
    grain(-s, -s * 0.6, s, s * 0.6, "rgba(255,255,255,0.15)", 26);
  };
  const drawBlob = (col: string, r: number) => {
    spray(0, 0, r * 0.95, col);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 7) {
      const rr = r * (0.65 + Math.random() * 0.45);
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  const drawDrip = (col: string) => {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = col;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const dx = rnd(-10, 10);
      const dy = rnd(0, h * 0.14);
      const wd = rnd(1.5, 4);
      ctx.beginPath();
      ctx.ellipse(dx, dy, wd, wd * 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };
  // 模板喷漆：单色简单符号（星），写实街头常见
  const drawStencil = (col: string, s: number) => {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = col;
    const r = s * 0.5;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // 每段独立随机布局；按涂鸦实际半径 R 约束边界，确保完整不裁切；
  // 随机旋转(打斜)+字号不一+不规则斑点，呈现 casual 街头涂鸦感。
  for (let sIdx = 0; sIdx < segments; sIdx++) {
    const segX = sIdx * segW;
    // 稀疏：约 50% 的段留白，其余出现 1 个（放大后避免拥挤），少量出现 2 个
    const r = Math.random();
    const n = r < 0.5 ? 0 : r < 0.92 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const col = pick();
      const t = Math.random();
      // 先确定类型与尺寸，算出包围半径 R（含旋转后余量）
      let s = 0;
      let rad = 0;
      let kind: "tag" | "blob" | "drip" | "star" | "grainOnly";
      if (t < 0.34) {
        kind = "tag";
        s = rnd(h * 0.2, h * 0.3); // 字号不一（逐字符错位，略收一点避免越界）
        rad = s * 1.05; // 预留逐字符错位+旋转后的真实包围半径
      } else if (t < 0.56) {
        kind = "blob";
        rad = rnd(h * 0.12, h * 0.2) * 1.3;
      } else if (t < 0.7) {
        kind = "drip";
        rad = Math.max(h * 0.1, h * 0.22);
      } else if (t < 0.84) {
        kind = "star";
        s = rnd(h * 0.12, h * 0.2);
        rad = s * 0.6 * 1.3;
      } else {
        kind = "grainOnly";
        rad = 30;
      }
      // 边界余量：除了涂鸦半径，还要容纳旋转(最大±0.5rad)后的投影余量，避免被贴图边缘裁切
      const pad = rad * 0.55 + 6;
      const xL = segX + rad + pad;
      const xR = segX + segW - rad - pad;
      const yL = rad + pad;
      const yR = h - rad - pad;
      if (xR <= xL || yR <= yL) continue; // 段太窄放不下该涂鸦，跳过
      const x = rnd(xL, xR);
      const y = rnd(yL, yR);
      const ang = rnd(-0.5, 0.5); // 打斜
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      if (kind === "tag") drawTag(col, s);
      else if (kind === "blob") drawBlob(col, rad / 1.3); // 用受边界约束的半径，避免重叠裁切
      else if (kind === "drip") drawDrip(col);
      else if (kind === "star") drawStencil(col, s);
      else grain(-segW * 0.5, -h * 0.5, segW * 0.5, h * 0.5, col, 36);
      ctx.restore();
    }
  }
}

// 仅导出被 ThreeRunner / loaders 使用的函数
export {
  makeSkyTexture,
  makeCloudTexture,
  makeFacadeTexture,
  makeBrickTexture,
  makeSidewalkTexture,
  makeTieTexture,
  makeSpeedLineTexture,
  makeBallastTexture,
  makeSeamlessTexture,
  addCementFrame,
  applyGraffitiToWall,
};
