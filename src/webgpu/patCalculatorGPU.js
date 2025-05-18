/**
 * @module patCalculatorGPU
 * WebGPU加速版本的patCalculator
 * 提供与原patCalculator相同的API，但使用WebGPU加速几何线条的生成
 */

// WebGPU设备和上下文
let device = null;
let adapter = null;
let initialized = false;
// 添加一个着色器代码版本号，每次修改时更新此值，强制重新编译着色器
const SHADER_VERSION = "v1.5.0"; // 完全重构实现，直接匹配CPU版本的算法逻辑

/**
 * 初始化WebGPU设备
 * @returns {Promise<boolean>} 初始化是否成功
 */
export async function initWebGPU() {
  if (initialized) return true;
  
  if (!navigator.gpu) {
    console.error("当前浏览器不支持WebGPU");
    return false;
  }
  
  try {
    adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.error("无法获取WebGPU适配器");
      return false;
    }
    
    device = await adapter.requestDevice();
    initialized = true;
    console.debug(`WebGPU初始化成功，着色器版本: ${SHADER_VERSION} - 完全匹配CPU版本的算法`);
    return true;
  } catch (error) {
    console.error("WebGPU初始化失败:", error);
    return false;
  }
}

/**
 * 计算着色器代码 - 用于生成线条
 */
const computeShaderCode = `
struct LineDef {
  angle: f32,
  originX: f32,
  originY: f32,
  deltaX: f32,
  deltaY: f32,
  dashCount: u32, // 虚线段数量
}

// 虚线结构定义
struct Dash {
  length: f32, // 正值表示绘制线段，负值表示空白
}

struct Boundary {
  minX: f32,
  minY: f32,
  maxX: f32,
  maxY: f32,
}

struct Line {
  startX: f32,
  startY: f32,
  endX: f32,
  endY: f32,
  isValid: u32,
}

struct Config {
  scale: f32,
  rotationRad: f32,
  offsetX: f32,
  offsetY: f32,
  boundaryDiagonal: f32,
  lineCount: u32, // Represents the number of line definitions to process / output slots
}

// 定义常量，避免硬编码
const PI: f32 = 3.1415926535897932384626433832795;
const TWO_PI: f32 = 6.2831853071795864769252867665590;
const EPSILON: f32 = 1e-10;

@group(0) @binding(0) var<storage, read> lineDefs: array<LineDef>;
@group(0) @binding(1) var<storage, read> boundary: Boundary; 
@group(0) @binding(2) var<storage, read> config: Config;     
@group(0) @binding(3) var<storage, read_write> outputLines: array<Line>;
@group(0) @binding(4) var<storage, read> dashes: array<Dash>; // 虚线定义缓冲区

// 角度转弧度函数，精确计算
fn toRadians(degrees: f32) -> f32 {
  return degrees * (PI / 180.0);
}

// 裁剪线段 - Liang-Barsky算法，精确匹配CPU版本实现
fn clipLine(x1: f32, y1: f32, x2: f32, y2: f32, b: Boundary) -> Line {
  var result: Line;
  result.startX = x1;
  result.startY = y1;
  result.endX = x2;
  result.endY = y2;
  result.isValid = 0u; // 默认为无效
  
  // 线段方向向量
  let dx = x2 - x1;
  let dy = y2 - y1;
  
  // 对边界进行参数化
  var tMin: f32 = 0.0; // 入口参数，初始值为0
  var tMax: f32 = 1.0; // 出口参数，初始值为1
  
  // 左边界检查 - 与CPU版本保持一致
  let p1 = -dx;
  let q1 = x1 - b.minX;
  
  // 特别处理几乎平行于边界的情况
  if (abs(p1) < EPSILON) {
    // 线段平行于左边界，检查是否在边界外
    if (q1 < 0.0) { 
      // 线段在边界外，完全裁剪
      return result; 
    }
    // 否则这个边界不影响线段，继续检查其他边界
  } else {
    // 计算与边界的交点参数
    let t = q1 / p1;
    
    // 根据p的符号更新参数
    if (p1 < 0.0) { // 从外部进入边界
      tMin = max(tMin, t);
    } else { // 从内部离开边界
      tMax = min(tMax, t);
    }
    
    // 如果参数已经不合理，表示线段完全在边界外
    if (tMin > tMax) {
      return result;
    }
  }
  
  // 右边界检查 - 与CPU版本保持一致
  let p2 = dx;
  let q2 = b.maxX - x1;
  if (abs(p2) < EPSILON) {
    if (q2 < 0.0) { return result; }
  } else {
    let t = q2 / p2;
    if (p2 < 0.0) { tMin = max(tMin, t); } else { tMax = min(tMax, t); }
    if (tMin > tMax) { return result; }
  }
  
  // 下边界检查 - 与CPU版本保持一致
  let p3 = -dy;
  let q3 = y1 - b.minY;
  if (abs(p3) < EPSILON) {
    if (q3 < 0.0) { return result; }
  } else {
    let t = q3 / p3;
    if (p3 < 0.0) { tMin = max(tMin, t); } else { tMax = min(tMax, t); }
    if (tMin > tMax) { return result; }
  }
  
  // 上边界检查 - 与CPU版本保持一致
  let p4 = dy;
  let q4 = b.maxY - y1;
  if (abs(p4) < EPSILON) {
    if (q4 < 0.0) { return result; }
  } else {
    let t = q4 / p4;
    if (p4 < 0.0) { tMin = max(tMin, t); } else { tMax = min(tMax, t); }
    if (tMin > tMax) { return result; }
  }
  
  // 计算裁剪后的线段端点 - 确保与CPU版本一致
  result.startX = x1 + tMin * dx;
  result.startY = y1 + tMin * dy;
  result.endX = x1 + tMax * dx;
  result.endY = y1 + tMax * dy;
  result.isValid = 1u; // 设置为有效
  
  return result;
}

// 完全按照CPU实现重写的线条计算函数
fn computeLineFamily(lineDefIndex: u32, outputStartIndex: u32) -> u32 {
  // 获取线条定义和环境参数
  let lineDef = lineDefs[lineDefIndex];
  let b = boundary;
  let c = config;
  
  // 1. 读取基本参数并应用缩放
  let effectiveOriginX = lineDef.originX * c.scale;
  let effectiveOriginY = lineDef.originY * c.scale;
  let effectiveDeltaX = lineDef.deltaX * c.scale;
  let effectiveDeltaY = lineDef.deltaY * c.scale;
  
  // 2. 计算线条角度（弧度）= 线定义角度 + 图案整体旋转
  let angleRad = toRadians(lineDef.angle);
  let currentAngleRad = angleRad + c.rotationRad;
  
  // 3. 对角度进行归一化处理到[0, 2π)区间 - 与CPU版本保持一致
  // 在WGSL中，我们确保模运算与JS行为一致
  var normalizedAngleRad = currentAngleRad;
  while (normalizedAngleRad >= TWO_PI) {
    normalizedAngleRad -= TWO_PI;
  }
  while (normalizedAngleRad < 0.0) {
    normalizedAngleRad += TWO_PI;
  }
  
  // 4. 旋转原点坐标并应用整体偏移 - 修复旋转矩阵计算
  let sinRot = sin(c.rotationRad);
  let cosRot = cos(c.rotationRad);

  // 【关键修复】正确的旋转矩阵计算:
  // [x'] = [cos -sin] [x]
  // [y']   [sin  cos] [y]
  let rotatedOriginX = effectiveOriginX * cosRot - effectiveOriginY * sinRot + c.offsetX;
  let rotatedOriginY = effectiveOriginX * sinRot + effectiveOriginY * cosRot + c.offsetY;
  
  // 5. 计算线条方向单位向量 - 使用currentAngleRad计算
  let dirX = cos(currentAngleRad);
  let dirY = sin(currentAngleRad);
  
  // 6. 计算垂直于线条方向的单位向量（逆时针旋转90度）
  let perpDirX = -dirY;
  let perpDirY = dirX;
  
  // 7. 计算中心点坐标
  let centerX = (b.minX + b.maxX) / 2.0;
  let centerY = (b.minY + b.maxY) / 2.0;
  
  // 统计生成的线条数量
  var linesGenerated: u32 = 0u;
  
  // 设置线条长度，确保覆盖整个边界
  let lineLength = c.boundaryDiagonal * 2.0;
  
  // 【关键修改】完全匹配CPU版本: 当effectiveDeltaY接近0时，只生成一条线
  // CPU版本中：if (Math.abs(deltaY) < 1e-10) { ... continue; }
  if (abs(effectiveDeltaY) < EPSILON) {
    // 计算虚线起始索引
    var dashStartOffset: u32 = 0u;
    for (var i: u32 = 0u; i < lineDefIndex && i < 10u; i = i + 1u) {
      if (i < arrayLength(&lineDefs)) {
        dashStartOffset += lineDefs[i].dashCount;
      }
    }
    
    // 只生成一条线，完全匹配CPU的行为
    let newLines = generateDashedLine(
      rotatedOriginX, rotatedOriginY,
      dirX, dirY,
      lineDef,
      dashStartOffset,
      outputStartIndex,
      b,
      c,
      lineLength
    );
    
    return newLines; // 直接返回，不生成多条平行线
  }
  
  // 计算垂直投影长度 - 确保覆盖整个边界
  let perpProjection = abs(
    (b.maxX - b.minX) * abs(perpDirX) + 
    (b.maxY - b.minY) * abs(perpDirY)
  ) + abs(effectiveDeltaY); // 额外加一个effectiveDeltaY确保覆盖边界
  
  // 这里已经确保effectiveDeltaY不为0，可以安全计算
  // 计算需要的线条数量
  let numLines = u32(ceil(perpProjection / abs(effectiveDeltaY))) + 1u;
  
  // 确定原点在垂直方向上的投影
  let originPerpDistance = rotatedOriginX * perpDirX + rotatedOriginY * perpDirY;
  
  // 计算边界中心在垂直方向上的投影
  let centerPerpDistance = centerX * perpDirX + centerY * perpDirY;
  
  // 中心与原点的差距，以effectiveDeltaY为单位，四舍五入
  let centerToOriginLines = i32(round((centerPerpDistance - originPerpDistance) / effectiveDeltaY));
  
  // 确定第一条线的索引，使线大致中心在边界中心
  let startLineIndex = -i32(numLines / 2u) + centerToOriginLines;
  
  // 计算虚线段起始索引
  var dashStartOffset: u32 = 0u;
  for (var i: u32 = 0u; i < lineDefIndex && i < 10u; i = i + 1u) {
    if (i < arrayLength(&lineDefs)) {
      dashStartOffset += lineDefs[i].dashCount;
    }
  }
  
  // 生成每条平行线
  for (var i: u32 = 0u; i < numLines; i = i + 1u) {
    let lineIndex = startLineIndex + i32(i);
    
    // 计算垂直偏移量
    let perpOffset = f32(lineIndex) * effectiveDeltaY;
    
    // 计算水平偏移量
    let horizOffset = f32(lineIndex) * effectiveDeltaX;
    
    // 计算线起始点 - 同时应用垂直和水平偏移
    let lineStartX = rotatedOriginX + perpOffset * perpDirX + horizOffset * dirX;
    let lineStartY = rotatedOriginY + perpOffset * perpDirY + horizOffset * dirY;
    
    // 生成这条线
    let newLines = generateDashedLine(
      lineStartX, lineStartY,
      dirX, dirY,
      lineDef,
      dashStartOffset,
      outputStartIndex + linesGenerated,
      b,
      c,
      lineLength
    );
    
    linesGenerated += newLines;
  }
  
  return linesGenerated;
}

// 生成虚线段 - 重构以支持更复杂的虚线模式
fn generateDashedLine(
  startX: f32, startY: f32,     // 线的起始点
  dirX: f32, dirY: f32,         // 线的方向向量
  lineDef: LineDef,             // 线定义
  dashStartOffset: u32,         // 虚线数组起始偏移
  outputStartIdx: u32,          // 输出数组起始索引
  b: Boundary,                  // 边界
  c: Config,                    // 配置
  lineLength: f32               // 线的总长度
) -> u32 {
  // 如果没有虚线定义，则绘制连续线
  if (lineDef.dashCount == 0u) {
    // 生成一个从起点开始的、足够长的线段
    let p1x = startX - dirX * lineLength;
    let p1y = startY - dirY * lineLength;
    let p2x = startX + dirX * lineLength;
    let p2y = startY + dirY * lineLength;
    
    // 裁剪线段
    let clippedLine = clipLine(p1x, p1y, p2x, p2y, b);
    
    if (clippedLine.isValid != 0u) {
      outputLines[outputStartIdx] = clippedLine;
      return 1u;
    }
    
    return 0u;
  }
  
  // 虚线处理逻辑
  var linesGenerated: u32 = 0u;
  
  // 确保虚线数组索引在合理范围内
  let safeDashCount = min(lineDef.dashCount, 100u);
  let dashArrayLen = arrayLength(&dashes);
  let dashArrayEnd = min(dashStartOffset + safeDashCount, dashArrayLen);
  
  if (dashArrayEnd <= dashStartOffset) {
    // 没有有效的虚线定义
    return 0u;
  }
  
  // 计算虚线模式总长度
  var patternLength: f32 = 0.0;
  for (var i = dashStartOffset; i < dashArrayEnd; i = i + 1u) {
    patternLength += abs(dashes[i].length);
  }
  
  if (patternLength < EPSILON) {
    // 虚线模式总长度太小
    return 0u;
  }
  
  // 设置合理的线段生成上限
  let maxSegments = 102400u;
  var segmentCount = 0u;
  
  // 从CPU版本重构虚线生成逻辑
  // 首先确定一个起始点，使其位于边界外但不会太远
  // 使用与CPU版本一致的扩展长度计算
  let extendedLength = lineLength * 1.5;
  var currentX = startX - dirX * extendedLength;
  var currentY = startY - dirY * extendedLength;
  
  // 计算整个虚线模式的总长度 - 不在此处应用缩放
  var dashPatternLength: f32 = 0.0;
  for (var i = dashStartOffset; i < dashArrayEnd; i = i + 1u) {
    dashPatternLength += abs(dashes[i].length);
  }
  // 单独应用缩放
  dashPatternLength *= c.scale;
  
  if (dashPatternLength < EPSILON) {
    // 虚线模式总长度太小，使用默认值
    dashPatternLength = 1.0;
  }
  
  // 计算从扩展起点到原始起点的距离
  let distToStart = sqrt(
    pow(currentX - startX, 2.0) + 
    pow(currentY - startY, 2.0)
  );
  
  // 调整起点使其落在虚线周期的起始处
  let cyclesBeforeStart = floor(distToStart / dashPatternLength);
  let remainingDist = distToStart - (cyclesBeforeStart * dashPatternLength);
  
  // 前进remainingDist距离
  currentX += dirX * remainingDist;
  currentY += dirY * remainingDist;
  
  // 总计要走的距离是扩展边界的两倍长度
  let totalDistance = extendedLength * 2.0;
  var distanceTraveled: f32 = 0.0;
  
  // 重复应用虚线模式直到覆盖整个边界
  var dashIndex = dashStartOffset;
  
  // 设置足够大的迭代次数，确保能生成足够的线段
  let maxIterations = 10000u;
  
  // 直接按照CPU版本的单向遍历方式生成线段
  for (var i = 0u; i < maxIterations && distanceTraveled < totalDistance; i = i + 1u) {
    // 循环使用虚线定义
    if (dashIndex >= dashArrayEnd) {
      dashIndex = dashStartOffset;
    }
    
    // 获取当前虚线段长度 - 一步到位计算，避免重新赋值
    let dashLength = max(abs(dashes[dashIndex].length) * c.scale, 0.001); // 确保长度不为零
    let isDraw = dashes[dashIndex].length >= 0.0; // 正值表示画线
    
    // 如果是画线部分，则生成一个线段
    if (isDraw) {
      // 计算线段端点
      let segmentEndX = currentX + dirX * dashLength;
      let segmentEndY = currentY + dirY * dashLength;
      
      // 裁剪线段
      let clippedLine = clipLine(currentX, currentY, segmentEndX, segmentEndY, b);
      
      // 添加有效线段到结果
      if (clippedLine.isValid != 0u && outputStartIdx + linesGenerated < c.lineCount * 50u) {
        outputLines[outputStartIdx + linesGenerated] = clippedLine;
        linesGenerated = linesGenerated + 1u;
        segmentCount = segmentCount + 1u;
      }
    }
    
    // 移动到下一个位置
    currentX += dirX * dashLength;
    currentY += dirY * dashLength;
    distanceTraveled += dashLength;
    
    // 移动到下一个虚线定义
    dashIndex = dashIndex + 1u;
  }
  
  return linesGenerated;
}

// 计算两点间距离的平方，避免不必要的平方根计算
fn distanceSquared(x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
  let dx = x2 - x1;
  let dy = y2 - y1;
  return dx*dx + dy*dy;
}

// 计算每个线定义的线条 - 入口函数
fn computeContinuousLine(lineDefIndex: u32, outputStartIndex: u32) -> u32 {
  // 直接调用线条计算函数
  return computeLineFamily(lineDefIndex, outputStartIndex);
}

@compute @workgroup_size(64) // 工作组大小可以根据实际情况调整
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  // 获取当前线程索引
  let invocation_idx = global_id.x;
  
  // 确保不会处理超出范围的线条定义
  if (invocation_idx >= arrayLength(&lineDefs) || invocation_idx >= config.lineCount) {
    return;
  }
  
  // 为每个线条定义计算线条，并确保写入到正确的输出位置
  let lines_generated = computeContinuousLine(invocation_idx, invocation_idx * 8192u); 
}
`;

/**
 * 使用WebGPU加速计算PAT图案线条
 * 
 * @param {object} parsedPatData - 已解析的PAT数据
 * @param {object} boundary - 矩形边界
 * @param {number} scale - 缩放因子
 * @param {number} rotation - 旋转角度（度）
 * @param {Array<number>} offset - [x,y]偏移
 * @returns {Promise<Array<object>>} 生成的线段数组
 */
export async function computePatternLinesGPU(parsedPatData, boundary, scale = 1.0, rotation = 0.0, offset = [0, 0]) {
  // 添加版本信息和详细日志
  //console.debug(`WebGPU着色器版本: ${SHADER_VERSION}，开始计算...`);
  //console.debug(`输入: ${parsedPatData.linesDefs.length}条线定义, 缩放=${scale}, 旋转=${rotation}度, 偏移=[${offset}]`);
  
  // 打印每条线定义的关键信息，帮助调试
  parsedPatData.linesDefs.forEach((ld, index) => {
    // 添加重要输出，计算各个角度的sin和cos值，帮助定位问题
    const angle = ld.angle;
    const angleRad = angle * (Math.PI / 180);
    //console.debug(`线定义[${index}]: 角度=${angle}, 弧度=${angleRad.toFixed(4)}, `+
     // `sin=${Math.sin(angleRad).toFixed(4)}, cos=${Math.cos(angleRad).toFixed(4)}, `+
      //`原点=[${ld.origin}], delta=[${ld.delta}], 虚线数=${ld.dashes?.length || 0}`);
    
    // 检查关键的角度
    if (Math.abs(angle - 90) < 0.001 || Math.abs(angle - 270) < 0.001) {
      //console.debug(`发现垂直线! 索引=${index}, 角度=${angle}, 原点=${ld.origin}, delta=${ld.delta}`);
    } else if (Math.abs(angle - 0) < 0.001 || Math.abs(angle - 180) < 0.001) {
      //console.debug(`发现水平线! 索引=${index}, 角度=${angle}, 原点=${ld.origin}, delta=${ld.delta}`);
    } else if (Math.abs(angle - 60) < 0.001 || Math.abs(angle - 120) < 0.001) {
      //console.debug(`发现60/120度线! 索引=${index}, 角度=${angle}, 原点=${ld.origin}, delta=${ld.delta}`);
    }
  });
  
  if (!initialized) {
    const success = await initWebGPU();
    if (!success) {
      console.warn("WebGPU不可用，将回退到CPU版本计算");
      const { computePatternLines } = await import('../patCalculator.js');
      return computePatternLines(parsedPatData, boundary, scale, rotation, offset);
    }
  }
  
  if (!parsedPatData || !parsedPatData.linesDefs || !boundary) {
    console.warn("无效的输入数据或边界");
    return [];
  }
  
  const { linesDefs } = parsedPatData;
  const { minX, minY, maxX, maxY } = boundary;
  
  if (minX === undefined || minY === undefined || maxX === undefined || maxY === undefined ||
      minX >= maxX || minY >= maxY) {
    console.warn("无效的边界尺寸");
    return [];
  }
  
  const boundaryDiagonal = Math.sqrt(Math.pow(maxX - minX, 2) + Math.pow(maxY - minY, 2));
  
  // Prepare lineDefData (angle, originX, originY, deltaX, deltaY, dashCount)
  const lineDefFlatArray = [];
  for (const ld of linesDefs) {
    // 检查dashes是否存在，并确保dashCount是整数
    const dashCount = (ld.dashes && ld.dashes.length > 0) ? ld.dashes.length : 0;
    
    // 注意: WGSL对类型非常严格，确保数据格式正确
    lineDefFlatArray.push(
      ld.angle,        // angle: f32
      ld.origin[0],    // originX: f32
      ld.origin[1],    // originY: f32
      ld.delta[0],     // deltaX: f32
      ld.delta[1],     // deltaY: f32
      dashCount        // dashCount: u32 (整数)
    );
  }
  
  // 确保WGSL结构对齐：使用Uint32Array将dashCount强制为整数类型
  const lineDefData = new Float32Array(lineDefFlatArray);
  const lineDefDataView = new DataView(lineDefData.buffer);
  
  // 修复dashCount类型：每6个元素中的第6个应该是u32类型
  for (let i = 0; i < lineDefData.length; i += 6) {
    if (i + 5 < lineDefData.length) {
      // 将第6个元素(索引5)转换为u32类型
      const dashCountValue = Math.floor(lineDefData[i + 5]); // 确保是整数
      lineDefDataView.setUint32((i + 5) * 4, dashCountValue, true); // 小端字节序
    }
  }
  
  // 收集所有虚线定义
  const allDashes = [];
  for (const ld of linesDefs) {
    if (ld.dashes && ld.dashes.length > 0) {
      // 不在这里应用缩放，改为在着色器中统一处理
      for (const dash of ld.dashes) {
        allDashes.push(dash); // 原始值，不应用缩放
      }
    }
  }
  
  // 创建虚线缓冲区 - 不在这里应用缩放，而是在着色器中处理
  const dashData = new Float32Array(allDashes.length > 0 ? allDashes : [0]);

  // Number of line definitions to process
  const numLineDefsToProcess = linesDefs.length;
  if (numLineDefsToProcess === 0) return [];
  
  // 打印调试信息 - 显示输入数据的详细信息
  ////console.debug(`创建WebGPU缓冲区，角度数据:`);
  for (let i = 0; i < lineDefData.length; i += 6) {
    if (i + 5 < lineDefData.length) {
      //console.debug(`线定义[${i/6}]: 角度=${lineDefData[i]}, 原点=[${lineDefData[i+1]},${lineDefData[i+2]}], delta=[${lineDefData[i+3]},${lineDefData[i+4]}], 虚线数=${lineDefDataView.getUint32((i+5)*4, true)}`);
    }
  }
  
  // 创建线定义缓冲区
  const lineDefBuffer = device.createBuffer({
    // 每个LineDef有6个元素，每个元素4字节
    size: Math.max(24, lineDefData.byteLength), // Minimum 6 floats * 4 bytes/float = 24 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint8Array(lineDefBuffer.getMappedRange()).set(new Uint8Array(lineDefData.buffer));
  lineDefBuffer.unmap();

  // 创建虚线缓冲区
  const dashBuffer = device.createBuffer({
    size: Math.max(4, dashData.byteLength), // 至少一个float
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(dashBuffer.getMappedRange()).set(dashData);
  dashBuffer.unmap();
  
  const boundaryBuffer = device.createBuffer({
    size: 4 * Float32Array.BYTES_PER_ELEMENT, // 16 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(boundaryBuffer.getMappedRange()).set([minX, minY, maxX, maxY]);
  boundaryBuffer.unmap();

  const configBuffer = device.createBuffer({
    size: 6 * Float32Array.BYTES_PER_ELEMENT, // 24 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(configBuffer.getMappedRange()).set([
    scale,
    rotation * (Math.PI / 180.0),
    offset[0],
    offset[1],
    boundaryDiagonal,
    numLineDefsToProcess // lineCount in shader now means number of line defs
  ]);
  configBuffer.unmap();

  // 估算最大可能的线段数量
  const maxLinesPerDef = 8192;
  const maxPossibleLines = numLineDefsToProcess * maxLinesPerDef;
  
  // Output buffer size based on the number of possible output lines
  const outputBufferSize = Math.max(20, maxPossibleLines * 5 * Float32Array.BYTES_PER_ELEMENT); 
  //console.debug(`WebGPU: 创建输出缓冲区大小: ${outputBufferSize} 字节，最多可存储 ${maxPossibleLines} 条线段`);
  
  const outputBuffer = device.createBuffer({
    size: outputBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const resultBuffer = device.createBuffer({
    size: outputBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const computeShaderModule = device.createShaderModule({ code: computeShaderCode });

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: computeShaderModule,
      entryPoint: 'main',
    },
  });

  const bindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: lineDefBuffer } },
      { binding: 1, resource: { buffer: boundaryBuffer } },
      { binding: 2, resource: { buffer: configBuffer } },
      { binding: 3, resource: { buffer: outputBuffer } },
      { binding: 4, resource: { buffer: dashBuffer } },  // 添加虚线缓冲区绑定
    ],
  });

  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(computePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  
  const workgroupSize = 64; // Match shader's workgroup_size
  const numWorkgroups = Math.ceil(numLineDefsToProcess / workgroupSize);
  passEncoder.dispatchWorkgroups(numWorkgroups);
  passEncoder.end();

  commandEncoder.copyBufferToBuffer(outputBuffer, 0, resultBuffer, 0, outputBufferSize);
  
  device.queue.submit([commandEncoder.finish()]);

  await resultBuffer.mapAsync(GPUMapMode.READ);
  const resultData = new Float32Array(resultBuffer.getMappedRange().slice(0)); // Slice to make a copy
  resultBuffer.unmap();

  const lines = [];
  
  // 调试信息
  //console.debug(`WebGPU计算开始: ${numLineDefsToProcess}条线定义，缩放=${scale}, 旋转=${rotation}度, 偏移=[${offset}]`);
  //console.debug(`GPU计算完成，处理了 ${numLineDefsToProcess} 条线段定义`);
  //console.debug(`数据缓冲区长度: ${resultData.length}`);
  
  // 检查是否有太多线条都有effectiveDeltaY接近0的情况
  let zeroEffectiveDeltaY = 0;
  for (const ld of linesDefs) {
    if (Math.abs(ld.delta[1] * scale) < 1e-10) {
      zeroEffectiveDeltaY++;
      // 详细记录这些线定义的信息
      //console.debug(`线定义delta[1]接近0: 角度=${ld.angle}, delta=[${ld.delta}], 有效delta=[${ld.delta[0]*scale}, ${ld.delta[1]*scale}]`);
    }
  }
  if (zeroEffectiveDeltaY > 0) {
    //console.debug(`注意: ${zeroEffectiveDeltaY}/${linesDefs.length}条线定义的effectiveDeltaY接近零`);
  }
  
  // 解析结果数据，每5个浮点数表示一个线段
  // 因为我们不知道每个线定义生成了多少条线，所以需要遍历整个结果缓冲区
  // 有效线段会将isValid标志设置为非零值
  const maxOutputLines = Math.floor(resultData.length / 5);
  
  for (let i = 0; i < maxOutputLines; i++) {
    const baseIdx = i * 5;
    
    // 确保我们不会越界
    if (baseIdx + 4 >= resultData.length) break;
    
    // 检查isValid标志（第5个元素）- 精确匹配CPU版本的结果格式
    if (resultData[baseIdx + 4] !== 0) { 
      // 确保数据不是NaN或Infinity
      if (isFinite(resultData[baseIdx]) && 
          isFinite(resultData[baseIdx + 1]) && 
          isFinite(resultData[baseIdx + 2]) && 
          isFinite(resultData[baseIdx + 3])) {
        
        // CPU版本返回的格式: { start: {x, y}, end: {x, y} }
        lines.push({
          start: { 
            x: Number(resultData[baseIdx]), 
            y: Number(resultData[baseIdx + 1]) 
          },
          end: { 
            x: Number(resultData[baseIdx + 2]), 
            y: Number(resultData[baseIdx + 3]) 
          }
        });
      }
    }
  }
  
  //console.debug(`GPU计算生成了 ${lines.length} 条有效线段`);
  
  // 添加更详细的诊断信息
  if (lines.length === 0) {
    //console.debug("诊断信息: 未生成线段，检查原始输出数据...");
    
    // 检查结果缓冲区中是否有任何数据
    let hasAnyValidData = false;
    let hasNonZeroValues = false;
    
    // 检查前100组数据
    for (let i = 0; i < Math.min(100 * 5, resultData.length); i += 5) {
      if (i + 4 < resultData.length) {
        // 检查是否有标记为有效的线段
        if (resultData[i + 4] !== 0) {
          hasAnyValidData = true;
          //console.debug(`找到有效标记的线段数据 [${i/5}]: [${resultData[i]}, ${resultData[i+1]}, ${resultData[i+2]}, ${resultData[i+3]}, ${resultData[i+4]}]`);
        }
        
        // 检查是否有非零坐标（即使标记为无效）
        const EPSILON = 1e-6; // 数值比较容差
        if (Math.abs(resultData[i]) > EPSILON || 
            Math.abs(resultData[i+1]) > EPSILON || 
            Math.abs(resultData[i+2]) > EPSILON || 
            Math.abs(resultData[i+3]) > EPSILON) {
          hasNonZeroValues = true;
          //console.debug(`找到非零坐标(但可能无效)线段数据 [${i/5}]: [${resultData[i]}, ${resultData[i+1]}, ${resultData[i+2]}, ${resultData[i+3]}, ${resultData[i+4]}]`);
        }
      }
    }
    
    if (!hasAnyValidData) {
      //console.debug("结果中没有找到有效标记的线段数据，clipLine函数可能将所有线段标记为无效");
      
      if (!hasNonZeroValues) {
        //console.debug("结果中所有坐标均为零，着色器可能没有正确执行或生成线段");
      } else {
        //console.debug("有非零坐标但全部被标记为无效，检查clipLine函数的实现");
      }
    }
    
    // 诊断边界值
    //console.debug(`边界值: minX=${minX}, minY=${minY}, maxX=${maxX}, maxY=${maxY}, 缩放=${scale}`);
  }
  
  // 在返回结果前，添加结果摘要
  //console.debug(`GPU生成了${lines.length}条线段，详细信息:`);
  if (lines.length > 0) {
    // 输出一些线段示例
    //console.debug(`示例线段[0]: 起点=(${lines[0].start.x}, ${lines[0].start.y}), 终点=(${lines[0].end.x}, ${lines[0].end.y})`);
    if (lines.length > 1) {
      //console.debug(`示例线段[${lines.length-1}]: 起点=(${lines[lines.length-1].start.x}, ${lines[lines.length-1].start.y}), 终点=(${lines[lines.length-1].end.x}, ${lines[lines.length-1].end.y})`);
    }
  } else {
    //console.warn("GPU没有生成任何线段! 检查输入数据和着色器实现");
  }
  
  return lines;
}

/**
 * 使用WebGPU加速检查PAT图案连续性
 * (注意: 当前实现仅为统一API, 内部仍使用CPU计算连续性)
 * 
 * @param {object} parsedPatData - 已解析的PAT数据
 * @param {object} boundary - 矩形边界
 * @param {number} scale - 缩放因子
 * @param {number} rotation - 旋转角度（度）
 * @param {Array<number>} offset - [x,y]偏移
 * @returns {Promise<object>} 包含连续性评估结果的对象
 */
export async function checkPatternContinuityGPU(parsedPatData, boundary, scale = 1.0, rotation = 0.0, offset = [0, 0]) {
  // 暂时使用CPU版本的实现，未来可以重构为GPU版本
  const { checkPatternContinuity } = await import('../patCalculator.js');
  return checkPatternContinuity(parsedPatData, boundary, scale, rotation, offset);
}

// 重命名的API，与原始patCalculator保持一致
export { computePatternLinesGPU as computePatternLines, checkPatternContinuityGPU as checkPatternContinuity }; 