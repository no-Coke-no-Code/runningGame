import type { App } from 'vue';
import reveal from './reveal';
import pageLoading from './pageLoading';

export function setupDirectives(app: App): void {
  app.directive('reveal', reveal);
  app.directive('page-loading', pageLoading);
}
