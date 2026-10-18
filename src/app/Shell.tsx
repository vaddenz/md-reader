import { Outlet } from 'react-router-dom';
import { TokenProvider } from '../state/TokenContext';

export default function Shell() {
  return (
    <TokenProvider>
      <div className="shell">
        <Outlet />
      </div>
    </TokenProvider>
  );
}
