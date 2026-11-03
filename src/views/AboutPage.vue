<script setup lang="ts">
import { ElMessage } from "element-plus";
import { onMounted, reactive, ref } from "vue";
import { getAboutContent, submitContactForm } from "@/api/about";
import type { AboutContent, ContactFormPayload } from "@/api/types";
import PageSkeleton from "@/components/PageSkeleton.vue";

const loading = ref(true);
const content = ref<AboutContent>();

const submitting = ref(false);
const form = reactive<ContactFormPayload>({
  firstName: "",
  lastName: "",
  email: "",
  message: "",
});

onMounted(async () => {
  try {
    content.value = await getAboutContent();
  } catch {
    // 错误提示由请求层统一处理
  } finally {
    loading.value = false;
  }
});

async function onSubmit() {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await submitContactForm({ ...form });
    ElMessage.success("Submitted");
    form.firstName = "";
    form.lastName = "";
    form.email = "";
    form.message = "";
  } catch {
    // 错误提示由请求层统一处理
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-page-loading="loading" class="about-page">
    <template v-if="!loading && content">
      <div class="container about-page-layout">
        <!-- 左列：介绍 + 联系表单 -->
        <div class="about-page-left">
          <div class="about-page-copy">
            <h1 class="about-page-title">{{ content.title }}</h1>
            <p class="about-page-sub">{{ content.sub }}</p>
            <p class="about-page-paragraph">{{ content.paragraph }}</p>
          </div>

          <h2 class="about-page-contact-heading">Contact me</h2>

          <el-form
            class="about-page-contact-form"
            label-position="top"
            @submit.prevent="onSubmit"
          >
            <div class="form-row">
              <el-form-item label="First name">
                <el-input v-model="form.firstName" placeholder="Jane" />
              </el-form-item>
              <el-form-item label="Last name">
                <el-input v-model="form.lastName" placeholder="Smitherton" />
              </el-form-item>
            </div>
            <el-form-item label="Email address">
              <el-input
                v-model="form.email"
                placeholder="email@janesfakedomain.net"
              />
            </el-form-item>
            <el-form-item label="Your message">
              <el-input
                v-model="form.message"
                type="textarea"
                :rows="6"
                placeholder="Enter your question or message"
              />
            </el-form-item>
            <el-button
              class="btn-primary about-page-submit-btn"
              native-type="submit"
              :loading="submitting"
            >
              Submit
            </el-button>
          </el-form>
        </div>

        <!-- 右列：图片 -->
        <div v-reveal class="about-page-image pop-frame">
          <img :src="content.image" alt="About" />
        </div>
      </div>
    </template>

    <PageSkeleton v-else variant="about" />
  </div>
</template>

<style scoped lang="scss">
.about-page {
  background: var(--color-bg);

  &-layout {
    margin-top: $gap-2xl;
    margin-bottom: 98px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 60px;
  }

  &-left {
    width: 626px;
    display: flex;
    flex-direction: column;
  }

  &-copy {
    display: flex;
    flex-direction: column;
    gap: $gap-md;
  }

  &-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: $fs-display;
    line-height: 0.95;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    -webkit-text-stroke: 1.5px var(--color-ink);
    color: var(--pop-magenta);
  }

  &-sub {
    font-size: $fs-body-lg;
    font-weight: 500;
    line-height: $lh-body-lg;
    color: var(--color-text-gray);
  }

  &-paragraph {
    font-size: $fs-body;
    font-weight: 500;
    line-height: $lh-body;
    white-space: pre-line;
  }

  &-contact-heading {
    margin-top: $gap-2xl;
    font-family: var(--font-display);
    font-weight: 400;
    font-size: $fs-h4;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.01em;
  }

  &-contact-form {
    margin-top: 45px;

    .form-row {
      display: flex;
      gap: $gap-lg;

      .el-form-item {
        flex: 1;
      }
    }

    :deep(.el-form-item__label) {
      font-family: var(--font-display);
      font-weight: 400;
      font-size: $fs-body-sm;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      line-height: $lh-body-sm;
      color: var(--color-text);
      margin-bottom: $gap-xs;
    }

    :deep(.el-input__wrapper),
    :deep(.el-textarea__inner) {
      border-radius: $radius-md;
      box-shadow: 0 0 0 var(--border-ink) var(--color-ink) inset,
        var(--shadow-hard-sm);
      background: var(--color-surface);
      font-size: $fs-body-sm;
    }

    :deep(.el-input__inner) {
      height: 48px;
    }

    :deep(.el-input__inner::placeholder),
    :deep(.el-textarea__inner::placeholder) {
      color: var(--color-text-gray);
    }
  }

  &-submit-btn {
    width: 100%;
    height: 62px;
    font-size: $fs-body;
  }

  &-image {
    width: 508px;
    height: 657px;
    object-fit: cover;
    background: var(--color-bg-gray);
    flex-shrink: 0;
  }
}
</style>
