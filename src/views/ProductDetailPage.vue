<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { getProductDetail, getRelatedProducts } from '@/api/product';
import type { Product, ProductDetail } from '@/api/types';
import ProductCard from '@/components/ProductCard.vue';
import PageSkeleton from '@/components/PageSkeleton.vue';

const route = useRoute();

const loading = ref(true);
const detail = ref<ProductDetail>();
const related = ref<Product[]>([]);

async function loadData(id: string) {
  loading.value = true;
  try {
    // 详情与相关商品并行请求
    const [detailData, relatedData] = await Promise.all([
      getProductDetail(id),
      getRelatedProducts(id),
    ]);
    detail.value = detailData;
    related.value = relatedData;
  } catch {
    // 错误提示由请求层统一处理
  } finally {
    loading.value = false;
  }
}

onMounted(() => loadData(String(route.params.id)));

// 从商品卡片跳入同一路由时，参数变化需要重新加载
watch(
  () => route.params.id,
  (id) => {
    if (id) loadData(String(id));
  },
);
</script>

<template>
  <div v-page-loading="loading" class="product-page">
    <template v-if="!loading && detail">
      <!-- 商品主区（首屏顶部内容，直接展示） -->
      <section class="container product-page-main">
        <div class="product-page-image pop-frame">
          <img :src="detail.image" :alt="detail.name" />
        </div>
        <div class="product-page-copy">
          <h1 class="product-page-name">{{ detail.name }}</h1>
          <p class="product-page-sub">{{ detail.sub }}</p>
          <p class="product-page-price">{{ detail.price }}</p>
          <p class="product-page-desc">{{ detail.description }}</p>
          <el-button class="btn-primary product-page-add-cart">Add to cart</el-button>
          <p class="product-page-fine-print">{{ detail.finePrint }}</p>
        </div>
      </section>

      <!-- 相关商品 -->
      <section v-reveal class="container product-page-related-section">
        <h2 class="product-page-related-heading">Related products</h2>
        <div class="product-page-related-grid">
          <ProductCard
            v-for="p in related"
            :key="p.id"
            v-reveal
            :image="p.image"
            :title="p.title"
            :description="p.description"
            :price="p.price"
            :image-height="238"
          />
        </div>
      </section>
    </template>

    <PageSkeleton v-else variant="product" />
  </div>
</template>

<style scoped lang="scss">
.product-page {
  background: var(--color-bg);

  &-main {
    @include flex-center-y;
    gap: 140px;
  }

  &-image {
    width: 625px;
    height: 613px;
    object-fit: cover;
    background: var(--color-bg-gray);
    flex-shrink: 0;
  }

  &-copy {
    width: 515px;
    display: flex;
    flex-direction: column;
    gap: $gap-md;
  }

  &-name {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: $fs-h3;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.01em;
  }

  &-sub {
    font-size: $fs-body-lg;
    font-weight: 500;
    line-height: $lh-body-lg;
    color: var(--color-text-gray);
  }

  &-price {
    font-size: $fs-h4;
    font-weight: 800;
    line-height: $lh-h4;
    color: var(--pop-red);
  }

  &-desc {
    font-size: $fs-body;
    line-height: $lh-body;
    color: var(--color-text-gray);
  }

  &-add-cart {
    width: 100%;
    height: 62px;
    font-size: $fs-body-sm;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  &-fine-print {
    font-size: $fs-body-sm;
    font-weight: 600;
    line-height: $lh-body-sm;
    color: var(--color-text-gray);
  }

  &-related-section {
    margin-top: $gap-2xl;
    margin-bottom: 150px;
    display: flex;
    flex-direction: column;
    gap: $gap-lg;
  }

  &-related-heading {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: $fs-h4;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.01em;
  }

  &-related-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: $gap-lg;
  }
}
</style>
