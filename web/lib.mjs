
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

// ---------------------------- 控制器接口定义 (每个Voxel实例的控制器) ----------------------------
/**
 * VoxelRenderController 控制单个 Voxel 模型实例
 */
class VoxelRenderController {
    /**
     * @param {THREE.Group} rootGroup - 该Voxel实例的根组
     * @param {Voxel} originalData - 原始数据 (用于后续扩展)
     * @param {Map<number, THREE.Group>} sectionGroups - section索引 -> group映射
     */
    constructor(rootGroup, originalData, sectionGroups) {
        this.rootGroup = rootGroup;
        this.originalData = originalData;
        this.sectionGroups = sectionGroups; // Map<number, THREE.Group>
        this.userData = {}; // 扩展用
    }

    // 显示/隐藏整个Voxel模型
    setVisible(visible) {
        this.rootGroup.visible = visible;
    }

    // 获取根组 (可直接用于变换)
    getGroup() {
        return this.rootGroup;
    }

    // 设置位置
    setPosition(x, y, z) {
        this.rootGroup.position.set(x, y, z);
    }

    // 设置旋转 (欧拉角)
    setRotation(x, y, z) {
        this.rootGroup.rotation.set(x, y, z);
    }

    // 获取某个section的组，便于后续独立控制 (例如高亮、隐藏)
    getSectionGroup(sectionIndex) {
        return this.sectionGroups.get(sectionIndex) || null;
    }

    // 遍历所有section，执行回调
    forEachSection(callback) {
        this.sectionGroups.forEach((group, idx) => {
            callback(group, idx, this.originalData.sections[idx]);
        });
    }
}

// ---------------------------- 核心渲染器类 ---------------------------------
class VoxelRenderer {
    /**
     * @param {string|HTMLElement} canvasContainer - canvas元素id或canvas元素本身, 要求已经存在 canvas 元素且id为 'canvas'
     * 按照要求渲染至 '#canvas' 画布，构造时获取该canvas
     */
    constructor(canvasSelector = '#canvas') {
        // 获取canvas元素
        const canvasElem = typeof canvasSelector === 'string'
            ? document.querySelector(canvasSelector)
            : canvasSelector;
        if (!canvasElem || !(canvasElem instanceof HTMLCanvasElement)) {
            throw new Error(`无法找到canvas元素: ${canvasSelector}`);
        }
        this.canvas = canvasElem;

        // 初始化场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111122); // 深色科技感背景，不花哨但舒适

        // 相机: 透视相机，根据视野放置合适位置
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
        this.camera.position.set(15, 12, 18);
        this.camera.lookAt(0, 0, 0);

        // 渲染器: 使用传入的canvas
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });

        // 轨道控制 (支持旋转/缩放/平移)
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;      // 惯性效果
        this.controls.dampingFactor = 0.05;
        this.controls.rotateSpeed = 1.0;
        this.controls.zoomSpeed = 1.2;
        this.controls.panSpeed = 0.8;
        this.controls.enableZoom = true;
        this.controls.enablePan = true;
        this.controls.target.set(0, 0, 0);

        // 当前调色板 (默认提供一个灰阶+简单色盘，长度256)
        this.palette = new Array(256).fill([255, 255, 255]);
        // 生成一个默认好看的调色板 (索引0~255)
        this._initDefaultPalette();

        // 存储当前所有的Voxel数据 (原始数据)
        this.voxelsData = [];         // 存储每个Voxel原始数据
        // 存储控制器实例列表
        this.voxelControllers = [];
        // 存储每个控制器对应的根组与section映射，以便重建时清理
        this.currentRootGroups = [];   // 用于快速清理场景

        // 辅助元素: 添加一个简单的网格地面辅助参考 (半透明，不干扰，可选，符合简洁风格但有助于观察空间)
        const gridHelper = new THREE.GridHelper(30, 20, 0x88aaff, 0x335588);
        gridHelper.position.y = -1.5;
        gridHelper.material.transparent = true;
        gridHelper.material.opacity = 0.35;
        this.scene.add(gridHelper);

        // 添加一个很 subtle 的环境光 + 方向光使体素材质有立体感 (使用标准材质)
        // 为了使颜色准确且不花哨，采用柔和光照
        const ambientLight = new THREE.AmbientLight(0x404060);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(5, 10, 7);
        this.scene.add(dirLight);
        const backLight = new THREE.DirectionalLight(0x88aaff, 0.5);
        backLight.position.set(-3, 2, -4);
        this.scene.add(backLight);

        // 启动渲染循环
        this.animate = this.animate.bind(this);
        this.animate();

        // 监听窗口尺寸变化
        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.onWindowResize();
    }

    // 初始化默认调色板 (生成256色，包含彩虹过渡+灰度，保证每个索引都有颜色)
    _initDefaultPalette() {
        const pal = [];
        for (let i = 0; i < 256; i++) {
            // 制作一个色彩丰富的映射: 前64种灰度，后192种彩虹循环
            if (i < 64) {
                const g = Math.floor(i * 4); // 0-252
                pal.push([g, g, g]);
            } else {
                const hue = (i - 64) / 192; // 0-1范围
                const rgb = this._hsvToRgb(hue, 0.8, 0.8);
                pal.push(rgb);
            }
        }
        // 确保一些特殊索引有辨识度
        pal[0] = [0, 0, 0];       // 黑色
        pal[1] = [255, 100, 100]; // 亮红
        pal[2] = [100, 255, 100]; // 亮绿
        pal[3] = [100, 100, 255]; // 亮蓝
        this.palette = pal;
    }

    // HSV转RGB辅助
    _hsvToRgb(h, s, v) {
        let r, g, b;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            default: r = v; g = p; b = q; break;
        }
        return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)];
    }

    /**
     * 设置索引色调色板
     * @param {number[][]} colorArray 长度为256的数组，每个元素为[r,g,b] 每个分量0-255
     * @returns {boolean} 是否成功
     */
    setPalette(colorArray) {
        if (!Array.isArray(colorArray) || colorArray.length !== 256) {
            console.error('调色板必须为长度为256的数组');
            return false;
        }
        // 验证每个元素格式
        for (let i = 0; i < colorArray.length; i++) {
            const c = colorArray[i];
            if (!Array.isArray(c) || c.length !== 3 || c.some(v => typeof v !== 'number' || v < 0 || v > 255)) {
                console.error(`调色板索引 ${i} 格式错误，需要 [r,g,b] 0-255`);
                return false;
            }
        }
        this.palette = colorArray.map(c => [...c]); // 深拷贝
        // 调色板改变后，重新构建所有体素模型（更新颜色）
        this._rebuildAllVoxels();
        return true;
    }

    /**
     * 核心渲染函数: 接收一个或多个Voxel实例，渲染并返回控制器数组
     * @param {Voxel|Voxel[]} voxels 单个Voxel对象或数组
     * @returns {VoxelRenderController[]} 控制器实例数组
     */
    render(voxels) {
        // 统一转为数组
        const inputArray = Array.isArray(voxels) ? voxels : [voxels];
        if (inputArray.length === 0) {
            console.warn('没有提供Voxel数据');
            return [];
        }
        // 存储新数据
        this.voxelsData = [...inputArray];
        // 重建场景
        this._rebuildAllVoxels();
        return this.voxelControllers;
    }

    // 完全重建所有Voxel模型 (根据当前voxelsData和palette)
    _rebuildAllVoxels() {
        // 1. 清除现有的所有Voxel模型组
        this.currentRootGroups.forEach(group => {
            if (group && group.parent) this.scene.remove(group);
            // 可选: 递归释放材质/几何体 (简单场景不复杂，为了内存可选择性处理)
            if (group) {
                group.traverse((obj) => {
                    if (obj.isMesh) {
                        if (obj.material) obj.material.dispose();
                        if (obj.geometry) obj.geometry.dispose();
                    }
                });
            }
        });
        this.currentRootGroups = [];
        this.voxelControllers = [];

        // 2. 遍历每个Voxel数据，构建独立的模型组及控制器
        for (let vIdx = 0; vIdx < this.voxelsData.length; vIdx++) {
            const voxelData = this.voxelsData[vIdx];
            if (!voxelData.sections || !Array.isArray(voxelData.sections)) continue;

            // 创建Voxel根组 (世界原点)
            const rootGroup = new THREE.Group();
            rootGroup.userData = { voxelIndex: vIdx, name: `Voxel_${vIdx}` };

            // 存储section组映射
            const sectionGroupsMap = new Map();

            // 遍历每个section (独立计算)
            for (let sIdx = 0; sIdx < voxelData.sections.length; sIdx++) {
                const section = voxelData.sections[sIdx];
                const { voxels, offset_x, offset_y, offset_z, name, max_bound_box } = section;

                // 每个section独立一个Group，位置由offset决定
                const sectionGroup = new THREE.Group();
                sectionGroup.position.set(offset_x, offset_y, offset_z);
                sectionGroup.userData = {
                    sectionName: name || `Section_${sIdx}`,
                    sectionIndex: sIdx,
                    offset: { x: offset_x, y: offset_y, z: offset_z },
                    maxBoundBox: max_bound_box
                };

                // 几何体复用: 单位立方体 (边长1，中心在局部坐标原点，范围-0.5到0.5)
                const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

                // 遍历该section的所有体素块
                if (voxels && Array.isArray(voxels)) {
                    for (const block of voxels) {
                        if (!block.used) continue; // 仅渲染使用的体素
                        // 获取颜色索引，安全访问调色板
                        const colorIdx = block.colour;
                        let colorRGB = this.palette[colorIdx];
                        if (!colorRGB) {
                            // 超出范围则使用洋红色提示
                            colorRGB = [255, 0, 255];
                        }
                        const materialColor = new THREE.Color(
                            colorRGB[0] / 255,
                            colorRGB[1] / 255,
                            colorRGB[2] / 255
                        );
                        const material = new THREE.MeshStandardMaterial({
                            color: materialColor,
                            roughness: 0.4,
                            metalness: 0.1,
                            flatShading: false
                        });

                        const cube = new THREE.Mesh(boxGeometry, material);
                        // 体素中心位置: (block.x, block.y, block.z) 因为sectionGroup已经有了offset偏移，所以cube相对于sectionGroup坐标就是block坐标
                        cube.position.set(block.x, block.y, block.z);
                        cube.userData = {
                            originalColorIdx: colorIdx,
                            blockData: block,
                            sectionName: name
                        };
                        sectionGroup.add(cube);
                    }
                }

                // 添加section组到根组
                rootGroup.add(sectionGroup);
                sectionGroupsMap.set(sIdx, sectionGroup);
            }

            // 将根组加入场景
            this.scene.add(rootGroup);
            this.currentRootGroups.push(rootGroup);

            // 创建控制器
            const controller = new VoxelRenderController(rootGroup, voxelData, sectionGroupsMap);
            this.voxelControllers.push(controller);
        }

        // 可选: 调整相机位置以适应模型总大小? 简单保持默认视角，并略微调整target
        if (this.voxelControllers.length > 0) {
            // 计算整体包围盒粗略优化视角 (保持合适视野)
            // 为了体验，不强制改变相机，以免打断用户交互，但首帧可以调整一次
            const boundingBox = new THREE.Box3();
            let hasValid = false;
            this.currentRootGroups.forEach(group => {
                const box = new THREE.Box3().setFromObject(group);
                if (box.min.x < box.max.x) {
                    boundingBox.union(box);
                    hasValid = true;
                }
            });
            if (hasValid && (boundingBox.max.x - boundingBox.min.x) > 0.1) {
                const center = boundingBox.getCenter(new THREE.Vector3());
                const size = boundingBox.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const distance = maxDim * 1.8;
                // 温和调整相机，但不丢失原始相对关系
                this.camera.position.set(center.x + distance * 0.8, center.y + distance * 0.6, center.z + distance);
                this.controls.target.copy(center);
                this.controls.update();
            }
        }
    }

    // 窗口自适应
    onWindowResize() {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    // 动画循环
    animate() {
        requestAnimationFrame(this.animate);
        this.controls.update(); // 更新轨道控制
        this.renderer.render(this.scene, this.camera);
    }

    // 销毁场景，释放资源 (可选)
    dispose() {
        window.removeEventListener('resize', this.onWindowResize);
        this.controls.dispose();
        this.renderer.dispose();
        this.scene.clear();
    }
}

export { VoxelRenderer, VoxelRenderController };