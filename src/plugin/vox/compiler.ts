import { VoxData } from "./types";


export function bufferify(data: VoxData): ArrayBuffer {
    const chunksList: Uint8Array[] = [];

    // 辅助函数：将单个 chunk（id + content + children）添加到总列表
    function appendChunk(id: string, content: Uint8Array, children: Uint8Array = new Uint8Array(0)): void {
        const idBuf = new Uint8Array(4);
        idBuf.set([id.charCodeAt(0), id.charCodeAt(1), id.charCodeAt(2), id.charCodeAt(3)]);
        chunksList.push(idBuf);
        const header = new ArrayBuffer(8);
        const headerView = new DataView(header);
        headerView.setInt32(0, content.byteLength, true);
        headerView.setInt32(4, children.byteLength, true);
        chunksList.push(new Uint8Array(header));
        if (content.byteLength > 0) chunksList.push(content);
        if (children.byteLength > 0) chunksList.push(children);
    }

    // 1. 文件头
    const headerBuf = new ArrayBuffer(8);
    const headerView = new DataView(headerBuf);
    headerView.setUint32(0, 0x564F5820, false); // 'VOX '
    headerView.setInt32(4, data.version, true);
    chunksList.push(new Uint8Array(headerBuf));

    // 2. 收集所有子块（将作为 MAIN 的 children）
    const childrenChunks: Uint8Array[] = [];

    // 辅助：将子块添加到 childrenChunks 列表
    function addChildChunk(id: string, content: Uint8Array): void {
        const idBuf = new Uint8Array(4);
        idBuf.set([id.charCodeAt(0), id.charCodeAt(1), id.charCodeAt(2), id.charCodeAt(3)]);
        childrenChunks.push(idBuf);
        const childHeader = new ArrayBuffer(8);
        const childView = new DataView(childHeader);
        childView.setInt32(0, content.byteLength, true);
        childView.setInt32(4, 0, true); // 子块没有 children
        childrenChunks.push(new Uint8Array(childHeader));
        if (content.byteLength > 0) childrenChunks.push(content);
    }

    // 处理每个模型
    for (const model of data.models) {
        // SIZE chunk
        const sizeContent = new ArrayBuffer(12);
        const sizeView = new DataView(sizeContent);
        sizeView.setInt32(0, model.size.x, true);
        sizeView.setInt32(4, model.size.y, true);
        sizeView.setInt32(8, model.size.z, true);
        addChildChunk('SIZE', new Uint8Array(sizeContent));

        // XYZI chunk
        const numVoxels = model.voxels.length;
        const xyzContent = new ArrayBuffer(4 + numVoxels * 4);
        const xyzView = new DataView(xyzContent);
        xyzView.setInt32(0, numVoxels, true);
        let off = 4;
        for (const v of model.voxels) {
            xyzView.setUint8(off, v.x);
            xyzView.setUint8(off + 1, v.y);
            xyzView.setUint8(off + 2, v.z);
            xyzView.setUint8(off + 3, v.colorIndex);
            off += 4;
        }
        addChildChunk('XYZI', new Uint8Array(xyzContent));
    }

    // RGBA chunk（如果提供了自定义调色板）
    if (data.palette.length === 256) {
        const rgbaContent = new ArrayBuffer(256 * 4);
        const rgbaView = new DataView(rgbaContent);
        for (let i = 0; i < 256; i++) {
            const [r, g, b, a] = data.palette[i];
            rgbaView.setUint8(i * 4, r);
            rgbaView.setUint8(i * 4 + 1, g);
            rgbaView.setUint8(i * 4 + 2, b);
            rgbaView.setUint8(i * 4 + 3, a);
        }
        addChildChunk('RGBA', new Uint8Array(rgbaContent));
    }

    // 将所有子块合并为一个 Uint8Array
    const totalChildrenSize = childrenChunks.reduce((sum, arr) => sum + arr.byteLength, 0);
    const childrenCombined = new Uint8Array(totalChildrenSize);
    let writePos = 0;
    for (const chunk of childrenChunks) {
        childrenCombined.set(chunk, writePos);
        writePos += chunk.byteLength;
    }

    // 3. MAIN chunk：content 为空，children 为上述合并数据
    appendChunk('MAIN', new Uint8Array(0), childrenCombined);

    // 4. 合并所有部分
    const totalSize = chunksList.reduce((sum, arr) => sum + arr.byteLength, 0);
    const result = new Uint8Array(totalSize);
    let resultPos = 0;
    for (const part of chunksList) {
        result.set(part, resultPos);
        resultPos += part.byteLength;
    }

    return result.buffer;
}