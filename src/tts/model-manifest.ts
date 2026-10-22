/** Matcha zh-en 离线语音包的模型清单（文件来自 ModelScope CDN）。 */

export interface ModelFile {
  /** 相对模型根目录的路径。 */
  path: string;
  size: number;
  sha256: string;
  url: string;
  /** 该文件是 tar.gz 包，下载后解压到模型根目录。 */
  archive?: boolean;
}

export interface ModelManifest {
  id: string;
  version: string;
  sampleRate: number;
  /** OPFS 下的根目录名，例如 `tts/matcha-zh-en/v1`。 */
  storageDir: string;
  files: ModelFile[];
}

const BASE = 'https://modelscope.cn/models/bujidc/matcha-icefall-zh-en/resolve/master/';

export const MATCHA_ZH_EN_MANIFEST: ModelManifest = {
  id: 'matcha-zh-en',
  version: '1',
  sampleRate: 16000,
  storageDir: 'tts/matcha-zh-en/v1',
  files: [
    {
      path: 'model-steps-3.onnx',
      size: 75717082,
      sha256: '524286bf6cf11be74329ae1c682ac69e34d6860c2ea9fd1290319d561540b16a',
      url: `${BASE}model-steps-3.onnx`,
    },
    {
      path: 'vocos-16khz-univ.onnx',
      size: 53882848,
      sha256: 'b599142a1fb8ff03de3e84ac35ff537c619e56f4267a6fe894851a42844acf9e',
      url: `${BASE}vocos-16khz-univ.onnx`,
    },
    {
      path: 'lexicon.txt',
      size: 1400278,
      sha256: '599efdcdaff4df2a123ce988c2cb90abcd59b919ef609ce36eb587d68b7ca2c0',
      url: `${BASE}lexicon.txt`,
    },
    {
      path: 'tokens.txt',
      size: 21146,
      sha256: '77fee8e5e5dd96b3547119e6159292c648e99e065c54c97777722e3ce710b9a4',
      url: `${BASE}tokens.txt`,
    },
    {
      path: 'phone-zh.fst',
      size: 88630,
      sha256: '1ac2b6fa56b1442320c4de7db08353bab8963a2b57f365eebcdd3a2d3562f8d7',
      url: `${BASE}phone-zh.fst`,
    },
    {
      path: 'date-zh.fst',
      size: 59154,
      sha256: 'eb8aa079ae3cb81d8f4404992f39d61a0cb990947512b5b8d1e54d1f6980e718',
      url: `${BASE}date-zh.fst`,
    },
    {
      path: 'number-zh.fst',
      size: 64482,
      sha256: '743f402181fcfebf76cc2f0546b71fa26476e626fbe4e460fb7b4c3a7a8bd5bd',
      url: `${BASE}number-zh.fst`,
    },
    {
      path: 'espeak-ng-data.tar.gz',
      size: 9019081,
      sha256: 'bcb8ee20b8d7a87e3cb5dfd1233d75c7aa4d874ccb35d434b9fe1dd28fe18637',
      url: `${BASE}espeak-ng-data.tar.gz`,
      archive: true,
    },
  ],
};

export const MATCHA_ZH_EN_TOTAL_SIZE = MATCHA_ZH_EN_MANIFEST.files.reduce((sum, file) => sum + file.size, 0);
