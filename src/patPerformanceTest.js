/**
 * PAT计算器性能测试工具
 * 比较原始patCalculator和优化版patCalculatorOptimized的性能差异
 */

import { computePatternLines as computeLinesOriginal, checkPatternContinuity as checkContinuityOriginal } from './patCalculator.js';
import { computePatternLines as computeLinesOptimized, checkPatternContinuity as checkContinuityOptimized } from './patCalculatorOptimized.js';

// 测试数据生成
function generateTestData(complexity = 1) {
  // 生成不同复杂度的测试数据
  const linesDefs = [];
  
  // 生成一系列线条定义，角度从0到90度
  for (let angle = 0; angle < 90; angle += 10 / complexity) {
    // 基本线条定义
    const lineDef = {
      angle,
      origin: [0, 0],
      delta: [5, 20],
      dashes: []
    };
    
    // 根据复杂度增加虚线段数量
    if (complexity > 1) {
      const dashCount = Math.min(20, Math.ceil(complexity * 2));
      for (let i = 0; i < dashCount; i++) {
        // 正值表示画线，负值表示空白
        lineDef.dashes.push(i % 2 === 0 ? 5 : -3);
      }
    }
    
    linesDefs.push(lineDef);
  }
  
  return {
    name: `测试图案-复杂度${complexity}`,
    linesDefs
  };
}

// 性能测试函数
function runPerformanceTest(testName, iterations = 100, complexity = 1) {
  console.log(`\n========= ${testName} (复杂度:${complexity}, 迭代次数:${iterations}) =========`);
  
  const testData = generateTestData(complexity);
  const boundary = {
    minX: -100,
    minY: -100,
    maxX: 100,
    maxY: 100
  };
  
  // 测试原始版本
  console.time('原始版本');
  let originalLines = [];
  let originalResult;
  
  for (let i = 0; i < iterations; i++) {
    originalLines = computeLinesOriginal(testData, boundary, 1.0, 0, [0, 0]);
    originalResult = checkContinuityOriginal(testData, boundary, 1.0, 0, [0, 0]);
  }
  
  console.timeEnd('原始版本');
  console.log(`线条数量: ${originalLines.length}`);
  
  // 测试优化版本
  console.time('优化版本');
  let optimizedLines = [];
  let optimizedResult;
  
  for (let i = 0; i < iterations; i++) {
    optimizedLines = computeLinesOptimized(testData, boundary, 1.0, 0, [0, 0]);
    optimizedResult = checkContinuityOptimized(testData, boundary, 1.0, 0, [0, 0]);
  }
  
  console.timeEnd('优化版本');
  console.log(`线条数量: ${optimizedLines.length}`);
  
  // 结果比较
  const linesMatch = originalLines.length === optimizedLines.length;
  const continuityMatch = originalResult.isContinuous === optimizedResult.isContinuous &&
                         Math.abs(originalResult.continuityScore - optimizedResult.continuityScore) < 0.001;
  
  console.log(`结果一致性检查: ${linesMatch && continuityMatch ? '通过 ✓' : '不通过 ✗'}`);
  if (!linesMatch) {
    console.log(`线条数量不匹配! 原始: ${originalLines.length}, 优化: ${optimizedLines.length}`);
  }
  if (!continuityMatch) {
    console.log(`连续性结果不匹配! 原始分数: ${originalResult.continuityScore}, 优化分数: ${optimizedResult.continuityScore}`);
  }
}

// 运行一系列测试
function runTests() {
  console.log('PAT计算器性能测试开始...');
  
  // 基础测试 - 低复杂度，高迭代次数
  runPerformanceTest('基础测试', 100, 1);
  
  // 中等复杂度测试
  runPerformanceTest('中等复杂度测试', 50, 3);
  
  // 高复杂度测试
  runPerformanceTest('高复杂度测试', 20, 5);
  
  // 极端测试 - 高复杂度，中等迭代次数
  runPerformanceTest('极端测试', 10, 10);
  
  console.log('\n性能测试完成!');
}

// 执行测试
runTests(); 