import SyncBadge from '../components/SyncBadge';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <SyncBadge />
      <h1>首页</h1>
    </main>
  );
}
