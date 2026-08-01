/**
 * config.js - 全局配置常量
 *
 * 集中管理所有可调参数，修改配置无需改动业务代码。
 * 按功能域分组：录制器 → 截图 → 输出 → 快照 → 进程控制。
 * 每个常量附带物理意义说明。
 */

// ==================== 录制目标 ====================

/** 要录制的目标页面 URL（修改这里即可） */
// export const TARGET_URL = 'http://10.16.11.45:31501/tpt-app/#/login';
export const TARGET_URL = 'https://tpt.supcon.com/tpt-app/#/home/chat/main?TptSaasUserTenantryId=ATL43NW8';

// ==================== 浏览器配置 ====================

/**
 * 是否启用原生窗口视口模式
 * - true：使用浏览器真实可视区（context.viewport = null），避免地址栏/标签栏导致底部被裁切
 * - false：使用固定 viewport（由 VIEWPORT_WIDTH/VIEWPORT_HEIGHT 指定）
 */
export const USE_NATIVE_WINDOW_VIEWPORT = true;

/** 固定视口宽度（像素，仅 USE_NATIVE_WINDOW_VIEWPORT=false 时生效） */
export const VIEWPORT_WIDTH = 1920;

/** 固定视口高度（像素，仅 USE_NATIVE_WINDOW_VIEWPORT=false 时生效） */
export const VIEWPORT_HEIGHT = 1080;

/** 操作间慢速延迟（毫秒），方便用户观察和截图捕获 */
export const SLOW_MO = 500;

/** 浏览器启动超时时间（毫秒） */
export const LAUNCH_TIMEOUT = 60000;

/** 页面导航超时时间（毫秒） */
export const NAVIGATION_TIMEOUT = 120000;

/**
 * 页面加载等待策略
 * - 'domcontentloaded': DOM 解析完成即继续（推荐，更快）
 * - 'networkidle': 网络空闲后继续（慢但更完整）
 * - 'load': 页面 load 事件触发后继续
 */
export const WAIT_UNTIL = 'domcontentloaded';

// ==================== 截图配置 ====================

/** 是否启用操作截图（默认关闭，需要时手动开启） */
export const SCREENSHOT_ENABLED = false;

/**
 * 截图格式
 * - 'jpeg': 支持 quality 参数，文件更小
 * - 'png': 无损，文件更大
 */
export const SCREENSHOT_FORMAT = 'jpeg';

/** 截图质量（1-100），仅 jpeg 格式生效 */
export const SCREENSHOT_QUALITY = 30;

/** 是否截取全页面（true=整页滚动截图，false=仅可视区域） */
export const SCREENSHOT_FULL_PAGE = false;

/** 操作后截图延迟（毫秒），等待页面完成渲染再截图 */
export const SCREENSHOT_DELAY_MS = 500;

// ==================== 输出配置 ====================

/** 输出根目录 */
export const OUTPUT_BASE_DIR = './output';

/**
 * 以下路径均为相对 runDir 的相对路径，完整布局见 run-layout.js
 */
export {
  META_FILENAME,
  SCREENSHOTS_SUBDIR,
  RECORD_ACTIONS_REL as ACTIONS_DATA_SUBDIR,
  RECORD_SNAPSHOTS_REL as SNAPSHOTS_DATA_SUBDIR,
  RECORD_LOG_REL as LOG_FILENAME,
  DASHBOARD_PREVIEW_REL_PATHS as DASHBOARD_PREVIEW_FILES,
} from './run-layout.js';

// ==================== Snapshot 配置 ====================

/**
 * 快照树最大深度
 * 限制 AX 树的遍历深度，避免快照体积过大
 * 推荐值 6-10：覆盖 page > dialog > group > control 的常见层级
 */
export const SNAPSHOT_MAX_DEPTH = 8;

/**
 * 快照轮询间隔（毫秒）
 * Node.js 后台周期性拍摄 AX 快照，缓存在内存中，
 * 当用户 action 到达时直接使用缓存快照，避免异步延迟导致快照"不干净"。
 */
export const SNAPSHOT_POLL_INTERVAL_MS = 300;

/**
 * 主框架导航（framenavigated）后，再等待多久检测 window.__recorderInjected（毫秒）
 *
 * SPA 路由切换后 DOM/子 iframe 可能尚未就绪；过短会误判为「脚本丢失」，
 * 且仅对主 frame 补注入时，应用在 iframe 内的交互仍无法上报。
 */
export const RECORDER_POST_NAV_INJECT_CHECK_DELAY_MS = 800;

// ==================== 进程控制配置 ====================

/** 停止录制超时时间（毫秒），超时强制退出 */
export const STOP_TIMEOUT_MS = 60000;

/** 进程退出前延迟（毫秒），确保日志写入完成 */
export const EXIT_DELAY_MS = 1000;

