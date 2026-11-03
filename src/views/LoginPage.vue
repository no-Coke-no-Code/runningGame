<script setup lang="ts">
import { ref, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { User, Lock } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { useUserStore } from "@/stores";

const userStore = useUserStore();
const router = useRouter();
const route = useRoute();

const loading = ref(false);
const form = reactive({ email: "", password: "" });

async function onSubmit() {
  if (!form.email || !form.password) {
    ElMessage.warning("请输入邮箱和密码");
    return;
  }
  loading.value = true;
  try {
    await userStore.login({ email: form.email, password: form.password });
    ElMessage.success("登录成功");
    const redirect = (route.query.redirect as string) || "/";
    router.replace(redirect);
  } catch (err) {
    ElMessage.error((err as Error).message || "登录失败");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page login-page">
    <main class="login-page-main">
      <div class="login-page-card">
        <h1 class="login-page-title">登录</h1>
        <p class="login-page-sub">欢迎回来，请登录你的账户</p>

        <el-form
          :model="form"
          class="login-page-form"
          label-position="top"
          @submit.prevent="onSubmit"
        >
          <el-form-item label="邮箱">
            <el-input v-model="form.email" size="large" placeholder="coke43">
              <template #prefix
                ><el-icon><User /></el-icon
              ></template>
            </el-input>
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="form.password"
              type="password"
              size="large"
              show-password
              placeholder="123456"
            >
              <template #prefix
                ><el-icon><Lock /></el-icon
              ></template>
            </el-input>
          </el-form-item>

          <el-button
            class="btn-primary login-page-btn"
            size="large"
            :loading="loading"
            native-type="submit"
          >
            登录
          </el-button>
        </el-form>

        <p class="login-page-hint">演示账号：coke43 / 123456</p>
      </div>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  // 波普纸感底纹
  background-color: var(--pop-cream);
  background-image:
    radial-gradient(rgba(0, 0, 0, 0.05) 2px, transparent 2.1px),
    repeating-linear-gradient(45deg, transparent 0 18px, rgba(45, 45, 242, 0.05) 18px 20px);
  background-size: 16px 16px, auto;

  &-main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 64px 24px;
  }

  &-card {
    width: 100%;
    max-width: 420px;
    background: var(--color-surface);
    border: var(--border-ink-lg) solid var(--color-ink);
    border-radius: 16px;
    padding: 40px 36px;
    box-shadow: var(--shadow-hard-lg);
  }

  &-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 32px;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    color: var(--pop-red);
    -webkit-text-stroke: 1.5px var(--color-ink);
    margin-bottom: 8px;
  }

  &-sub {
    font-weight: 500;
    color: var(--color-text-gray);
    margin-bottom: 28px;
  }

  &-form {
    margin-bottom: 8px;

    :deep(.el-form-item__label) {
      font-family: var(--font-display);
      font-weight: 400;
      font-size: 14px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--color-text);
    }

    :deep(.el-input__wrapper) {
      border-radius: $radius-md;
      box-shadow: 0 0 0 var(--border-ink) var(--color-ink) inset, var(--shadow-hard-sm);
      background: var(--color-surface);
    }

    :deep(.el-input__inner) {
      height: 48px;
    }
  }

  &-btn {
    width: 100%;
    margin-top: 8px;
  }

  &-hint {
    margin-top: 16px;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-gray);
    text-align: center;
  }
}
</style>
