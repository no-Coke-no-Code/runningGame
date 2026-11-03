/**
 * ECharts 按需引入：仅注册项目实际用到的图表类型与组件，显著减小打包体积。
 * 图表类型：柱状图、饼图、折线图、地图；组件：提示框、图例、直角坐标系、视觉映射。
 */
import * as echarts from 'echarts/core';
import { BarChart, PieChart, LineChart, MapChart } from 'echarts/charts';
import {
  TooltipComponent,
  LegendComponent,
  GridComponent,
  VisualMapComponent,
  TitleComponent,
  GraphicComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Map3DChart } from 'echarts-gl/charts';
import type { ComposeOption } from 'echarts/core';

// 组合各图表/组件的 option 类型
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption, MapSeriesOption } from 'echarts/charts';
import type {
  TooltipComponentOption,
  LegendComponentOption,
  GridComponentOption,
  VisualMapComponentOption,
  TitleComponentOption,
  GraphicComponentOption,
} from 'echarts/components';

export type ECOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | MapSeriesOption
  | TooltipComponentOption
  | LegendComponentOption
  | GridComponentOption
  | VisualMapComponentOption
  | TitleComponentOption
  | GraphicComponentOption
>;

echarts.use([
  BarChart,
  PieChart,
  LineChart,
  MapChart,
  Map3DChart,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  VisualMapComponent,
  TitleComponent,
  GraphicComponent,
  CanvasRenderer,
]);

export default echarts;
