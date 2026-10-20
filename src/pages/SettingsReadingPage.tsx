import { useNavigate } from 'react-router-dom';
import { goBackOrSettings } from '../app/nav';
import AppearanceSection from '../components/AppearanceSection';
import SettingsHeader from '../components/SettingsHeader';
import { useOrientation } from '../state/OrientationContext';
import '../styles/settings.css';

/** 设置 · 阅读体验：阅读外观 + 显示方向。 */
export default function SettingsReadingPage() {
  const navigate = useNavigate();
  const { state: orientation, setOrientation } = useOrientation();

  return (
    <main className="settings">
      <SettingsHeader
        title="阅读体验"
        subtitle="正文排版与屏幕方向；外观改动即时预览并自动保存。"
        backLabel="设置"
        backAriaLabel="返回设置"
        onBack={() => goBackOrSettings(navigate)}
      />

      <AppearanceSection />

      <section className="settings-section" aria-labelledby="settings-orientation-title">
        <h2 id="settings-orientation-title">显示方向</h2>
        <div className="appearance-row" role="radiogroup" aria-label="显示方向">
          {([
            ['portrait', '竖屏锁定'],
            ['landscape', '横屏'],
            ['landscape-flipped', '横屏（翻转）'],
          ] as const).map(([id, label]) => (
            <label key={id} className="appearance-radio">
              <input type="radio" name="orientation" checked={orientation === id} onChange={() => setOrientation(id)} />
              {label}
            </label>
          ))}
        </div>
        <p className="settings-note">方向锁定需要以主屏幕应用（PWA）打开；浏览器标签下可能不支持。默认竖屏锁定、不跟随手机旋转。</p>
      </section>
    </main>
  );
}
