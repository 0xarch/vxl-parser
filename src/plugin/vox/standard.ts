import { VoxData, VoxModel, VoxVoxel } from "./types";
import { Voxel, VoxelSection, VoxelBlock } from "../../types";

export function standarize(voxData: VoxData): Voxel {
    const sections: VoxelSection[] = [];

    for (let i = 0; i < voxData.models.length; i++) {
        const model = voxData.models[i];
        // 标准尺寸：X ← MV.Y, Y ← MV.X, Z ← MV.Z
        const stdSx = model.size.y;   // 宽度（x方向）
        const stdSy = model.size.x;   // 高度（y方向）
        const stdSz = model.size.z;   // 深度（z方向）

        const totalVoxels = stdSx * stdSy * stdSz;
        const blocks: VoxelBlock[] = new Array(totalVoxels);

        // 填充默认空体素
        for (let idx = 0; idx < totalVoxels; idx++) {
            blocks[idx] = {
                used: false,
                colour: 0,
                normal: 0,
                x: 0, y: 0, z: 0,
            };
        }

        for (const vox of model.voxels) {
            // 从 MV 坐标映射到标准坐标（逆映射推导见下文）
            const stdX = (model.size.y - 1) - vox.y;   // 翻转 Y 并交换
            const stdY = vox.x;                        // 交换 X
            const stdZ = vox.z;                        // Z 不变

            const index = (stdZ * stdSy + stdY) * stdSx + stdX; // x 变化最快
            blocks[index] = {
                used: true,
                colour: vox.colorIndex - 1,
                normal: 0,
                x: stdX,
                y: stdY,
                z: stdZ,
            };
        }

        sections.push({
            voxels: blocks,
            max_bound_box: [stdSx - 1, stdSy - 1, stdSz - 1],
            name: `vox-${i}`,
        });
    }

    return { sections };
}

export function toLocalType(voxel: Voxel): VoxData {
    const models: VoxModel[] = [];

    for (const section of voxel.sections) {
        // 从 max_bound_box 获取标准尺寸
        const stdSx = section.max_bound_box[0] + 1;
        const stdSy = section.max_bound_box[1] + 1;
        const stdSz = section.max_bound_box[2] + 1;

        // 还原 MV 尺寸（交换 X 和 Y）
        const mvSx = stdSy; // MV X 尺寸 = 标准 Y 尺寸
        const mvSy = stdSx; // MV Y 尺寸 = 标准 X 尺寸
        const mvSz = stdSz;

        const voxelsList: VoxVoxel[] = [];

        for (const block of section.voxels) {
            if (!block.used) continue;

            // 标准坐标 → MV 坐标
            // 1. 交换 X 和 Y：标准.x → MV.y，标准.y → MV.x
            // 2. Y 轴翻转：MV.y = (MV Y 尺寸 -1) - 标准.x
            // 3. Z 轴翻转：MV.z = (MV Z 尺寸 -1) - 标准.z
            const mvX = block.y;                                    // MV.x = 标准.y
            const mvY = (mvSy - 1) - block.x;                       // MV.y = (MV Y尺寸-1) - 标准.x
            const mvZ = block.z;                       // MV.z = (MV Z尺寸-1) - 标准.z

            voxelsList.push({
                x: mvX,
                y: mvY,
                z: mvZ,
                colorIndex: block.colour + 1,
            });
        }

        models.push({
            size: { x: mvSx, y: mvSy, z: mvSz },
            voxels: voxelsList,
        });
    }

    if (models.length === 0) {
        models.push({ size: { x: 0, y: 0, z: 0 }, voxels: [] });
    }

    return {
        version: 150,
        models: models,
        palette: [],
    };
}