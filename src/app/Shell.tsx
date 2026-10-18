import { Outlet } from 'react-router-dom';

export default function Shell() {
  return (
    <div className="shell">
      <Outlet />
    </div>
  );
}
