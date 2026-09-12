# My PAT Loader

一个用于解析和处理AutoCAD .PAT（填充图案）文件的JavaScript模块。

## 特性

- ✅ 支持带角度、原点、delta值和虚线定义的完整PAT规则
- ✅ 高精度计算PAT图案的矢量线段表示
- ✅ 支持缩放、旋转和偏移图案
- ✅ 轻量级实现，无外部依赖
- ✅ 包含Vue.js示例应用

## 安装

```bash
# 尚未发布到NPM，目前可通过Git仓库直接使用
git clone <repository-url>
cd my-pat-loader
# 如果需要依赖安装
npm install
```

## 主要API

这个库导出三个主要函数：

### `parsePatContent(patTextString)`

解析PAT文件文本内容为结构化数据。

```javascript
import { parsePatContent } from 'my-pat-loader';

const patContent = `*STARS,Stars pattern
45, 0, 0, 0, 20, 0, -20
135, 0, 0, 0, 20, 0, -20`;

const parsedPat = parsePatContent(patContent);
// 返回: { name: "STARS", linesDefs: [...], description: "Stars pattern" }
```

### `computePatternLines(parsedPatData, boundary, scale, rotation, offset)`

根据解析后的PAT数据，计算指定边界内的矢量线段。

```javascript
import { parsePatContent, computePatternLines } from 'my-pat-loader';

// 解析PAT数据
const parsedPat = parsePatContent(patContent);

// 计算线段
const lines = computePatternLines(
  parsedPat,
  { minX: 0, minY: 0, maxX: 100, maxY: 100 }, // 边界
  1.0, // 缩放
  0.0, // 旋转角度
  [0, 0] // 偏移
);

// 返回：[{start: {x, y}, end: {x, y}}, ...]
```

### `checkPatternContinuity(parsedPatData, boundary, scale, rotation, offset)`

检查图案在当前设置下是否在边界上形成连续的模式。

```javascript
import { parsePatContent, checkPatternContinuity } from 'my-pat-loader';

// 解析PAT数据
const parsedPat = parsePatContent(patContent);

// 检查连续性
const continuity = checkPatternContinuity(
  parsedPat,
  { minX: 0, minY: 0, maxX: 100, maxY: 100 }, // 边界
  1.0, // 缩放
  0.0, // 旋转角度
  [0, 0] // 偏移
);

// 返回：{ isContinuous: true, continuityScore: 0.95, edgeContinuity: {...}, details: "..." }
```

## 示例应用

项目包含一个基于Vue.js的完整示例应用，演示如何使用这个库来可视化PAT文件：

```bash
cd example
npm install
npm run dev
```

## PAT文件格式参考

AutoCAD PAT文件格式的基本结构如下：

```
*图案名称[,描述]
角度, 原点X, 原点Y, 增量X, 增量Y[, 虚线定义...]
```

- 每个图案以`*`开头，后跟图案名称
- 后续每行定义一组平行线族
- 正数虚线定义表示绘制线段，负数表示不绘制（空白）
- 零长度虚线表示点

## 许可

AGPL-3.0

## 赞赏

如果这个项目帮到了你，可以请我喝杯咖啡：

![赞赏码](assets/sponsor-qr.png)

也欢迎通过 [爱发电](https://afdian.net/a/leolee9086) 支持。