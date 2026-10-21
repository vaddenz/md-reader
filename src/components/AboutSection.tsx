import pkg from '../../package.json';

/**
 * 「关于」区块（Spec §9）：版本号 + 定位声明（个人自用）+ 隐私说明。
 * 文案与 README 顶部「仅供个人使用」声明、引导页页脚保持一致。
 */
export default function AboutSection() {
  return (
    <section className="settings-section settings-about" aria-label="关于">
      <p className="settings-version">
        版本 <code>v{pkg.version}</code>
      </p>

      <p className="settings-about-statement">
        <strong>个人自用，非通用 Markdown 阅读器</strong>
        ：本项目是作者个人自用的小工具，唯一用途是在自己的手机 / 电脑浏览器里阅读自己私有 GitHub
        仓库中的 Markdown 文档（默认指向作者本人的仓库）。
      </p>
      <ul className="settings-about-list">
        <li>不是通用产品，不面向其他用户设计，也不建议其他人部署使用；</li>
        <li>不提供通用使用指引、兼容性承诺或技术支持；</li>
        <li>如果你在寻找通用的 Markdown 阅读器，本项目不适合你，请另寻其他开源项目。</li>
      </ul>

      <p className="settings-about-statement">
        内置字体：霞鹜新晰黑·屏幕阅读版（© 落霞孤鹜，IPA Font License 1.0）；
        思源宋体 / Noto Serif SC（© Adobe/Google，SIL OFL 1.1）。许可文本见仓库 <code>public/fonts/licenses/</code>。
      </p>

      <p className="settings-about-statement">隐私说明：</p>
      <ul className="settings-about-list">
        <li>GitHub Token 仅保存在本机浏览器（localStorage），不会上传到任何第三方，也不会写入 URL 或日志；</li>
        <li>跨设备同步默认关闭；启用后阅读进度、高亮、笔记、收藏与记忆数据会发送到你自备的 Neon 端点，正文、GitHub Token 与 AI Key 永不上传；</li>
        <li>应用仅访问 <code>api.github.com</code>、你配置的模型地址与你启用的同步端点，无任何第三方脚本 / 字体 / 图片 / CDN 请求；</li>
        <li>所有文档内容仅存于本机浏览器缓存，不经过任何托管平台。</li>
      </ul>
    </section>
  );
}
