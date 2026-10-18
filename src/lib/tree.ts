/** 文件树数据模型（根文档 / 顶层子目录分组）。 */

export interface TreeItem {
  /** 仓库内完整路径（如 `NodeJS/内存.md`）。 */
  path: string;
  /** 显示名：文件名去 `.md` 后缀（如 `内存`）。 */
  name: string;
}

export interface TreeDir {
  /** 顶层目录名（如 `NodeJS`）。 */
  name: string;
  /** 该目录下的全部文档（含嵌套子目录中的），按显示顺序排列。 */
  items: TreeItem[];
}

export interface Tree {
  root: TreeItem[];
  dirs: TreeDir[];
}

const collator = new Intl.Collator('zh');

/** 显示名：取路径最后一段并去掉 `.md` 后缀。 */
function displayName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

/**
 * 同层排序：文件在前、子目录在后，各自按 Intl.Collator('zh') 排序，子目录内递归 ——
 * 与 PrevNext.orderDocPaths 同口径（实测：汉字在拉丁字母之前、汉字按拼音）。
 */
function orderRests(rests: string[]): string[] {
  const files: string[] = [];
  const dirs = new Map<string, string[]>();
  for (const rest of rests) {
    const i = rest.indexOf('/');
    if (i < 0) {
      files.push(rest);
      continue;
    }
    const dir = rest.slice(0, i);
    const inner = rest.slice(i + 1);
    const bucket = dirs.get(dir);
    if (bucket) bucket.push(inner);
    else dirs.set(dir, [inner]);
  }
  files.sort(collator.compare);
  const out = files;
  for (const dir of [...dirs.keys()].sort(collator.compare)) {
    for (const rest of orderRests(dirs.get(dir)!)) out.push(`${dir}/${rest}`);
  }
  return out;
}

/** 按顶层目录分组构建文件树：根文档在前，目录按 zh 排序，目录内深度优先。 */
export function buildTree(paths: string[]): Tree {
  const rootRests: string[] = [];
  const byDir = new Map<string, string[]>();
  for (const path of paths) {
    const i = path.indexOf('/');
    if (i < 0) {
      rootRests.push(path);
      continue;
    }
    const dir = path.slice(0, i);
    const rest = path.slice(i + 1);
    const bucket = byDir.get(dir);
    if (bucket) bucket.push(rest);
    else byDir.set(dir, [rest]);
  }
  const toItem = (path: string): TreeItem => ({ path, name: displayName(path) });
  return {
    root: orderRests(rootRests).map(toItem),
    dirs: [...byDir.keys()].sort(collator.compare).map((name) => ({
      name,
      items: orderRests(byDir.get(name)!).map((rest) => toItem(`${name}/${rest}`)),
    })),
  };
}

/** 展平为路径列表（深度优先：根文档 → 各目录按序），供 PrevNext 等使用。 */
export function flattenTree(tree: Tree): string[] {
  const out = tree.root.map((i) => i.path);
  for (const dir of tree.dirs) for (const item of dir.items) out.push(item.path);
  return out;
}
