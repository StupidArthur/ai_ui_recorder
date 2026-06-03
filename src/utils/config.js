/**
 * config.js - 全局配置常量
 *
 * 集中管理所有可调参数，修改配置无需改动业务代码。
 * 按功能域分组：录制器 → 截图 → 输出 → 快照 → 预处理 → AI 翻译 → 进程控制。
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

/** 截图子目录名 */
export const SCREENSHOTS_SUBDIR = 'screenshots';

/** 日志文件名 */
export const LOG_FILENAME = 'recorder.log';

/** 快照数据子目录名 */
export const SNAPSHOTS_DATA_SUBDIR = 'snapshots';

/** 操作数据子目录名 */
export const ACTIONS_DATA_SUBDIR = 'actions';

/** 录制元信息文件名（含操作摘要，取代原 actions.json 和手工测试用例.md） */
export const META_FILENAME = 'meta.json';

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

// ==================== 预处理配置（case_translate/preprocessor） ====================

/** 预处理输出子目录名（位于 run_XXXX/ 下） */
export const PREPROCESSED_SUBDIR = 'preprocessed';

/** 快照 diff 输出子目录名（位于 preprocessed/ 下） */
export const DIFFS_DATA_SUBDIR = 'diffs';

/** 富化后的 action 输出子目录名（位于 preprocessed/ 下） */
export const ENRICHED_DATA_SUBDIR = 'enriched';

/** 预处理日志文件名 */
export const PREPROCESS_LOG_FILENAME = 'preprocess.log';

/**
 * Diff 文本截断阈值（字符数）
 * 超过此长度的 diff 将被截断，避免 AI 输入过长浪费 token。
 * 截断后会保留首尾各一半，中间以省略号连接。
 */
export const DIFF_TRUNCATE_THRESHOLD = 3000;

/**
 * 上下文片段提取：被操作元素的同级兄弟节点最大数量
 * 从快照中提取操作元素的父节点及其最近 N 个兄弟，构建精简的 UI 上下文。
 */
export const CONTEXT_EXCERPT_MAX_SIBLINGS = 5;

// ==================== 语义归并配置（case_translate/preprocessor/action-merge） ====================

/** 归并报告输出子目录名（位于 preprocessed/ 下） */
export const MERGED_DATA_SUBDIR = 'merged';

/**
 * 双击去重：时间阈值（毫秒）
 * 浏览器双击会依次触发 click → click → dblclick 三个事件，
 * 若 click 与 dblclick 时间差在此阈值内且作用于同一元素，则视为冗余 click。
 */
export const DBLCLICK_TIME_THRESHOLD_MS = 500;

/**
 * 密码字段脱敏替代文本
 * 当输入识别检测到 type="password" 的输入框时，用此文本替代真实密码值。
 */
export const PASSWORD_MASK = '[MASKED]';

// ==================== AI 用例翻译配置 ====================

/**
 * Evidence 滑动窗口大小
 * 每次调用 AI 生成单条 evidence 时，携带最近 N 条已生成的 evidence 作为上下文，
 * 帮助 AI 理解操作的连续性和业务流程。
 */
export const EVIDENCE_CONTEXT_WINDOW_SIZE = 10;

/** AI 生成的逐条操作分析文件名（原 AI_evidence.md） */
export const AI_STEPS_FILENAME = 'AI_steps.md';

/** Phase 1 结构化步骤文件名（机器主消费，替代 AI_steps.md 作为主输出） */
export const AI_STEPS_STRUCTURED_FILENAME = 'step_2_structured_steps.json';

/** Phase 1 结构化步骤错误追踪文件名（记录 JSON 修复/兜底信息） */
export const AI_STEPS_ERRORS_FILENAME = 'step_2_structured_steps.errors.json';

/** AI 生成的归纳测试用例文件名（原 AI_steps.md） */
export const AI_CASES_FILENAME = 'AI_cases.md';

/** Midscene YAML（0 assert 版本）文件名 */
export const MIDSCENE_NO_ASSERT_FILENAME = 'step_4_midscene_no_assert.yaml';

/** Midscene 默认任务名 */
export const MIDSCENE_TASK_NAME = '自动生成用例';

/** Midscene 默认等待毫秒数 */
export const MIDSCENE_DEFAULT_SLEEP_MS = 1000;

/** 是否根据相邻 step 的时间间隔自动插入 sleep */
export const MIDSCENE_ENABLE_INTERVAL_SLEEP = true;

/** 自动插入 sleep 的最小阈值（毫秒），过小间隔不插入 */
export const MIDSCENE_INTERVAL_SLEEP_MIN_MS = 300;

/** 自动插入 sleep 的最大阈值（毫秒），避免极端长等待 */
export const MIDSCENE_INTERVAL_SLEEP_MAX_MS = 5000;

/** AI 生成日志文件名 */
export const GENERATE_LOG_FILENAME = 'generate.log';

/**
 * Phase 2：固定窗口内参与归纳的有效步数（仅统计 status=normal 的步骤）
 * 窗口在过滤后的有效步骤数组上滑动；可通过调大该值覆盖更长业务流程片段。
 */
export const PHASE2_CASE_WINDOW_STEPS = 20;

/**
 * Phase 2：相邻有效步骤间隔超过该阈值时，瘦身字段 gapTag 记为 longGap，否则为 contiguous
 * 与录制侧“空闲切分”思路一致，仅作弱边界信号，不写入毫秒原值。
 */
export const PHASE2_GAP_TAG_LONG_GAP_MS = 45000;

/**
 * Phase 2：传入模型的 assertText 最大字符数，超出则截断前缀
 */
export const PHASE2_ASSERT_TEXT_MAX_CHARS = 200;

/**
 * Phase 2：单窗口归纳时 LLM 最大输出 token
 */
export const PHASE2_CASE_WINDOW_MAX_TOKENS = 3500;

// ==================== 进程控制配置 ====================

/** 停止录制超时时间（毫秒），超时强制退出 */
export const STOP_TIMEOUT_MS = 60000;

/** 进程退出前延迟（毫秒），确保日志写入完成 */
export const EXIT_DELAY_MS = 1000;

// ==================== Selenium 导出（Driver4 + XPath） ====================

/**
 * 是否在录制过程中增量写出 Selenium 草稿，并在 AI Phase1 后生成终稿 Python
 * - false：保持历史行为，不写 py
 * - true：写 step_0_selenium_draft.py（原始 action，不完整）+ Phase1 后 step_0_selenium_from_recording.py
 */
export const SELENIUM_EXPORT_ENABLED = true;

/** 录制过程中追加的草稿文件名（位于 run 目录根下） */
export const SELENIUM_DRAFT_FILENAME = 'step_0_selenium_draft.py';

/** 依赖 enriched + step_2 的终稿 Python 文件名 */
export const SELENIUM_FINAL_FILENAME = 'step_0_selenium_from_recording.py';

/** 生成脚本中 chromedriver 路径占位变量名（Python 侧） */
export const SELENIUM_CHROMEDRIVER_VAR_NAME = 'CHROMEDRIVER_PATH';

/**
 * 生成 Python 中 import Driver4 的语句（用户需配置 PYTHONPATH 使该 import 可解析）
 * 例如项目根在 PYTHONPATH 且包名为 utils 时可用下方默认值。
 */
export const SELENIUM_DRIVER4_IMPORT_LINE = 'from utils.driver4 import Driver4';
