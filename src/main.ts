import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import { createApp } from 'vue';
import App from './App.vue';
import { initTheme } from './composables/useTheme';
import { setupDirectives } from './directives';
import { pinia, useUserStore } from './stores';
import router from './router';
import './styles/global.scss';

// 在挂载前初始化主题，避免首屏闪烁
initTheme();

const app = createApp(App).use(pinia).use(router).use(ElementPlus);
setupDirectives(app);

// 应用启动：若本地存在 token，则恢复登录态（拉取最新用户信息）
const userStore = useUserStore();
userStore.restore().finally(() => {
  app.mount('#app');
});
