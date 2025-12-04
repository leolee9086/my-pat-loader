import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 显示测试工具信息
console.log('\n===== PAT计算器性能测试工具 =====');
console.log('比较原始patCalculator和优化版本之间的性能差异\n');

// 检查测试文件是否存在
const testFile = resolve(__dirname, '../src/patPerformanceTest.js'); // Adjusted path
if (!fs.existsSync(testFile)) {
  console.error('错误: 性能测试文件不存在 -', testFile);
  process.exit(1);
}

// 运行测试
console.log('运行性能测试...\n');
try {
  // 使用Node.js执行测试脚本
  const result = execSync(`node ${testFile}`, {
    encoding: 'utf8',
    stdio: 'inherit'
  });
} catch (error) {
  console.error('测试执行失败:', error.message);
  process.exit(1);
}

// 显示完成信息
console.log('\n测试完成！查看上方结果比较两个版本的性能差异。'); 