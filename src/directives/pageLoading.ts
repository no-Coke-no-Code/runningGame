import type { Directive, DirectiveBinding } from 'vue';
import { ElLoading, type LoadingInstance } from 'element-plus';

/**
 * v-page-loading：页面级加载占位指令。
 * 相比原生 v-loading，预设了“无 spinner、透明背景、无淡出过渡”，
 * 仅作为动态获取内容时的占位语义，避免与首屏内容叠加产生闪烁。
 * 用法：<div v-page-loading="loading">
 */
const instances = new WeakMap<HTMLElement, LoadingInstance>();

function open(el: HTMLElement): void {
  instances.set(
    el,
    ElLoading.service({
      target: el,
      lock: false,
      spinner: '',
      background: 'transparent',
      customClass: 'page-loading-mask',
    }),
  );
}

const pageLoading: Directive<HTMLElement, boolean | undefined> = {
  mounted(el, binding: DirectiveBinding<boolean | undefined>) {
    if (binding.value) open(el);
  },
  updated(el, binding: DirectiveBinding<boolean | undefined>) {
    const inst = instances.get(el);
    if (binding.value && !inst) open(el);
    else if (!binding.value && inst) {
      inst.close();
      instances.delete(el);
    }
  },
  unmounted(el) {
    instances.get(el)?.close();
    instances.delete(el);
  },
};

export default pageLoading;
