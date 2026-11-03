<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SiteFooter from '@/components/SiteFooter.vue';
import SiteHeader from '@/components/SiteHeader.vue';

const route = useRoute();
// 数据大屏等全屏页面：隐藏顶部/底部栏，让内容占满整页
const hideChrome = computed(() => !!route.meta.hideChrome);
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--chrome-less': hideChrome }">
    <SiteHeader v-if="!hideChrome" />
    <main class="app-main">
      <router-view />
    </main>
    <SiteFooter v-if="!hideChrome" />
  </div>
</template>
