recorder_translate_server 的目标是将 Python 命令行工具包装为 Web 服务，降低用户使用门槛。整体技术选型（FastAPI + SSE + 内存队列）非常契合单机轻量级工具的定位。

👍 哪里好（设计亮点）
极其轻量，拒绝过度设计：

采用 FastAPI + Uvicorn + 内存字典（dict）管理任务，没有引入 Redis、Celery 或数据库。对于一个单机版/局域网部署的工具来说，这是最合理的选择，部署成本极低。

职责复用完美：

Server 层只做“上传 -> 状态流转 -> 下载”的 HTTP 胶水层，翻译核心逻辑直接 import record_translate 包暴露的接口（validate, preprocess, workflow），没有重复造轮子。

用户体验闭环设计好：

采用了 SSE（Server-Sent Events）推送进度。对于动辄几分钟的 LLM 长轮询任务，SSE 比 WebSocket 更轻量，比轮询（Polling）更优雅。

⚠️ 哪里不好（潜在隐患）
缺乏生命周期与垃圾回收机制（OOM 与爆盘风险）：

内存字典泄漏：jobs.py 使用内存 dict 存任务状态。随着不断上传，字典会无限膨胀。

磁盘堆积：每次解压到 uploads/{job_id}/，生成翻译产物后没有删除逻辑。几天不用，服务器磁盘就会被快照图片和生成的 zip 文件塞满。

重启状态丢失：一旦重启服务，内存 dict 清空，但 uploads/ 目录里的历史垃圾还在，变成“孤儿文件”。

CPU 阻塞异步事件循环的风险（Blocking Event Loop）：

FastAPI 是异步的，但翻译流程中的 computeAllDiffs（Myers diff 算法）、海量小文件 I/O 读写、Pydantic 全量校验属于 CPU 密集型或同步 I/O 操作。如果直接在 FastAPI 的路由或默认 task 里执行，会卡死整个 Event Loop，导致在这期间其他用户的 SSE 推送和网页访问被挂起（无响应）。

Zip 文件解压的不确定性与安全性：

结构不确定：用户打包 zip 的习惯不同，有的人会选中 run_2026-xx 文件夹打包，有的人会进到文件夹里选中 meta.json 打包。解压后 meta.json 的层级位置是不确定的。

Zip Slip 漏洞：标准库 zipfile.extractall() 如果遇到恶意构造的包含 ../ 的路径，可能导致文件被解压覆盖到服务器其他系统目录（如 /etc/）。

🛠️ 要怎么改（优化建议）
建议在开始编码前，对 recorder_translate_server 的方案做以下 4 点修正：

1. 增加任务清理与垃圾回收机制（TTL）

改造点：在 FastAPI 生命周期（或后台任务）中增加定时清理逻辑。

具体做法：
任务完成后，保留 1-2 小时供用户下载。设定一个后台轮询线程（如 asyncio.create_task(cleanup_worker())），每 30 分钟扫描一次 jobs 字典和 uploads/ 文件夹，将超时（如 > 2小时）的任务移出内存，并使用 shutil.rmtree 强制删除对应的本地目录和临时 Zip 包。

2. 安全执行 CPU 密集型任务（隔离线程池）

改造点：防止 record_translate 的同步 CPU 代码卡死 Web 服务。

具体做法：
在执行耗时预处理时，将任务丢入线程池：

Python
import asyncio
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=4)
# 把 CPU 密集的 preprocess 放到单独线程跑
enriched, meta = await asyncio.get_running_loop().run_in_executor(
    executor, 
    lambda: preprocess(run_dir) 
)
(注：如果翻译管线里 workflow.run_workflow 已经是纯粹的 async 并只等待网络 I/O，那可以直接 await，但只要有大规模 Diff 计算，请务必用 run_in_executor。)

3. 规范化 Zip 解压层级（鲁棒性优化）

改造点：容错处理用户的奇怪打包习惯。

具体做法：
解压完成后，写一个递归扫描函数 find_meta_json(root_dir)，找到 meta.json 所在的目录并将其作为真正的 run_dir。
同时，在解压前必须过滤 Zip 路径名，安全提取：

Python
for member in zip_ref.namelist():
    # 忽略绝对路径和含 ../ 的路径，防止目录穿越
    if not member.startswith('/') and '../' not in member:
        zip_ref.extract(member, target_dir)
4. SSE 状态恢复机制

改造点：如果用户刷新了前端页面，当前的 SSE 就会断开重连，前端不知道当前进度到哪了。

具体做法：
jobs.py 的内存字典里，除了存 status，还要存一个 last_message 或 progress_history 列表。当新接入一个 SSE /stream 请求时，服务端立刻把该任务最近的一条进度 push 过去，避免前端刷新后一直处于“白屏等待下一条日志”的尴尬局面。