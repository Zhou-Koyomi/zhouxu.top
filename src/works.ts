// 「我的作品」档案的 360° 预览配置。命中的档案在模型查看器中以画框展板
// 替代光学环组/光学核心；其余档案保持装配模型原行为。
export interface ArtworkPartLabel {
  label: string;
  en: string;
}
export interface ArtworkInfo {
  /** 运行时图片 URL（public/works 下）。 */
  src: string;
  /** 作品标题，用于盖板标签与贴图降级占位。 */
  title: string;
  /** 图片自然尺寸，用于展板宽高比与纹理加载失败时的兜底。 */
  width: number;
  height: number;
  /** 装配结构列表中被替换部件的显示文案。 */
  partLabels: {
    "optical-lenses": ArtworkPartLabel;
    "optical-core": ArtworkPartLabel;
    substrate: ArtworkPartLabel;
  };
}

const ARTWORK_PART_LABELS: ArtworkInfo["partLabels"] = {
  "optical-lenses": { label: "琥珀画框", en: "AMBER FRAME" },
  "optical-core": { label: "展板画芯", en: "ART PRINT" },
  substrate: { label: "象牙背板", en: "IVORY BACKING" },
};

export const ARTWORKS: Record<string, ArtworkInfo> = {
  "X-002": {
    src: "/works/X-002.png",
    title: "我的画像",
    width: 2048,
    height: 2048,
    partLabels: ARTWORK_PART_LABELS,
  },
  "X-009": {
    src: "/works/X-009.jpg",
    title: "覆布雕像",
    width: 1280,
    height: 1748,
    partLabels: ARTWORK_PART_LABELS,
  },
  "X-010": {
    src: "/works/X-010.png",
    title: "夕",
    width: 1280,
    height: 1710,
    partLabels: ARTWORK_PART_LABELS,
  },
  "X-011": {
    src: "/works/X-011.jpg",
    title: "百叶窗",
    width: 1080,
    height: 1303,
    partLabels: ARTWORK_PART_LABELS,
  },
  "X-012": {
    src: "/works/X-012.jpg",
    title: "注视",
    width: 1280,
    height: 731,
    partLabels: ARTWORK_PART_LABELS,
  },
  "X-013": {
    src: "/works/X-013.jpg",
    title: "兔兔",
    width: 1587,
    height: 2000,
    partLabels: ARTWORK_PART_LABELS,
  },
  "X-014": {
    src: "/works/X-014.jpg",
    title: "设计、宇宙和机械",
    width: 1036,
    height: 1552,
    partLabels: ARTWORK_PART_LABELS,
  },
};
