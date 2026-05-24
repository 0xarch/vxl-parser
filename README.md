# VXL Parser

支持将 MagicaVoxel(.vox) 体素与 TiberumSun/RedAlert2(.vxl) 体素互相转换，并保留色盘。

此工具的色盘转换功能基于直接数据索引，不需要经过 VXLSE III 使用的切片颜色匹配。理论上本工具可完美保留相近色（如亮光红不会被解析为所属色），且不会受MagicaVoxel色盘干扰（你可以用不同的所属色作画）。

此工具默认使用的优化色盘如截图所示：

![色盘截图](./asset/pal.png)

此色盘自心灵终结中使用的拓展了尾区的 uniturb.pal 转换 （应用了坐标变换以使颜色分布与VXLSE近似）。 你可以手动根据 pal 文件解析，或者使用这个 [Shell 脚本](./asset/build_palette.sh) 来自动将 RA2 色盘转换为 MagicaVoxel 色盘 （该脚本适配了行列转换，最终结果和在VXLSE中的排列近似相同）。

使用方式：
需求: 需要首先安装 Bun 或 Node.js （推荐 Bun 因为其更快，且原生支持 TypeScript）
> 如果使用 Node.js，你需要提前安装 TypeScript 编译器将代码转换为 JavaScript，因为 Node.js 的原生TS支持仍然是实验性的。

```sh
bun ${tool_dir}/src/main.ts ${from_type}-${to_type} ${input_file} ${output_file}
```
`tool_dir` 为该项目的地址， `from_type` 代表转换前的格式，`to_type` 代表转换的目标格式。 `input_file` 代表要转换的文件路径， `output_file` 代表输出文件路径。

例如：我想要把当前目录下面的 myartwork.vox 转换为 myartwork.vxl ，且本项目位于 `D:\vxl-parser`，那么便需要执行 `bun D:\vxl-parser\src\main.ts vox-vxl myartwork.vox myartwork.vxl`。

该工具在运行时会读取工作目录下的 parser.json ，该文件是可选的JSON格式文件。该文件有如下字段：
*   `autonormal`: `boolean`，指定是否启用自动法线。默认 `true` 。
*   `normalrange`: `number`，指定自动法线算法应用的半径，默认 `3.5`。
*   `palettetransform`: `boolean`，指定是否对vox文件应用色盘转换。该转换算法以上图中使用的色盘进行反向变换。

## 多组件

多组件支持尚在试验阶段。目前，你可以：
*   读取多组件VXL和多组件VOX
*   写入多组件VXL

对于多组件VOX的支持因无法定位MagicaVoxel解析nTRN/nSHP遇到的问题，目前仅支持写入组件数据，无法记录位置，可能需要很长时间修复。

你仍然需要使用 HVA Builder 来为模型添加动画效果，目前暂未支持导出 MagicaVoxel 的动画。

已知问题：
*   如果从有水平偏移的 VXL 转 VOX，可能导致该 VOX 转 VXL 后无法正确计算偏移位置。
*   对于 VOX 模型盒比实际模型大的，可能导致无法正确计算偏移位置。因此在 MagicaVoxel 中搭建多组件应当使用干净的文件拖拽已有模型进行组装而不是直接在物体上组装。
