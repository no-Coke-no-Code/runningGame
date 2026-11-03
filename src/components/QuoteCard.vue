<script setup lang="ts">
defineProps<{
  quote: string;
  name: string;
  description: string;
  avatar: string;
}>();
</script>

<template>
  <div class="quote-card pop-card">
    <p class="quote-text">{{ quote }}</p>
    <div class="quote-author">
      <el-avatar class="author-avatar" :size="45" :src="avatar" />
      <div class="author-meta">
        <p class="author-name">{{ name }}</p>
        <p class="author-desc">{{ description }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.quote-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: $gap-xl;
  padding: $gap-md;
  background: var(--pop-yellow);
}

.quote-text {
  font-size: $fs-body-lg;
  font-weight: 700;
  line-height: $lh-body-lg;
}

.quote-author {
  @include flex-center-y;
  gap: $gap-sm;
}

.author-avatar {
  border: 2px solid var(--color-ink);
  box-shadow: var(--shadow-press);
}

.author-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.author-name {
  font-size: $fs-body-sm;
  font-weight: 700;
  line-height: $lh-body-sm;
}

.author-desc {
  font-size: $fs-body-sm;
  font-weight: 600;
  line-height: $lh-body-sm;
  color: var(--color-text-dark);
}
</style>
