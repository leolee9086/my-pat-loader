<template>
  <div class="vue-app-container">
    <h1>PAT 文件加载器 & 查看器</h1>
    <div class="main-layout">
      <div class="left-panel">
        <PatInputControls
          :is-loading="patFileInfo.isLoading"
          :max-lines-to-generate="patFileInfo.maxLinesToGenerate"
          @file-selected="handleFileSelected"
          @max-lines-changed="handleMaxLinesChange"
        />
        <div class="pattern-controls">
          <div class="control-group">
            <label>缩放: {{ patternScale.toFixed(2) }}</label>
            <input 
              type="range" 
              min="0.1" 
              max="2" 
              step="0.05" 
              v-model.number="patternScale"
              @input="handlePatternChange"
            >
          </div>
          <div class="control-group">
            <label>旋转: {{ patternRotation }}°</label>
            <input 
              type="range" 
              min="0" 
              max="359" 
              step="5" 
              v-model.number="patternRotation"
              @input="handlePatternChange"
            >
          </div>
          <div class="control-group">
            <label>范围: {{ previewRange.toFixed(1) }} 单位</label>
            <input 
              type="range" 
              min="1" 
              max="50" 
              step="0.5" 
              v-model.number="previewRange"
              @input="handlePatternChange"
            >
          </div>
          <div class="control-group-row">
            <label>X偏移:</label>
            <input 
              type="number" 
              step="0.1" 
              v-model.number="offsetX"
              @input="handlePatternChange"
              class="number-input"
            >
            <label class="ml-2">Y偏移:</label>
            <input 
              type="number" 
              step="0.1" 
              v-model.number="offsetY"
              @input="handlePatternChange"
              class="number-input"
            >
          </div>
          <div class="control-group engine-switch">
            <label>渲染引擎:</label>
            <div class="toggle-container">
              <label class="toggle">
                <input
                  type="checkbox"
                  v-model="useWebGPU"
                  @change="handleEngineChange"
                />
                <span class="slider"></span>
                <span class="toggle-labels">
                  <span class="label-left">CPU</span>
                  <span class="label-right">WebGPU</span>
                </span>
              </label>
            </div>
            <div v-if="gpuStatus" class="gpu-status" :class="gpuStatus.isAvailable ? 'available' : 'unavailable'">
              {{ gpuStatus.message }}
            </div>
          </div>
        </div>
        
        <div v-if="continuityInfo" class="continuity-info">
          <h3>图案连续性分析</h3>
          <div :class="['continuity-score', continuityInfo.isContinuous ? 'continuous' : 'discontinuous']">
            连续性评分: {{ (continuityInfo.continuityScore * 100).toFixed(1) }}%
          </div>
          <div class="continuity-details">
            {{ continuityInfo.details }}
          </div>
        </div>
        
        <PatInfoDisplay
          :name="patFileInfo.name"
          :description="patFileInfo.description"
          :lines-defs="patFileInfo.linesDefs"
          :line-def-count="patFileInfo.lineDefCount"
          :error-message="patFileInfo.errorMessage"
          :warning-message="patFileInfo.warningMessage"
          :is-loading="patFileInfo.isLoading"
        />
      </div>
      <div class="right-panel">
        <PatCanvasRenderer :pattern-data="lastPatternOutput" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { parsePatContent } from '../../src/patParser.js';

// 导入默认的CPU版本作为备用
import * as patCpuCalculator from '../../src/patCalculator.js';
import * as optimizedPatCalculator from '../../src/patCalculatorUltra.js';
// 图案计算模块 (根据使用引擎动态变化)
let patCalculator = patCpuCalculator;

import PatInputControls from './components/PatInputControls.vue';
import PatInfoDisplay from './components/PatInfoDisplay.vue';
import PatCanvasRenderer from './components/PatCanvasRenderer.vue';

const patFileInfo = reactive({
  name: '-',
  description: '-',
  linesDefs: [],
  lineDefCount: 0,
  errorMessage: '',
  warningMessage: '',
  isLoading: false,
  maxLinesToGenerate: 10000,
});

// 添加图案控制参数
const patternScale = ref(0.25); // 默认设置一个较小的缩放值，使较大的PAT图案能够在预览窗口中看到
const patternRotation = ref(0);
const previewRange = ref(10); // 默认预览范围为10个单位，可以调整为1-50单位
const offsetX = ref(0); // X方向偏移
const offsetY = ref(0); // Y方向偏移

// WebGPU相关状态
const useWebGPU = ref(false); // 默认使用WebGPU
const gpuStatus = ref(null);

const lastPatternOutput = ref(null);
// 保存最后解析的PAT数据，用于重新生成预览
const lastParsedData = ref(null);
// 图案连续性信息
const continuityInfo = ref(null);

// 检查WebGPU是否可用
async function checkWebGPUAvailability() {
  try {
    // 动态导入WebGPU模块
    const webGPUModule = await import('../../src/webgpu/patCalculatorGPU.js');
    const { initWebGPU } = webGPUModule;
    
    const isAvailable = await initWebGPU();
    
    if (isAvailable) {
      gpuStatus.value = {
        isAvailable: true,
        message: "WebGPU可用"
      };
      
      // 设置为WebGPU计算器
      if (useWebGPU.value) {
        patCalculator = webGPUModule;
        console.log("使用WebGPU加速版本");
      }
    } else {
      gpuStatus.value = {
        isAvailable: false,
        message: "WebGPU不可用，已切换到CPU模式"
      };
      
      // 强制使用CPU版本
      useWebGPU.value = false;
      patCalculator = patCpuCalculator;
      console.log("WebGPU不可用，使用CPU版本");
    }
  } catch (error) {
    console.error("检查WebGPU时出错:", error);
    gpuStatus.value = {
      isAvailable: false,
      message: "WebGPU检测错误: " + error.message
    };
    
    // 强制使用CPU版本
    useWebGPU.value = false;
    patCalculator = patCpuCalculator;
  }
}

// 切换渲染引擎
async function handleEngineChange() {
  if (useWebGPU.value && gpuStatus.value?.isAvailable) {
    // 切换到WebGPU
    const webGPUModule = await import('../../src/webgpu/patCalculatorGPU.js');
    patCalculator = webGPUModule;
    console.log("切换到WebGPU模式");
  } else {
    // 切换到CPU
    patCalculator = patCpuCalculator;
    console.log("切换到CPU模式");
  }
  
  // 如果有数据，重新生成预览
  if (lastParsedData.value) {
    handlePatternChange();
  }
}

const resetUI = () => {
  patFileInfo.name = '-';
  patFileInfo.description = '-';
  patFileInfo.linesDefs = [];
  patFileInfo.lineDefCount = 0;
  patFileInfo.errorMessage = '';
  patFileInfo.warningMessage = '';
  patFileInfo.isLoading = false;
  // maxLinesToGenerate is intentionally not reset here
  lastPatternOutput.value = null;
  lastParsedData.value = null;
  continuityInfo.value = null;
};

const generatePreview = async (parsedData) => {
  if (!parsedData) return;
  console.log('开始生成预览');
  const startTime = performance.now();
  // 根据当前预览范围计算边界
  const halfRange = previewRange.value / 2;
  const previewBox = { 
    x: -halfRange, 
    y: -halfRange, 
    width: previewRange.value, 
    height: previewRange.value 
  };
  
  const boundary = {
    minX: previewBox.x,
    minY: previewBox.y,
    maxX: previewBox.x + previewBox.width,
    maxY: previewBox.y + previewBox.height
  };

  // 获取当前图案的偏移值
  const offset = [offsetX.value, offsetY.value];

  try {
    console.log(`使用${useWebGPU.value ? 'WebGPU' : 'CPU'}引擎计算图案...`);
    
    // 使用当前计算器模块的函数生成线条
    const generatedLines = await patCalculator.computePatternLines(
      parsedData, 
      boundary,
      patternScale.value, // 使用当前缩放值
      patternRotation.value, // 使用当前旋转值
      offset // 使用当前偏移值
    );
    console.log('生成线条数量:', generatedLines.length);
    if (generatedLines.length > 0) {
      console.log('第一条线:', generatedLines[0]);
    }
    
    // 限制生成的线条数量
    const limitedLines = generatedLines.slice(0, patFileInfo.maxLinesToGenerate);

    // 将线条格式转换为渲染器期望的格式
    // PatCanvasRenderer期望 { lineGroups: [{ lines: [{x1,y1,x2,y2}], lineWidth }] }
    const defaultLineWidth = 0.001;
    
    // 将坐标从边界坐标系转换为[0,1]范围
    // 在预览窗口中，(-range/2,-range/2)映射到(0,0)，(range/2,range/2)映射到(1,1)
    const mapCoord = (value, axis) => {
      const min = axis === 'x' ? boundary.minX : boundary.minY;
      const max = axis === 'x' ? boundary.maxX : boundary.maxY;
      const range = max - min;
      return (value - min) / range;
    };
    
    // 将所有线条归入一个组
    const lineGroup = {
      lines: limitedLines.map(line => ({
        x1: mapCoord(line.start.x, 'x'),
        y1: mapCoord(line.start.y, 'y'),
        x2: mapCoord(line.end.x, 'x'),
        y2: mapCoord(line.end.y, 'y')
      })),
      lineWidth: defaultLineWidth,
      lineColor: '#000000' // 默认黑色线条
    };
    
    lastPatternOutput.value = {
      lineGroups: [lineGroup],
      width: previewBox.width,
      height: previewBox.height
    };
    
    // 使用当前计算器模块检查连续性
    continuityInfo.value = await patCalculator.checkPatternContinuity(
      parsedData,
      boundary,
      patternScale.value,
      patternRotation.value,
      offset
    );
    
    if (generatedLines.length >= patFileInfo.maxLinesToGenerate) {
      patFileInfo.warningMessage = `已达到最大线条数量限制(${patFileInfo.maxLinesToGenerate})`;
    } else {
      patFileInfo.warningMessage = '';
    }
    const endTime = performance.now();
    console.log(`使用${useWebGPU.value ? 'WebGPU' : 'CPU'}引擎生成预览时间: ${endTime - startTime} 毫秒`);   
  } catch (error) {
    console.error('生成预览时出错:', error);
    patFileInfo.errorMessage = `生成预览时出错: ${error.message}`;
  }
};

const handlePatternChange = () => {
  if (lastParsedData.value) {
    generatePreview(lastParsedData.value);
  }
};

const handleFileSelected = async (file) => {
  if (!file) {
    resetUI();
    return;
  }
  
  patFileInfo.isLoading = true;
  patFileInfo.errorMessage = '';
  patFileInfo.warningMessage = '';
  
  try {
    const fileContent = await file.text();
    
    // 解析PAT文件内容
    const parsedData = parsePatContent(fileContent);
    
    if (!parsedData) {
      throw new Error('无法解析PAT文件内容');
    }
    
    console.log('解析PAT数据:', parsedData);
    
    // 更新UI信息
    patFileInfo.name = parsedData.name || file.name;
    patFileInfo.description = parsedData.description || '无描述';
    patFileInfo.linesDefs = parsedData.linesDefs || [];
    patFileInfo.lineDefCount = parsedData.linesDefs?.length || 0;
    
    // 保存解析后的数据，用于重新生成预览
    lastParsedData.value = parsedData;
    
    // 生成预览
    const startTime = performance.now();
    await generatePreview(parsedData);
    const endTime = performance.now();
    console.log(`生成预览时间: ${endTime - startTime} 毫秒`);   
  } catch (error) {
    console.error('处理PAT文件时出错:', error);
    patFileInfo.errorMessage = `处理PAT文件时出错: ${error.message}`;
    resetUI();
    patFileInfo.errorMessage = `处理PAT文件时出错: ${error.message}`;
  } finally {
    patFileInfo.isLoading = false;
  }
};

const handleMaxLinesChange = (newValue) => {
  patFileInfo.maxLinesToGenerate = newValue;
  // 如果已经有解析的数据，重新生成预览
  if (lastParsedData.value) {
    generatePreview(lastParsedData.value);
  }
};

// 组件挂载时检查WebGPU可用性
onMounted(async () => {
  await checkWebGPUAvailability();
});
</script>

<style scoped>
.vue-app-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
}

h1 {
  text-align: center;
  margin-bottom: 20px;
  color: #2c3e50;
}

.main-layout {
  display: flex;
  gap: 20px;
}

.left-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.right-panel {
  flex: 2;
  min-height: 500px;
  border: 1px solid #ddd;
  border-radius: 4px;
  overflow: hidden;
}

.pattern-controls {
  background-color: #f9f9f9;
  padding: 15px;
  border-radius: 4px;
  border: 1px solid #ddd;
}

.control-group {
  margin-bottom: 10px;
}

.control-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
}

.control-group input[type="range"] {
  width: 100%;
}

.control-group-row {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.number-input {
  width: 60px;
  margin: 0 5px;
  padding: 5px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.ml-2 {
  margin-left: 10px;
}

.continuity-info {
  background-color: #f9f9f9;
  padding: 15px;
  border-radius: 4px;
  border: 1px solid #ddd;
}

.continuity-score {
  font-size: 18px;
  font-weight: bold;
  padding: 8px;
  border-radius: 4px;
  margin: 10px 0;
  text-align: center;
}

.continuous {
  background-color: #d4edda;
  color: #155724;
}

.discontinuous {
  background-color: #f8d7da;
  color: #721c24;
}

.continuity-details {
  white-space: pre-line;
  font-size: 14px;
}

/* WebGPU切换样式 */
.engine-switch {
  margin-top: 15px;
  padding-top: 10px;
  border-top: 1px dashed #ccc;
}

.toggle-container {
  margin-top: 8px;
  display: flex;
  align-items: center;
}

.toggle {
  position: relative;
  display: inline-block;
  width: 140px;
  height: 34px;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: .4s;
  border-radius: 34px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 26px;
  width: 26px;
  left: 4px;
  bottom: 4px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #2196F3;
}

input:checked + .slider:before {
  transform: translateX(106px);
}

.toggle-labels {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 10px;
  pointer-events: none;
  color: white;
  font-weight: bold;
  font-size: 14px;
}

.label-left, .label-right {
  z-index: 1;
}

.gpu-status {
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 14px;
}

.available {
  background-color: #d4edda;
  color: #155724;
}

.unavailable {
  background-color: #f8d7da;
  color: #721c24;
}
</style> 