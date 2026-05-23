import { VoxData as VoxDocument, VoxModel, VoxVoxel,  } from "./types";

export function readString(view: DataView, offset: number, length: number): string {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(view.getUint8(offset + i));
  }
  return str;
}

// 写入字符串
export function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// 解析子块区域（用于MAIN的children或其他chunk的children）
export function parseChunks(buffer: ArrayBuffer, startOffset: number, endOffset: number, context: {
  models: VoxModel[];
  palette?: Uint8Array;
}) {
  let offset = startOffset;
  let currentSize: { x: number; y: number; z: number } | null = null;

  while (offset < endOffset) {
    const view = new DataView(buffer);
    if (offset + 12 > endOffset) break; // 至少需要chunk头

    const chunkId = readString(view, offset, 4);
    const contentSize = view.getInt32(offset + 4, true);
    const childrenSize = view.getInt32(offset + 8, true);
    const contentStart = offset + 12;
    const childrenStart = contentStart + contentSize;
    const nextChunkStart = childrenStart + childrenSize;

    // 处理已知chunk
    switch (chunkId) {
      case 'PACK': {
        if (contentSize >= 4) {
          const numModels = view.getInt32(contentStart, true);
          // 仅用于校验，实际模型数量由后续SIZE/XYZI对决定
        }
        break;
      }
      case 'SIZE': {
        if (contentSize >= 12) {
          const x = view.getInt32(contentStart, true);
          const y = view.getInt32(contentStart + 4, true);
          const z = view.getInt32(contentStart + 8, true);
          currentSize = { x, y, z };
        }
        break;
      }
      case 'XYZI': {
        if (contentSize >= 4 && currentSize) {
          const numVoxels = view.getInt32(contentStart, true);
          const voxels: VoxVoxel[] = [];
          for (let i = 0; i < numVoxels; i++) {
            const voxOffset = contentStart + 4 + i * 4;
            const x = view.getUint8(voxOffset);
            const y = view.getUint8(voxOffset + 1);
            const z = view.getUint8(voxOffset + 2);
            const colorIndex = view.getUint8(voxOffset + 3);
            if (colorIndex !== 0) { // 0是保留值
              voxels.push({ x, y, z, colorIndex });
            }
          }
          context.models.push({
            size: currentSize,
            voxels: voxels
          });
          currentSize = null;
        }
        break;
      }
      case 'RGBA': {
        if (contentSize >= 1024) {
          const palette = new Uint8Array(256 * 4);
          for (let i = 0; i < 256; i++) {
            palette[i * 4] = view.getUint8(contentStart + i * 4);
            palette[i * 4 + 1] = view.getUint8(contentStart + i * 4 + 1);
            palette[i * 4 + 2] = view.getUint8(contentStart + i * 4 + 2);
            palette[i * 4 + 3] = view.getUint8(contentStart + i * 4 + 3);
          }
          context.palette = palette;
        }
        break;
      }
      default:
        // 未知chunk，忽略其内容及子块（直接跳过）
        break;
    }

    // 跳转到下一个chunk
    offset = nextChunkStart;
  }
}

export function isDocumentEqual(a: VoxDocument, b: VoxDocument): boolean {
  if (a.version !== b.version) return false;
  if (a.models.length !== b.models.length) return false;
  for (let i = 0; i < a.models.length; i++) {
    const ma = a.models[i], mb = b.models[i];
    if (ma.size.x !== mb.size.x || ma.size.y !== mb.size.y || ma.size.z !== mb.size.z) return false;
    if (ma.voxels.length !== mb.voxels.length) return false;
    for (let j = 0; j < ma.voxels.length; j++) {
      const va = ma.voxels[j], vb = mb.voxels[j];
      if (va.x !== vb.x || va.y !== vb.y || va.z !== vb.z || va.colorIndex !== vb.colorIndex) return false;
    }
  }
  if (a.palette && b.palette) {
    if (a.palette.length !== b.palette.length) return false;
    for (let i = 0; i < a.palette.length; i++) if (a.palette[i] !== b.palette[i]) return false;
  } else if (a.palette !== b.palette) return false;
  return true;
}