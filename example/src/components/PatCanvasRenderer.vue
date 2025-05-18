<template>
  <div class="canvas-area" ref="containerEl">
    <v-stage :config="stageConfig">
      <v-layer :config="layerConfig">
        <template v-if="displayableLineGroups && displayableLineGroups.length > 0">
          <template v-for="(group, groupIndex) in displayableLineGroups" :key="`group-${groupIndex}`">
            <v-line 
              v-for="(line, lineIndex) in group.linesToRender" 
              :key="`line-${groupIndex}-${lineIndex}`" 
              :config="line"
            />
          </template>
        </template>
      </v-layer>
    </v-stage>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, watch, nextTick, defineProps, computed } from 'vue';
// vue-konva is typically registered globally via app.use(VueKonva) in main.js
// If not, you might need: import { Stage as VStage, Layer as VLayer, Line as VLine } from 'vue-konva';

const props = defineProps({
  patternData: {
    type: Object,
    default: null
  }
});

const containerEl = ref(null);
const stageConfig = reactive({
  width: 300, // Initial default
  height: 300, // Initial default
});

const layerConfig = reactive({
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1
});

let observer = null;
// 防止尺寸无限变化的标志
let isResizing = false;
// 跟踪前一个尺寸，防止微小变化引起的无限循环
let prevWidth = 0;
let prevHeight = 0;

const currentStrokeColor = ref('#000000');

const updateStrokeColor = () => {
  currentStrokeColor.value = getComputedStyle(document.body).getPropertyValue('color') || '#000000';
};

const displayableLineGroups = computed(() => {
  if (!props.patternData || !props.patternData.lineGroups || props.patternData.lineGroups.length === 0) {
    return [];
  }
  if (stageConfig.width === 0 || stageConfig.height === 0) return [];

  const canvasWidth = stageConfig.width;
  const canvasHeight = stageConfig.height;

  return props.patternData.lineGroups.map(group => {
    if (!group.lines || group.lines.length === 0) {
      return { ...group, linesToRender: [] }; // Keep original group info, empty render lines
    }

    let drawWidth, drawHeight;
    let offsetX = 0, offsetY = 0;

    // 使用传入的宽高或默认比例1:1
    const patternWidth = props.patternData.width || 1;
    const patternHeight = props.patternData.height || 1;
    const patternAspectRatio = patternWidth / patternHeight;
    
    const canvasAspectRatio = canvasWidth / canvasHeight;

    if (patternAspectRatio > canvasAspectRatio) {
      // 宽度受限
      drawWidth = canvasWidth;
      drawHeight = drawWidth / patternAspectRatio;
      offsetY = (canvasHeight - drawHeight) / 2;
    } else {
      // 高度受限
      drawHeight = canvasHeight;
      drawWidth = drawHeight * patternAspectRatio;
      offsetX = (canvasWidth - drawWidth) / 2;
    }
    
    const baseDimForLineWidth = Math.min(drawWidth, drawHeight);
    const konvaStrokeWidth = Math.max(0.5, (group.lineWidth || 0.005) * baseDimForLineWidth);

    const linesToRender = group.lines.map(line => ({
      points: [ 
        offsetX + line.x1 * drawWidth, 
        offsetY + line.y1 * drawHeight, 
        offsetX + line.x2 * drawWidth, 
        offsetY + line.y2 * drawHeight 
      ],
      stroke: currentStrokeColor.value, 
      strokeWidth: konvaStrokeWidth,
    }));
    
    // Return a new object for the group to be consumed by the template
    return {
      // we can spread the original group if other original properties are needed by the template for some reason
      // ...group, 
      originalRule: group.originalRule, // Example if needed
      name: group.name, // Example if needed
      linesToRender // The crucial part for Konva
    };
  });
});

const updateStageDimensions = () => {
  if (!containerEl.value || isResizing) return;
  
  const newWidth = containerEl.value.offsetWidth;
  const newHeight = containerEl.value.offsetHeight;
  
  // 检查尺寸是否真的变化，避免微小变化引起的循环
  const hasSignificantChange = 
    Math.abs(newWidth - prevWidth) > 1 || 
    Math.abs(newHeight - prevHeight) > 1;
  
  if (hasSignificantChange) {
    isResizing = true;
    
    // 约束最大尺寸，防止无限增长
    const maxDimension = 3000; // 设置一个最大安全尺寸
    const constrainedWidth = Math.min(newWidth, maxDimension);
    const constrainedHeight = Math.min(newHeight, maxDimension);
    
    stageConfig.width = constrainedWidth;
    stageConfig.height = constrainedHeight;
    
    prevWidth = constrainedWidth;
    prevHeight = constrainedHeight;
    
    console.log(`Canvas resized to: ${constrainedWidth}x${constrainedHeight}`);
    
    // 防止同一事件循环中的多次更新
    setTimeout(() => {
      isResizing = false;
    }, 100); 
  }
};

const handleResize = (entries) => {
  // 防抖处理：使用requestAnimationFrame确保在下一帧处理尺寸变化
  if (!isResizing) {
    window.requestAnimationFrame(() => {
      updateStageDimensions();
    });
  }
};

const handleThemeChange = () => {
  updateStrokeColor();
  // The change in currentStrokeColor (a ref) will automatically trigger
  // the re-computation of `displayableLineGroups` as it's a dependency.
  // Konva should then re-render the lines with the new stroke color.
};

onMounted(async () => {
  await nextTick(); 
  updateStrokeColor();
  
  // 确保初始尺寸设置正确
  if (containerEl.value) {
    prevWidth = containerEl.value.offsetWidth;
    prevHeight = containerEl.value.offsetHeight;
    stageConfig.width = prevWidth;
    stageConfig.height = prevHeight;
    
    // 使用更稳定的ResizeObserver配置
    observer = new ResizeObserver(handleResize);
    observer.observe(containerEl.value);
  }
  
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', handleThemeChange);
});

onUnmounted(() => {
  if (observer && containerEl.value) {
    observer.unobserve(containerEl.value);
  }
  observer = null;
  window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', handleThemeChange);
});

</script>

<style scoped>
.canvas-area {
  width: 100%;
  height: 100%; /* Ensure canvas area takes full height of its flex container */
  display: flex; /* To help stage to get dimensions if needed */
  flex-direction: column; 
  overflow: hidden; /* 防止内容溢出导致滚动条出现，引起新的尺寸变化 */
  position: relative; /* 确保定位上下文正确 */
}

/* The v-stage itself will take the dimensions from its config. 
   The container .canvas-area provides the boundary for these dimensions. */
</style> 