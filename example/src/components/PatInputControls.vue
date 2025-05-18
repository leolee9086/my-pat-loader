<template>
  <div class="controls">
    <label for="patFileVue">选择一个 .PAT 文件:</label>
    <input type="file" id="patFileVue" accept=".pat" @change="onFileChange" :disabled="isLoading" />
    
    <label for="maxLinesVue" style="margin-left: 20px;">最大线条数:</label>
    <input 
      type="number" 
      id="maxLinesVue" 
      :value="maxLinesToGenerate" 
      @input="onMaxLinesChange" 
      min="100" 
      max="100000" 
      step="100" 
      :disabled="isLoading" 
    />

    <span v-if="isLoading" class="loading-indicator"> 读取中...</span>
  </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

const props = defineProps({
  isLoading: {
    type: Boolean,
    default: false
  },
  maxLinesToGenerate: {
    type: Number,
    default: 10000
  }
});

const emit = defineEmits(['file-selected', 'max-lines-changed']);

const onFileChange = (event) => {
  const file = event.target.files[0];
  if (file) {
    emit('file-selected', file);
  } else {
    // Optional: emit an event if file selection was cancelled or cleared
    emit('file-selected', null); 
  }
};

const onMaxLinesChange = (event) => {
  emit('max-lines-changed', parseInt(event.target.value, 10));
};
</script>

<style scoped>
.controls {
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.loading-indicator {
  margin-left: 10px;
  font-style: italic;
}
/* Add other relevant styles from App.vue if needed */
</style> 