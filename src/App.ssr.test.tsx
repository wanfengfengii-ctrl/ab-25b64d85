import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App 界面挂载', () => {
  it('在无 localStorage 的环境下回退到内置示例并正常渲染', () => {
    const html = renderToString(<App />);
    expect(html).toContain('应急供氧歧管复原台');
    expect(html).toContain('模块格网');
    expect(html).toContain('复原接头朝向');
    // 内置示例为 2×2，共 4 张模块卡
    expect(html.match(/第1行第1列/g)?.length).toBeGreaterThan(0);
  });
});
