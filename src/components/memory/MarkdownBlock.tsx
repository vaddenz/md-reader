import { useMemo } from 'react';
import { renderDoc } from '../../markdown/render';

/** 轻量 markdown 渲染块：题库题干 / 题面 / 答案复用阅读器渲染管线。 */
export default function MarkdownBlock(props: { text: string; path: string; knownPaths: Set<string>; className?: string }) {
  const html = useMemo(
    () => renderDoc(props.text, { path: props.path, knownPaths: props.knownPaths }).html,
    [props.text, props.path, props.knownPaths],
  );
  return (
    <div
      className={props.className ? `memory-md ${props.className}` : 'memory-md'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
