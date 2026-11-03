<script setup lang="ts">
withDefaults(
  defineProps<{
    image: string;
    title: string;
    body: string;
    imageHeight?: number;
  }>(),
  { imageHeight: 405 },
);
</script>

<template>
  <div class="feature-card pop-card">
    <div class="card-image pop-frame" :style="{ height: imageHeight + 'px' }">
      <img :src="image" :alt="title" />
    </div>
    <div class="card-copy">
      <h3 class="text-subheading">{{ title }}</h3>
      <p class="text-body">{{ body }}</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.feature-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: $gap-md;
  padding: 12px;
}

.card-image {
  width: 100%;
  object-fit: cover;
}

.card-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 4px 4px 8px;

  .text-subheading {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: $fs-h3;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.01em;
  }
}
</style>
