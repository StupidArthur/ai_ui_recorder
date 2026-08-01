import { useState, useEffect, useCallback, useRef } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "./components/ui/button"
import { Badge } from "./components/ui/badge"
import { Input } from "./components/ui/input"
import { ModelConfigDialog } from "./components/ModelConfigDialog"
import { api } from "./lib/api"

interface RunInfo {
  dirName: string
  fullPath: string
  title: string
  startedAt: string
  actionCount: number
  translated: boolean
}

interface TranslateProgress {
  phase: string
  step: string
  detail: string
  percent: number
}

const AGENT_RESULT_PATH = "translate/phase3/agents.txt"
const CASE_RESULT_PATH = "translate/phase4/cases.md"

export default function App() {
  const [outputDir, setOutputDir] = useState("")
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [selectedRun, setSelectedRun] = useState<RunInfo | null>(null)
  const [translating, setTranslating] = useState(false)
  const [progress, setProgress] = useState<TranslateProgress | null>(null)
  const [resultFile, setResultFile] = useState<string>("")
  const [resultContent, setResultContent] = useState<string>("")
  const [showModelConfig, setShowModelConfig] = useState(false)
  const [logText, setLogText] = useState("")
  const viewerRef = useRef<HTMLPreElement>(null)

  // 日志/内容更新时自动滚到底部（最新内容在底部）
  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.scrollTop = viewerRef.current.scrollHeight
    }
  }, [logText, resultContent])

  const refreshRuns = useCallback(async () => {
    if (!outputDir) return
    const list = await api.listRuns(outputDir)
    setRuns(list || [])
  }, [outputDir])

  useEffect(() => {
    refreshRuns()
  }, [refreshRuns])

  // 轮询进度
  useEffect(() => {
    if (!translating) return
    const timer = setInterval(async () => {
      const p = await api.getProgress()
      if (p && p.phase) {
        setProgress(p)
      }
      const log = await api.readFile(selectedRun?.fullPath || "", "translate/logs/generate.log")
      if (log) setLogText(log)
    }, 500)
    return () => clearInterval(timer)
  }, [translating, selectedRun])

  const handleTranslate = async () => {
    if (!selectedRun) return
    setTranslating(true)
    setProgress({ phase: "init", step: "start", detail: "正在启动...", percent: 0 })
    setResultContent("")
    setResultFile("")
    try {
      const result = await api.startTranslate(selectedRun.fullPath)
      // 翻译返回后立即补读一次日志，避免轮询定时器被清除导致最后一屏日志丢失
      const finalLog = await api.readFile(selectedRun.fullPath, "translate/logs/generate.log")
      if (finalLog) setLogText(finalLog)
      if (result.success) {
        setProgress({ phase: "done", step: "complete", detail: "翻译完成", percent: 100 })
        const caseContent = await api.readFile(selectedRun.fullPath, CASE_RESULT_PATH)
        if (caseContent) {
          setResultFile(CASE_RESULT_PATH)
          setResultContent(caseContent)
        } else {
          const agentContent = await api.readFile(selectedRun.fullPath, AGENT_RESULT_PATH)
          setResultFile(AGENT_RESULT_PATH)
          setResultContent(agentContent || "(暂无翻译结果)")
        }
        setSelectedRun((current) => current ? { ...current, translated: true } : current)
        await refreshRuns()
      } else {
        setProgress({ phase: "error", step: "error", detail: result.message, percent: 0 })
      }
    } catch (e: any) {
      setProgress({ phase: "error", step: "error", detail: e.message, percent: 0 })
    }
    setTranslating(false)
  }

  const handleSelectRun = async (run: RunInfo) => {
    setSelectedRun(run)
    setResultContent("")
    setResultFile("")
    if (run.translated) {
      const caseContent = await api.readFile(run.fullPath, CASE_RESULT_PATH)
      if (caseContent) {
        setResultFile(CASE_RESULT_PATH)
        setResultContent(caseContent)
      }
    }
  }

  const loadFile = async (relPath: string) => {
    if (!selectedRun) return
    const content = await api.readFile(selectedRun.fullPath, relPath)
    setResultFile(relPath)
    setResultContent(content || "")
  }

  const phaseLabel = (phase: string) => {
    const map: Record<string, string> = {
      init: "初始化", phase1: "Phase 1 结构化", phase2: "Phase 2 切分用例",
      phase3: "Phase 3 执行用例", phase4: "Phase 4 Case表格", done: "完成", error: "错误",
    }
    return map[phase] || phase
  }

  return (
    <div className="flex flex-col h-screen relative">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b px-4 py-3 bg-white">
        <div className="flex items-center gap-2 flex-1">
          <Input
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            placeholder="输入 output 目录路径（包含 run_* 文件夹）"
            className="flex-1"
          />
          <Button size="sm" variant="outline" onClick={async () => {
            const dir = await api.selectDirectory()
            if (dir) {
              setOutputDir(dir)
            }
          }}>选择目录</Button>
          <Button size="sm" onClick={refreshRuns}>刷新</Button>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowModelConfig(true)}>模型配置</Button>
      </header>

      {/* 主体 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：录制列表 */}
        <div className="w-80 border-r overflow-y-auto bg-gray-50">
          {runs.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              {outputDir ? "未找到录制目录" : "请先输入 output 目录路径"}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {runs.map((run) => (
                <div
                  key={run.dirName}
                  onClick={() => handleSelectRun(run)}
                  className={`p-3 rounded-md cursor-pointer border transition-colors ${
                    selectedRun?.dirName === run.dirName
                      ? "bg-primary text-primary-foreground"
                      : "bg-white hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">{run.title || run.dirName}</span>
                    {run.translated && (
                      <Badge variant="success" className="ml-2 shrink-0">已翻译</Badge>
                    )}
                  </div>
                  <div className={`text-xs mt-1 ${selectedRun?.dirName === run.dirName ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {run.actionCount} 个操作 · {run.startedAt || run.dirName}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右侧：详情/进度/结果 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedRun ? (
            <>
              {/* 翻译控制 */}
              <div className="border-b px-4 py-3 bg-white shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-semibold">{selectedRun.title || selectedRun.dirName}</h2>
                    <p className="text-sm text-muted-foreground">{selectedRun.actionCount} 个操作</p>
                  </div>
                  <Button onClick={handleTranslate} disabled={translating}>
                    {translating ? "翻译中..." : selectedRun.translated ? "重新翻译" : "开始翻译"}
                  </Button>
                </div>
                {progress && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={progress.phase === "done" ? "success" : progress.phase === "error" ? "destructive" : "default"}>
                        {phaseLabel(progress.phase)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{progress.detail}</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${progress.phase === "error" ? "bg-destructive" : "bg-primary"}`}
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 文件按钮栏 */}
              {selectedRun.translated && (
                <div className="border-b px-4 py-2 bg-gray-50 shrink-0 flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant={resultFile === "" ? "default" : "outline"} onClick={() => { setResultFile(""); setResultContent("") }}>
                    日志
                  </Button>
                  {[
                    { label: "切片结果", path: "translate/phase2/case_slices.json" },
                    { label: "覆盖核对", path: "translate/phase2/coverage.md" },
                    { label: "执行用例", path: AGENT_RESULT_PATH },
                    { label: "Case 表格", path: CASE_RESULT_PATH },
                    { label: "结构化步骤", path: "translate/phase1/structured_steps.json" },
                  ].map((f) => (
                    <Button key={f.path} size="sm" variant={resultFile === f.path ? "default" : "outline"} onClick={() => loadFile(f.path)}>
                      {f.label}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => api.openInFolder(selectedRun.fullPath)}>
                    打开目录
                  </Button>
                </div>
              )}

              {/* 合并查看区：选中文件看内容，不选看日志 */}
              <div className="flex-1 overflow-hidden p-4">
                {resultFile.endsWith(".md") ? (
                  <div className="markdown-view h-full overflow-y-auto bg-white border rounded-md px-8 py-6">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {resultContent || "(暂无内容)"}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <pre ref={viewerRef} className="text-xs h-full overflow-y-auto whitespace-pre-wrap font-mono bg-secondary/30 rounded-md p-4">
                    {resultContent || logText || "(暂无内容)"}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              请从左侧选择一个录制目录
            </div>
          )}
        </div>
      </div>

      {/* 对话框 */}
      <ModelConfigDialog open={showModelConfig} onClose={() => setShowModelConfig(false)} />

      {/* 右下角署名 */}
      <div className="absolute bottom-2 right-3 text-xs text-muted-foreground pointer-events-none select-none">
        v0.2.1 designed by @yuzechao
      </div>
    </div>
  )
}
