import { VoxData, VoxPalette, VoxVoxel, VoxModel } from "./types";
import { getDefaultPalette } from "./misc";

export function parseBuffer(arrayBuffer: ArrayBuffer): VoxData {
    const dv = new DataView(arrayBuffer);
    let offset = 0;

    // 文件头
    const signature = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (signature !== 'VOX ') throw new Error('Invalid VOX signature');
    offset += 4;
    const version = dv.getInt32(offset, true);
    offset += 4;

    // 读取 MAIN 块
    const chunkId = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset+1), dv.getUint8(offset+2), dv.getUint8(offset+3));
    if (chunkId !== 'MAIN') throw new Error('Expected MAIN chunk');
    offset += 4;
    const mainContentSize = dv.getInt32(offset, true);
    offset += 4;
    const mainChildrenSize = dv.getInt32(offset, true);
    offset += 4;
    offset += mainContentSize; // 跳过 MAIN 内容（通常为空）

    const childrenEnd = offset + mainChildrenSize;
    let models: VoxModel[] = [];
    let palette: VoxPalette = [];
    let expectedModelCount = 1; // 默认 1 个模型

    while (offset < childrenEnd) {
        const id = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset+1), dv.getUint8(offset+2), dv.getUint8(offset+3));
        offset += 4;
        const contentSize = dv.getInt32(offset, true);
        offset += 4;
        const childSize = dv.getInt32(offset, true);
        offset += 4;
        const contentStart = offset;

        switch (id) {
            case 'PACK':
                expectedModelCount = dv.getInt32(offset, true);
                // 预先分配 models 数组
                models = new Array(expectedModelCount);
                break;
            case 'SIZE': {
                const sx = dv.getInt32(offset, true);
                const sy = dv.getInt32(offset+4, true);
                const sz = dv.getInt32(offset+8, true);
                // 将 SIZE 暂存，稍后与 XYZI 配对
                // 简单起见，这里假设 SIZE 和 XYZI 成对出现，且顺序一致
                // 我们用一个临时数组保存当前未配对的 SIZE
                // 具体实现：先收集所有 SIZE 和 XYZI 再匹配，或者按顺序匹配
                // 为简化，这里采用 push 新模型，然后再填充 voxels
                models.push({ size: { x: sx, y: sy, z: sz }, voxels: [] });
                break;
            }
            case 'XYZI': {
                const numVoxels = dv.getInt32(offset, true);
                const voxels: VoxVoxel[] = [];
                let voxOffset = offset + 4;
                for (let i = 0; i < numVoxels; i++) {
                    const x = dv.getUint8(voxOffset);
                    const y = dv.getUint8(voxOffset+1);
                    const z = dv.getUint8(voxOffset+2);
                    const ci = dv.getUint8(voxOffset+3);
                    voxels.push({ x, y, z, colorIndex: ci });
                    voxOffset += 4;
                }
                // 找到最后一个没有 voxels 的模型（即刚由 SIZE 添加的）
                for (let i = models.length-1; i >= 0; i--) {
                    if (models[i].voxels.length === 0) {
                        models[i].voxels = voxels;
                        break;
                    }
                }
                break;
            }
            case 'RGBA': {
                for (let i = 0; i < 256; i++) {
                    const r = dv.getUint8(offset + i*4);
                    const g = dv.getUint8(offset + i*4+1);
                    const b = dv.getUint8(offset + i*4+2);
                    const a = dv.getUint8(offset + i*4+3);
                    palette.push([r, g, b, a]);
                }
                break;
            }
            // 其他块可以忽略或警告
        }

        offset = contentStart + contentSize + childSize;
    }

    // 如果未读取到任何模型（无 SIZE/XYZI），则设为空数组
    if (models.length === 0) models.push({ size: { x: 0, y: 0, z: 0 }, voxels: [] });
    if (palette.length === 0) palette = getDefaultPalette();

    return { version, models, palette };
}

// export function parseBuffer(arrayBuffer: ArrayBuffer): VoxData {
//   const dataView = new DataView(arrayBuffer);
//   let offset = 0;

//   // 1. 读取并验证文件头 (Header)
//   const id = String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4));
//   if (id !== 'VOX ') throw new Error('Invalid file signature');
//   offset += 4;

//   const version = dataView.getInt32(offset, true); // 小端字节序
//   offset += 4;

//   // 2. 读取主块 (MAIN Chunk)
//   const mainChunkId = String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4));
//   if (mainChunkId !== 'MAIN') throw new Error('Expected MAIN chunk');
//   offset += 4;

//   const mainContentSize = dataView.getInt32(offset, true);
//   offset += 4;
//   const mainChildrenSize = dataView.getInt32(offset, true);
//   offset += 4;

//   // 跳过 MAIN Chunk 的内容部分（内容长度通常为0）
//   offset += mainContentSize;

//   // 3. 进入 Children 区域，开始解析具体的数据块
//   const result: VoxData = { version, models: [], palette: [] };
//   const childrenEndOffset = offset + mainChildrenSize;

//   while (offset < childrenEndOffset) {
//     const chunkId = String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4));
//     offset += 4;
//     const contentSize = dataView.getInt32(offset, true);
//     offset += 4;
//     const childrenSize = dataView.getInt32(offset, true);
//     offset += 4;

//     const contentStartOffset = offset;

//     switch (chunkId) {
//       case 'PACK':
//         // 多模型文件：读取模型数量
//         const numModels = dataView.getInt32(offset, true);
//         // 在实际实现中，可根据此信息初始化 result.models 数组
//         break;
//       case 'SIZE':
//         // 读取模型尺寸
//         const sizeX = dataView.getInt32(offset, true);
//         const sizeY = dataView.getInt32(offset + 4, true);
//         const sizeZ = dataView.getInt32(offset + 8, true);
//         // 通常 SIZE 后紧跟 XYZI，这里简化处理，用数组索引对应模型
//         result.models.push({ size: { x: sizeX, y: sizeY, z: sizeZ }, voxels: [] });
//         break;
//       case 'XYZI':
//         // 读取所有体素
//         const numVoxels = dataView.getInt32(offset, true);
//         const voxels: VoxVoxel[] = [];
//         let voxelOffset = offset + 4;
//         for (let i = 0; i < numVoxels; i++) {
//           const x = dataView.getUint8(voxelOffset);
//           const y = dataView.getUint8(voxelOffset + 1);
//           const z = dataView.getUint8(voxelOffset + 2);
//           const colorIndex = dataView.getUint8(voxelOffset + 3);
//           voxels.push({ x, y, z, colorIndex });
//           voxelOffset += 4;
//         }
//         if (result.models.length === 0) result.models.push({ size: { x: 0, y: 0, z: 0 }, voxels: [] });
//         result.models[result.models.length - 1].voxels = voxels;
//         break;
//       case 'RGBA':
//         // 读取调色板 (256个颜色)
//         const palette: VoxPalette = [];
//         for (let i = 0; i < 256; i++) {
//           const r = dataView.getUint8(offset + i * 4);
//           const g = dataView.getUint8(offset + i * 4 + 1);
//           const b = dataView.getUint8(offset + i * 4 + 2);
//           const a = dataView.getUint8(offset + i * 4 + 3);
//           palette.push([r, g, b, a]);
//         }
//         result.palette = palette;
//         break;
//       // 此处可扩展 MATT, MATL, nTRN 等更多块的支持
//     }

//     // 移动到下一个块的开始位置
//     offset = contentStartOffset + contentSize + childrenSize;
//   }

//   // 如果文件未提供 RGBA 调色板，使用默认调色板
//   if (result.palette.length === 0) {
//     result.palette = getDefaultPalette();
//   }

//   return result;
// }