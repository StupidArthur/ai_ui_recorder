/**
 * inject-script.js - 浏览器注入脚本生成器
 *
 * 生成一段 JavaScript 脚本字符串，通过 context.addInitScript() 注入到每个浏览器页面中。
 * 脚本在页面内监听物理用户动作，通过 window.__recordAction() 将操作数据回传 Node.js。
 *
 * 监听的物理动作：
 * - pointerdown（capture）— 在 click 之前同步捕获表单状态（formStateDelta）
 * - click（capture）— 左键单击
 * - dblclick（capture）— 双击
 * - contextmenu（capture）— 右键点击
 * - keydown（capture）— Enter / Tab / Escape / Space 按键
 *
 * 设计原则：
 * - 只监听物理用户动作，不监听 change/hover/drag/MutationObserver
 * - 值变更由 pre/post snapshot diff 体现，无需 change 事件
 * - getElementInfo 只保留轻量字段，冗余 DOM 信息由整页快照取代
 * - pointerdown/keydown capture 阶段同步读取表单状态，作为 formStateDelta 独立字段发送
 *
 * 使用方式：
 *   import { buildInjectedScript } from './inject-script.js';
 *   const script = buildInjectedScript();
 *   await context.addInitScript(script);
 */

/**
 * 生成浏览器注入脚本字符串
 *
 * @returns {string} 可直接注入浏览器的 JavaScript 脚本字符串
 */
export function buildInjectedScript() {
  return `(function() {
  // ========== 防止重复注入 ==========
  if (window.__recorderInjected) return;
  window.__recorderInjected = true;

  // ========== 工具函数：XPath（与 Selenium Driver4.identity 一致） ==========

  /**
   * XPath 1.0 属性字面量（可含单引号时用 concat）
   */
  function xpathStringLiteral(s) {
    if (s.indexOf("'") === -1) return "'" + s + "'";
    var parts = s.split("'");
    // 注意：不得在此处写 parts.join("', \"'\", '") —— 外层 buildInjectedScript 使用模板字符串时，
    // 该片段会与反引号/转义组合产生非法 JS，导致 frame.evaluate SyntaxError。
    var out = "concat(";
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) {
        // 在「运行时生成的 JS」里需要字面量 \", \"'\", \" —— 外层 buildInjectedScript 使用模板字符串时，
        // 不得写 ", \"'\", "（会经模板解析成非法片段）。用字符码拼接避免引号/反引号嵌套。
        out += ", " + String.fromCharCode(34) + "'" + String.fromCharCode(34) + ", ";
      }
      out += "'" + parts[i] + "'";
    }
    out += ")";
    return out;
  }

  /**
   * XPath 匹配节点数量（用于唯一性判断）
   */
  function xpathMatchCount(expr) {
    try {
      var r = document.evaluate(expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return r.snapshotLength;
    } catch (e) {
      return -1;
    }
  }

  /**
   * 同父下与同 tag 兄弟相比的片段：唯一同名 tag 则省略 [n]
   */
  function segmentForNode(node) {
    var par = node.parentElement;
    if (!par) return node.tagName.toLowerCase();
    var tag = node.tagName.toLowerCase();
    var siblings = par.children;
    var same = [];
    for (var si = 0; si < siblings.length; si++) {
      if (siblings[si].tagName === node.tagName) same.push(siblings[si]);
    }
    if (same.length === 1) return tag;
    var idx = same.indexOf(node) + 1;
    return tag + '[' + idx + ']';
  }

  /**
   * 从祖先（含）到 el（含）的相对路径，祖先为起点时前缀不带 /
   */
  function relativePathFromAncestor(ancestor, el) {
    if (el === ancestor) return '';
    var segs = [];
    var c = el;
    while (c && c !== ancestor) {
      segs.push(segmentForNode(c));
      c = c.parentElement;
      if (!c) return '';
    }
    if (c !== ancestor) return '';
    segs.reverse();
    return '/' + segs.join('/');
  }

  /**
   * 兜底：自底向上绝对路径（长链 div[n]）
   */
  function getXPathAbsolute(el) {
    if (!el || el.nodeType !== 1) return 'unknown';
    if (el === document.body) return '/html/body';
    if (el === document.documentElement) return '/html';
    if (el.id) {
      return '//*[@id=' + xpathStringLiteral(el.id) + ']';
    }
    var tag = el.tagName.toLowerCase();
    if (!el.parentElement) return '//' + tag;
    var siblings = el.parentElement.children;
    var sameTagIndex = 0;
    for (var i = 0; i < siblings.length; i++) {
      var sib = siblings[i];
      if (sib.tagName === el.tagName) {
        sameTagIndex++;
        if (sib === el) {
          return getXPathAbsolute(el.parentElement) + '/' + tag + '[' + sameTagIndex + ']';
        }
      }
    }
    return '//' + tag;
  }

  /**
   * 用于 text() / normalize-space 的短文本（优先直接文本节点）
   */
  function getShortTextForXPath(el) {
    var direct = '';
    for (var ti = 0; ti < el.childNodes.length; ti++) {
      if (el.childNodes[ti].nodeType === 3) {
        direct += el.childNodes[ti].textContent;
      }
    }
    direct = direct.replace(/^\\s+|\\s+$/g, '');
    if (direct.length >= 1 && direct.length <= 30) return direct;
    var all = (el.textContent || '').replace(/\\s+/g, ' ').replace(/^\\s+|\\s+$/g, '');
    if (all.length > 30) all = all.slice(0, 30);
    if (all.length >= 1) return all;
    return '';
  }

  /**
   * 智能短 XPath：属性锚点、唯一文本、最近祖先锚点 + 相对路径，最后兜底绝对路径
   */
  function getXPath(el) {
    try {
      if (!el || el.nodeType !== 1) return 'unknown';
      if (el === document.body) return '/html/body';
      if (el === document.documentElement) return '/html';

      if (el.id) {
        return '//*[@id=' + xpathStringLiteral(el.id) + ']';
      }

      var tag = el.tagName.toLowerCase();
      var nm = el.getAttribute('name');
      if (nm) {
        var xn = '//' + tag + '[@name=' + xpathStringLiteral(nm) + ']';
        if (xpathMatchCount(xn) === 1) return xn;
      }

      var testId = el.getAttribute('data-testid');
      if (testId) {
        var xt = '//*[@data-testid=' + xpathStringLiteral(testId) + ']';
        if (xpathMatchCount(xt) === 1) return xt;
      }

      var ph = el.getAttribute('placeholder');
      if (ph) {
        var xp = '//' + tag + '[@placeholder=' + xpathStringLiteral(ph) + ']';
        if (xpathMatchCount(xp) === 1) return xp;
      }

      var st = getShortTextForXPath(el);
      if (st) {
        var lit = xpathStringLiteral(st);
        var xeq = '//' + tag + '[normalize-space(.)=' + lit + ']';
        if (xpathMatchCount(xeq) === 1) return xeq;
        var xcon = '//' + tag + '[contains(normalize-space(.),' + lit + ')]';
        if (xpathMatchCount(xcon) === 1) return xcon;
      }

      var p = el.parentElement;
      var depth = 0;
      while (p && p !== document.documentElement && depth < 15) {
        if (p.id) {
          return '//*[@id=' + xpathStringLiteral(p.id) + ']' + relativePathFromAncestor(p, el);
        }
        var dt = p.getAttribute('data-testid');
        if (dt) {
          var ax = '//*[@data-testid=' + xpathStringLiteral(dt) + ']';
          if (xpathMatchCount(ax) === 1) {
            return ax + relativePathFromAncestor(p, el);
          }
        }
        var pan = p.getAttribute('name');
        if (pan) {
          var ptag = p.tagName.toLowerCase();
          var axn = '//' + ptag + '[@name=' + xpathStringLiteral(pan) + ']';
          if (xpathMatchCount(axn) === 1) {
            return axn + relativePathFromAncestor(p, el);
          }
        }
        p = p.parentElement;
        depth++;
      }

      return getXPathAbsolute(el);
    } catch (e2) {
      return 'unknown';
    }
  }

  // ========== 工具函数：关联 Label 查找 ==========

  /**
   * 查找与表单元素关联的 <label> 文本
   * 方式1：通过 for 属性关联
   * 方式2：input 被 <label> 包裹
   * 方式3：相邻兄弟 label 或同级 label
   */
  function getAssociatedLabel(el) {
    try {
      // 方式1: <label for="inputId">
      if (el.id) {
        var label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (label) return label.textContent.trim().slice(0, 100);
      }

      // 方式2: <label><input></label>
      var parentLabel = el.closest('label');
      if (parentLabel) {
        var clone = parentLabel.cloneNode(true);
        var inputs = clone.querySelectorAll('input, select, textarea');
        inputs.forEach(function(inp) { inp.remove(); });
        var text = clone.textContent.trim();
        if (text) return text.slice(0, 100);
      }

      // 方式3: 前面紧邻的 label 或 span
      var prev = el.previousElementSibling;
      if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN')) {
        var prevText = prev.textContent.trim();
        if (prevText && prevText.length < 50) return prevText;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  // ========== 工具函数：元素信息提取（精简版） ==========

  /**
   * 提取元素的轻量描述信息
   *
   * 只保留必要字段，冗余 DOM 上下文信息（domContext、checkedState、classes、ariaLabel、role）
   * 由整页 AX 快照取代。
   *
   * 保留字段：tag, id, name, type, text, label, placeholder, title, href, xpath（唯一主定位，供 Selenium Driver4）
   */
  function getElementInfo(el) {
    try {
      // 获取直接文本内容（减少子元素噪音）
      var directText = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) { // TEXT_NODE
          directText += el.childNodes[i].textContent;
        }
      }
      directText = directText.trim();

      // 如果直接文本为空，取完整 textContent（截断）
      if (!directText) {
        directText = (el.textContent || '').trim().slice(0, 100);
      }

      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.getAttribute('name') || null,
        type: el.getAttribute('type') || null,
        text: directText.slice(0, 100),
        placeholder: el.getAttribute('placeholder') || null,
        title: el.getAttribute('title') || null,
        href: el.getAttribute('href') || null,
        xpath: getXPath(el),
        label: getAssociatedLabel(el),
      };
    } catch (e) {
      return { tag: 'unknown', xpath: 'unknown' };
    }
  }

  // ========== 安全发送操作数据 ==========

  /**
   * 查找可用的 __recordAction 函数
   * 搜索顺序：当前 window → parent → top
   * 处理 iframe 场景：exposeFunction 可能只在主框架可用
   */
  function findRecordAction() {
    try {
      if (typeof window.__recordAction === 'function') return window.__recordAction;
    } catch (e) {}
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__recordAction === 'function') return window.parent.__recordAction;
    } catch (e) {}
    try {
      if (window.top && window.top !== window && typeof window.top.__recordAction === 'function') return window.top.__recordAction;
    } catch (e) {}
    return null;
  }

  /** 缓存找到的 __recordAction 引用 */
  var __cachedRecordAction = null;

  /**
   * 将操作数据序列化后通过 __recordAction 回传 Node.js
   */
  function sendAction(data) {
    try {
      if (!__cachedRecordAction) {
        __cachedRecordAction = findRecordAction();
      }
      if (__cachedRecordAction) {
        __cachedRecordAction(JSON.stringify(data));
      } else {
        console.warn('[Recorder] __recordAction 不可用，操作未记录:', data.type,
          'frame:', window.location.href.substring(0, 80));
      }
    } catch (e) {
      // 函数引用可能失效（页面导航），清除缓存重试一次
      __cachedRecordAction = null;
      try {
        var fn = findRecordAction();
        if (fn) fn(JSON.stringify(data));
      } catch (e2) {
        // 彻底失败，静默忽略
      }
    }
  }

  // ========== 表单状态同步捕获 ==========

  /**
   * 同步捕获当前页面所有表单元素的精确状态
   * 在 pointerdown / keydown capture 阶段调用，保证读取到操作前的真实值。
   * 返回 { xpath: { value, checked, selectedIndex, ariaExpanded, ... } }，键与 element.xpath 一致
   */
  function captureFormState() {
    var state = {};
    try {
      var elements = document.querySelectorAll('input, select, textarea, [aria-expanded], [aria-checked], [aria-selected]');
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        var sel = getXPath(el);
        var entry = {};
        var tag = el.tagName.toLowerCase();

        // 表单值
        if (tag === 'input' || tag === 'textarea') {
          entry.value = el.value || '';
          if (el.type === 'checkbox' || el.type === 'radio') {
            entry.checked = el.checked;
          }
        } else if (tag === 'select') {
          entry.selectedIndex = el.selectedIndex;
          entry.value = el.value || '';
        }

        // ARIA 状态
        var ariaExpanded = el.getAttribute('aria-expanded');
        if (ariaExpanded !== null) entry.ariaExpanded = ariaExpanded;

        var ariaChecked = el.getAttribute('aria-checked');
        if (ariaChecked !== null) entry.ariaChecked = ariaChecked;

        var ariaSelected = el.getAttribute('aria-selected');
        if (ariaSelected !== null) entry.ariaSelected = ariaSelected;

        // 只保留有实质信息的条目
        if (Object.keys(entry).length > 0) {
          state[sel] = entry;
        }
      }
    } catch (e) {
      // 静默忽略
    }
    return state;
  }

  /** 暂存 pointerdown 时捕获的表单状态，供后续 click/dblclick/contextmenu 使用 */
  var __pendingFormState = null;

  // ---------- pointerdown：在所有 click 之前同步捕获表单状态 ----------
  document.addEventListener('pointerdown', function(e) {
    __pendingFormState = captureFormState();
  }, true);

  // ========== 事件监听器注册（仅物理动作） ==========

  // ---------- 单击事件 ----------
  document.addEventListener('click', function(e) {
    sendAction({
      type: 'click',
      element: getElementInfo(e.target),
      position: { x: e.clientX, y: e.clientY },
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      formStateDelta: __pendingFormState
    });
    __pendingFormState = null;
  }, true);

  // ---------- 双击事件 ----------
  document.addEventListener('dblclick', function(e) {
    sendAction({
      type: 'dblclick',
      element: getElementInfo(e.target),
      position: { x: e.clientX, y: e.clientY },
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      formStateDelta: __pendingFormState
    });
    __pendingFormState = null;
  }, true);

  // ---------- 右键点击事件 ----------
  document.addEventListener('contextmenu', function(e) {
    sendAction({
      type: 'rightclick',
      element: getElementInfo(e.target),
      position: { x: e.clientX, y: e.clientY },
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      formStateDelta: __pendingFormState
    });
    __pendingFormState = null;
  }, true);

  // ---------- 关键按键事件（Enter / Tab / Escape / Space） ----------
  document.addEventListener('keydown', function(e) {
    // if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape' || e.key === ' ') 
    if (e.key === 'Enter') 
    {
      // keydown 没有 pointerdown 前置，需要在这里同步捕获
      var formState = captureFormState();
      sendAction({
        type: 'keypress',
        key: e.key,
        element: getElementInfo(e.target),
        url: window.location.href,
        title: document.title,
        timestamp: Date.now(),
        formStateDelta: formState
      });
    }
  }, true);

})();`;
}
