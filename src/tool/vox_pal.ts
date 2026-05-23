import { Voxel, VoxelSection, VoxelBlock } from '../types';

// 预计算映射表，避免重复计算
const voxToStdMap: number[] = new Array(256);
const stdToVoxMap: number[] = new Array(256);

for (let v = 0; v < 256; v++) {
    const row = Math.floor(v / 8);   // 0-31
    const col = v % 8;               // 0-7
    const stdIdx = (7 - col) * 32 + (31 - row);
    voxToStdMap[v] = stdIdx;
    stdToVoxMap[stdIdx] = v;
}

/**
 * 将 Voxel 中所有体素的颜色索引从 MagicaVoxel 色盘转换为标准色盘
 * @param voxel 标准 Voxel 对象
 * @returns 新 Voxel 对象，体素的 colour 已转换
 */
export function voxPalToStandardPal(voxel: Voxel): Voxel {
    const newSections: VoxelSection[] = voxel.sections.map(section => ({
        ...section,
        voxels: section.voxels.map(block => {
            if (!block.used) return { ...block };
            return {
                ...block,
                colour: voxToStdMap[block.colour],
            };
        }),
    }));
    return { sections: newSections };
}

/**
 * 将 Voxel 中所有体素的颜色索引从标准色盘转换为 MagicaVoxel 色盘
 * @param voxel 标准 Voxel 对象
 * @returns 新 Voxel 对象，体素的 colour 已转换
 */
export function standardPalToVoxPal(voxel: Voxel): Voxel {
    const newSections: VoxelSection[] = voxel.sections.map(section => ({
        ...section,
        voxels: section.voxels.map(block => {
            if (!block.used) return { ...block };
            return {
                ...block,
                colour: stdToVoxMap[block.colour],
            };
        }),
    }));
    return { sections: newSections };
}