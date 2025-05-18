<template>
  <div class="pat-info-area">
    <h2>图案详情</h2>
    <div>名称: {{ name }}</div>
    <div>描述: {{ description }}</div>
    <p v-if="errorMessage" class="error-text">错误: {{ errorMessage }}</p>
    
    <h3>线条定义 ({{ lineDefCount }})</h3>
    <div id="lineDefinitionsVue" class="line-definitions-container">
      <p v-if="linesDefs.length === 0 && !errorMessage && !isLoading">
        加载 PAT 文件以查看线条定义。
      </p>
      <div v-for="(def, index) in linesDefs" :key="index" class="line-def-item">
        <p><strong>定义 {{ index + 1 }}:</strong></p>
        <p>  角度: <code>{{ def.angle }}°</code> (线条家族的初始方向)</p>
        <p>  原点: <code>[{{ def.origin.join(", ") }}]</code> (该家族第一条线的起始点 <code>[x,y]</code>)</p>
        <p>  偏移: <code>[{{ def.delta.join(", ") }}]</code> (<code>[dx, dy]</code> - 用于重复线条或虚线组的偏移)</p>
        <p>    - <code>dx ({{ def.delta[0] }})</code>: 沿线方向(<code>{{ def.angle }}°</code>)为下一个虚线组或线段的偏移。</p>
        <p>    - <code>dy ({{ def.delta[1] }})</code>: 垂直于线方向的偏移，用于创建平行线。</p>
        <p>  虚线: <code>[{{ def.dashes.join(", ") }}]</code> (绘制/留空长度的模式)</p>
        <p>    <em>含义: {{ getDashMeaning(def.dashes) }}</em></p>
      </div>
    </div>
     <p v-if="warningMessage" class="warning-text">生成警告: {{ warningMessage }}</p>
  </div>
</template>

<script setup>
import { defineProps } from 'vue';

const props = defineProps({
  name: { type: String, default: '-' },
  description: { type: String, default: '-' },
  linesDefs: { type: Array, default: () => [] },
  lineDefCount: { type: Number, default: 0 },
  errorMessage: { type: String, default: '' },
  warningMessage: { type: String, default: '' },
  isLoading: { type: Boolean, default: false },
});

const getDashMeaning = (dashes) => {
  if (!dashes || dashes.length === 0) return "实线 (连续)";
  return dashes.map(d => {
    if (d > 0) return `绘制 ${d} 单位`;
    if (d < 0) return `抬笔 ${Math.abs(d)} 单位`;
    return `点 (0长度绘制)`;
  }).join(", ");
};
</script>

<style scoped>
.pat-info-area {
  margin-bottom: 1rem;
}
.error-text {
  color: red;
  font-weight: bold;
}
.warning-text {
  color: orange;
}
.line-definitions-container {
  max-height: 300px; 
  overflow-y: auto;
  padding: 1rem;
  border-radius: 4px;
  font-family: monospace;
  border: 1px solid var(--line-def-border-color, #444);
}
.line-def-item {
  margin-bottom: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px dashed var(--line-def-border-color, #444);
}
.line-def-item:last-child {
  border-bottom: none;
}
</style> 