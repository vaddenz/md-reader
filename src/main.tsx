import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initRepoState, takeReloadRoute } from './data/repos';
import './styles/base.css';
import './styles/content.css';
import './styles/fonts.css';
import './styles/menu.css';

/**
 * 启动前先确定“当前仓库”的 IndexedDB 作用域（多仓库各自独立库），
 * 再恢复切换仓库前记住的路由，最后渲染 React。
 */
async function bootstrap(): Promise<void> {
  try {
    await initRepoState();
  } catch {
    // 初始化失败（IndexedDB 不可用等）不阻塞渲染；运行时会回退默认仓库。
  }
  const route = takeReloadRoute();
  if (route && window.location.hash !== route) window.location.hash = route;

  // 多标签页共用 localStorage 中的仓库指针：其它标签切换/增删仓库后整页重载，
  // 避免两个标签在不同 IndexedDB 作用域里读写同一份界面状态。
  window.addEventListener('storage', (e) => {
    if (e.key === 'mdreader.repos') window.location.reload();
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
