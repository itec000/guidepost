// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Actions では actions/configure-pages の結果（公開URL・パス）が渡される。
// ローカルでは未設定なので http://localhost:4321/ で動く
export default defineConfig({
  site: process.env.SITE_ORIGIN || undefined,
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
});
