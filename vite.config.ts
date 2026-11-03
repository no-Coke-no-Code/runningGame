import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // 图表库独立分包，利于浏览器缓存
          echarts: ['echarts'],
        },
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // 每个组件的 <style lang="scss"> 都会自动注入 variables 和 mixins，无需手动 @use
        additionalData: `@use "@/styles/variables" as *; @use "@/styles/mixins" as *;`,
      },
    },
  },
});
