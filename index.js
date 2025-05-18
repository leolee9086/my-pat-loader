/**
 * PAT Loader - AutoCAD Hatch Pattern File Parser and Generator
 * 
 * This module provides functionality to parse .PAT files (AutoCAD Hatch Pattern)
 * and generate vector line segments based on the pattern definitions.
 */

import { parsePatContent } from './src/patParser.js';
import { computePatternLines, checkPatternContinuity } from './src/patCalculator.js';

export {
  // PAT文件解析函数
  parsePatContent,
  
  // PAT图案计算函数
  computePatternLines,
  
  // PAT图案连续性检查函数
  checkPatternContinuity
}; 