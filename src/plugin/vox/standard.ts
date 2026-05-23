import { VoxData, VoxModel, VoxVoxel } from "./types";
import { Voxel, VoxelSection, VoxelBlock } from "../../types";

export function standarize(voxData: VoxData): Voxel {
    const sections: VoxelSection[] = [];

    for (let i = 0; i < voxData.models.length; i++) {
        const model = voxData.models[i];
        const sx = model.size.x;
        const sy = model.size.y;
        const sz = model.size.z;
        const totalVoxels = sx * sy * sz;

        // 预先创建数组，所有体素默认 used = false
        const blocks: VoxelBlock[] = new Array(totalVoxels);

        // 先全部填充默认值（used = false），避免后续遗漏
        for (let idx = 0; idx < totalVoxels; idx++) {
            blocks[idx] = {
                used: false,
                colour: 0,
                normal: 0,
                x: 0,
                y: 0,
                z: 0,
            };
        }

        // 遍历非空体素，填入正确信息
        for (const vox of model.voxels) {
            // 计算翻转后的 Y 坐标
            const newX = vox.x;
            const newY = sy - 1 - vox.y;
            const newZ = vox.z;

            // 计算在数组中的索引（x 变化最快，然后 y，然后 z）
            const index = (newZ * sy + newY) * sx + newX;

            blocks[index] = {
                used: true,
                colour: vox.colorIndex - 1,
                normal: 0,
                x: newX,
                y: newY,
                z: newZ,
            };
        }

        sections.push({
            voxels: blocks,
            max_bound_box: [sx - 1, sy - 1, sz - 1],
            name: `vox-${i}`,
        });
    }

    return { sections };
}

/**
 * 将通用格式 (Voxel) 转换回 MagicaVoxel 内部格式 (VoxData)
 * 转换规则：
 *   - 每个 section 生成一个 model
 *   - 从 max_bound_box 还原尺寸 size = [bx+1, by+1, bz+1]
 *   - 遍历 voxels 数组（顺序与 standarize 一致），对 used == true 的体素：
 *        - 翻转 Y 坐标：orig_y = (size.y - 1) - block.y
 *        - 生成 VoxVoxel 并加入 model.voxels
 *   - palette 设为空数组（表示使用默认调色板）
 *   - version 设为 150（常用版本）
 */
export function toLocalType(voxel: Voxel): VoxData {
    const models: VoxModel[] = [];

    for (const section of voxel.sections) {
        // 从 max_bound_box 获取尺寸
        const sx = section.max_bound_box[0] + 1;
        const sy = section.max_bound_box[1] + 1;
        const sz = section.max_bound_box[2] + 1;
        const expectedCount = sx * sy * sz;

        // 确保 voxels 数组长度正确（若长度不符，截断或补默认值）
        const blocks = section.voxels;
        if (blocks.length !== expectedCount) {
            console.warn(`Section '${section.name}' voxel count mismatch. Expected ${expectedCount}, got ${blocks.length}. Truncating/padding.`);
        }

        const voxelsList: VoxVoxel[] = [];

        // 遍历所有位置，重建体素
        for (let idx = 0; idx < Math.min(blocks.length, expectedCount); idx++) {
            const block = blocks[idx];
            if (!block.used) continue;

            // 从索引反算坐标（x 变化最快）
            const x = idx % sx;
            const y = Math.floor(idx / sx) % sy;
            const z = Math.floor(idx / (sx * sy));

            // 翻转 Y 坐标回到 MagicaVoxel 坐标系
            const origY = sy - 1 - y;

            voxelsList.push({
                x: x,
                y: origY,
                z: z,
                colorIndex: block.colour + 1,
            });
        }

        models.push({
            size: { x: sx, y: sy, z: sz },
            voxels: voxelsList,
        });
    }

    // 如果没有 sections，至少返回一个空模型
    if (models.length === 0) {
        models.push({ size: { x: 0, y: 0, z: 0 }, voxels: [] });
    }

    return {
        version: 150,
        models: models,
        palette: [], // 使用默认调色板
    };
}