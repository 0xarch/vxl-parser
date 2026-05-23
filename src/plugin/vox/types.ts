// 调色板，256个RGBA颜色值数组
export type VoxPalette = [number, number, number, number][];

// 体素数据
export interface VoxVoxel {
    x: number;
    y: number;
    z: number;
    colorIndex: number; // 1-255 指向调色板的索引
}

// 单个模型 (SIZE + XYZI)
export interface VoxModel {
    size: { x: number; y: number; z: number };
    voxels: VoxVoxel[];
}

// 主数据结构
export interface VoxData {
    version: number;          // 文件版本，通常是 150
    models: VoxModel[];      // 支持多模型
    palette: VoxPalette;     // 自定义调色板
}