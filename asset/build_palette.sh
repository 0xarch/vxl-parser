#!/bin/bash

PAL_FILE="$1"                  # 第一个参数：色盘文件路径
OUTPUT="${2:-ra2_palette.png}" # 第二个参数：输出文件（默认 ra2_palette.png）

if [ ! -f "$PAL_FILE" ]; then
  echo "Usage: $0 <pal_file> [output_png]"
  echo "Example: $0 unittem.pal ra2_palette.png"
  exit 1
fi

# 检查文件大小
size=$(stat -c%s "$PAL_FILE")
if [ "$size" -ne 768 ]; then
  echo "Warning: File size is $size bytes, expected 768 bytes"
fi

# 第一步：读取所有颜色到数组
colors=()
while read hex; do
  r6=$((0x${hex:0:2}))
  g6=$((0x${hex:2:2}))
  b6=$((0x${hex:4:2}))
  r8=$((r6 << 2))
  g8=$((g6 << 2))
  b8=$((b6 << 2))
  colors+=("$r8 $g8 $b8")
done < <(dd if="$PAL_FILE" bs=3 count=256 2>/dev/null | xxd -p -c 3)

# 第二步：重新排列（列优先转行优先）
# 编辑器是 32 行 × 8 列（列优先）
# MagicaVoxel 需要行优先的 256×1
reordered=()
for row in {0..31}; do  # 32 行
  for col in {0..7}; do # 8 列
    idx=$(((7 - col) * 32 + (31 - row)))
    reordered+=("${colors[$idx]}")
  done
done

# 第三步：生成色盘
(
  echo "P3"
  echo "256 1"
  echo "255"
  printf "%s\n" "${reordered[@]}"
) >ra2_palette.ppm

# 转换为 PNG
convert ra2_palette.ppm "$OUTPUT"

# 清理临时文件
rm ra2_palette.ppm

echo "Done: $OUTPUT (reordered for MagicaVoxel)"
identify "$OUTPUT"
