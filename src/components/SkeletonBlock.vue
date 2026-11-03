<script setup lang="ts">
withDefaults(
  defineProps<{
    width?: string;
    height?: string;
    radius?: string;
  }>(),
  {
    width: '100%',
    height: '20px',
    radius: 'var(--radius-sm)',
  },
);
</script>

<template>
  <div
    class="skeleton-block"
    :style="{ width, height, borderRadius: radius }"
  />
</template>

<style scoped lang="scss">
.skeleton-block {
  background: var(--color-bg-gray);
  animation: sk-pulse 1.2s ease-in-out infinite;
}

@keyframes sk-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
