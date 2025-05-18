/**
 * @module patCalculator
 * This module provides functions to generate geometric lines based on parsed PAT data.
 */

/**
 * Calculates the geometric lines for a given parsed PAT pattern within a specified boundary.
 *
 * @param {object} parsedPatData - The parsed PAT data object from `patParser.js`.
 * @param {string} parsedPatData.name - Pattern name.
 * @param {Array<object>} parsedPatData.linesDefs - Array of line definition objects.
 *   Each object: { angle, origin: [x,y], delta: [dx,dy], dashes: [d1,d2,...] }
 *   - angle is in degrees.
 *   - origin is [x,y] for the first line of the family.
 *   - delta is [dx, dy] where dx is shift along the line direction for subsequent parallel lines,
 *     and dy is the perpendicular distance between parallel lines.
 *   - dashes is an array of positive (draw) and negative (gap) lengths. Empty for a continuous line.
 * @param {object} boundary - The rectangular boundary to generate lines within.
 * @param {number} boundary.minX - Minimum X coordinate of the boundary.
 * @param {number} boundary.minY - Minimum Y coordinate of the boundary.
 * @param {number} boundary.maxX - Maximum X coordinate of the boundary.
 * @param {number} boundary.maxY - Maximum Y coordinate of the boundary.
 * @param {number} [scale=1.0] - Optional scaling factor for the pattern.
 * @param {number} [rotation=0.0] - Optional additional rotation for the entire pattern in degrees (围绕(0,0)点旋转图案).
 * @param {Array<number>} [offset=[0,0]] - Optional offset [x,y] for the entire pattern.
 * @returns {Array<object>} An array of line segments. Each segment is { start: {x, y}, end: {x, y} }.
 *                                 Returns an empty array if no lines are generated or if input is invalid.
 */
export function computePatternLines(parsedPatData, boundary, scale = 1.0, rotation = 0.0, offset = [0, 0]) {
  if (!parsedPatData || !parsedPatData.linesDefs || !boundary) {
    // console.warn("patCalculator: Invalid input data or boundary.");
    return [];
  }

  const { linesDefs } = parsedPatData;
  const { minX, minY, maxX, maxY } = boundary;

  if (minX === undefined || minY === undefined || maxX === undefined || maxY === undefined ||
      minX >= maxX || minY >= maxY) {
    // console.warn("patCalculator: Invalid boundary dimensions.");
    return [];
  }

  const allGeneratedLines = [];
  const toRadians = (degrees) => degrees * (Math.PI / 180);

  // 边界对角线长度，用于确保线条足够长以覆盖整个边界
  const boundaryDiagonal = Math.sqrt(Math.pow(maxX - minX, 2) + Math.pow(maxY - minY, 2));
  // 边界中心点，用于定位线条
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // 应用整体偏移
  const [offsetX, offsetY] = offset;

  for (const lineDef of linesDefs) {
    let { angle, origin, delta, dashes } = lineDef;

    // Apply scaling to relevant line definition parameters
    const effectiveOrigin = [origin[0] * scale, origin[1] * scale];
    const effectiveDelta = [delta[0] * scale, delta[1] * scale];
    const effectiveDashes = dashes.map(d => d * scale);

    // Apply overall pattern rotation
    const patternRotationRad = toRadians(rotation);
    let currentAngleRad = toRadians(angle) + patternRotationRad;

    // Normalize angle to be between 0 and 2PI
    currentAngleRad = currentAngleRad % (2 * Math.PI);
    if (currentAngleRad < 0) {
        currentAngleRad += (2 * Math.PI);
    }

    // Rotate the origin point of the line definition
    let [ox, oy] = effectiveOrigin;
    let rotatedOriginX = ox * Math.cos(patternRotationRad) - oy * Math.sin(patternRotationRad);
    let rotatedOriginY = ox * Math.sin(patternRotationRad) + oy * Math.cos(patternRotationRad);

    // 应用整体偏移
    rotatedOriginX += offsetX;
    rotatedOriginY += offsetY;

    const [deltaX, deltaY] = effectiveDelta; // deltaX for shift, deltaY for perpendicular spacing

    // 1. 计算线条方向向量
    const dirX = Math.cos(currentAngleRad);
    const dirY = Math.sin(currentAngleRad);
    
    // 2. 计算垂直于线条的方向向量 (逆时针旋转90度)
    const perpDirX = -dirY;
    const perpDirY = dirX;

    // 如果deltaY为0，则只生成一条线
    if (Math.abs(deltaY) < 1e-10) {
      const linesFromSingleDef = generateDashedLine(
        rotatedOriginX, rotatedOriginY, 
        dirX, dirY, 
        effectiveDashes, 
        boundary, 
        boundaryDiagonal
      );
      allGeneratedLines.push(...linesFromSingleDef);
      continue;
    }

    // 3. 确定需要生成的平行线数量和范围
    // 计算边界在垂直方向上的投影长度
    const perpProjection = Math.abs(
      (maxX - minX) * Math.abs(perpDirX) + 
      (maxY - minY) * Math.abs(perpDirY)
    ) + Math.abs(deltaY); // 额外加一个deltaY确保覆盖边界

    // 计算需要多少条平行线
    const numLines = Math.ceil(perpProjection / Math.abs(deltaY)) + 1;
    
    // 确定起始线的位置 - 将原点投影到垂直方向
    const originPerpDistance = rotatedOriginX * perpDirX + rotatedOriginY * perpDirY;
    
    // 计算边界中心在垂直方向上的投影
    const centerPerpDistance = centerX * perpDirX + centerY * perpDirY;
    
    // 中心与原点在垂直方向上的差距，以deltaY为单位
    const centerToOriginLines = Math.round((centerPerpDistance - originPerpDistance) / deltaY);
    
    // 确定第一条线的索引，使其大致中心在边界中心
    const startLineIndex = -Math.floor(numLines / 2) + centerToOriginLines;
    
    // 4. 生成每条平行线
    for (let i = 0; i < numLines; i++) {
      const lineIndex = startLineIndex + i;
      
      // 计算这条线的垂直偏移量
      const perpOffset = lineIndex * deltaY;
      
      // 计算水平偏移量
      // 使用累积偏移，按照AutoCAD的规范
      const horizOffset = lineIndex * deltaX;
      
      // 计算这条线的起始点
      const lineStartX = rotatedOriginX + perpOffset * perpDirX + horizOffset * dirX;
      const lineStartY = rotatedOriginY + perpOffset * perpDirY + horizOffset * dirY;
      
      // 生成这条线的所有线段，并添加到结果中
      const dashedLines = generateDashedLine(
        lineStartX, lineStartY, 
        dirX, dirY, 
        effectiveDashes, 
        boundary, 
        boundaryDiagonal
      );
      
      allGeneratedLines.push(...dashedLines);
    }
  }

  return allGeneratedLines;
}

/**
 * 检查图案在当前设置下是否在边界上形成连续的模式
 * 
 * @param {object} parsedPatData - 已解析的PAT数据
 * @param {object} boundary - 矩形边界
 * @param {number} scale - 缩放因子
 * @param {number} rotation - 旋转角度（度）
 * @param {Array<number>} offset - [x,y]偏移
 * @returns {object} 包含连续性评估结果的对象
 *   {
 *     isContinuous: boolean, // 整体是否连续
 *     continuityScore: number, // 连续性分数(0-1)，1表示完全连续
 *     edgeContinuity: { // 每个边的连续性
 *       top: boolean,
 *       right: boolean,
 *       bottom: boolean,
 *       left: boolean
 *     },
 *     details: string // 描述连续性的详细文本信息
 *   }
 */
export function checkPatternContinuity(parsedPatData, boundary, scale = 1.0, rotation = 0.0, offset = [0, 0]) {
  // 生成边界内的线条
  const lines = computePatternLines(parsedPatData, boundary, scale, rotation, offset);
  
  if (lines.length === 0) {
    return {
      isContinuous: false,
      continuityScore: 0,
      edgeContinuity: { top: false, right: false, bottom: false, left: false },
      details: "没有生成任何线条，无法评估连续性。"
    };
  }
  
  const { minX, minY, maxX, maxY } = boundary;
  const epsilon = 1e-6; // 浮点数比较的容差
  
  // 边界四条边的定义
  const edges = {
    top: { start: minX, end: maxX, isHorizontal: true, coord: maxY },
    right: { start: minY, end: maxY, isHorizontal: false, coord: maxX },
    bottom: { start: minX, end: maxX, isHorizontal: true, coord: minY },
    left: { start: minY, end: maxY, isHorizontal: false, coord: minX }
  };
  
  // 收集每条边与线段的交点
  const intersections = {
    top: [],
    right: [],
    bottom: [],
    left: []
  };
  
  // 找出所有线段与边界的交点
  for (const line of lines) {
    const { start, end } = line;
    
    // 检查线段是否与边界的每条边相交
    for (const [edgeName, edge] of Object.entries(edges)) {
      const { isHorizontal, coord, start: edgeStart, end: edgeEnd } = edge;
      
      // 线段方程参数: p + t*d, 0 <= t <= 1
      // 边界边方程: isHorizontal ? y = coord : x = coord
      
      let t;
      if (isHorizontal) {
        // 水平边 (y = coord)
        if (Math.abs(end.y - start.y) < epsilon) continue; // 平行于边
        t = (coord - start.y) / (end.y - start.y);
      } else {
        // 垂直边 (x = coord)
        if (Math.abs(end.x - start.x) < epsilon) continue; // 平行于边
        t = (coord - start.x) / (end.x - start.x);
      }
      
      // 交点在线段上
      if (t >= 0 && t <= 1) {
        const x = start.x + t * (end.x - start.x);
        const y = start.y + t * (end.y - start.y);
        
        // 交点在边上
        if (isHorizontal) {
          if (x >= edgeStart - epsilon && x <= edgeEnd + epsilon) {
            intersections[edgeName].push({ x, y, isEndpoint: 
              (Math.abs(t) < epsilon || Math.abs(t - 1) < epsilon) });
          }
        } else {
          if (y >= edgeStart - epsilon && y <= edgeEnd + epsilon) {
            intersections[edgeName].push({ x, y, isEndpoint: 
              (Math.abs(t) < epsilon || Math.abs(t - 1) < epsilon) });
          }
        }
      }
    }
  }
  
  // 对每条边的交点进行排序
  for (const edgeName of Object.keys(edges)) {
    if (edges[edgeName].isHorizontal) {
      // 水平边，按x排序
      intersections[edgeName].sort((a, b) => a.x - b.x);
    } else {
      // 垂直边，按y排序
      intersections[edgeName].sort((a, b) => a.y - b.y);
    }
  }
  
  // 评估每条边的连续性
  const edgeContinuity = {};
  let totalContinuityScore = 0;
  let edgesWithIntersections = 0;
  
  for (const [edgeName, points] of Object.entries(intersections)) {
    if (points.length < 2) {
      // 少于2个交点的边无法形成连续模式
      edgeContinuity[edgeName] = false;
      continue;
    }
    
    edgesWithIntersections++;
    
    // 分析交点间距的一致性
    const edge = edges[edgeName];
    const isHorizontal = edge.isHorizontal;
    const edgeLength = edge.end - edge.start;
    
    // 计算交点间距并检查一致性
    const distances = [];
    let totalGaps = 0;
    
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const distance = isHorizontal ? 
        Math.abs(curr.x - prev.x) : 
        Math.abs(curr.y - prev.y);
      
      distances.push(distance);
      totalGaps += distance;
    }
    
    if (distances.length === 0) {
      edgeContinuity[edgeName] = false;
      continue;
    }
    
    // 计算平均间距
    const avgDistance = totalGaps / distances.length;
    
    // 计算间距的变异系数(CV)，越小越一致
    let sumSquaredDiff = 0;
    for (const distance of distances) {
      sumSquaredDiff += Math.pow(distance - avgDistance, 2);
    }
    const stdDev = Math.sqrt(sumSquaredDiff / distances.length);
    const cv = stdDev / avgDistance;
    
    // 计算边覆盖率
    const coverage = totalGaps / edgeLength;
    
    // 判断连续性 - CV小于阈值认为间距一致
    const isDistanceConsistent = cv < 0.1; // 10%的变异被认为是一致的
    
    // 计算边的连续性分数 (0-1)
    const edgeScore = isDistanceConsistent ? 
      Math.min(1, coverage) * (1 - Math.min(1, cv)) : 
      0;
    
    totalContinuityScore += edgeScore;
    edgeContinuity[edgeName] = edgeScore > 0.8; // 80%以上的分数认为是连续的
  }
  
  // 计算总体连续性分数
  const finalScore = edgesWithIntersections > 0 ? 
    totalContinuityScore / edgesWithIntersections : 
    0;
  
  // 总体连续性判断
  const isContinuous = finalScore > 0.8; // 80%以上的分数认为是连续的
  
  // 生成详细描述
  let details = "";
  if (isContinuous) {
    details = `图案在当前设置下形成了连续的模式(连续性分数: ${(finalScore * 100).toFixed(1)}%)。`;
  } else if (finalScore > 0.5) {
    details = `图案在当前设置下基本连续，但存在一些不连续处(连续性分数: ${(finalScore * 100).toFixed(1)}%)。`;
  } else if (finalScore > 0) {
    details = `图案在当前设置下不连续(连续性分数: ${(finalScore * 100).toFixed(1)}%)。`;
  } else {
    details = "图案在当前设置下无法形成连续模式。";
  }
  
  // 添加每条边的连续性信息
  details += "\n边界连续性: ";
  for (const [edge, isCont] of Object.entries(edgeContinuity)) {
    const edgeName = {
      top: "顶部", right: "右侧", bottom: "底部", left: "左侧"
    }[edge];
    details += `${edgeName}: ${isCont ? "连续" : "不连续"}; `;
  }
  
  return {
    isContinuous,
    continuityScore: finalScore,
    edgeContinuity,
    details
  };
}

/**
 * 生成一条可能带有虚线的线，并与边界相交
 * 
 * @param {number} startX - 线的起始点X坐标
 * @param {number} startY - 线的起始点Y坐标
 * @param {number} dirX - 线的方向向量X分量
 * @param {number} dirY - 线的方向向量Y分量
 * @param {Array<number>} dashes - 虚线定义数组，正数为画线长度，负数为空白长度
 * @param {object} boundary - 裁剪边界
 * @param {number} boundaryDiagonal - 边界对角线长度
 * @returns {Array<object>} 裁剪后的线段数组，每个线段为 { start: {x, y}, end: {x, y} }
 */
function generateDashedLine(startX, startY, dirX, dirY, dashes, boundary, boundaryDiagonal) {
  const { minX, minY, maxX, maxY } = boundary;
  const result = [];
  
  // 对于连续线条 (无虚线定义)，生成一条穿过整个边界的线
  if (!dashes || dashes.length === 0) {
    // 创建一条足够长的线，确保能覆盖整个边界
    const lineLength = boundaryDiagonal * 2; // 使用边界对角线的两倍长度
    
    // 计算线的两个端点
    const p1x = startX - dirX * lineLength;
    const p1y = startY - dirY * lineLength;
    const p2x = startX + dirX * lineLength;
    const p2y = startY + dirY * lineLength;
    
    // 使用Liang-Barsky算法裁剪线段
    const clippedLine = clipLineLiangBarsky(p1x, p1y, p2x, p2y, boundary);
    
    if (clippedLine) {
      result.push({
        start: { x: clippedLine[0], y: clippedLine[1] },
        end: { x: clippedLine[2], y: clippedLine[3] }
      });
    }
    
    return result;
  }
  
  // 对于虚线模式，我们需要沿着线依次应用虚线定义

  // 首先确定一个起始点，使其位于边界外但不会太远
  const extendedLength = boundaryDiagonal * 1.5;
  let currentX = startX - dirX * extendedLength;
  let currentY = startY - dirY * extendedLength;
  
  // 计算整个虚线模式的总长度
  let patternLength = 0;
  for (const dash of dashes) {
    patternLength += Math.abs(dash);
  }
  
  // 确保从一个完整的虚线周期开始
  // 计算从扩展起点到原始起点有多少个完整周期
  const distToStart = Math.sqrt(
    Math.pow(currentX - startX, 2) + 
    Math.pow(currentY - startY, 2)
  );
  
  // 调整起点使其落在虚线周期的起始处
  const cyclesBeforeStart = Math.floor(distToStart / patternLength);
  const remainingDist = distToStart - (cyclesBeforeStart * patternLength);
  
  // 前进remainingDist距离
  currentX += dirX * remainingDist;
  currentY += dirY * remainingDist;
  
  // 总计要走的距离是扩展边界的两倍长度
  const totalDistance = extendedLength * 2;
  let distanceTraveled = 0;
  
  // 重复应用虚线模式直到覆盖整个边界
  let dashIndex = 0;
  let inDash = true; // 是否在画线状态

  while (distanceTraveled < totalDistance) {
    const dashLength = Math.abs(dashes[dashIndex]);
    const isDraw = dashes[dashIndex] >= 0; // 正值表示画线，负值表示空白
    
    // 如果是画线部分，则生成一个线段
    if (isDraw) {
      const segmentEndX = currentX + dirX * dashLength;
      const segmentEndY = currentY + dirY * dashLength;
      
      // 裁剪这个线段
      const clippedLine = clipLineLiangBarsky(
        currentX, currentY, 
        segmentEndX, segmentEndY, 
        boundary
      );
      
      // 如果裁剪后线段仍然存在，则添加到结果
      if (clippedLine) {
        result.push({
          start: { x: clippedLine[0], y: clippedLine[1] },
          end: { x: clippedLine[2], y: clippedLine[3] }
        });
      }
    }
    
    // 移动当前点到下一个位置
    currentX += dirX * dashLength;
    currentY += dirY * dashLength;
    distanceTraveled += dashLength;
    
    // 移动到下一个虚线定义
    dashIndex = (dashIndex + 1) % dashes.length;
  }
  
  return result;
}

/**
 * 使用Liang-Barsky算法裁剪线段
 * 
 * @param {number} x1 - 线段起点X坐标
 * @param {number} y1 - 线段起点Y坐标
 * @param {number} x2 - 线段终点X坐标
 * @param {number} y2 - 线段终点Y坐标
 * @param {object} boundary - 裁剪边界 {minX, minY, maxX, maxY}
 * @returns {Array<number>|null} 裁剪后的线段 [x1, y1, x2, y2] 或 null表示完全裁剪掉
 */
function clipLineLiangBarsky(x1, y1, x2, y2, boundary) {
  const { minX, minY, maxX, maxY } = boundary;
  
  // 线段方向向量
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  // 对边界进行参数化
  let tMin = 0; // 入口参数，初始值为0
  let tMax = 1; // 出口参数，初始值为1
  
  // 边界测试数组: [p, q]，其中p是投影坐标，q是起点相对边界的位置
  const edges = [
    [-dx, x1 - minX], // 左边界
    [dx, maxX - x1],  // 右边界
    [-dy, y1 - minY], // 下边界
    [dy, maxY - y1]   // 上边界
  ];
  
  // 对每个边界进行测试
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-10) { // 几乎平行于边界
      if (q < 0) {
        // 线段完全在边界外
        return null;
      }
      // 否则这个边界不影响线段
      continue;
    }
    
    // 计算与边界的交点参数
    const t = q / p;
    
    if (p < 0) { // 从外部进入边界
      tMin = Math.max(tMin, t);
    } else { // 从内部离开边界
      tMax = Math.min(tMax, t);
    }
    
    // 如果参数已经不合理，表示线段完全在边界外
    if (tMin > tMax) {
      return null;
    }
  }
  
  // 计算裁剪后的线段端点
  const clippedX1 = x1 + tMin * dx;
  const clippedY1 = y1 + tMin * dy;
  const clippedX2 = x1 + tMax * dx;
  const clippedY2 = y1 + tMax * dy;
  
  return [clippedX1, clippedY1, clippedX2, clippedY2];
}

