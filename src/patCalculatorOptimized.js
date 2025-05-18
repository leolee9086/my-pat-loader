/**
 * @module patCalculatorOptimized
 * 高性能版本的PAT图案计算模块，基于原始patCalculator.js但经过极端性能优化
 */

// 常量和缓存 - 减少重复计算
const TWO_PI = 2 * Math.PI;
const TO_RADIANS = Math.PI / 180;
const EPSILON = 1e-10;

// 预分配重用对象 - 减少垃圾回收
const _vec2 = {x: 0, y: 0};
const _vec2b = {x: 0, y: 0};
const _point1 = {x: 0, y: 0};
const _point2 = {x: 0, y: 0};
const _tempVec = {x: 0, y: 0};

// 预先分配裁剪结果数组，减少内存分配
const _clippedLine = [0, 0, 0, 0];
const _linePool = [];
const _maxPoolSize = 1000;

/**
 * 高性能向量运算 - 实际在优化版本中使用这些函数
 */
const Vec2 = {
  set(vec, x, y) {
    vec.x = x;
    vec.y = y;
    return vec;
  },
  
  copy(target, source) {
    target.x = source.x;
    target.y = source.y;
    return target;
  },
  
  rotate(vec, sinAngle, cosAngle) {
    const x = vec.x;
    const y = vec.y;
    vec.x = x * cosAngle - y * sinAngle;
    vec.y = x * sinAngle + y * cosAngle;
    return vec;
  },
  
  scale(vec, scalar) {
    vec.x *= scalar;
    vec.y *= scalar;
    return vec;
  },
  
  add(vec, dx, dy) {
    vec.x += dx;
    vec.y += dy;
    return vec;
  },
  
  addVec(target, v1, v2) {
    target.x = v1.x + v2.x;
    target.y = v1.y + v2.y;
    return target;
  },
  
  dist(v1, v2) {
    const dx = v2.x - v1.x;
    const dy = v2.y - v1.y;
    return Math.sqrt(dx * dx + dy * dy);
  },
  
  lerp(out, v1, v2, t) {
    out.x = v1.x + (v2.x - v1.x) * t;
    out.y = v1.y + (v2.y - v1.y) * t;
    return out;
  }
};

/**
 * 从对象池获取线段对象，减少内存分配
 */
function getLineFromPool() {
  if (_linePool.length > 0) {
    return _linePool.pop();
  }
  return {
    start: {x: 0, y: 0},
    end: {x: 0, y: 0}
  };
}

/**
 * 回收线段对象到池中
 */
function recycleLines(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (_linePool.length < _maxPoolSize) {
      _linePool.push(lines[i]);
    }
  }
}

/**
 * 计算PAT图案线条 - 经过高度优化的版本
 * 
 * @param {object} parsedPatData - 解析后的PAT数据对象
 * @param {object} boundary - 矩形边界
 * @param {number} [scale=1.0] - 缩放因子
 * @param {number} [rotation=0.0] - 旋转角度（度）
 * @param {Array<number>} [offset=[0,0]] - [x,y]偏移
 * @returns {Array<object>} 线段数组
 */
export function computePatternLines(parsedPatData, boundary, scale = 1.0, rotation = 0.0, offset = [0, 0]) {
  // 快速验证输入
  if (!parsedPatData?.linesDefs?.length || !boundary || 
      typeof boundary.minX !== 'number' || typeof boundary.minY !== 'number' || 
      typeof boundary.maxX !== 'number' || typeof boundary.maxY !== 'number' ||
      boundary.minX >= boundary.maxX || boundary.minY >= boundary.maxY) {
    return [];
  }

  const { minX, minY, maxX, maxY } = boundary;
  
  // 预计算常用值
  const boundaryDiagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const [offsetX, offsetY] = offset;
  
  // 预计算旋转值
  const rotationRad = rotation * TO_RADIANS;
  const sinRotation = Math.sin(rotationRad);
  const cosRotation = Math.cos(rotationRad);
  
  // 估算结果数组大小以减少扩容 - 基于线条数量和边界对角线长度的估算
  const estimatedLines = parsedPatData.linesDefs.length * Math.ceil(boundaryDiagonal / 10);
  const allGeneratedLines = [];
  allGeneratedLines.capacity = Math.min(10000, estimatedLines);
  
  // 处理每个线条定义
  for (let i = 0; i < parsedPatData.linesDefs.length; i++) {
    const lineDef = parsedPatData.linesDefs[i];
    const { angle, origin, delta, dashes } = lineDef;
    
    // 使用向量对象表示原点
    Vec2.set(_vec2, origin[0] * scale, origin[1] * scale);
    
    // 使用向量对象表示增量
    Vec2.set(_vec2b, delta[0] * scale, delta[1] * scale);
    
    // 仅在必要时缩放虚线定义
    let scaledDashes;
    if (dashes && dashes.length > 0) {
      scaledDashes = new Array(dashes.length);
      for (let j = 0; j < dashes.length; j++) {
        scaledDashes[j] = dashes[j] * scale;
      }
    }
    
    // 计算旋转后的角度
    let currentAngleRad = angle * TO_RADIANS + rotationRad;
    
    // 规范化角度
    currentAngleRad = currentAngleRad % TWO_PI;
    if (currentAngleRad < 0) {
      currentAngleRad += TWO_PI;
    }
    
    // 计算线条方向向量
    const dirX = Math.cos(currentAngleRad);
    const dirY = Math.sin(currentAngleRad);
    Vec2.set(_tempVec, dirX, dirY);
    
    // 应用旋转和偏移到原点
    Vec2.rotate(_vec2, sinRotation, cosRotation);
    Vec2.add(_vec2, offsetX, offsetY);
    
    // 提取旋转后的原点坐标
    const rotatedOriginX = _vec2.x;
    const rotatedOriginY = _vec2.y;
    
    // 计算垂直方向
    const perpDirX = -dirY;
    const perpDirY = dirX;
    
    // 如果deltaY接近0，只生成一条线
    if (Math.abs(_vec2b.y) < EPSILON) {
      generateSingleLine(
        rotatedOriginX, rotatedOriginY,
        dirX, dirY,
        scaledDashes,
        boundary,
        boundaryDiagonal,
        allGeneratedLines
      );
      continue;
    }
    
    // 高效计算平行线数量和范围
    const deltaY = _vec2b.y;
    const absDeltaY = Math.abs(deltaY);
    
    // 计算边界在垂直方向的投影
    const perpProjection = Math.abs(
      (maxX - minX) * Math.abs(perpDirX) + 
      (maxY - minY) * Math.abs(perpDirY)
    ) + absDeltaY;
    
    // 平行线数量
    const numLines = Math.ceil(perpProjection / absDeltaY) + 1;
    
    // 确定起始线位置
    const originPerpDistance = rotatedOriginX * perpDirX + rotatedOriginY * perpDirY;
    const centerPerpDistance = centerX * perpDirX + centerY * perpDirY;
    const centerToOriginLines = Math.round((centerPerpDistance - originPerpDistance) / deltaY);
    const startLineIndex = -Math.floor(numLines * 0.5) + centerToOriginLines;
    
    // 使用批处理生成所有平行线
    for (let j = 0; j < numLines; j++) {
      const lineIndex = startLineIndex + j;
      
      // 平行线的偏移计算
      const perpOffset = lineIndex * deltaY;
      const horizOffset = lineIndex * _vec2b.x;
      
      // 计算线的起始点
      const lineStartX = rotatedOriginX + perpOffset * perpDirX + horizOffset * dirX;
      const lineStartY = rotatedOriginY + perpOffset * perpDirY + horizOffset * dirY;
      
      // 生成这条线的所有线段
      generateSingleLine(
        lineStartX, lineStartY,
        dirX, dirY,
        scaledDashes,
        boundary,
        boundaryDiagonal,
        allGeneratedLines
      );
    }
  }
  
  return allGeneratedLines;
}

/**
 * 生成单条线并添加到结果数组 - 内联函数减少调用开销
 */
function generateSingleLine(startX, startY, dirX, dirY, dashes, boundary, boundaryDiagonal, resultArray) {
  const { minX, minY, maxX, maxY } = boundary;
  
  // 连续线处理 (无虚线)
  if (!dashes || dashes.length === 0) {
    // 使用足够长的线段
    const lineLength = boundaryDiagonal * 2;
    
    // 计算端点
    Vec2.set(_point1, startX - dirX * lineLength, startY - dirY * lineLength);
    Vec2.set(_point2, startX + dirX * lineLength, startY + dirY * lineLength);
    
    // 裁剪
    if (clipLineFast(_point1, _point2, boundary, _clippedLine)) {
      const line = getLineFromPool();
      line.start.x = _clippedLine[0];
      line.start.y = _clippedLine[1];
      line.end.x = _clippedLine[2];
      line.end.y = _clippedLine[3];
      resultArray.push(line);
    }
    
    return;
  }
  
  // 虚线处理 - 使用优化的实现
  const extendedLength = boundaryDiagonal * 1.5;
  
  // 计算起始点
  Vec2.set(_point1, startX - dirX * extendedLength, startY - dirY * extendedLength);
  
  // 计算虚线模式总长度
  let patternLength = 0;
  for (let i = 0; i < dashes.length; i++) {
    patternLength += Math.abs(dashes[i]);
  }
  
  // 调整起点到虚线周期开始处
  if (patternLength > EPSILON) {
    const distToStart = Math.sqrt((_point1.x - startX) ** 2 + (_point1.y - startY) ** 2);
    const cyclesBeforeStart = Math.floor(distToStart / patternLength);
    const remainingDist = distToStart - (cyclesBeforeStart * patternLength);
    
    _point1.x += dirX * remainingDist;
    _point1.y += dirY * remainingDist;
  }
  
  // 优化虚线生成循环
  const totalDistance = extendedLength * 2;
  let distanceTraveled = 0;
  let dashIndex = 0;
  
  // 当前点位置
  let currentX = _point1.x;
  let currentY = _point1.y;
  
  while (distanceTraveled < totalDistance) {
    const dashLength = Math.abs(dashes[dashIndex]);
    const isDraw = dashes[dashIndex] >= 0;
    
    if (isDraw) {
      // 计算线段终点
      const segmentEndX = currentX + dirX * dashLength;
      const segmentEndY = currentY + dirY * dashLength;
      
      // 使用向量对象设置端点
      Vec2.set(_point1, currentX, currentY);
      Vec2.set(_point2, segmentEndX, segmentEndY);
      
      // 裁剪线段
      if (clipLineFast(_point1, _point2, boundary, _clippedLine)) {
        const line = getLineFromPool();
        line.start.x = _clippedLine[0];
        line.start.y = _clippedLine[1];
        line.end.x = _clippedLine[2];
        line.end.y = _clippedLine[3];
        resultArray.push(line);
      }
    }
    
    // 更新当前位置
    currentX += dirX * dashLength;
    currentY += dirY * dashLength;
    distanceTraveled += dashLength;
    
    // 快速循环虚线定义
    dashIndex = (dashIndex + 1) % dashes.length;
  }
}

/**
 * 高性能线段裁剪 (基于Liang-Barsky算法)
 * 内联关键计算以减少函数调用开销
 * 
 * @param {object} p1 - 线段起点 {x, y}
 * @param {object} p2 - 线段终点 {x, y}
 * @param {object} boundary - 裁剪边界
 * @param {Array<number>} result - 结果数组 [x1, y1, x2, y2]
 * @returns {boolean} - 是否有有效的裁剪结果
 */
function clipLineFast(p1, p2, boundary, result) {
  const { minX, minY, maxX, maxY } = boundary;
  
  // 线段方向向量
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  
  let tMin = 0;
  let tMax = 1;
  
  // 使用展开的循环代替数组迭代 - 减少内存分配和循环开销
  
  // 左边界测试
  if (Math.abs(dx) < EPSILON) {
    if (p1.x < minX) return false;
  } else {
    const p = -dx;
    const q = p1.x - minX;
    if (p !== 0) {
      const t = q / p;
      if (p < 0) {
        if (t > tMin) tMin = t;
      } else {
        if (t < tMax) tMax = t;
      }
    } else if (q < 0) {
      return false;
    }
  }
  
  if (tMin > tMax) return false;
  
  // 右边界测试
  if (Math.abs(dx) < EPSILON) {
    if (p1.x > maxX) return false;
  } else {
    const p = dx;
    const q = maxX - p1.x;
    if (p !== 0) {
      const t = q / p;
      if (p < 0) {
        if (t > tMin) tMin = t;
      } else {
        if (t < tMax) tMax = t;
      }
    } else if (q < 0) {
      return false;
    }
  }
  
  if (tMin > tMax) return false;
  
  // 下边界测试
  if (Math.abs(dy) < EPSILON) {
    if (p1.y < minY) return false;
  } else {
    const p = -dy;
    const q = p1.y - minY;
    if (p !== 0) {
      const t = q / p;
      if (p < 0) {
        if (t > tMin) tMin = t;
      } else {
        if (t < tMax) tMax = t;
      }
    } else if (q < 0) {
      return false;
    }
  }
  
  if (tMin > tMax) return false;
  
  // 上边界测试
  if (Math.abs(dy) < EPSILON) {
    if (p1.y > maxY) return false;
  } else {
    const p = dy;
    const q = maxY - p1.y;
    if (p !== 0) {
      const t = q / p;
      if (p < 0) {
        if (t > tMin) tMin = t;
      } else {
        if (t < tMax) tMax = t;
      }
    } else if (q < 0) {
      return false;
    }
  }
  
  if (tMin > tMax) return false;
  
  // 直接计算裁剪点并写入结果数组
  result[0] = p1.x + tMin * dx;
  result[1] = p1.y + tMin * dy;
  result[2] = p1.x + tMax * dx;
  result[3] = p1.y + tMax * dy;
  return true;
}

/**
 * 检查图案在当前设置下是否形成连续模式 - 优化版本
 * 
 * @param {object} parsedPatData - 已解析的PAT数据
 * @param {object} boundary - 矩形边界
 * @param {number} scale - 缩放因子
 * @param {number} rotation - 旋转角度（度）
 * @param {Array<number>} offset - [x,y]偏移
 * @returns {object} 包含连续性评估结果的对象
 */
export function checkPatternContinuity(parsedPatData, boundary, scale = 1.0, rotation = 0.0, offset = [0, 0]) {
  // 生成边界内的线条 - 重用计算结果
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
  
  // 优化边界定义 - 使用数组减少属性查找
  const edges = [
    { name: 'top', start: minX, end: maxX, isHorizontal: true, coord: maxY },
    { name: 'right', start: minY, end: maxY, isHorizontal: false, coord: maxX },
    { name: 'bottom', start: minX, end: maxX, isHorizontal: true, coord: minY },
    { name: 'left', start: minY, end: maxY, isHorizontal: false, coord: minX }
  ];
  
  // 预分配交点数组
  const allIntersections = [[], [], [], []];
  
  // 使用向量对象进行交点计算
  const tmpStart = {x: 0, y: 0};
  const tmpEnd = {x: 0, y: 0};
  
  // 查找所有线段与边界的交点 - 使用批处理优化
  for (let i = 0; i < lines.length; i++) {
    const { start, end } = lines[i];
    
    // 复制到临时向量对象
    Vec2.copy(tmpStart, start);
    Vec2.copy(tmpEnd, end);
    
    for (let j = 0; j < 4; j++) {
      const edge = edges[j];
      const { isHorizontal, coord, start: edgeStart, end: edgeEnd } = edge;
      
      let t;
      const dx = tmpEnd.x - tmpStart.x;
      const dy = tmpEnd.y - tmpStart.y;
      
      if (isHorizontal) {
        // 水平边
        if (Math.abs(dy) < EPSILON) continue; // 平行于边
        t = (coord - tmpStart.y) / dy;
      } else {
        // 垂直边
        if (Math.abs(dx) < EPSILON) continue; // 平行于边
        t = (coord - tmpStart.x) / dx;
      }
      
      // 交点在线段上
      if (t >= 0 && t <= 1) {
        // 使用向量插值计算交点
        Vec2.lerp(_tempVec, tmpStart, tmpEnd, t);
        
        // 交点在边上
        if (isHorizontal) {
          if (_tempVec.x >= edgeStart - EPSILON && _tempVec.x <= edgeEnd + EPSILON) {
            allIntersections[j].push({
              x: _tempVec.x,
              y: _tempVec.y,
              isEndpoint: (t < EPSILON || Math.abs(t - 1) < EPSILON)
            });
          }
        } else {
          if (_tempVec.y >= edgeStart - EPSILON && _tempVec.y <= edgeEnd + EPSILON) {
            allIntersections[j].push({
              x: _tempVec.x,
              y: _tempVec.y,
              isEndpoint: (t < EPSILON || Math.abs(t - 1) < EPSILON)
            });
          }
        }
      }
    }
  }
  
  // 高效排序交点
  for (let i = 0; i < 4; i++) {
    const intersections = allIntersections[i];
    const isHorizontal = edges[i].isHorizontal;
    
    if (isHorizontal) {
      // 水平边按x排序
      intersections.sort((a, b) => a.x - b.x);
    } else {
      // 垂直边按y排序
      intersections.sort((a, b) => a.y - b.y);
    }
  }
  
  // 评估连续性
  const edgeContinuity = {};
  let totalContinuityScore = 0;
  let edgesWithIntersections = 0;
  
  for (let i = 0; i < 4; i++) {
    const edgeName = edges[i].name;
    const points = allIntersections[i];
    
    if (points.length < 2) {
      edgeContinuity[edgeName] = false;
      continue;
    }
    
    edgesWithIntersections++;
    
    // 优化分析交点间距的一致性
    const edge = edges[i];
    const isHorizontal = edge.isHorizontal;
    const edgeLength = edge.end - edge.start;
    
    // 预分配并高效计算间距
    const numDistances = points.length - 1;
    if (numDistances === 0) {
      edgeContinuity[edgeName] = false;
      continue;
    }
    
    // 单次循环计算总差距和间距数组
    let totalGaps = 0;
    const distances = new Array(numDistances);
    
    for (let j = 0; j < numDistances; j++) {
      const prev = points[j];
      const curr = points[j + 1];
      const distance = isHorizontal ? 
        Math.abs(curr.x - prev.x) : 
        Math.abs(curr.y - prev.y);
      
      distances[j] = distance;
      totalGaps += distance;
    }
    
    // 高效计算统计值
    const avgDistance = totalGaps / numDistances;
    
    // 单次循环计算方差
    let sumSquaredDiff = 0;
    for (let j = 0; j < numDistances; j++) {
      const diff = distances[j] - avgDistance;
      sumSquaredDiff += diff * diff;
    }
    
    const stdDev = Math.sqrt(sumSquaredDiff / numDistances);
    const cv = avgDistance > EPSILON ? stdDev / avgDistance : 1;
    
    // 计算边覆盖率
    const coverage = totalGaps / edgeLength;
    
    // 判断连续性
    const isDistanceConsistent = cv < 0.1;
    
    // 计算边的连续性分数
    const edgeScore = isDistanceConsistent ? 
      Math.min(1, coverage) * (1 - Math.min(1, cv)) : 
      0;
    
    totalContinuityScore += edgeScore;
    edgeContinuity[edgeName] = edgeScore > 0.8;
  }
  
  // 计算总体连续性分数
  const finalScore = edgesWithIntersections > 0 ? 
    totalContinuityScore / edgesWithIntersections : 
    0;
  
  // 总体连续性判断
  const isContinuous = finalScore > 0.8;
  
  // 生成详细描述 - 使用模板字符串优化
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
  const edgeNameMap = {
    top: "顶部", right: "右侧", bottom: "底部", left: "左侧"
  };
  
  for (const edge of edges) {
    const edgeName = edge.name;
    const isCont = edgeContinuity[edgeName];
    details += `${edgeNameMap[edgeName]}: ${isCont ? "连续" : "不连续"}; `;
  }
  
  // 回收线段对象到对象池
  recycleLines(lines);
  
  return {
    isContinuous,
    continuityScore: finalScore,
    edgeContinuity,
    details
  };
} 