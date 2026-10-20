import { createHashRouter, RouterProvider } from 'react-router-dom';
import { DataSyncProvider } from './sync/DataSyncContext';
import './sync/backends';
import Shell from './app/Shell';
import HomePage from './pages/HomePage';
import DocPage from './pages/DocPage';
import FontPreviewPage from './pages/FontPreviewPage';
import MemoryPage from './pages/MemoryPage';
import MemoryRecordsPage from './pages/MemoryRecordsPage';
import MemoryTrainPage from './pages/MemoryTrainPage';
import SearchPage from './pages/SearchPage';
import SettingsAboutPage from './pages/SettingsAboutPage';
import SettingsAccountPage from './pages/SettingsAccountPage';
import SettingsDataPage from './pages/SettingsDataPage';
import SettingsMemoryPage from './pages/SettingsMemoryPage';
import SettingsPage from './pages/SettingsPage';
import SettingsReadingPage from './pages/SettingsReadingPage';
import SettingsSyncPage from './pages/SettingsSyncPage';
import SetupPage from './pages/SetupPage';

const router = createHashRouter([
  { path: '/', element: <Shell />, children: [
    { index: true, element: <HomePage /> },
    { path: 'doc/*', element: <DocPage /> },
    { path: 'search', element: <SearchPage /> },
    { path: 'settings', element: <SettingsPage /> },
    { path: 'settings/account', element: <SettingsAccountPage /> },
    { path: 'settings/reading', element: <SettingsReadingPage /> },
    { path: 'settings/data', element: <SettingsDataPage /> },
    { path: 'settings/sync', element: <SettingsSyncPage /> },
    { path: 'settings/memory', element: <SettingsMemoryPage /> },
    { path: 'settings/about', element: <SettingsAboutPage /> },
    { path: 'font-preview', element: <FontPreviewPage /> },
    { path: 'setup', element: <SetupPage /> },
    { path: 'memory', element: <MemoryPage /> },
    { path: 'memory/train', element: <MemoryTrainPage /> },
    { path: 'memory/records', element: <MemoryRecordsPage /> },
  ]},
]);

export default function App() {
  return (
    <DataSyncProvider>
      <RouterProvider router={router} />
    </DataSyncProvider>
  );
}
