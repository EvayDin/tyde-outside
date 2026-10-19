# 客户端图标

- `icon-reference.png`：用户提供的 56×55 像素参考图。
- `icon.png`：基于参考图用内置 imagegen 还原的 1024×1024 透明背景高清版，用于开发运行和窗口图标；并非原始高清源文件。
- `icon.icns`：macOS 应用图标，包含多个尺寸。
- `icon.ico`：Windows EXE、安装器、卸载器和窗口图标，包含多个尺寸。

ICNS 与 ICO 通过项目已安装的 electron-builder 图标转换工具从 `icon.png` 生成。替换图标时同步更新三种格式，开发版需完全退出后重启，安装版需重新打包安装。

## 高清版生成提示词

工具：内置 imagegen；输入：`icon-reference.png`；`transparent_background: true`。输出缩放至 1024×1024 后保存为 `icon.png`。

```text
Use case: precise-object-edit. Asset type: production desktop application icon for macOS and Windows. Input image 1 is the edit target and exact visual reference, a tiny 56x55 logo. Reproduce this same logo as a crisp high-resolution square PNG with real alpha transparency outside the logo. Preserve the original composition, silhouette, proportions, teal/turquoise colors, soft gradient lighting, small white shapes, horizontal wavy bands, and the separate small turquoise dot near the upper-right. The main logo is a large slightly organic turquoise circular disk; inside are the same three short white rounded upright marks at mid-height and layered wavy teal and white horizontal bands. Closely follow what is actually visible in the input; do not invent additional details. Remove only the white screenshot background outside the circular symbol, preserving white internal logo elements. Center the entire symbol including the upper-right dot on a square canvas, with balanced transparent margins, occupy approximately 85 percent of the canvas. Smooth clean edges, no text, no letter, no extra objects, no badge, no border, no 3D mockup, no enclosing rounded square. This is faithful resolution restoration of an existing identity, not a redesign.
```
