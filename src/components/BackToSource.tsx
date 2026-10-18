import { useNavigate } from 'react-router-dom';

/** 从正文站内互链跳入时显示的「返回来源」条：点击回到来源历史条目。 */
export default function BackToSource() {
  const navigate = useNavigate();

  return (
    <button type="button" className="back-to-source" onClick={() => navigate(-1)}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 5l-7 7 7 7"
        />
      </svg>
      返回来源
    </button>
  );
}
