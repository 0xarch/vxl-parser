// 调色板，256个RGBA颜色值数组
export type VoxPalette = [number, number, number, number][];

// 体素数据
export interface VoxVoxel {
    x: number;
    y: number;
    z: number;
    colorIndex: number; // 1-255 指向调色板的索引
}

// // 单个模型 (SIZE + XYZI)
// export interface VoxModel {
//     size: { x: number; y: number; z: number };
//     voxels: VoxVoxel[];
//     offset: { x:number; y: number; z: number };
// }

// 主数据结构
export interface VoxData {
    version: number;          // 文件版本，通常是 150
    models: VoxModel[];      // 支持多模型
    palette: VoxPalette;     // 自定义调色板
}

// nTRN 块的字典属性接口
export interface DictEntry {
    key: string;
    value: string;
}

// nTRN 块的帧属性接口
export interface FrameAttributes {
    _r?: number;   // 旋转
    _t?: string;   // 平移，格式如 "x y z"
    _f?: number;   // 帧索引
}

// nTRN 块接口
export interface NTRNChunk {
    nodeId: number;
    nodeAttributes: DictEntry[];
    childNodeId: number;
    layerId: number;
    numFrames: number;
    frames: FrameAttributes[];
}

// 扩展 VoxModel 以包含偏移信息和节点 ID
export interface VoxModel {
    size: { x: number; y: number; z: number };
    voxels: VoxVoxel[];
    offset: { x: number; y: number; z: number };
    nodeId?: number;   // 用于关联 nTRN 节点，可选
}