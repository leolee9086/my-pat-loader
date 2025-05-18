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
import { computePatternLines, checkPatternContinuity } from '../../src/patCalculator.js';

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

const lastPatternOutput = ref(null);
// 保存最后解析的PAT数据，用于重新生成预览
const lastParsedData = ref(null);
// 图案连续性信息
const continuityInfo = ref(null);

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

const generatePreview = (parsedData) => {
  if (!parsedData) return;
  
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
    // 使用新的计算函数生成线条，应用当前的缩放、旋转和偏移
    const generatedLines = computePatternLines(
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
    const defaultLineWidth = 0.005;
    
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
      name: parsedData.name
    };

    console.log('转换后第一条线:', lineGroup.lines.length > 0 ? lineGroup.lines[0] : 'no lines');

    // 创建渲染器需要的数据结构
    const presentation = {
      lineGroups: [lineGroup],
      aspectRatio: 1, // 预览区域是正方形
      metadata: {
        name: parsedData.name,
        description: parsedData.description,
        totalLinesGenerated: limitedLines.length,
        totalLinesRequested: generatedLines.length,
        scale: patternScale.value,
        rotation: patternRotation.value,
        range: previewRange.value,
        offset: offset
      }
    };

    // 检查是否有线条被限制
    if (generatedLines.length > patFileInfo.maxLinesToGenerate) {
      presentation.error = `已限制生成线条数量为 ${patFileInfo.maxLinesToGenerate}（总计 ${generatedLines.length} 条）。可以在设置中调整最大生成线条数。`;
      patFileInfo.warningMessage = presentation.error;
    } else if (limitedLines.length === 0) {
      // 如果没有生成任何线条，添加警告
      presentation.error = "当前设置下未生成任何可见线条。请尝试调整缩放、旋转、范围或偏移参数。";
      patFileInfo.warningMessage = presentation.error;
    } else {
      patFileInfo.warningMessage = '';
    }

    lastPatternOutput.value = presentation;
    
    // 计算图案连续性
    continuityInfo.value = checkPatternContinuity(
      parsedData,
      boundary,
      patternScale.value,
      patternRotation.value,
      offset
    );
    
  } catch (genError) {
    console.error("生成图案线条时出错:", genError);
    patFileInfo.warningMessage = `生成图案线条时发生错误: ${genError.message}`;
    
    // 创建一个空的展示对象，这样渲染器至少有东西可以处理
    lastPatternOutput.value = {
      lineGroups: [],
      aspectRatio: 1,
      metadata: {
        name: parsedData.name,
        description: parsedData.description,
        totalLinesGenerated: 0,
        totalLinesRequested: 0,
        scale: patternScale.value,
        rotation: patternRotation.value,
        range: previewRange.value,
        offset: offset
      },
      error: `生成图案线条时发生错误: ${genError.message}`
    };
    
    continuityInfo.value = null;
  }
};

const handlePatternChange = () => {
  // 当缩放、旋转、范围或偏移参数变化时重新生成预览
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
  // Reset previous pattern before loading new one
  lastPatternOutput.value = null; 
  lastParsedData.value = null;
  continuityInfo.value = null;

  const reader = new FileReader();
  reader.onload = (e) => {
    const patText = e.target.result;
    try {
      const parsedData = parsePatContent(patText);
      patFileInfo.name = parsedData.name || '无名称';
      patFileInfo.description = parsedData.description || '无描述';

      if (parsedData.error && (!parsedData.linesDefs || parsedData.linesDefs.length === 0)) {
        patFileInfo.errorMessage = parsedData.error;
        patFileInfo.linesDefs = [];
        patFileInfo.lineDefCount = 0;
        lastPatternOutput.value = null; // Ensure canvas is cleared via renderer
        patFileInfo.isLoading = false;
        return;
      }
      
      if (!parsedData.linesDefs || parsedData.linesDefs.length === 0) {
        patFileInfo.errorMessage = parsedData.error || "PAT 文件中未找到线条定义。";
        patFileInfo.linesDefs = [];
        patFileInfo.lineDefCount = 0;
        lastPatternOutput.value = null;
        patFileInfo.isLoading = false;
        return;
      }

      patFileInfo.linesDefs = parsedData.linesDefs;
      patFileInfo.lineDefCount = parsedData.linesDefs.length;
      // Clear parsing error if we have line defs
      patFileInfo.errorMessage = parsedData.error || ''; 

      // 保存解析后的数据以便稍后重新生成
      lastParsedData.value = parsedData;

      // 生成初始预览
      generatePreview(parsedData);

    } catch (error) {
      console.error("处理 PAT 文件失败:", error);
      patFileInfo.errorMessage = `处理文件时发生严重错误: ${error.message}`;
      patFileInfo.name = "错误";
      patFileInfo.description = "处理失败";
      patFileInfo.linesDefs = [];
      patFileInfo.lineDefCount = 0;
      patFileInfo.warningMessage = '';
      lastPatternOutput.value = null;
      lastParsedData.value = null;
      continuityInfo.value = null;
    } finally {
      patFileInfo.isLoading = false;
    }
  };
  reader.onerror = (err) => {
    console.error("FileReader 错误:", err);
    patFileInfo.errorMessage = "读取文件失败。";
    resetUI(); // Full reset on reader error
  };
  reader.readAsText(file, 'GBK'); // Keep GBK encoding as per previous AInote
};

const handleMaxLinesChange = (newMaxLines) => {
  patFileInfo.maxLinesToGenerate = newMaxLines;
  
  // 如果已经有加载的图案，重新生成
  if (lastParsedData.value) {
    generatePreview(lastParsedData.value);
  }
};

onMounted(() => {
  resetUI(); 
  // Global event listeners (resize, theme change) are now managed by PatCanvasRenderer.vue
});

</script>

<style scoped>
.vue-app-container {
  display: flex;
  flex-direction: column;
  height: 100vh; /* Make app container take full viewport height */
  padding: 1rem; /* Add some padding to the overall container */
  box-sizing: border-box;
}

.vue-app-container > h1 {
  flex-shrink: 0; /* Prevent h1 from shrinking */
  margin-bottom: 1rem;
}

.main-layout {
  display: flex;
  flex-grow: 1; /* Allow main layout to take remaining space */
  gap: 1rem;     /* Space between left and right panels */
  overflow: hidden; /* Prevent content from overflowing the viewport height */
}

.left-panel {
  flex: 0 0 40%; /* Left panel takes 40% of width, doesn't grow or shrink */
  /* max-width: 500px; */ /* Optional: set a max width for the left panel */
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto; /* Allow left panel to scroll if content overflows */
  padding-right: 1rem; /* Add some padding if needed */
  box-sizing: border-box;
}

.right-panel {
  flex: 1 1 60%; /* Right panel takes remaining 60%, can grow and shrink */
  display: flex;
  flex-direction: column; /* Ensure renderer takes full height of this panel */
  overflow: hidden; /* if PatCanvasRenderer itself handles its internal scrolling/sizing */
}

.pattern-controls {
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: #f8f8f8;
  margin-bottom: 1rem;
}

.control-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 0.8rem;
}

.control-group-row {
  display: flex;
  align-items: center;
  margin-bottom: 0.8rem;
}

.control-group label, .control-group-row label {
  margin-bottom: 0.3rem;
  font-weight: bold;
}

.control-group input[type="range"] {
  width: 100%;
}

.number-input {
  width: 60px;
  text-align: center;
  padding: 4px;
  border: 1px solid #ddd;
  border-radius: 3px;
}

.ml-2 {
  margin-left: 10px;
}

.continuity-info {
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: #f8f8f8;
  margin-bottom: 1rem;
}

.continuity-score {
  font-weight: bold;
  font-size: 1.1em;
  padding: 0.5rem;
  margin: 0.5rem 0;
  border-radius: 4px;
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
  font-size: 0.9em;
}
</style> 