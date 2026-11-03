<script setup lang="ts">
withDefaults(
  defineProps<{
    image: string;
    title: string;
    description: string;
    price: string;
    imageHeight?: number;
  }>(),
  { imageHeight: 284 },
);
</script>

<template>
  <router-link to="/product" class="product-card pop-card">
    <div class="product-image pop-frame" :style="{ height: imageHeight + 'px' }">
      <img :src="image" :alt="title" />
    </div>
    <div class="product-copy">
      <p class="product-title">{{ title }}</p>
      <p class="product-desc">{{ description }}</p>
      <p class="product-price">{{ price }}</p>
    </div>
  </router-link>
</template>

<style scoped lang="scss">
.product-card {
  display: flex;
  flex-direction: column;
  gap: $gap-md;
  padding: 12px;
  color: var(--color-text);
}

.product-image {
  width: 100%;
  object-fit: cover;
  background: var(--color-bg-gray);
}

.product-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 4px;
}

.product-title {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: $fs-body-lg;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.01em;
}

.product-desc {
  font-size: $fs-body;
  line-height: $lh-body;
  color: var(--color-text-gray);
}

.product-price {
  font-size: $fs-body-lg;
  font-weight: 800;
  line-height: $lh-body;
  color: var(--pop-red);
}
</style>
