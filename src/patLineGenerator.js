/**
 * @file patLineGenerator.js
 * @description 负责根据解析后的 PAT 数据生成图案线条表示, 支持在指定预览框内生成并分组线条。
 */

/**
 * @typedef {object} ParsedPatData 从 patParser.js 解析得到的 PAT 文件数据。
 * @property {string} name 图案名称。
 * @property {Array<PatLineDefinition>} linesDefs PAT 文件中的线条定义数组。
 * @property {string} [description] 图案描述。
 * @property {string} [error] 解析阶段的错误信息。
 */

/**
 * @typedef {object} PatLineDefinition 单条 PAT 线条定义。
 * @property {number} angle 线条家族的角度 (度)。
 * @property {Array<number>} origin 线条家族中第一条线的起始点 [x, y]。
 * @property {Array<number>} delta 定义线条重复或虚线组重复的偏移 [dx, dy]。
 *   dx: 沿线方向的偏移。dy: 垂直于线方向的偏移 (用于平行线)。
 * @property {Array<number>} dashes 虚线模式数组 [画, 空, 画, 空, ...]。正数表示绘制，负数表示抬笔，0表示点。
 */

/**
 * @typedef {object} PreviewBox 定义线条生成的预览区域。
 * @property {number} x 预览区域左上角的 x 坐标 (PAT 单位)。
 * @property {number} y 预览区域左上角的 y 坐标 (PAT 单位)。
 * @property {number} width 预览区域的宽度 (PAT 单位)。
 * @property {number} height 预览区域的高度 (PAT 单位)。
 */

/**
 * @typedef {object} UVScale UV 坐标的缩放因子。
 * @property {number} [width=1] UV 宽度的缩放。
 * @property {number} [height=1] UV 高度的缩放。
 */

/**
 * @typedef {object} LineSegment 表示一条线段。
 * @property {number} x1 起点 x 坐标。
 * @property {number} y1 起点 y 坐标。
 * @property {number} x2 终点 x 坐标。
 * @property {number} y2 终点 y 坐标。
 */

/**
 * @typedef {object} LineGroup 表示一组相关的线条。
 * @property {string} name 线条组的名称 (例如，来自哪条规则)。
 * @property {Array<LineSegment>} lines 该组包含的线段数组 (通常已归一化到 UV 坐标)。
 * @property {number} lineWidth 该组线条的宽度。
 * @property {PatLineDefinition} originalRule 该线条组对应的原始 PAT 规则定义。
 * @property {string} [error] 生成该组线条时发生的警告或错误。
 */

/**
 * @typedef {object} PatternPresentation 图案的最终可视化表示。
 * @property {Array<LineGroup>} lineGroups 包含所有线条组的数组。
 * @property {number} aspectRatio 预览区域的宽高比 (previewBox.width / previewBox.height)。
 * @property {string} [error] 生成整个图案过程中发生的全局性错误或重要警告。
 */

/**
 * 主要入口函数：根据解析后的 PAT 数据和指定的预览参数生成图案的可视化表示。
 * 每条 PAT 规则生成的线条将被分别编组。
 *
 * @param {object} params - 参数对象。
 * @param {ParsedPatData} params._parsedPatData - 解析后的 PAT 数据。
 * @param {PreviewBox} params.previewBox - 定义线条生成的预览区域和最终归一化参照。
 * @param {UVScale} [params.uvScale={width:1, height:1}] - UV 坐标的最终缩放。
 * @param {number} [params.defaultLineWidth=0.005] - 默认线条宽度 (相对于预览区域较短边)。
 * @param {number} [params.maxTotalGeneratedLines=20000] - 所有规则生成的总线条数上限。
 * @param {string} [params.basePatName="pat_import"] - 生成线条组的基础名称。
 * @returns {PatternPresentation} 生成的图案表示对象。
 */
export function generatePatternPresentation(params) {
  const {
    _parsedPatData,
    previewBox,
    uvScale = { width: 1, height: 1 },
    defaultLineWidth = 0.005,
    maxTotalGeneratedLines = 20000,
    basePatName = "pat_import",
  } = params;

  if (!_parsedPatData || !_parsedPatData.linesDefs || _parsedPatData.linesDefs.length === 0) {
    const errorMsg = _parsedPatData?.error || "PAT 数据无效或无任何线条定义。";
    return {
      lineGroups: [],
      aspectRatio: previewBox && previewBox.width > 0 && previewBox.height > 0 ? previewBox.width / previewBox.height : 1,
      error: errorMsg,
    };
  }

  const allLineGroups = [];
  let totalLinesCurrentlyGenerated = 0;
  let overallErrorMessage = _parsedPatData.error ? _parsedPatData.error + "; " : "";

  const lineDefinitions = _parsedPatData.linesDefs;

  for (let i = 0; i < lineDefinitions.length; i++) {
    if (totalLinesCurrentlyGenerated >= maxTotalGeneratedLines) {
      overallErrorMessage += `已达到总线条数上限 (${maxTotalGeneratedLines})，部分规则可能未处理。`;
      break;
    }

    const ruleDef = lineDefinitions[i];
    // 预估单条规则允许生成的最大线条数，可以根据总上限和剩余规则数动态调整
    // 简单平均分配，至少为100条，或根据剩余额度计算
    const remainingRules = lineDefinitions.length - i;
    const estimatedMaxLinesForRule = Math.max(100, Math.floor((maxTotalGeneratedLines - totalLinesCurrentlyGenerated) / remainingRules));
    
    const groupName = `${basePatName}_rule_${i + 1}`;
    
    const ruleResult = generateLinesForRuleInPreview({
      ruleDef,
      previewBox,
      maxLinesLimitForRule: estimatedMaxLinesForRule,
      ruleIndex: i
    });

    if (ruleResult.lines && ruleResult.lines.length > 0) {
      // 在这里进行归一化处理
      const normalizedLines = normalizeLineCoordinates(ruleResult.lines, previewBox, uvScale);
      allLineGroups.push({
        name: groupName,
        lines: normalizedLines,
        lineWidth: defaultLineWidth, // TODO: Consider if lineWidth can be per-rule
        originalRule: ruleDef,
        error: ruleResult.error,
      });
      totalLinesCurrentlyGenerated += ruleResult.lines.length;
    } else if (ruleResult.error) {
      // 即使没有线条，也可能产生错误/警告信息
       allLineGroups.push({
        name: groupName,
        lines: [],
        lineWidth: defaultLineWidth,
        originalRule: ruleDef,
        error: ruleResult.error,
      });
    }
  }
  
  if (totalLinesCurrentlyGenerated === 0 && allLineGroups.every(group => group.lines.length === 0) && !overallErrorMessage && !(_parsedPatData.error) ) {
      overallErrorMessage += "根据 PAT 定义和预览范围，未生成任何线条。";
  }


  return {
    lineGroups: allLineGroups,
    aspectRatio: previewBox.width / previewBox.height,
    error: overallErrorMessage || undefined, // 确保 error 字段在没有错误时为 undefined
  };
}

/**
 * 为单条 PAT 规则，在指定的预览框内生成线条。
 * 此函数负责核心的几何计算，线条坐标基于 PAT 文件的原始坐标系。
 *
 * @param {object} params - 参数。
 * @param {PatLineDefinition} params.ruleDef - 单条 PAT 线条定义。
 * @param {PreviewBox} params.previewBox - 预览区域。
 * @param {number} params.maxLinesLimitForRule - 此规则允许生成的最大线条数。
 * @param {number} params.ruleIndex - 当前规则的索引，用于生成唯一ID或名称。
 * @returns {{lines: Array<LineSegment>, error?: string, linesGeneratedCount: number}} 包含原始坐标线条和潜在错误的对象。
 */
function generateLinesForRuleInPreview({ ruleDef, previewBox, maxLinesLimitForRule, ruleIndex }) {
  const { angle, origin, delta, dashes } = ruleDef;
  let linesInRule = [];
  let linesGeneratedCount = 0;
  let ruleSpecificError = null;

  const angleRad = angle * Math.PI / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  const patOriginX = origin[0];
  const patOriginY = origin[1];
  const deltaX = delta[0];
  const deltaY = delta[1];

  const tempMaxRenderDimForALine = Math.max(previewBox.width, previewBox.height) * 2;

  let pStepsMin = 0;
  let pStepsMax = 0;

  if (Math.abs(deltaY) > 1e-9) {
    const corners = [
      { x: previewBox.x, y: previewBox.y },
      { x: previewBox.x + previewBox.width, y: previewBox.y },
      { x: previewBox.x, y: previewBox.y + previewBox.height },
      { x: previewBox.x + previewBox.width, y: previewBox.y + previewBox.height },
    ];
    let minPerpProjection = Infinity;
    let maxPerpProjection = -Infinity;
    corners.forEach(corner => {
      const relX = corner.x - patOriginX;
      const relY = corner.y - patOriginY;
      const projection = -relX * sinA + relY * cosA;
      minPerpProjection = Math.min(minPerpProjection, projection);
      maxPerpProjection = Math.max(maxPerpProjection, projection);
    });
    pStepsMin = Math.floor(minPerpProjection / deltaY) - 1;
    pStepsMax = Math.ceil(maxPerpProjection / deltaY) + 1;
  }

  for (let pStep = pStepsMin; pStep <= pStepsMax; pStep++) {
    if (linesGeneratedCount >= maxLinesLimitForRule) {
      ruleSpecificError = `规则 ${ruleIndex + 1} 已达到线条上限 (${maxLinesLimitForRule})，可能不完整。`;
      break;
    }

    const lineFamilyBaseOriginX = patOriginX - pStep * deltaY * sinA;
    const lineFamilyBaseOriginY = patOriginY + pStep * deltaY * cosA;

    const lineProcessingParams = {
      lineFamilyBaseOriginX,
      lineFamilyBaseOriginY,
      angleRad, // Though cosA/sinA are used directly, angleRad might be useful for clarity or future use
      cosA,
      sinA,
      dashes,
      deltaX,
      previewBox,
      maxLinesLimitForRule, // Pass the rule-specific limit
      currentLinesGenerated: linesGeneratedCount, // Pass current count for this rule
      tempMaxRenderDimForALine, // For "infinite" line calculations
      ruleIndex // For error messaging if needed inside deeper functions
    };

    const { generatedSegments, linesAdded, error } = processSingleParallelLine(lineProcessingParams);
    
    if (generatedSegments && generatedSegments.length > 0) {
      linesInRule.push(...generatedSegments);
    }
    linesGeneratedCount += linesAdded;
    if (error && !ruleSpecificError) { // Prioritize earlier errors or combine them
        ruleSpecificError = error;
    }


    if (linesGeneratedCount >= maxLinesLimitForRule && !ruleSpecificError) {
      ruleSpecificError = `规则 ${ruleIndex + 1} (pStep: ${pStep}) 已达到线条上限 (${maxLinesLimitForRule})，可能不完整。`;
    }
  }

  return { lines: linesInRule, error: ruleSpecificError, linesGeneratedCount };
}

/**
 * 处理单条平行线的线段生成（实线或虚线）。
 * @param {object} params - 参数对象。
 * @param {number} params.lineFamilyBaseOriginX - 当前平行线的基准X原点。
 * @param {number} params.lineFamilyBaseOriginY - 当前平行线的基准Y原点。
 * @param {number} params.cosA - 线条角度的余弦值。
 * @param {number} params.sinA - 线条角度的正弦值。
 * @param {Array<number>|null} params.dashes - 虚线模式数组。
 * @param {number} params.deltaX - 沿线方向的偏移。
 * @param {PreviewBox} params.previewBox - 预览区域。
 * @param {number} params.maxLinesLimitForRule - 此规则允许生成的最大线条数。
 * @param {number} params.currentLinesGenerated - 当前规则已生成的线条数。
 * @param {number} params.tempMaxRenderDimForALine - 用于无限长线计算的辅助尺寸。
 * @param {number} params.ruleIndex - 当前规则索引。
 * @returns {{generatedSegments: Array<LineSegment>, linesAdded: number, error?: string}}
 */
function processSingleParallelLine({
  lineFamilyBaseOriginX,
  lineFamilyBaseOriginY,
  cosA,
  sinA,
  dashes,
  deltaX,
  previewBox,
  maxLinesLimitForRule,
  currentLinesGenerated,
  tempMaxRenderDimForALine,
  ruleIndex
}) {
  let generatedSegments = [];
  let linesAdded = 0;
  let error = null;

  if (!dashes || dashes.length === 0) { // 实线
    const solidLineParams = {
      lineFamilyBaseOriginX,
      lineFamilyBaseOriginY,
      cosA,
      sinA,
      deltaX,
      previewBox,
      tempMaxRenderDimForALine
    };
    const segment = generateSolidSegmentForLine(solidLineParams);
    if (segment) {
      if (currentLinesGenerated + linesAdded < maxLinesLimitForRule) {
        generatedSegments.push(segment);
        linesAdded++;
      } else {
        error = `规则 ${ruleIndex + 1} 在生成实线时达到上限。`;
      }
    }
  } else { // 虚线
    const dashedLineParams = {
      lineFamilyBaseOriginX,
      lineFamilyBaseOriginY,
      cosA,
      sinA,
      dashes,
      deltaX,
      previewBox,
      maxLinesLimitForRule,
      currentLinesGenerated, // Start counting from what's already there for this rule
      tempMaxRenderDimForALine,
      ruleIndex
    };
    const result = generateDashedSegmentsForLine(dashedLineParams);
    if (result.segments.length > 0) {
      generatedSegments.push(...result.segments);
    }
    linesAdded += result.linesAdded; // accumulate lines added from dashing
    if (result.error && !error) {
        error = result.error;
    }
  }
  return { generatedSegments, linesAdded, error };
}

/**
 * 为单条平行线生成实线段（有限长或"无限长"裁剪后）。
 * @param {object} params - 参数对象。
 * @returns {LineSegment | null}
 */
function generateSolidSegmentForLine({
  lineFamilyBaseOriginX,
  lineFamilyBaseOriginY,
  cosA,
  sinA,
  deltaX,
  previewBox,
  tempMaxRenderDimForALine
}) {
  let x1, y1, x2, y2;
  if (Math.abs(deltaX) > 1e-9) { // 有限长度实线段
    x1 = lineFamilyBaseOriginX;
    y1 = lineFamilyBaseOriginY;
    x2 = lineFamilyBaseOriginX + deltaX * cosA;
    y2 = lineFamilyBaseOriginY + deltaX * sinA;
  } else { // "无限长"实线 (deltaX 为 0)
    x1 = lineFamilyBaseOriginX - cosA * tempMaxRenderDimForALine;
    y1 = lineFamilyBaseOriginY - sinA * tempMaxRenderDimForALine;
    x2 = lineFamilyBaseOriginX + cosA * tempMaxRenderDimForALine;
    y2 = lineFamilyBaseOriginY + sinA * tempMaxRenderDimForALine;
  }
  return clipLineSegmentToRect({ x1, y1, x2, y2 }, previewBox);
}

/**
 * 为单条平行线生成虚线段。
 * @param {object} params - 参数对象。
 * @returns {{segments: Array<LineSegment>, linesAdded: number, error?: string}}
 */
function generateDashedSegmentsForLine({
  lineFamilyBaseOriginX,
  lineFamilyBaseOriginY,
  cosA,
  sinA,
  dashes,
  deltaX,
  previewBox,
  maxLinesLimitForRule,
  currentLinesGenerated,
  tempMaxRenderDimForALine,
  ruleIndex
}) {
  const segments = [];
  let linesAdded = 0;
  let error = null;

  const dashPatternTotalLength = dashes.reduce((sum, d) => sum + Math.abs(d), 0);
  if (dashPatternTotalLength < 1e-9 && !(dashes.length === 1 && dashes[0] === 0)) {
    return { segments, linesAdded, error: `规则 ${ruleIndex + 1} 虚线模式无效 (总长为0且非单点)。` };
  }

  // TODO: 精确计算 lineStartLimit 和 lineEndLimit，通过将 previewBox 投影到线上
  // For now, using a large extent and then clipping each dash segment.
  let lineStartLimit = -tempMaxRenderDimForALine;
  let lineEndLimit = tempMaxRenderDimForALine;

  if (Math.abs(deltaX) < 1e-6) { // Case 1: deltaX is zero, dashes repeat along the line
    let currentPosOnLine = lineStartLimit;
    while (currentPosOnLine < lineEndLimit) {
      if (currentLinesGenerated + linesAdded >= maxLinesLimitForRule) {
        error = `规则 ${ruleIndex + 1} 生成虚线时达到上限 (沿线重复)。`;
        break;
      }
      for (const dashVal of dashes) {
        if (currentLinesGenerated + linesAdded >= maxLinesLimitForRule) break;
        if (currentPosOnLine >= lineEndLimit && dashVal > 0) break;

        const absDashLength = Math.abs(dashVal);
        const dashStartX = lineFamilyBaseOriginX + currentPosOnLine * cosA;
        const dashStartY = lineFamilyBaseOriginY + currentPosOnLine * sinA;
        currentPosOnLine += absDashLength;
        const dashEndX = lineFamilyBaseOriginX + currentPosOnLine * cosA;
        const dashEndY = lineFamilyBaseOriginY + currentPosOnLine * sinA;

        if (dashVal >= 0) { // Draw (dashVal > 0) or dot (dashVal == 0)
          const clipped = clipLineSegmentToRect({ x1: dashStartX, y1: dashStartY, x2: dashEndX, y2: dashEndY }, previewBox);
          if (clipped) {
            if (currentLinesGenerated + linesAdded < maxLinesLimitForRule) {
              segments.push(clipped);
              linesAdded++;
            } else {
                 error = `规则 ${ruleIndex + 1} 生成虚线时达到上限 (单个虚线段) (沿线重复)。`;
                 break; // break inner loop
            }
          }
        }
      } // end dashes loop
      if (currentLinesGenerated + linesAdded >= maxLinesLimitForRule && !error) {
           error = `规则 ${ruleIndex + 1} 生成虚线时达到上限 (完成一次虚线模式后) (沿线重复)。`;
      }
      if (dashPatternTotalLength < 1e-9 || error) break; // Avoid infinite loop or if limit reached
    }
  } else { // Case 2: deltaX is non-zero, dash *groups* repeat
    const numDashRepsMin = Math.floor(lineStartLimit / deltaX) - 1;
    const numDashRepsMax = Math.ceil(lineEndLimit / deltaX) + 1;

    for (let dRep = numDashRepsMin; dRep <= numDashRepsMax; dRep++) {
      if (currentLinesGenerated + linesAdded >= maxLinesLimitForRule) {
        error = `规则 ${ruleIndex + 1} 生成虚线时达到上限 (虚线组重复)。`;
        break;
      }
      
      const groupOffsetX = dRep * deltaX;
      let currentPosInGroup = 0;

      for (const dashVal of dashes) {
        if (currentLinesGenerated + linesAdded >= maxLinesLimitForRule) break;
        
        const absDashLength = Math.abs(dashVal);
        const dashStartRelX = groupOffsetX + currentPosInGroup;
        currentPosInGroup += absDashLength;
        const dashEndRelX = groupOffsetX + currentPosInGroup;
        
        const dashStartX = lineFamilyBaseOriginX + dashStartRelX * cosA;
        const dashStartY = lineFamilyBaseOriginY + dashStartRelX * sinA;
        const dashEndX = lineFamilyBaseOriginX + dashEndRelX * cosA;
        const dashEndY = lineFamilyBaseOriginY + dashEndRelX * sinA;

        if (dashVal >= 0) {
          const clipped = clipLineSegmentToRect({ x1: dashStartX, y1: dashStartY, x2: dashEndX, y2: dashEndY }, previewBox);
          if (clipped) {
             if (currentLinesGenerated + linesAdded < maxLinesLimitForRule) {
                segments.push(clipped);
                linesAdded++;
            } else {
                 error = `规则 ${ruleIndex + 1} 生成虚线时达到上限 (单个虚线段) (虚线组重复)。`;
                 break; // break inner loop
            }
          }
        }
      } // end dashes loop for a group
        if (currentLinesGenerated + linesAdded >= maxLinesLimitForRule && !error) {
           error = `规则 ${ruleIndex + 1} 生成虚线时达到上限 (完成一次虚线组后) (虚线组重复)。`;
      }
      if(error) break; // break outer dRep loop
    }
  }
  return { segments, linesAdded, error };
}

/**
 * 将一组使用原始 PAT 坐标的线段归一化到基于 previewBox 的 UV 坐标 (0-1)。
 *
 * @param {Array<LineSegment>} lines - 原始坐标的线段数组。
 * @param {PreviewBox} previewBox - 定义归一化参照的预览区域。
 * @param {UVScale} uvScale - UV 坐标的最终缩放。
 * @returns {Array<LineSegment>} 归一化后的线段数组。
 */
function normalizeLineCoordinates(lines, previewBox, uvScale) {
  if (!previewBox || previewBox.width <= 1e-9 || previewBox.height <= 1e-9) {
    // console.warn("[patLineGenerator.js] 无效的 previewBox，无法进行归一化。");
    return lines; // 返回原始线条或空数组，取决于如何处理错误
  }
  const { x:pbx, y:pby, width:pbw, height:pbh } = previewBox;
  const {width: uvw, height: uvh} = uvScale;

  return lines.map(line => ({
    x1: ((line.x1 - pbx) / pbw) * uvw,
    y1: ((line.y1 - pby) / pbh) * uvh, // PAT Y轴通常向下为正，UV Y轴通常向上为正。但当前实现保持直接映射。
    x2: ((line.x2 - pbx) / pbw) * uvw,
    y2: ((line.y2 - pby) / pbh) * uvh,
  }));
}

/**
 * 将线段裁剪到指定的矩形区域 (previewBox)。
 * 使用 Liang-Barsky 算法或 Cohen-Sutherland 算法。这里用一个简化版本或占位符。
 *
 * @param {LineSegment} line - 要裁剪的线段 {x1, y1, x2, y2}。
 * @param {PreviewBox} rect - 裁剪区域 {x, y, width, height}。
 * @returns {LineSegment | null} 裁剪后的线段，如果完全在外部则返回 null。
 */
function clipLineSegmentToRect(line, rect) {
  // 使用 Liang-Barsky 线段裁剪算法
  let { x1, y1, x2, y2 } = line;
  const { x: xmin, y: ymin, width, height } = rect;
  const xmax = xmin + width;
  const ymax = ymin + height;

  let p1 = -(x2 - x1);
  let p2 = x2 - x1;
  let p3 = -(y2 - y1);
  let p4 = y2 - y1;

  let q1 = x1 - xmin;
  let q2 = xmax - x1;
  let q3 = y1 - ymin;
  let q4 = ymax - y1;

  let t0 = 0.0;
  let t1 = 1.0;

  // Check for lines parallel to an edge
  if ((p1 === 0 && q1 < 0) || (p2 === 0 && q2 < 0) || (p3 === 0 && q3 < 0) || (p4 === 0 && q4 < 0)) {
      // Line is outside and parallel or points away from the clip edge
      // Or if a start/end point of a zero-length line is outside
      if (p1 === 0 && p2 === 0 && (q1 < 0 || q2 < 0)) return null; // Vertical line outside
      if (p3 === 0 && p4 === 0 && (q3 < 0 || q4 < 0)) return null; // Horizontal line outside
      // More specific checks for lines that are effectively points
      if (x1 === x2 && y1 === y2) { // It's a point
          if (x1 >= xmin && x1 <= xmax && y1 >= ymin && y1 <= ymax) {
              return { x1, y1, x2, y2 }; // Point is inside
          }
          return null; // Point is outside
      }
  }
  
  // Test against left and right edges
  if (p1 !== 0) {
    let r = q1 / p1;
    if (p1 < 0) { // Line proceeds from outside to inside
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else { // Line proceeds from inside to outside
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  } else if (q1 < 0) { // Line is parallel and outside left edge
      return null;
  }


  if (p2 !== 0) {
    let r = q2 / p2;
    if (p2 < 0) { // Line proceeds from outside to inside (w.r.t. this edge normal)
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else { // Line proceeds from inside to outside
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  } else if (q2 < 0) { // Line is parallel and outside right edge
      return null;
  }

  // Test against top and bottom edges
  if (p3 !== 0) {
    let r = q3 / p3;
    if (p3 < 0) { // Line proceeds from outside to inside
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else { // Line proceeds from inside to outside
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  } else if (q3 < 0) { // Line is parallel and outside top edge
      return null;
  }
  
  if (p4 !== 0) {
    let r = q4 / p4;
    if (p4 < 0) { // Line proceeds from outside to inside
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else { // Line proceeds from inside to outside
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  } else if (q4 < 0) { // Line is parallel and outside bottom edge
      return null;
  }


  if (t0 > t1) { // Line is completely outside
    return null;
  }

  const nx1 = x1 + t0 * (x2 - x1);
  const ny1 = y1 + t0 * (y2 - y1);
  const nx2 = x1 + t1 * (x2 - x1);
  const ny2 = y1 + t1 * (y2 - y1);

  // Final check for extremely small segments (effectively points) that might be on the boundary
  // or if the original line was a point.
   if (Math.abs(nx1 - nx2) < 1e-9 && Math.abs(ny1 - ny2) < 1e-9) { // Clipped to a point
        // Ensure this point is within bounds
        if (nx1 >= xmin - 1e-9 && nx1 <= xmax + 1e-9 && ny1 >= ymin - 1e-9 && ny1 <= ymax + 1e-9) {
             return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
        }
        return null; // Clipped to a point that's effectively outside due to precision
    }


  return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
}

