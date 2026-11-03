<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ECOption } from "@/utils/echarts";
import BaseChart from "@/components/BaseChart.vue";
import { useTheme } from "@/composables/useTheme";
import chinaGeo from "@/assets/map/china.json";
// 虚构的省份实时数据（外置 JSON，便于维护/替换为真实接口）
import dashboardData from "@/assets/map/dashboard-data.json";

const { theme } = useTheme();

// 波普色板（区分日/夜，图表完全跟随主题）
const POP = computed(() => ({
  magenta: "#ff00a8",
  blue: "#00a2e8",
  yellow: "#ffe000",
  cyan: "#00d8c8",
  red: "#ff0033",
  // 文字 / 坐标轴 / 分割线 / 投影颜色：日间墨黑，夜间近白
  ink: theme.value === "dark" ? "#f6f0ff" : "#1a1a1a",
  grid:
    theme.value === "dark" ? "rgba(246,240,255,0.18)" : "rgba(26,26,26,0.15)",
  labelBg: theme.value === "dark" ? "#1f1f3d" : "#f6eed7",
  labelBorder: theme.value === "dark" ? "#f6f0ff" : "#1a1a1a",
  surface: theme.value === "dark" ? "#1f1f3d" : "#ffffff",
  tooltipShadow:
    theme.value === "dark" ? "rgba(255,0,168,0.5)" : "rgba(0,0,0,0.2)",
}));

// ---------- 模拟数据模型（虚构各省实时数据） ----------
interface ProvinceData {
  baseValue: number; // 基准销量（万件/月）
  growth: number; // 同比增长率 %
  category: string; // 主营品类
  trend: number[]; // 近 4 季度销量趋势（亿元）
  mix: number[]; // 品类构成占比
}

// 各省虚构基准数据 + 品类权重 + 品类名（来自外置 JSON）
const provinceSeed: Record<
  string,
  Omit<ProvinceData, "mix">
> = dashboardData.provinces as Record<string, Omit<ProvinceData, "mix">>;
const MIX_WEIGHTS: Record<string, number[]> = dashboardData.mixWeights;
const CATEGORIES: string[] = dashboardData.categories;

function makeMix(category: string): number[] {
  const w = MIX_WEIGHTS[category] ?? MIX_WEIGHTS["其他"];
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((v) => Math.round((v / total) * 100));
}

// 实时数据（响应式），定时随机游走模拟后端实时推送
const provinceData = ref<Record<string, ProvinceData>>(
  Object.fromEntries(
    Object.entries(provinceSeed).map(([name, seed]) => [
      name,
      { ...seed, mix: makeMix(seed!.category) } as ProvinceData,
    ])
  )
);

// 地图展示模式：2D 平面 / 3D 立体
const mapMode = ref<"2d" | "3d">("2d");

// 选中省份：null = 全国数据；选中后展示该省数据
const activeProvince = ref<string | null>(null);

// 可点击省份名列表（与地图 GeoJSON 全名一致，如"北京市"）
const provinceNames = Object.keys(provinceSeed);

// 省名简称：去掉"省/市/自治区/壮族/回族/维吾尔"后缀，用于界面展示
function shortName(name: string): string {
  return name
    .replace("维吾尔自治区", "")
    .replace("壮族自治区", "")
    .replace("回族自治区", "")
    .replace("自治区", "")
    .replace("省", "")
    .replace("市", "");
}

// ---------- 模拟实时数据刷新（随机游走，模拟后端推送） ----------
function randomWalk(base: number, amplitude = 0.06): number {
  const drift = (Math.random() - 0.48) * 2 * amplitude; // 轻微正偏，整体缓涨
  return Math.max(1, Math.round(base * (1 + drift) * 10) / 10);
}

function refreshData(): void {
  const next: Record<string, ProvinceData> = {};
  Object.entries(provinceData.value).forEach(([name, d]) => {
    next[name] = {
      ...d,
      // 销量在基准附近随机游走
      baseValue: randomWalk(d.baseValue),
      // 增长在 ±2 内波动
      growth: Math.round((d.growth + (Math.random() - 0.5) * 2) * 10) / 10,
      // 趋势最近一季随 tick 微动
      trend: d.trend.map((v, i) =>
        i === d.trend.length - 1
          ? Math.round((v + (Math.random() - 0.5) * 4) * 10) / 10
          : v
      ),
      mix: d.mix,
    };
  });
  provinceData.value = next;
}

let timer: ReturnType<typeof setInterval> | null = null;

// ---------- 派生数据 ----------
// 当前选中省份的数据（未选中为 null）
const selected = computed(() =>
  activeProvince.value ? provinceData.value[activeProvince.value] : null
);

// 全国汇总：各省求和 + 平均增长
const national = computed(() => {
  const names = provinceNames;
  const totalValue = names.reduce(
    (s, n) => s + provinceData.value[n].baseValue,
    0
  );
  const avgGrowth =
    names.reduce((s, n) => s + provinceData.value[n].growth, 0) / names.length;
  return {
    name: "全国",
    value: Math.round(totalValue * 10) / 10,
    growth: Math.round(avgGrowth * 10) / 10,
    category: "综合",
  };
});

// 当前展示主体（全国 or 选中省份），统一为 { name, value, growth, category } 形状
const focus = computed<{
  name: string;
  value: number;
  growth: number;
  category: string;
}>(() => {
  if (selected.value) {
    return {
      name: activeProvince.value!,
      value: selected.value.baseValue,
      growth: selected.value.growth,
      category: selected.value.category,
    };
  }
  return national.value;
});

// 当前展示主体名（界面展示用简称）
const focusName = computed(() =>
  activeProvince.value ? shortName(activeProvince.value) : "全国"
);

// 当前品类构成（全国=各省 mix 加权，选中=该省 mix）
const focusMix = computed(() => {
  if (selected.value) {
    return CATEGORIES.map((c, i) => ({
      name: c,
      value: selected.value!.mix[i],
    }));
  }
  // 全国：取各省 mix 的平均作为整体构成
  const sums = [0, 0, 0, 0, 0];
  provinceNames.forEach((n) => {
    const m = provinceData.value[n].mix;
    m.forEach((v, i) => (sums[i] += v));
  });
  const avg = sums.map((v) => Math.round((v / provinceNames.length) * 10) / 10);
  return CATEGORIES.map((c, i) => ({ name: c, value: avg[i] }));
});

// 当前趋势（全国=各省 trend 之和，选中=该省 trend）
const focusTrend = computed(() => {
  if (selected.value) {
    return selected.value!.trend.map((v) => Math.round(v * 10) / 10);
  }
  const sums = [0, 0, 0, 0];
  provinceNames.forEach((n) => {
    const t = provinceData.value[n].trend;
    t.forEach((v, i) => (sums[i] += v));
  });
  return sums.map((v) => Math.round(v * 10) / 10);
});

// 当前增长值（用于环图中心）
const focusGrowth = computed(() => Math.abs(focus.value.growth));

// 柱状图数据：未选中显示销量 Top 省份，选中显示该省及相邻省份
const barData = computed(() => {
  if (activeProvince.value) {
    const idx = provinceNames.indexOf(activeProvince.value);
    const near = [-1, 0, 1].map(
      (off) =>
        provinceNames[(idx + off + provinceNames.length) % provinceNames.length]
    );
    return near.map((name) => ({
      name: shortName(name),
      value: provinceData.value[name].baseValue,
      highlight: name === activeProvince.value,
    }));
  }
  return [...provinceNames]
    .sort(
      (a, b) =>
        provinceData.value[b].baseValue - provinceData.value[a].baseValue
    )
    .slice(0, 5)
    .map((name) => ({
      name: shortName(name),
      value: provinceData.value[name].baseValue,
      highlight: false,
    }));
});

// ---------- 图表 Option ----------

// 地图 option：仅用于省份选择，不在地图上展示数据。
// 选中省份青色高亮，其余统一品红；点击后联动周边图表展示该省数据。
const mapOption = computed<ECOption>(() => {
  const { ink, labelBg, labelBorder } = POP.value;
  // 省份列表。选中态写在 data 的 itemStyle 中（选中青/未选中品红 + 省名 label）。
  // 配合 BaseChart 的 notMerge 完整重建：地图 option 不随数据刷新变化，
  // 仅在 activeProvince/mapMode 变化时重建，故切回全国时准确重算为品红、无残留。
  const items = provinceNames.map((name) => {
    const isSelected = name === activeProvince.value;
    return {
      name,
      itemStyle: {
        // 选中省份黄色高亮；边框统一用黑色（避免红/黑边框叠加导致显示不全）
        areaColor: isSelected ? "#ffe000" : "rgba(255,0,168,0.55)",
        borderColor: ink,
        borderWidth: isSelected ? 2 : 1,
      },
      label: isSelected
        ? {
            // 选中省份常显省名
            show: true,
            color: ink,
            fontWeight: 700,
            fontSize: 12,
            formatter: shortName(name),
          }
        : undefined,
    };
  });

  return {
    tooltip: {
      trigger: "item",
      backgroundColor: labelBg,
      borderColor: labelBorder,
      borderWidth: 2,
      textStyle: { color: ink, fontWeight: 600 },
      // 地图不展示数据，仅提示点击省份进行联动
      formatter: (params: unknown) => {
        const p = params as { name: string };
        return `<b>${shortName(
          p.name
        )}</b><br/><span style="font-weight:400">点击查看该省数据</span>`;
      },
    },
    // 只用 series-map 单个地图组件
    series: [
      {
        type: "map",
        map: "china",
        roam: false,
        layoutCenter: ["50%", "50%"],
        layoutSize: "95%",
        data: items,
        // 关闭动画，避免重建时闪动
        animationDurationUpdate: 0,
        animation: false,
        itemStyle: {
          areaColor: "rgba(255,0,168,0.55)",
          borderColor: ink,
          borderWidth: 1,
          shadowColor: "rgba(255,0,168,0.4)",
          shadowBlur: 10,
        },
        // 默认不显示省名，hover（emphasis）时显示
        label: { show: false },
        emphasis: {
          label: {
            show: true,
            color: ink,
            fontWeight: 700,
            fontSize: 12,
            formatter: (params: unknown) =>
              shortName((params as { name: string }).name),
          },
          itemStyle: { areaColor: "#ffe000", borderColor: ink, borderWidth: 2 },
        },
      },
    ],
  };
});

// 饼图：品类构成（全国 / 选中省份）
const pieOption = computed<ECOption>(() => {
  const { ink, labelBg, labelBorder } = POP.value;
  return {
    tooltip: {
      trigger: "item",
      backgroundColor: labelBg,
      borderColor: labelBorder,
      textStyle: { color: ink, fontWeight: 600 },
    },
    color: [
      POP.value.magenta,
      POP.value.blue,
      POP.value.yellow,
      POP.value.cyan,
      POP.value.red,
    ],
    legend: {
      bottom: 0,
      textStyle: { color: ink, fontWeight: 600 },
    },
    series: [
      {
        name: "品类构成",
        type: "pie",
        radius: ["45%", "70%"],
        center: ["50%", "42%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: ink, borderWidth: 2, borderRadius: 4 },
        label: { show: true, color: ink, fontWeight: 700 },
        data: focusMix.value,
      },
    ],
  };
});

// 柱状图：华东区域门店销量
const barOption = computed<ECOption>(() => {
  const { ink, grid, labelBg, labelBorder } = POP.value;
  return {
    tooltip: {
      trigger: "axis",
      backgroundColor: labelBg,
      borderColor: labelBorder,
      textStyle: { color: ink },
    },
    color: [POP.value.blue],
    grid: { left: 45, right: 16, top: 30, bottom: 36 },
    xAxis: {
      type: "category",
      data: barData.value.map((d) => d.name),
      axisLine: { lineStyle: { color: ink } },
      axisTick: { show: false },
      axisLabel: { color: ink, fontWeight: 600 },
    },
    yAxis: {
      type: "value",
      name: "万件",
      nameTextStyle: { color: ink },
      splitLine: { lineStyle: { color: grid, type: "dashed" } },
      axisLabel: { color: ink },
    },
    series: [
      {
        name: "销量",
        type: "bar",
        barWidth: "46%",
        // 每项带独立颜色：选中省份品红高亮，其余蓝色
        data: barData.value.map((d) => ({
          value: d.value,
          itemStyle: {
            color: d.highlight ? POP.value.magenta : POP.value.blue,
            borderRadius: [6, 6, 0, 0] as [number, number, number, number],
            borderColor: ink,
            borderWidth: 2,
            shadowColor: ink,
            shadowOffsetY: 4,
          },
        })),
        label: { show: true, position: "top", color: ink, fontWeight: 700 },
      },
    ],
  };
});

// 折线图：季度销售额趋势（全国 / 选中省份，随数据刷新实时变动）
const lineOption = computed<ECOption>(() => {
  const { ink, grid, labelBg, labelBorder } = POP.value;
  const seasons = ["Q1", "Q2", "Q3", "Q4"];
  const data = focusTrend.value;
  return {
    tooltip: {
      trigger: "axis",
      backgroundColor: labelBg,
      borderColor: labelBorder,
      textStyle: { color: ink },
    },
    color: [POP.value.magenta],
    grid: { left: 45, right: 16, top: 30, bottom: 36 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: seasons,
      axisLine: { lineStyle: { color: ink } },
      axisTick: { show: false },
      axisLabel: { color: ink, fontWeight: 600 },
    },
    yAxis: {
      type: "value",
      name: "亿元",
      nameTextStyle: { color: ink },
      splitLine: { lineStyle: { color: grid, type: "dashed" } },
      axisLabel: { color: ink },
    },
    series: [
      {
        name: "销售额",
        type: "line",
        smooth: true,
        data,
        // 大数据量时用 lttb 降采样，保持曲线形状的同时减少渲染点数，避免卡顿
        sampling: "lttb",
        // 分片渐进渲染，避免一次性绘制海量点导致阻塞
        progressive: 5000,
        symbol: "circle",
        symbolSize: 8,
        lineStyle: { width: 3, color: POP.value.magenta },
        itemStyle: { borderColor: ink, borderWidth: 2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(255,0,168,0.5)" },
              { offset: 1, color: "rgba(255,0,168,0.02)" },
            ],
          },
        },
      },
    ],
  };
});

// 环图：当前主体（全国 / 选中省份）增长构成
const ringOption = computed<ECOption>(() => {
  const { ink, labelBg, labelBorder } = POP.value;
  const g = focusGrowth.value;
  return {
    tooltip: {
      trigger: "item",
      backgroundColor: labelBg,
      borderColor: labelBorder,
      textStyle: { color: ink },
    },
    color: [
      POP.value.yellow,
      POP.value.cyan,
      POP.value.red,
      POP.value.blue,
      POP.value.magenta,
    ],
    title: {
      text: focusName.value,
      left: "center",
      top: "34%",
      textStyle: { color: ink, fontSize: 20, fontWeight: 800 },
    },
    graphic: [
      {
        type: "text",
        left: "center",
        top: "46%",
        style: { text: `${g}%`, fill: ink, fontSize: 22, fontWeight: 800 },
      },
    ],
    legend: { bottom: 0, textStyle: { color: ink, fontWeight: 600 } },
    series: [
      {
        name: "增长构成",
        type: "pie",
        radius: ["60%", "80%"],
        center: ["50%", "42%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: ink, borderWidth: 2 },
        label: { show: false },
        // 用 100 刻度表达增长占比
        data: [
          { value: Math.min(g, 100), name: "同比增长" },
          { value: Math.max(100 - g, 0), name: "基线" },
        ],
      },
    ],
  };
});

// 3D 地图 option（echarts-gl map3D，类型放宽以支持 map3D 系列）
// 仅用于省份选择，不展示数据；选中态写在 data 的 itemStyle 中（与 2D 一致）。
const map3DOption = computed<any>(() => {
  const { ink } = POP.value;
  const items = provinceNames.map((name) => {
    const isSelected = name === activeProvince.value;
    return {
      name,
      itemStyle: {
        // 选中省份黄色高亮；边框统一黑色，避免红/黑叠加
        color: isSelected ? "#ffe000" : "rgba(255,0,168,0.4)",
        borderColor: ink,
        borderWidth: isSelected ? 2 : 1,
      },
    };
  });

  return {
    tooltip: {
      backgroundColor: POP.value.labelBg,
      borderColor: POP.value.labelBorder,
      textStyle: { color: ink, fontWeight: 600 },
      formatter: (params: unknown) => {
        const p = params as { name: string };
        return `<b>${shortName(
          p.name
        )}</b><br/><span style="font-weight:400">点击查看该省数据</span>`;
      },
    },
    series: [
      {
        name: "省份销量",
        type: "map3D",
        map: "china",
        roam: false,
        regionHeight: 3,
        itemStyle: {
          color: "rgba(255,0,168,0.4)",
          borderColor: ink,
          borderWidth: 1,
        },
        emphasis: {
          label: { show: true, color: ink, fontWeight: 700, fontSize: 12 },
          itemStyle: { color: "#ffe000", borderColor: ink, borderWidth: 2 },
        },
        shadeQuality: "high",
        label: { show: false },
        data: items,
        viewControl: {
          autoRotate: false,
          // 增大距离让整幅地图（含南海诸岛）完整落入视口
          distance: 130,
          alpha: 40,
          beta: 0,
          center: [0, 0, 0],
        },
        light: {
          main: { intensity: 1.2, shadow: true },
          ambient: { intensity: 0.4 },
        },
      },
    ],
  };
});

// 根据当前模式返回地图 option
const activeMapOption = computed<ECOption>(() =>
  mapMode.value === "3d" ? map3DOption.value : mapOption.value
);

// ---------- 地图点击联动 ----------
// 点击省份：选中该省
function onMapClick(params: unknown) {
  const p = params as { name?: string };
  if (p?.name && provinceData.value[p.name]) {
    activeProvince.value = p.name;
  }
}

// 清除选中，回到全国视角
function clearSelection() {
  activeProvince.value = null;
}

// ---------- 大屏整体缩放（固定设计稿 1920x1080，等比缩放 + 居中，保持比例不变形） ----------
const DESIGN_W = 1920;
const DESIGN_H = 1080;
const scaleEl = ref<HTMLDivElement | null>(null);

function applyScale() {
  const el = scaleEl.value;
  if (!el) return;
  // 等比缩放：取宽、高比例较小者，保持 16:9 不变形
  const s = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
  // 缩放后实际尺寸，用于居中
  const w = DESIGN_W * s;
  const h = DESIGN_H * s;
  const tx = (window.innerWidth - w) / 2;
  const ty = (window.innerHeight - h) / 2;
  el.style.width = `${DESIGN_W}px`;
  el.style.height = `${DESIGN_H}px`;
  el.style.transformOrigin = "top left";
  el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
}

let scaleTimer: ReturnType<typeof setTimeout> | null = null;
function onWindowResize() {
  if (scaleTimer) clearTimeout(scaleTimer);
  scaleTimer = setTimeout(applyScale, 60);
}

onMounted(() => {
  // 启动数据实时刷新
  timer = setInterval(refreshData, 3000);
  // 初始化大屏整体缩放
  applyScale();
  window.addEventListener("resize", onWindowResize);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  window.removeEventListener("resize", onWindowResize);
  if (scaleTimer) clearTimeout(scaleTimer);
});
</script>

<template>
  <!-- 外层占满视口，内层按固定设计稿缩放 -->
  <div class="dashboard-scale">
    <div ref="scaleEl" class="dashboard-page">
      <!-- 顶部标题栏 -->
      <header class="dashboard-header">
        <span class="dashboard-header-bracket bracket-left" />
        <h1 class="dashboard-title">全国销售数据大屏</h1>
        <span class="dashboard-header-bracket bracket-right" />
        <div class="dashboard-header-meta">
          <span class="meta-dot" /> 实时数据 · 每 3 秒刷新
        </div>
      </header>

      <!-- 主体三列布局 -->
      <div class="dashboard-body">
        <!-- 左列 -->
        <div class="dashboard-col">
          <section class="chart-panel">
            <h2 class="panel-title">{{ focusName }}品类构成</h2>
            <BaseChart :option="pieOption" height="100%" />
          </section>
          <section class="chart-panel">
            <h2 class="panel-title">
              {{
                activeProvince ? `${focusName}及相邻省份销量` : "销量 TOP 省份"
              }}
            </h2>
            <BaseChart :option="barOption" height="100%" />
          </section>
        </div>

        <!-- 中列：中国地图 -->
        <div class="dashboard-col dashboard-col--center">
          <section class="chart-panel map-panel">
            <div class="panel-head">
              <h2 class="panel-title">各省销售分布（点击省份查看该省数据）</h2>
              <div class="map-mode-switch">
                <button
                  type="button"
                  :class="{ active: mapMode === '2d' }"
                  @click="mapMode = '2d'"
                >
                  2D
                </button>
                <button
                  type="button"
                  :class="{ active: mapMode === '3d' }"
                  @click="mapMode = '3d'"
                >
                  3D
                </button>
              </div>
            </div>
            <BaseChart
              :option="activeMapOption"
              height="100%"
              :register-map="{ name: 'china', geoJSON: chinaGeo }"
              @click="onMapClick"
            />
            <!-- 选中省份详情浮层（仅在选中省份时显示该省数据；未选中即隐藏） -->
            <div v-if="activeProvince" class="map-detail">
              <div class="map-detail-head">
                <span class="map-detail-name">{{ focusName }}</span>
                <button
                  type="button"
                  class="map-detail-clear"
                  @click="clearSelection"
                  title="返回全国数据"
                >
                  全国
                </button>
              </div>
              <div class="map-detail-item">
                <span>本月销量</span>
                <b>{{ focus.value }} 万件</b>
              </div>
              <div class="map-detail-item">
                <span>同比增长</span>
                <b :class="{ up: focus.growth > 0 }">
                  {{ focus.growth > 0 ? "+" : "" }}{{ focus.growth }}%
                </b>
              </div>
              <div class="map-detail-item">
                <span>主营品类</span>
                <b>{{ focus.category }}</b>
              </div>
            </div>
          </section>
        </div>

        <!-- 右列 -->
        <div class="dashboard-col">
          <section class="chart-panel">
            <h2 class="panel-title">{{ focusName }}季度销售额趋势</h2>
            <BaseChart :option="lineOption" height="100%" realtime />
          </section>
          <section class="chart-panel">
            <h2 class="panel-title">{{ focusName }}同比增长</h2>
            <BaseChart :option="ringOption" height="100%" />
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 外层：占满视口并隐藏溢出；内层 .dashboard-page 按固定设计稿缩放适配
.dashboard-scale {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--color-bg);
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
}

// 数据大屏：固定设计稿尺寸（1920x1080），由 JS 通过 transform: scale 整体缩放适配，
// 任何分辨率/浏览器缩放下排版比例恒定，不会出现右列出屏
.dashboard-page {
  position: absolute;
  top: 0;
  left: 0;
  overflow: hidden;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
  transform-origin: top left;
}

// 顶部标题栏（波普风，基于设计稿固定高度）
.dashboard-header {
  position: relative;
  flex-shrink: 0;
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 38px;
  border-bottom: 4px solid var(--color-ink);

  &-meta {
    position: absolute;
    right: 38px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--color-text-gray);
    display: flex;
    align-items: center;
    gap: 6px;
  }
}

.meta-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--pop-magenta);
  animation: blink 1.2s ease-in-out infinite;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.2;
  }
}

// 主标题：基于设计稿固定字号，靠外层 scale 整体缩放
.dashboard-title {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 58px;
  line-height: 1;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--color-ink);
  // 用细投影强化立体但不糊字
  text-shadow: 0 0 1px currentColor;
  -webkit-font-smoothing: antialiased;
}

// 装饰角标
.bracket-left,
.bracket-right {
  width: 34px;
  height: 34px;
  border: 4px solid var(--color-ink);
}

.bracket-left {
  border-right: none;
  border-bottom: none;
}

.bracket-right {
  border-left: none;
  border-top: none;
}

// 主体三列：占满剩余高度，基于设计稿固定间距
.dashboard-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr 1.4fr 1fr;
  gap: 30px;
  padding: 22px 38px;
  align-items: stretch;
}

.dashboard-col {
  display: flex;
  flex-direction: column;
  gap: 30px;
  min-height: 0;
  // 防止图表内容撑开列宽，导致右列出屏
  min-width: 0;
  overflow: hidden;
}

// 图表面板（波普硬框 + 投影）：flex 纵向，图表区占满剩余空间
.chart-panel {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 3px solid var(--color-ink);
  border-radius: $radius-md;
  box-shadow: var(--shadow-hard);
  padding: 14px 16px 12px;
  overflow: hidden;
  background: var(--color-bg);

  :deep(.base-chart) {
    flex: 1;
    min-height: 0;
    min-width: 0;
    width: 100%;
  }
}

.panel-title {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 17px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-ink);
  flex-shrink: 0;
  margin-bottom: 8px;
}

// 面板标题行（含右上角切换按钮）
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  margin-bottom: 8px;

  .panel-title {
    margin-bottom: 0;
  }
}

// 2D / 3D 切换按钮（波普小标签）
.map-mode-switch {
  display: flex;
  gap: 6px;

  button {
    padding: 3px 10px;
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 400;
    letter-spacing: 0.04em;
    color: var(--color-ink);
    background: var(--color-surface);
    border: 2px solid var(--color-ink);
    border-radius: $radius-sm;
    cursor: pointer;
    transition: background-color 0.18s ease, color 0.18s ease,
      transform 0.12s ease;

    &:hover {
      transform: translate(-1px, -1px);
      box-shadow: var(--shadow-press);
    }

    &.active {
      background: var(--pop-yellow);
      color: var(--color-ink);
      box-shadow: var(--shadow-press);
    }
  }
}

// 地图详情浮层
.map-detail {
  position: absolute;
  left: 22px;
  bottom: 18px;
  width: 200px;
  padding: 10px 12px;
  background: var(--pop-yellow);
  border: 3px solid var(--color-ink);
  border-radius: $radius-sm;
  box-shadow: var(--shadow-hard-sm);
  display: flex;
  flex-direction: column;
  gap: 6px;

  &-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 2px solid var(--color-ink);
    padding-bottom: 4px;
    margin-bottom: 2px;
  }

  &-name {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 400;
    text-transform: uppercase;
    color: var(--color-ink);
  }

  &-clear {
    padding: 1px 8px;
    font-family: var(--font-display);
    font-size: 12px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--color-ink);
    background: var(--color-surface);
    border: 2px solid var(--color-ink);
    border-radius: $radius-sm;
    cursor: pointer;
    transition: background-color 0.15s ease, transform 0.1s ease;

    &:hover {
      background: var(--pop-magenta);
      transform: translate(-1px, -1px);
      box-shadow: var(--shadow-press);
    }
  }

  &-item {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-ink);

    b {
      font-weight: 800;
      white-space: nowrap;

      &.up {
        color: var(--pop-red);
      }
    }
  }
}
</style>
