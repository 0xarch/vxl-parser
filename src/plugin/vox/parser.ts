import { VoxData, VoxPalette, VoxVoxel, VoxModel, DictEntry, FrameAttributes } from "./types";
import { getDefaultPalette } from "./misc";

function readString(dv: DataView, offset: number, maxLen: number = 1024): string {
    // 检查 offset 是否有效
    if (offset < 0 || offset + 4 > dv.byteLength) {
        console.warn(`readString: offset ${offset} out of range (buffer length ${dv.byteLength})`);
        return "";
    }
    const length = dv.getInt32(offset, true);
    if (length < 0 || length > maxLen || offset + 4 + length > dv.byteLength) {
        console.warn(`readString: invalid length ${length} at offset ${offset}`);
        return "";
    }
    const bytes = new Uint8Array(dv.buffer, offset + 4, length);
    return new TextDecoder().decode(bytes);
}

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
    const chunkId = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset + 1), dv.getUint8(offset + 2), dv.getUint8(offset + 3));
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

    let nextModelIdx = 0;

    const ntrnNodes: Map<number, { offset: { x: number, y: number, z: number }, childNodeId: number }> = new Map();
    const nshpToModel: Map<number, number> = new Map();

    while (offset < childrenEnd) {
        const id = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset + 1), dv.getUint8(offset + 2), dv.getUint8(offset + 3));
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
                const sy = dv.getInt32(offset + 4, true);
                const sz = dv.getInt32(offset + 8, true);
                // 将 SIZE 暂存，稍后与 XYZI 配对
                // 简单起见，这里假设 SIZE 和 XYZI 成对出现，且顺序一致
                // 我们用一个临时数组保存当前未配对的 SIZE
                // 具体实现：先收集所有 SIZE 和 XYZI 再匹配，或者按顺序匹配
                // 为简化，这里采用 push 新模型，然后再填充 voxels
                models.push({ size: { x: sx, y: sy, z: sz }, voxels: [], offset: { x: 0, y: 0, z: 0 } });
                break;
            }
            case 'XYZI': {
                const numVoxels = dv.getInt32(offset, true);
                const voxels: VoxVoxel[] = [];
                let voxOffset = offset + 4;
                for (let i = 0; i < numVoxels; i++) {
                    const x = dv.getUint8(voxOffset);
                    const y = dv.getUint8(voxOffset + 1);
                    const z = dv.getUint8(voxOffset + 2);
                    const ci = dv.getUint8(voxOffset + 3);
                    voxels.push({ x, y, z, colorIndex: ci });
                    voxOffset += 4;
                }
                // 找到最后一个没有 voxels 的模型（即刚由 SIZE 添加的）
                for (let i = models.length - 1; i >= 0; i--) {
                    if (models[i].voxels.length === 0) {
                        models[i].voxels = voxels;
                        break;
                    }
                }
                break;
            }
            case 'RGBA': {
                for (let i = 0; i < 256; i++) {
                    const r = dv.getUint8(offset + i * 4);
                    const g = dv.getUint8(offset + i * 4 + 1);
                    const b = dv.getUint8(offset + i * 4 + 2);
                    const a = dv.getUint8(offset + i * 4 + 3);
                    palette.push([r, g, b, a]);
                }
                break;
            }
            case 'nTRN': {
                const startOffset = offset;
                try {
                    const nodeId = dv.getInt32(offset, true);
                    offset += 4;
                    // console.log(`[nTRN] nodeId=${nodeId}`);

                    // 解析节点属性字典 (DICT)
                    const numAttrs = dv.getInt32(offset, true);
                    offset += 4;
                    // console.log(`  numAttrs=${numAttrs}`);
                    for (let i = 0; i < numAttrs && offset < arrayBuffer.byteLength; i++) {
                        const key = readString(dv, offset);
                        if (!key) { offset += 4; break; } // 跳过无效
                        offset += 4 + key.length;
                        const value = readString(dv, offset);
                        offset += 4 + (value ? value.length : 0);
                        // console.log(`    ${key}=${value}`);
                    }

                    const childNodeId = dv.getInt32(offset, true);
                    offset += 4;
                    const reserved = dv.getInt32(offset, true);
                    offset += 4;
                    const layerId = dv.getInt32(offset, true);
                    offset += 4;
                    let numFrames = dv.getInt32(offset, true);
                    offset += 4;
                    // console.log(`  childNodeId=${childNodeId}, reserved=${reserved}, layerId=${layerId}, numFrames=${numFrames}`);

                    // 如果 numFrames 异常（负数或过大），尝试修正为 1
                    if (numFrames < 0 || numFrames > 1000) {
                        console.warn(`  numFrames=${numFrames} is abnormal, treating as 1`);
                        numFrames = 1;
                    }

                    let offsetX = 0, offsetY = 0, offsetZ = 0;
                    for (let i = 0; i < numFrames && offset < arrayBuffer.byteLength; i++) {
                        const frameNumAttrs = dv.getInt32(offset, true);
                        if (frameNumAttrs < 0 || frameNumAttrs > 1000) {
                            console.warn(`  frameNumAttrs=${frameNumAttrs} abnormal, skip`);
                            offset += 4; // 跳过这个无效的帧头
                            break;
                        }
                        offset += 4;
                        for (let j = 0; j < frameNumAttrs && offset < arrayBuffer.byteLength; j++) {
                            const key = readString(dv, offset);
                            if (!key) { offset += 4; break; }
                            offset += 4 + key.length;
                            const value = readString(dv, offset);
                            offset += 4 + (value ? value.length : 0);
                            if (key === '_t') {
                                const parts = value.split(' ').map(Number);
                                if (parts.length === 3) {
                                    offsetX = parts[0];
                                    offsetY = parts[1];
                                    offsetZ = parts[2];
                                    // console.log(`    _t = (${offsetX},${offsetY},${offsetZ})`);
                                }
                            }
                        }
                    }

                    ntrnNodes.set(nodeId, { offset: { x: offsetX, y: offsetY, z: offsetZ }, childNodeId });
                } catch (err) {
                    console.error(`Error parsing nTRN at offset ${startOffset}:`, err);
                    // 跳过整个块内容，避免影响后续解析
                    offset = contentStart + contentSize + childSize;
                }
                break;
            }

            case 'nSHP': {
                const startOffset = offset;
                try {
                    const nodeId = dv.getInt32(offset, true);
                    offset += 4;
                    // console.log(`[nSHP] nodeId=${nodeId}`);

                    const numAttrs = dv.getInt32(offset, true);
                    offset += 4;
                    for (let i = 0; i < numAttrs && offset < arrayBuffer.byteLength; i++) {
                        const key = readString(dv, offset);
                        if (!key) { offset += 4; break; }
                        offset += 4 + key.length;
                        const value = readString(dv, offset);
                        offset += 4 + (value ? value.length : 0);
                    }

                    const numModels = dv.getInt32(offset, true);
                    offset += 4;
                    for (let m = 0; m < numModels && offset < arrayBuffer.byteLength; m++) {
                        const modelId = dv.getInt32(offset, true);
                        offset += 4;
                        const numModelAttrs = dv.getInt32(offset, true);
                        offset += 4;
                        for (let j = 0; j < numModelAttrs && offset < arrayBuffer.byteLength; j++) {
                            const key = readString(dv, offset);
                            if (!key) { offset += 4; break; }
                            offset += 4 + key.length;
                            const value = readString(dv, offset);
                            offset += 4 + (value ? value.length : 0);
                        }
                        nshpToModel.set(nodeId, modelId);
                        // console.log(`  nSHP ${nodeId} -> modelId ${modelId}`);
                    }
                } catch (err) {
                    console.error(`Error parsing nSHP at offset ${startOffset}:`, err);
                    offset = contentStart + contentSize + childSize;
                }
                break;
            }
            // 其他块可以忽略或警告
        }

        offset = contentStart + contentSize + childSize;
    }

    // console.log(`nshpToMap contents:`, Array.from(nshpToModel.entries()));
    // console.log(`ntrnNodes contents:`, Array.from(ntrnNodes.entries()));

    for (const [ntrnId, { offset, childNodeId }] of ntrnNodes) {
        const modelId = nshpToModel.get(childNodeId);
        if (modelId !== undefined && models[modelId]) {
            models[modelId].offset = offset;
            models[modelId].nodeId = ntrnId;
            // console.log(`Associated nTRN ${ntrnId} -> model index ${modelId}, offset=(${offset.x},${offset.y},${offset.z})`);
        } else {
            // console.warn(`Cannot associate nTRN ${ntrnId}: childNodeId=${childNodeId} not found in nSHP map, or modelId ${modelId} out of range (models.length=${models.length})`);
        }
    }

    // 如果未读取到任何模型（无 SIZE/XYZI），则设为空数组
    if (models.length === 0) models.push({ size: { x: 0, y: 0, z: 0 }, voxels: [], offset: { x: 0, y: 0, z: 0 } });
    if (palette.length === 0) palette = getDefaultPalette();

    return { version, models, palette };
}