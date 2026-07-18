import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  base: './',
  build: {
    // subsrt 用动态 require('./format/'+name+'.js') 加载各格式处理器,
    // 生产构建时 @rollup/plugin-commonjs 无法静态解析,需显式声明这些目标,
    // 否则打包后运行时会抛 "Could not dynamically require" 导致整页空白。
    commonjsOptions: {
      dynamicRequireTargets: ['node_modules/subsrt/lib/format/*.js'],
    },
  },
});
