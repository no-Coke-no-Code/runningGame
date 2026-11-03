import type { Directive, DirectiveBinding } from 'vue';

interface RevealEl extends HTMLElement {
  __revealObserver?: IntersectionObserver;
  __revealed?: boolean;
}

/**
 * v-reveal 滚动进入动效指令
 * 元素进入视口时，从「半透明 + 下方小幅位移」过渡到「不透明 + 原位」，增添灵动感。
 *
 * 用法：
 *   v-reveal                      默认（自下而上 24px 位移）
 *   v-reveal="'left'"             自左向右进入
 *   v-reveal="{ distance: 40 }"  自定义位移距离（px）
 *   v-reveal="{ once: false }"   离开视口后重新播放（默认只播放一次）
 */
const reduceMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const reveal: Directive<RevealEl, string | Record<string, unknown> | undefined> = {
  mounted(el: RevealEl, binding: DirectiveBinding) {
    const opts =
      typeof binding.value === 'object' && binding.value !== null
        ? (binding.value as Record<string, unknown>)
        : {};
    const distance = typeof opts.distance === 'number' ? opts.distance : 24;
    const once = opts.once !== false; // 默认只播放一次

    // 尊重用户的「减少动态效果」系统偏好：直接显示，不做动效
    if (reduceMotion()) {
      el.style.opacity = '1';
      return;
    }

    // 初始隐藏态：直接操作内联样式（不要用 setAttribute 整体重写，否则会破坏 transition 时机）
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.style.transform = `translate3d(0, ${distance}px, 0)`;
    // 强制回流，固定初始态（此时无过渡），避免从默认 opacity:1 过渡到 0 造成首次闪烁
    void el.offsetHeight;
    el.style.transition = 'opacity 0.6s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.willChange = 'opacity, transform';

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            el.__revealed = true;
            el.style.opacity = '1';
            el.style.transform = 'translate3d(0, 0, 0)';
            if (once) {
              observer.unobserve(el);
              el.__revealObserver = undefined;
              // 过渡播完后再清除内联 transform/transition，交还 CSS 控制，
              // 否则内联 transform 会覆盖 .pop-card:hover 等类样式的 transform，导致 hover 动效失效。
              // 注意：必须在 transitionend 之后清除，不能在设置终态的同一帧里清除，
              // 否则元素会瞬间跳到终态、入场动画被吞。
              const onEnd = (e: TransitionEvent) => {
                if (e.target !== el || e.propertyName !== 'transform') return;
                el.style.removeProperty('transform');
                el.style.removeProperty('transition');
                el.style.removeProperty('will-change');
                el.removeEventListener('transitionend', onEnd);
              };
              el.addEventListener('transitionend', onEnd);
            }
          } else if (!once && el.__revealed) {
            // 可重复播放：仅当已显示过（离开视口）才恢复隐藏态，
            // 避免首屏/重排时把尚未显示的元素反复重置，造成二次闪烁
            el.style.opacity = '0';
            el.style.transform = `translate3d(0, ${distance}px, 0)`;
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    );

    observer.observe(el);
    el.__revealObserver = observer;
  },
  unmounted(el: RevealEl) {
    el.__revealObserver?.disconnect();
    el.__revealObserver = undefined;
  },
};

export default reveal;
