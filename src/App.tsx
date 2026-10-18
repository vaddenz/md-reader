import { createHashRouter, RouterProvider } from 'react-router-dom';
import Shell from './app/Shell';
import HomePage from './pages/HomePage';
import DocPage from './pages/DocPage';
import FontPreviewPage from './pages/FontPreviewPage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';

const router = createHashRouter([
  { path: '/', element: <Shell />, children: [
    { index: true, element: <HomePage /> },
    { path: 'doc/*', element: <DocPage /> },
    { path: 'search', element: <SearchPage /> },
    { path: 'settings', element: <SettingsPage /> },
    { path: 'font-preview', element: <FontPreviewPage /> },
    { path: 'setup', element: <SetupPage /> },
  ]},
]);

export default function App() {
  return <RouterProvider router={router} />;
}
