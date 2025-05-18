/**
 * @module patCalculatorUltra
 * 极致性能版本的PAT图案计算模块，在patCalculatorOptimized基础上进一步极端优化
 */

// 常量和缓存 - 减少重复计算
const TWO_PI = 2 * Math.PI;
const TO_RADIANS = Math.PI / 180;
const TO_DEGREES = 180 / Math.PI;
const EPSILON = 1e-10;

// 特殊角度三角函数值预计算缓存
const COSINE_CACHE = new Float64Array(361); // 0-360度
const SINE_CACHE = new Float64Array(361);

// 初始化三角函数缓存
for (let angle = 0; angle <= 360; angle++) {
  const rad = angle * TO_RADIANS;
  COSINE_CACHE[angle] = Math.cos(rad);
  SINE_CACHE[angle] = Math.sin(rad);
}

// 预分配重用对象 - 减少垃圾回收
const _vec2 = {x: 0, y: 0};
const _vec2b = {x: 0, y: 0};
const _point1 = {x: 0, y: 0};
const _point2 = {x: 0, y: 0};
const _tempVec = {x: 0, y: 0};

// 线段端点对象池和初始容量
const _clippedLine = [0, 0, 0, 0];
const _linePool = [];
const _maxPoolSize = 5000; // 增加池大小以处理更复杂的图案

// 线段定义缓存 - 为了避免重复计算相同角度的线段
const _lineDefCache = new Map(); // 键为角度+delta组合, 值为预计算的方向向量等
const _maxCacheSize = 100; // 最多缓存100个不同的线段定义

/**
 * 高性能向量运算
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
  
  // 使用预计算的三角函数表进行旋转
  rotateByDegrees(vec, degrees) {
    // 规范化角度到0-360范围
    const normDegrees = Math.round(((degrees % 360) + 360) % 360);
    const cosVal = COSINE_CACHE[normDegrees];
    const sinVal = SINE_CACHE[normDegrees];
    
    const x = vec.x;
    const y = vec.y;
    vec.x = x * cosVal - y * sinVal;
    vec.y = x * sinVal + y * cosVal;
    return vec;
  },
  
  // 传统旋转，用于非整数角度
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
  
  // 使用位移批量创建平行向量
  createParallelVectors(baseX, baseY, dirX, dirY, perpDirX, perpDirY, count, stepDelta, horizDelta) {
    const results = new Array(count);
    
    // 初始位置
    let currentX = baseX;
    let currentY = baseY;
    
    for (let i = 0; i < count; i++) {
      // 创建一个新点而不是修改基础点
      results[i] = {x: currentX, y: currentY};
      
      // 位移到下一个位置
      currentX += perpDirX * stepDelta + dirX * horizDelta;
      currentY += perpDirY * stepDelta + dirY * horizDelta;
    }
    
    return results;
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
 * 获取或创建线段定义缓存
 * @param {number} angle - 角度（度）
 * @param {Array} delta - 增量数组 [dx, dy]
 * @param {number} rotationDegrees - 额外旋转角度
 * @returns {object} 缓存的线段定义
 */
function getOrCreateLineDef(angle, delta, rotationDegrees) {
  // 创建缓存键
  const cacheKey = `${angle}_${delta[0]}_${delta[1]}_${rotationDegrees}`;
  
  // 检查缓存
  if (_lineDefCache.has(cacheKey)) {
    return _lineDefCache.get(cacheKey);
  }
  
  // 如果缓存太大，删除一些旧条目
  if (_lineDefCache.size >= _maxCacheSize) {
    // 删除第一个条目（最旧的）
    const firstKey = _lineDefCache.keys().next().value;
    _lineDefCache.delete(firstKey);
  }
  
  // 计算总旋转角度（确保角度在0-360范围内）
  const totalAngle = ((angle + rotationDegrees) % 360 + 360) % 360;
  
  // 将角度转换为弧度
  const angleRad = totalAngle * TO_RADIANS;
  
  // 直接计算方向向量，不使用缓存表
  const dirX = Math.cos(angleRad);
  const dirY = Math.sin(angleRad);
  
  // 计算垂直方向向量
  const perpDirX = -dirY;
  const perpDirY = dirX;
  
  // 创建新的线段定义
  const lineDef = {
    dirX,
    dirY,
    perpDirX,
    perpDirY,
    deltaX: delta[0],
    deltaY: delta[1]
  };
  
  // 存入缓存
  _lineDefCache.set(cacheKey, lineDef);
  
  return lineDef;
}

/**
 * 从对象池获取线段对象
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
 * 计算PAT图案线条 - 极致优化版本
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

  // 预计算常用值
  const { minX, minY, maxX, maxY } = boundary;
  const boundaryDiagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const [offsetX, offsetY] = offset;
  
  // 扩展边界，确保捕获边缘线段
  // 使用边界对角线长度的一定比例作为扩展距离，确保足够大以覆盖边缘线段
  const boundaryExtend = Math.max(boundaryDiagonal * 0.1, 10); // 至少10个单位，或对角线的10%
  const extendedBoundary = {
    minX: minX - boundaryExtend,
    minY: minY - boundaryExtend,
    maxX: maxX + boundaryExtend,
    maxY: maxY + boundaryExtend
  };
  
  // 规范化旋转角度到0-360
  const normRotation = Math.round(((rotation % 360) + 360) % 360);
  
  // 估算结果数组容量，增加容量以确保不会漏掉线段
  const estimatedLines = parsedPatData.linesDefs.length * Math.ceil(boundaryDiagonal / 8);
  const allGeneratedLines = [];
  allGeneratedLines.capacity = Math.min(30000, estimatedLines);
  
  // 使用Map缓存已处理的线定义，避免重复计算
  const processedLines = new Map();
  
  // 处理每个线条定义
  for (let i = 0; i < parsedPatData.linesDefs.length; i++) {
    const lineDef = parsedPatData.linesDefs[i];
    const { angle, origin, delta, dashes } = lineDef;
    
    // 使用缓存中的预计算线段定义
    const cachedLineDef = getOrCreateLineDef(angle, delta, rotation);
    const { dirX, dirY, perpDirX, perpDirY, deltaX, deltaY } = cachedLineDef;
    
    // 生成标准化的虚线定义
    const scaledDashes = prepareScaledDashes(dashes, scale);
    
    // 使用向量对象表示原点并应用旋转和偏移
    Vec2.set(_vec2, origin[0] * scale, origin[1] * scale);
    
    // 应用整体图案旋转 - 确保与原始算法一致
    const rotationRad = rotation * TO_RADIANS;
    Vec2.rotate(_vec2, Math.sin(rotationRad), Math.cos(rotationRad));
    
    // 应用偏移
    Vec2.add(_vec2, offsetX, offsetY);
    
    // 提取旋转后的原点坐标
    const rotatedOriginX = _vec2.x;
    const rotatedOriginY = _vec2.y;
    
    // 如果deltaY接近0，只生成一条线
    if (Math.abs(deltaY * scale) < EPSILON) {
      generateSingleLine(
        rotatedOriginX, rotatedOriginY,
        dirX, dirY,
        scaledDashes,
        extendedBoundary, // 使用扩展边界
        boundaryDiagonal,
        allGeneratedLines
      );
      continue;
    }
    
    // 高效计算平行线族
    generateParallelLineFamily(
      rotatedOriginX, rotatedOriginY,
      dirX, dirY,
      perpDirX, perpDirY,
      deltaX * scale, deltaY * scale,
      scaledDashes,
      extendedBoundary, // 使用扩展边界
      boundaryDiagonal,
      centerX, centerY,
      allGeneratedLines
    );
  }
  
  // 过滤掉完全位于扩展区域的线段，只保留与原始边界相交的线段
  filterLinesByOriginalBoundary(allGeneratedLines, boundary);
  
  return allGeneratedLines;
}

/**
 * 过滤线段，确保只保留与原始边界相交的线段
 */
function filterLinesByOriginalBoundary(lines, originalBoundary) {
  // 放宽边界，确保边缘线段被保留
  const { minX, minY, maxX, maxY } = originalBoundary;
  const margin = Math.max((maxX - minX + maxY - minY) * 0.01, 1); // 使用更小的边距，避免过度放宽
  
  const relaxedBoundary = {
    minX: minX - margin,
    minY: minY - margin,
    maxX: maxX + margin,
    maxY: maxY + margin
  };
  
  // 检查线段是否与放宽边界相交
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const { start, end } = line;
    
    // 快速检查 - 任何端点在扩展边界内，保留
    if (pointInRect(start, relaxedBoundary) || pointInRect(end, relaxedBoundary)) {
      continue;
    }
    
    // 如果两个端点在边界外，检查线段是否穿过边界
    // 使用Cohen-Sutherland算法快速判断
    const startCode = computeOutCode(start, originalBoundary);
    const endCode = computeOutCode(end, originalBoundary);
    
    // 如果按位与为0，线段可能穿过边界
    if ((startCode & endCode) === 0) {
      continue;
    }
    
    // 额外检查 - 线段是否与边界相交
    if (segmentIntersectsRectangle(start, end, relaxedBoundary.minX, relaxedBoundary.minY, 
                                 relaxedBoundary.maxX, relaxedBoundary.maxY)) {
      continue;
    }
    
    // 确认线段确实不与边界相交，回收这个线段对象
    if (_linePool.length < _maxPoolSize) {
      _linePool.push(line);
    }
    
    // 从数组中移除
    lines.splice(i, 1);
  }
}

/**
 * 计算点相对于矩形的位置码（Cohen-Sutherland算法）
 */
function computeOutCode(point, rect) {
  const { minX, minY, maxX, maxY } = rect;
  let code = 0;
  
  if (point.x < minX) code |= 1; // 左
  else if (point.x > maxX) code |= 2; // 右
  if (point.y < minY) code |= 4; // 下
  else if (point.y > maxY) code |= 8; // 上
  
  return code;
}

/**
 * 判断点是否在矩形内
 */
function pointInRect(point, rect) {
  return point.x >= rect.minX && point.x <= rect.maxX && 
         point.y >= rect.minY && point.y <= rect.maxY;
}

/**
 * 判断线段是否与矩形相交 - 用于处理特殊情况
 */
function segmentIntersectsRectangle(start, end, minX, minY, maxX, maxY) {
  // 线段参数
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  // 检查线段是否与矩形的任意一条边相交
  
  // 左边界
  if (lineIntersectsSegment(minX, minY, minX, maxY, start, end)) {
    return true;
  }
  
  // 右边界
  if (lineIntersectsSegment(maxX, minY, maxX, maxY, start, end)) {
    return true;
  }
  
  // 下边界
  if (lineIntersectsSegment(minX, minY, maxX, minY, start, end)) {
    return true;
  }
  
  // 上边界
  if (lineIntersectsSegment(minX, maxY, maxX, maxY, start, end)) {
    return true;
  }
  
  return false;
}

/**
 * 判断两条线段是否相交
 */
function lineIntersectsSegment(x1, y1, x2, y2, seg1, seg2) {
  // 快速边界框测试
  if (Math.max(x1, x2) < Math.min(seg1.x, seg2.x) || 
      Math.min(x1, x2) > Math.max(seg1.x, seg2.x) ||
      Math.max(y1, y2) < Math.min(seg1.y, seg2.y) || 
      Math.min(y1, y2) > Math.max(seg1.y, seg2.y)) {
    return false;
  }
  
  // 计算叉积判断相交
  const dx1 = x2 - x1;
  const dy1 = y2 - y1;
  const dx2 = seg2.x - seg1.x;
  const dy2 = seg2.y - seg1.y;
  
  const denominator = dx1 * dy2 - dy1 * dx2;
  
  // 如果平行或共线
  if (Math.abs(denominator) < EPSILON) {
    // 共线情况下的重叠检测
    if (Math.abs(dx1) > Math.abs(dy1)) {
      // 水平性更强，使用x坐标判断
      const t1 = (seg1.x - x1) / dx1;
      const t2 = (seg2.x - x1) / dx1;
      return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || 
             (t1 <= 0 && t2 >= 1) || (t1 >= 1 && t2 <= 0);
    } else {
      // 垂直性更强，使用y坐标判断
      const t1 = (seg1.y - y1) / dy1;
      const t2 = (seg2.y - y1) / dy1;
      return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || 
             (t1 <= 0 && t2 >= 1) || (t1 >= 1 && t2 <= 0);
    }
  }
  
  // 计算交点参数
  const r = ((seg1.y - y1) * dx2 - (seg1.x - x1) * dy2) / denominator;
  const s = ((seg1.y - y1) * dx1 - (seg1.x - x1) * dy1) / denominator;
  
  // 如果参数都在[0,1]范围内，则相交
  return r >= 0 && r <= 1 && s >= 0 && s <= 1;
}

/**
 * 准备并缓存缩放后的虚线定义
 */
function prepareScaledDashes(dashes, scale) {
  if (!dashes || dashes.length === 0) {
    return null;
  }
  
  // 创建缓存键 - 使用数组内容和比例因子
  const cacheKey = dashes.join('_') + '_' + scale;
  
  // 使用WeakMap缓存虚线定义
  if (!prepareScaledDashes.cache) {
    prepareScaledDashes.cache = new Map();
  }
  
  // 从缓存获取
  if (prepareScaledDashes.cache.has(cacheKey)) {
    return prepareScaledDashes.cache.get(cacheKey);
  }
  
  // 创建新的缩放虚线定义
  const scaledDashes = new Float64Array(dashes.length);
  let patternLength = 0;
  
  for (let i = 0; i < dashes.length; i++) {
    const value = dashes[i] * scale;
    scaledDashes[i] = value;
    patternLength += Math.abs(value);
  }
  
  // 添加总长度信息，优化后续计算
  scaledDashes.totalLength = patternLength;
  
  // 如果缓存过大，清理一些
  if (prepareScaledDashes.cache.size > 100) {
    // 简单策略：清除整个缓存
    prepareScaledDashes.cache.clear();
  }
  
  // 存入缓存
  prepareScaledDashes.cache.set(cacheKey, scaledDashes);
  
  return scaledDashes;
}

/**
 * 生成平行线族 - 使用批处理优化
 */
function generateParallelLineFamily(
  originX, originY, dirX, dirY, perpDirX, perpDirY, 
  deltaX, deltaY, dashes, boundary, boundaryDiagonal, 
  centerX, centerY, resultArray
) {
  const { minX, minY, maxX, maxY } = boundary;
  const absDeltaY = Math.abs(deltaY);
  
  if (absDeltaY < EPSILON) {
    // 防止除零错误，如果deltaY接近0，直接生成一条线
    generateSingleLine(
      originX, originY,
      dirX, dirY,
      dashes,
      boundary,
      boundaryDiagonal,
      resultArray
    );
    return;
  }
  
  // 增加边界扩展系数，确保覆盖整个显示区域
  const boundaryExtendFactor = 2.0; // 增加到2.0以确保足够覆盖
  
  // 计算边界在垂直方向的投影 - 增加余量
  const perpProjection = Math.abs(
    (maxX - minX) * Math.abs(perpDirX) + 
    (maxY - minY) * Math.abs(perpDirY)
  ) * boundaryExtendFactor;
  
  // 增加平行线数量，确保充分覆盖
  const numLines = Math.ceil(perpProjection / absDeltaY) + 8; // 额外增加更多线条
  
  // 优化起始线位置计算
  const originPerpDistance = originX * perpDirX + originY * perpDirY;
  const centerPerpDistance = centerX * perpDirX + centerY * perpDirY;
  const centerToOriginLines = Math.round((centerPerpDistance - originPerpDistance) / deltaY);
  
  // 确定第一条线的索引，使其大致中心在边界中心
  // 这里和原patCalculator中完全一致
  const startLineIndex = -Math.floor(numLines / 2) + centerToOriginLines;
  
  // 不使用批量创建，直接逐行计算以确保与原始算法一致
  for (let j = 0; j < numLines; j++) {
    const lineIndex = startLineIndex + j;
    
    // 计算这条线的垂直偏移量
    const perpOffset = lineIndex * deltaY;
    
    // 计算水平偏移量（按照AutoCAD的规范）
    const horizOffset = lineIndex * deltaX;
    
    // 计算这条线的起始点
    const lineStartX = originX + perpOffset * perpDirX + horizOffset * dirX;
    const lineStartY = originY + perpOffset * perpDirY + horizOffset * dirY;
    
    // 生成这条线的所有线段
    generateSingleLine(
      lineStartX, lineStartY,
      dirX, dirY,
      dashes,
      boundary,
      boundaryDiagonal,
      resultArray
    );
  }
}

/**
 * 生成单条线并添加到结果数组 - 内联函数减少调用开销
 */
function generateSingleLine(startX, startY, dirX, dirY, dashes, boundary, boundaryDiagonal, resultArray) {
  // 连续线处理 (无虚线)
  if (!dashes || dashes.length === 0) {
    // 使用足够长的线段
    const lineLength = boundaryDiagonal * 2.5; // 增大长度确保覆盖整个边界
    
    // 计算端点 - 确保足够长以穿过整个边界
    Vec2.set(_point1, startX - dirX * lineLength, startY - dirY * lineLength);
    Vec2.set(_point2, startX + dirX * lineLength, startY + dirY * lineLength);
    
    // 裁剪前先检查方向向量是否有效
    if (Math.abs(dirX) < EPSILON && Math.abs(dirY) < EPSILON) {
      // 无效方向向量，跳过
      return;
    }
    
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
  
  // 虚线处理 - 批处理优化
  generateDashedLine(startX, startY, dirX, dirY, dashes, boundary, boundaryDiagonal, resultArray);
}

/**
 * 优化的虚线生成 - 使用位移代替重复计算
 */
function generateDashedLine(startX, startY, dirX, dirY, dashes, boundary, boundaryDiagonal, resultArray) {
  const extendedLength = boundaryDiagonal * 1.5;
  
  // 计算起始点 - 使用位移操作
  Vec2.set(_point1, startX - dirX * extendedLength, startY - dirY * extendedLength);
  
  // 获取总模式长度 - 从预计算中获取
  const patternLength = dashes.totalLength || 0;
  
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
  
  // 预先计算常用虚线段
  const dashesBatch = [];
  const dashCount = dashes.length;
  
  // 在循环外预先计算所有可能的虚线段位移
  for (let i = 0; i < dashCount; i++) {
    const dashLength = Math.abs(dashes[i]);
    dashesBatch.push({
      length: dashLength,
      isDraw: dashes[i] >= 0,
      // 预计算位移量
      offsetX: dirX * dashLength,
      offsetY: dirY * dashLength
    });
  }
  
  while (distanceTraveled < totalDistance) {
    const { length: dashLength, isDraw, offsetX, offsetY } = dashesBatch[dashIndex];
    
    if (isDraw) {
      // 计算线段终点 - 使用预计算的位移量
      const segmentEndX = currentX + offsetX;
      const segmentEndY = currentY + offsetY;
      
      // 设置端点
      Vec2.set(_point1, currentX, currentY);
      Vec2.set(_point2, segmentEndX, segmentEndY);
      
      // 裁剪线段 - 使用同一个裁剪结果数组减少内存分配
      if (clipLineFast(_point1, _point2, boundary, _clippedLine)) {
        const line = getLineFromPool();
        line.start.x = _clippedLine[0];
        line.start.y = _clippedLine[1];
        line.end.x = _clippedLine[2];
        line.end.y = _clippedLine[3];
        resultArray.push(line);
      }
    }
    
    // 更新当前位置 - 使用预计算的位移
    currentX += offsetX;
    currentY += offsetY;
    distanceTraveled += dashLength;
    
    // 快速循环虚线定义
    dashIndex = (dashIndex + 1) % dashCount;
  }
}

/**
 * 高性能线段裁剪 (基于Liang-Barsky算法) - 内联与展开优化
 */
function clipLineFast(p1, p2, boundary, result) {
  const { minX, minY, maxX, maxY } = boundary;
  
  // 为裁剪添加微小的容差，确保边缘线不会被错误裁剪
  // 太大的容差会导致实线被错误裁剪，使用更小的容差值
  const margin = EPSILON * 5; // 更合理的容差值
  const clipMinX = minX - margin;
  const clipMinY = minY - margin;
  const clipMaxX = maxX + margin;
  const clipMaxY = maxY + margin;
  
  // 线段方向向量
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  
  let tMin = 0;
  let tMax = 1;
  
  // 左边界测试
  if (Math.abs(dx) < EPSILON) {
    if (p1.x < clipMinX) return false;
  } else {
    const p = -dx;
    const q = p1.x - clipMinX;
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
    if (p1.x > clipMaxX) return false;
  } else {
    const p = dx;
    const q = clipMaxX - p1.x;
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
    if (p1.y < clipMinY) return false;
  } else {
    const p = -dy;
    const q = p1.y - clipMinY;
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
    if (p1.y > clipMaxY) return false;
  } else {
    const p = dy;
    const q = clipMaxY - p1.y;
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
  
  // 计算裁剪结果 - 直接使用预分配结果数组
  result[0] = p1.x + tMin * dx;
  result[1] = p1.y + tMin * dy;
  result[2] = p1.x + tMax * dx;
  result[3] = p1.y + tMax * dy;
  return true;
}

/**
 * 检查图案在当前设置下是否形成连续模式 - 极致优化版本
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
  
  // 数组形式的边界定义和预分配交点数组
  const edges = [
    { name: 'top', start: minX, end: maxX, isHorizontal: true, coord: maxY },
    { name: 'right', start: minY, end: maxY, isHorizontal: false, coord: maxX },
    { name: 'bottom', start: minX, end: maxX, isHorizontal: true, coord: minY },
    { name: 'left', start: minY, end: maxY, isHorizontal: false, coord: minX }
  ];
  
  // 使用TypedArray存储交点信息，减少内存开销
  const allIntersections = [[], [], [], []];
  
  // 向量对象重用
  const tmpStart = {x: 0, y: 0};
  const tmpEnd = {x: 0, y: 0};
  
  // 优化批量计算线段与边界的交点
  calculateBoundaryIntersections(lines, edges, allIntersections, tmpStart, tmpEnd);
  
  // 评估连续性
  const continuityResult = evaluateContinuity(edges, allIntersections);
  
  // 回收线段对象到对象池
  recycleLines(lines);
  
  return continuityResult;
}

/**
 * 批量计算线段与边界的交点 - 分离以便内联优化
 */
function calculateBoundaryIntersections(lines, edges, allIntersections, tmpStart, tmpEnd) {
  for (let i = 0; i < lines.length; i++) {
    const { start, end } = lines[i];
    
    // 复制到临时向量对象
    Vec2.copy(tmpStart, start);
    Vec2.copy(tmpEnd, end);
    
    for (let j = 0; j < 4; j++) {
      const edge = edges[j];
      const { isHorizontal, coord, start: edgeStart, end: edgeEnd } = edge;
      
      // 计算线段与边界的交点
      const dx = tmpEnd.x - tmpStart.x;
      const dy = tmpEnd.y - tmpStart.y;
      
      let t;
      
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
  
  // 对交点进行排序
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
}

/**
 * 评估连续性 - 分离以便内联优化
 */
function evaluateContinuity(edges, allIntersections) {
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
    
    // 优化间距计算
    const numDistances = points.length - 1;
    if (numDistances === 0) {
      edgeContinuity[edgeName] = false;
      continue;
    }
    
    // 单次循环计算总差距和间距
    let totalGaps = 0;
    let sumSquaredDiff = 0;
    let previousDistance = 0;
    const distances = new Float64Array(numDistances);
    
    // 第一遍：计算所有距离和总距离
    for (let j = 0; j < numDistances; j++) {
      const prev = points[j];
      const curr = points[j + 1];
      const distance = isHorizontal ? 
        Math.abs(curr.x - prev.x) : 
        Math.abs(curr.y - prev.y);
      
      distances[j] = distance;
      totalGaps += distance;
    }
    
    // 计算平均距离
    const avgDistance = totalGaps / numDistances;
    
    // 第二遍：计算方差
    for (let j = 0; j < numDistances; j++) {
      const diff = distances[j] - avgDistance;
      sumSquaredDiff += diff * diff;
    }
    
    const stdDev = Math.sqrt(sumSquaredDiff / numDistances);
    const cv = avgDistance > EPSILON ? stdDev / avgDistance : 1;
    
    // 计算边覆盖率
    const coverage = totalGaps / edgeLength;
    
    // 判断连续性和计算分数
    const isDistanceConsistent = cv < 0.1;
    const edgeScore = isDistanceConsistent ? 
      Math.min(1, coverage) * (1 - Math.min(1, cv)) : 
      0;
    
    totalContinuityScore += edgeScore;
    edgeContinuity[edgeName] = edgeScore > 0.8;
  }
  
  // 计算总体连续性分数和判断
  const finalScore = edgesWithIntersections > 0 ? 
    totalContinuityScore / edgesWithIntersections : 
    0;
  
  const isContinuous = finalScore > 0.8;
  
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
  const edgeNameMap = {
    top: "顶部", right: "右侧", bottom: "底部", left: "左侧"
  };
  
  for (const edge of edges) {
    const edgeName = edge.name;
    const isCont = edgeContinuity[edgeName];
    details += `${edgeNameMap[edgeName]}: ${isCont ? "连续" : "不连续"}; `;
  }
  
  return {
    isContinuous,
    continuityScore: finalScore,
    edgeContinuity,
    details
  };
} 