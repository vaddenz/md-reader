import { useNavigate } from 'react-router-dom';
import { goBackOrSettings } from '../app/nav';
import AboutSection from '../components/AboutSection';
import SettingsHeader from '../components/SettingsHeader';
import '../styles/settings.css';

/** 设置 · 关于：版本、定位声明与隐私说明。 */
export default function SettingsAboutPage() {
  const navigate = useNavigate();

  return (
    <main className="settings">
      <SettingsHeader
        title="关于"
        subtitle="版本、定位与隐私说明。"
        backLabel="设置"
        backAriaLabel="返回设置"
        onBack={() => goBackOrSettings(navigate)}
      />
      <AboutSection />
    </main>
  );
}
