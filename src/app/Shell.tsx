import { Outlet } from 'react-router-dom';
import { SyncProvider } from '../state/SyncContext';
import { TokenProvider } from '../state/TokenContext';

export default function Shell() {
  return (
    <TokenProvider>
      <SyncProvider>
        <div className="shell">
          <Outlet />
        </div>
      </SyncProvider>
    </TokenProvider>
  );
}
