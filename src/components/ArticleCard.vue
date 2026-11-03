<script setup lang="ts">
defineProps<{
  image: string;
  title: string;
  author: string;
}>();
</script>

<template>
  <div class="article-card pop-card">
    <div class="card-image pop-frame">
      <img :src="image" :alt="title" />
    </div>
    <div class="card-copy">
      <p class="card-title">{{ title }}</p>
      <p class="card-author">{{ author }}</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.article-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: $gap-md;
  padding: 12px;
}

.card-image {
  width: 100%;
  height: 346px;
  object-fit: cover;
  background: var(--color-bg-gray);
}

.card-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 4px;
}

.card-title {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: $fs-body-lg;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.01em;
}

.card-author {
  font-size: $fs-body;
  font-weight: 700;
  line-height: $lh-body;
  color: var(--pop-magenta);
}
</style>
