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

const currentStrokeColor = ref('#000000');

const updateStrokeColor = () => {
  currentStrokeColor.value = getComputedStyle(document.body).getPropertyValue('color') || '#000000';
};

const displayableLineGroups = computed(() => {
  if (!props.patternData || !props.patternData.lineGroups || props.patternData.lineGroups.length === 0) {
    return [];
  }
  if (stageConfig.width === 0 || stageConfig.height === 0) return [];

  return props.patternData.lineGroups.map(group => {
    if (!group.lines || group.lines.length === 0) {
      return { ...group, linesToRender: [] }; // Keep original group info, empty render lines
    }

    const canvasWidth = stageConfig.width;
    const canvasHeight = stageConfig.height;
    let drawWidth, drawHeight;
    let offsetX = 0, offsetY = 0;

    const patternAspectRatio = props.patternData.aspectRatio || 1;
    const canvasAspectRatio = canvasWidth / canvasHeight;

    if (patternAspectRatio > canvasAspectRatio) {
      drawWidth = canvasWidth;
      drawHeight = drawWidth / patternAspectRatio;
      offsetY = (canvasHeight - drawHeight) / 2;
    } else {
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
  if (containerEl.value) {
    stageConfig.width = containerEl.value.offsetWidth;
    stageConfig.height = containerEl.value.offsetHeight;
  }
};

const handleResize = () => {
  updateStageDimensions();
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
  updateStageDimensions(); 

  if (containerEl.value) {
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
}

/* The v-stage itself will take the dimensions from its config. 
   The container .canvas-area provides the boundary for these dimensions. */
</style> 