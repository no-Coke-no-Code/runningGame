<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import echarts, { type ECOption } from '@/utils/echarts';
import { useTheme } from '@/composables/useTheme';

const props = withDefaults(
  defineProps<{
    option: ECOption;
    height?: string;
    // 地图使用：传入 geoJSON 注册后，option 中的 geo/map 即可引用
    registerMap?: { name: string; geoJSON: unknown } | null;
    autoresize?: boolean;
    // 实时刷新图表：用 merge + lazyUpdate 合并更新，避免频繁全量重建，降低大数据量下卡顿
    realtime?: boolean;
  }>(),
  {
    height: '300px',
    registerMap: null,
    autoresize: true,
    realtime: false,
  },
);

const emit = defineEmits<{
  (e: 'click', params: unknown): void;
  (e: 'mouseover', params: unknown): void;
  (e: 'mouseout', params: unknown): void;
}>();

const el = ref<HTMLDivElement>();
let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
const { theme } = useTheme();

function render() {
  if (!chart || !props.option) return;
  if (props.realtime) {
    // 实时模式：merge + lazyUpdate 合并更新，仅更新数据，保留交互状态，降低大数据量卡顿
    chart.setOption(props.option, { notMerge: false, lazyUpdate: true });
    return;
  }
  // 完整重建（notMerge）：确保 itemStyle 等状态准确反映当前数据，无 merge 残留。
  // 地图 option 不随数据刷新变化，仅在选中变化时重建，故不会频繁触发重绘。
  chart.setOption(props.option, { notMerge: true });
}

// 自适应尺寸：浏览器页面缩放（Ctrl+/-）或容器变化时，用防抖重新测量并 resize，
// 避免多次缩放时 ECharts 内部尺寸漂移导致地图区域越来越窄
function handleResize() {
  if (!el.value || !chart) return;
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = el.value!.clientWidth;
    const h = el.value!.clientHeight;
    if (w > 0 && h > 0) {
      chart?.resize({ width: w, height: h });
    }
  }, 60);
}

onMounted(() => {
  if (!el.value) return;
  // 注册地图（若提供）
  if (props.registerMap) {
    echarts.registerMap(props.registerMap.name, props.registerMap.geoJSON as never);
  }
  chart = echarts.init(el.value);
  render();

  // 转发交互事件（用于地图省份点击联动与 hover 状态跟踪）
  chart.on('click', (params: unknown) => emit('click', params));
  chart.on('mouseover', (params: unknown) => emit('mouseover', params));
  chart.on('mouseout', (params: unknown) => emit('mouseout', params));

  if (props.autoresize) {
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(el.value);
    // 监听窗口 resize，覆盖浏览器页面缩放场景
    window.addEventListener('resize', handleResize);
  }
});

watch(() => props.option, render, { deep: true });
watch(theme, handleResize);

// 暴露 ECharts 实例，供外部执行 dispatchAction（如恢复地图选中态）
defineExpose({ getInstance: () => chart });

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('resize', handleResize);
  if (resizeTimer) clearTimeout(resizeTimer);
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div ref="el" class="base-chart" :style="{ height }" />
</template>

<style scoped lang="scss">
.base-chart {
  width: 100%;
}
</style>
