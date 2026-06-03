/**
 * action-classify.js - 操作分类与 AI 提示生成模块
 *
 * 根据 action 的类型、元素信息和上下文，程序化地对操作进行分类，
 * 并生成针对性的 hint（提示），引导 AI 更准确地分析该操作。
 *
 * 分类维度：
 * - 操作类型：click / dblclick / rightclick / keypress / input（语义归并后新增）
 * - 元素类型：button / link / input / select / checkbox / switch / tab / menu / other
 * - 业务场景：navigation / form-input / form-submit / dialog / toggle / selection / other
 *
 * 使用方式：
 *   import { classifyAction } from './action-classify.js';
 *   const { category, elementType, hints } = classifyAction(action, diff, formStateChanges);
 */

// ==================== 核心函数 ====================

/**
 * 对单条 action 进行分类，并生成 AI 提示
 *
 * @param {Object} action - action 数据（含 type、element、key 等）
 * @param {string} diffText - 该操作对应的 snapshot diff 文本
 * @param {Object|null} formStateChanges - formState 变化对象（computeFormStateChanges 的返回值）
 * @returns {Object} 分类结果
 * @returns {string} returns.category - 业务场景分类
 * @returns {string} returns.elementType - 元素类型分类
 * @returns {string[]} returns.hints - AI 分析提示列表
 */
export function classifyAction(action, diffText, formStateChanges) {
  const element = action.element || {};
  const tag = (element.tag || '').toLowerCase();
  const type = action.type || '';
  const key = action.key || '';

  // 1. 元素类型分类
  const elementType = classifyElementType(tag, element);

  // 2. 业务场景分类
  const category = classifyCategory(type, elementType, element, key, diffText);

  // 3. 生成 AI 提示
  const inputValue = action.inputValue || null;
  const hints = generateHints(type, elementType, category, element, diffText, formStateChanges, inputValue);

  return { category, elementType, hints };
}

// ==================== 元素类型分类 ====================

/**
 * 根据 HTML tag 和元素属性分类元素类型
 *
 * @param {string} tag - HTML 标签名（小写）
 * @param {Object} element - 元素信息对象
 * @returns {string} 元素类型
 */
function classifyElementType(tag, element) {
  // 按钮类
  if (tag === 'button' || element.type === 'submit') return 'button';

  // 链接
  if (tag === 'a') return 'link';

  // 输入框
  if (tag === 'input' || tag === 'textarea') {
    const inputType = (element.type || '').toLowerCase();
    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'radio') return 'radio';
    return 'input';
  }

  // 下拉选择
  if (tag === 'select') return 'select';

  // 开关（常见组件库的 switch）
  if (element.role === 'switch' || (element.classes && element.classes.includes('switch'))) {
    return 'switch';
  }

  // Tab 页签
  if (element.role === 'tab') return 'tab';

  // 菜单项
  if (element.role === 'menuitem') return 'menuitem';

  return 'other';
}

// ==================== 业务场景分类 ====================

/**
 * 根据操作类型、元素类型和上下文判断业务场景
 *
 * @param {string} actionType - 操作类型（click/keypress/...）
 * @param {string} elementType - 元素类型
 * @param {Object} element - 元素信息
 * @param {string} key - 按键名（keypress 类型时有效）
 * @param {string} diffText - diff 文本
 * @returns {string} 业务场景分类
 */
function classifyCategory(actionType, elementType, element, key, diffText) {
  // 语义归并后的输入操作（click → input）
  if (actionType === 'input') {
    return 'form-input';
  }

  // 键盘输入
  if (actionType === 'keypress') {
    if (key === 'Enter') {
      return 'form-submit';
    }
    if (key === 'Escape') {
      return 'dialog-dismiss';
    }
    if (key === 'Tab') {
      return 'navigation';
    }
    return 'form-input';
  }

  // 点击类操作
  if (actionType === 'click' || actionType === 'dblclick') {
    // 开关/复选框
    if (elementType === 'checkbox' || elementType === 'switch' || elementType === 'radio') {
      return 'toggle';
    }

    // 链接/导航
    if (elementType === 'link') return 'navigation';

    // Tab 页签
    if (elementType === 'tab') return 'selection';

    // 菜单项
    if (elementType === 'menuitem') return 'selection';

    // 下拉选择
    if (elementType === 'select') return 'selection';

    // 按钮：根据文本推测
    if (elementType === 'button') {
      const text = (element.text || element.label || '').toLowerCase();
      if (['确定', '提交', 'submit', 'ok', '保存', 'save'].some(k => text.includes(k))) {
        return 'form-submit';
      }
      if (['取消', 'cancel', '关闭', 'close'].some(k => text.includes(k))) {
        return 'dialog-dismiss';
      }
      if (['删除', 'delete', '移除', 'remove'].some(k => text.includes(k))) {
        return 'destructive';
      }
    }

    // diff 中出现 dialog/modal 相关内容
    if (diffText && (diffText.includes('dialog') || diffText.includes('modal'))) {
      return 'dialog';
    }

    return 'other';
  }

  // 右键
  if (actionType === 'rightclick') return 'context-menu';

  return 'other';
}

// ==================== AI 提示生成 ====================

/**
 * 根据分类结果生成 AI 分析提示
 *
 * @param {string} actionType - 操作类型（含语义归并后的 'input'）
 * @param {string} elementType - 元素类型
 * @param {string} category - 业务场景分类
 * @param {Object} element - 元素信息
 * @param {string} diffText - diff 文本
 * @param {Object|null} formStateChanges - 表单状态变化
 * @param {string|null} inputValue - 语义归并识别出的输入值（仅 input 类型有值）
 * @returns {string[]} 提示列表
 */
function generateHints(actionType, elementType, category, element, diffText, formStateChanges, inputValue) {
  const hints = [];

  // 通用提示：diff 无变化
  if (diffText && diffText.includes('完全相同')) {
    hints.push('Diff 显示 UI 无变化，这可能是一次没有视觉反馈的点击，或者效果是异步的。');
  }

  // 按场景生成提示
  switch (category) {
    case 'form-input':
      if (actionType === 'input' && inputValue) {
        // 语义归并已识别出的文本输入
        hints.push(`这是一次文本输入操作（由语义归并识别），用户在此元素中输入了 "${inputValue}"。请以此值为准描述操作。`);
      } else {
        // 原始 keypress 类型的键盘输入
        hints.push('这是一次键盘输入操作，请重点关注 formStateDelta 中的值变化，以确定用户输入了什么。');
        if (formStateChanges && formStateChanges.hasChanges) {
          hints.push('formState 发生了变化，请以 formState 中的精确值为准描述输入内容。');
        }
      }
      break;

    case 'form-submit':
      hints.push('这可能是一次表单提交操作，请关注 diff 中是否出现了提交后的反馈（成功/失败提示、页面跳转等）。');
      break;

    case 'toggle':
      hints.push('这是一个开关/复选框操作，请在 diff 中查找 checked/unchecked 状态变化来判断是"打开"还是"关闭"。');
      break;

    case 'navigation':
      hints.push('这可能触发了页面导航，请关注 diff 中大面积的内容变化。');
      break;

    case 'dialog':
      hints.push('diff 中出现了 dialog/modal 相关变化，请关注是否打开或关闭了弹窗。');
      break;

    case 'dialog-dismiss':
      hints.push('这可能是关闭弹窗或取消操作，请确认 diff 中弹窗内容是否消失。');
      break;

    case 'selection':
      hints.push('这是一次选择操作（Tab/菜单/下拉），请关注 diff 中 selected/expanded 等属性变化。');
      break;

    case 'destructive':
      hints.push('这可能是一次删除/移除操作，请关注 diff 中消失的内容。');
      break;

    case 'context-menu':
      hints.push('这是一次右键操作，通常会打开上下文菜单，请关注 diff 中新出现的菜单内容。');
      break;
  }

  return hints;
}
