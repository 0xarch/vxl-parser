import { VoxelRenderController, VoxelRenderer } from './lib.mjs';
import VXLPlugin from '../compiled/plugin/vxl/main.js';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'; // 用于可选的文字标签，但不强制，保持简洁

// ---------------------------- 类型定义 (根据需求) ---------------------------------
/**
 * @typedef {Object} VoxelBlock
 * @property {boolean} used
 * @property {number} colour       // 索引色 0-255
 * @property {number} normal
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {Object} VoxelSection
 * @property {VoxelBlock[]} voxels
 * @property {[number,number,number]} max_bound_box
 * @property {string} name
 * @property {number} offset_x
 * @property {number} offset_y
 * @property {number} offset_z
 */

/**
 * @typedef {Object} Voxel
 * @property {VoxelSection[]} sections
 */

// ---------------------------- 演示和导出 (满足题目要求，并展示功能) ----------------------------
// 为了让页面展示样例，我们实例化渲染器并渲染一个包含两个Section的演示Voxel模型
// 同时暴露全局以便调试，但不强制，主要是演示符合要求

// 构建示例Voxel数据: 包含了两个section，展示独立偏移和不同体素
function createSampleVoxel() {
    // Section A: 一个简单的立方体形状，位于原点附近
    const sectionAVoxels = [];
    // 创建一个 3x3x3 的实心立方体区域，颜色使用不同索引
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            for (let k = -1; k <= 1; k++) {
                // 设置不同的颜色索引 (基于位置和某种模式)
                const colorIdx = ((i + 1) * 3 + (j + 1) * 5 + (k + 1) * 7) % 200 + 20;
                sectionAVoxels.push({
                    used: true,
                    colour: colorIdx,
                    normal: 0,
                    x: i,
                    y: j,
                    z: k
                });
            }
        }
    }
    // 额外添加几个突出的柱子
    for (let i = -1; i <= 1; i++) {
        sectionAVoxels.push({ used: true, colour: 45, normal: 0, x: i, y: 2, z: 0 });
        sectionAVoxels.push({ used: true, colour: 78, normal: 0, x: i, y: -2, z: 0 });
    }

    const sectionA = {
        voxels: sectionAVoxels,
        max_bound_box: [5, 5, 5],
        name: "Core Section",
        offset_x: 0,
        offset_y: 0,
        offset_z: 0
    };

    // Section B: 一个漂浮的小平台，偏移位置在 (4, 2, 3)
    const sectionBVoxels = [];
    // 做一个环状或者简单平面
    for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
            if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || (dx === 0 && dz === 0)) {
                const colorIdx = 120 + (dx + dz) % 80;
                sectionBVoxels.push({
                    used: true,
                    colour: colorIdx,
                    normal: 0,
                    x: dx,
                    y: 0,
                    z: dz
                });
            }
        }
    }
    // 加一个中心高柱
    sectionBVoxels.push({ used: true, colour: 200, normal: 0, x: 0, y: 1, z: 0 });
    sectionBVoxels.push({ used: true, colour: 201, normal: 0, x: 0, y: 2, z: 0 });

    const sectionB = {
        voxels: sectionBVoxels,
        max_bound_box: [6, 4, 6],
        name: "Floating Platform",
        offset_x: 4.5,
        offset_y: 2.5,
        offset_z: 3.2
    };

    // Section C: 一个小装饰，独立偏移，展示多section独立计算
    const sectionCVoxels = [];
    for (let r = -1; r <= 1; r++) {
        sectionCVoxels.push({ used: true, colour: 80 + r * 10, normal: 0, x: r, y: 0, z: 0 });
        sectionCVoxels.push({ used: true, colour: 90 + r * 5, normal: 0, x: 0, y: r, z: 0 });
        sectionCVoxels.push({ used: true, colour: 100 + r * 6, normal: 0, x: 0, y: 0, z: r });
    }
    const sectionC = {
        voxels: sectionCVoxels,
        max_bound_box: [2, 2, 2],
        name: "Ornament",
        offset_x: -3,
        offset_y: 3,
        offset_z: -2.5
    };

    return {
        sections: [sectionA, sectionB, sectionC]
    };
}

// 创建第二个Voxel模型 (一个小金字塔风格，用于演示多实例)
function createSecondaryVoxel() {
    const voxelsList = [];
    // 金字塔形状层
    const layers = [
        { y: 0, size: 3, colorBase: 160 },
        { y: 1, size: 2, colorBase: 170 },
        { y: 2, size: 1, colorBase: 180 }
    ];
    for (const layer of layers) {
        const s = layer.size;
        for (let i = -s; i <= s; i++) {
            for (let j = -s; j <= s; j++) {
                if (Math.abs(i) <= s && Math.abs(j) <= s && (Math.abs(i) === s || Math.abs(j) === s || s === 1)) {
                    const colorIdx = layer.colorBase + (i + j) % 30;
                    voxelsList.push({
                        used: true,
                        colour: colorIdx,
                        normal: 0,
                        x: i,
                        y: layer.y,
                        z: j
                    });
                }
            }
        }
    }
    const section = {
        voxels: voxelsList,
        max_bound_box: [4, 4, 4],
        name: "Pyramid",
        offset_x: -5,
        offset_y: -1,
        offset_z: -4
    };
    return { sections: [section] };
}

// 页面启动: 实例化渲染器，渲染示例模型
async function initDemo() {
    const renderer = new VoxelRenderer('#canvas');
    // 注册到全局便于控制台调试 (但非必须，方便演示)
    window.voxelRenderer = renderer;

    // 构建示例模型
    const sampleVoxel1 = createSampleVoxel();
    const sampleVoxel2 = createSecondaryVoxel();

    // 调用 render 方法传入多个Voxel实例，获得控制器列表
    const controllers = renderer.render([sampleVoxel1, sampleVoxel2]);

    // 显示状态
    const statusDiv = document.getElementById('statusMsg');
    if (statusDiv) {
        statusDiv.innerText = `✅ 已加载 ${controllers.length} 个Voxel模型 | 共 ${controllers.reduce((sum, ctrl) => sum + ctrl.sectionGroups.size, 0)} 个独立区块(Section)`;
    }

    // 演示按钮: 随机调色板
    const randomPaletteBtn = document.getElementById('randomPaletteBtn');
    if (randomPaletteBtn) {
        randomPaletteBtn.addEventListener('click', () => {
            const newPalette = [];
            for (let i = 0; i < 256; i++) {
                // 生成鲜艳随机颜色
                newPalette.push([Math.random() * 255, Math.random() * 255, Math.random() * 255]);
            }
            // 保证索引0是深灰色，保持对比
            newPalette[0] = [30, 30, 40];
            const success = renderer.setPalette(newPalette);
            if (success && statusDiv) {
                statusDiv.innerText = `🎨 调色板已更新 (随机色) | 模型颜色已刷新`;
                setTimeout(() => {
                    if (statusDiv) statusDiv.innerText = `✅ ${controllers.length} 个Voxel模型 | 独立区块已重建`;
                }, 1500);
            }
        });
    }

    // 演示独立Section控制: 切换第一个Voxel模型的第二个section (索引1，即浮空平台section) 可见性
    const toggleBtn = document.getElementById('toggleSectionBtn');
    let sectionVisible = true;
    if (toggleBtn && controllers.length > 0) {
        const firstController = controllers[0];
        // 获取第二个section (索引1)
        const targetSectionGroup = firstController.getSectionGroup(1);
        if (targetSectionGroup) {
            toggleBtn.addEventListener('click', () => {
                sectionVisible = !sectionVisible;
                targetSectionGroup.visible = sectionVisible;
                if (statusDiv) {
                    statusDiv.innerText = sectionVisible ?
                        "🔘 Section 'Floating Platform' 可见" :
                        "🔘 Section 'Floating Platform' 已隐藏 (独立控制)";
                    setTimeout(() => {
                        if (statusDiv && !statusDiv.innerText.includes("调色板"))
                            statusDiv.innerText = `✅ ${controllers.length} 个Voxel模型 | 独立区块可控`;
                    }, 1500);
                }
            });
        } else {
            toggleBtn.disabled = true;
            toggleBtn.style.opacity = 0.5;
            toggleBtn.title = "当前第一个Voxel无第二个Section";
        }
    }
}

// 启动演示
// initDemo().catch(console.error);

function fileToBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const buffer = reader.result;
            if (!reader.result instanceof ArrayBuffer) throw new Error(`I CAN GET ARRAYBUFFER`);
            resolve(buffer);
        };

        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

document.addEventListener('DOMContentLoaded', function init() {
    const renderer = new VoxelRenderer('#canvas');

    document.getElementById('uploadFile').addEventListener('change', async function uploadFile(event) {
        const results = await Promise.all(Array.from(event.target.files).map(async file => ({ raw: file, buffer: await fileToBuffer(file) })));

        const voxels = [];
        for (const result of results) {
            if (result.raw.name.endsWith('.vxl')) {
                const vxl = VXLPlugin.parse(result.buffer);
                const voxel = VXLPlugin.standarize(vxl);
                voxels.push(voxel);
            }
        }
        renderer.render(voxels);
    });
})

export { VoxelRenderer, VoxelRenderController };