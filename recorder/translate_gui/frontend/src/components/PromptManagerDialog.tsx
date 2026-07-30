import { useState, useEffect } from "react"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog"
import { Button } from "./ui/button"
import { Textarea } from "./ui/textarea"
import { Badge } from "./ui/badge"
import { api } from "@/lib/api"

const PHASES = [
  { key: "phase1", label: "Phase 1 (snapshots→steps)" },
  { key: "phase2", label: "Phase 2 (steps→cases)" },
  { key: "phase4", label: "Phase 4 (case→agents)" },
]

export function PromptManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [prompts, setPrompts] = useState<any[]>([])
  const [selectedPhase, setSelectedPhase] = useState("phase1")
  const [content, setContent] = useState("")
  const [isCustom, setIsCustom] = useState(false)

  const loadPrompts = async () => {
    const list = await api.listPrompts()
    setPrompts(list)
  }

  useEffect(() => {
    if (open) loadPrompts()
  }, [open])

  useEffect(() => {
    const p = prompts.find((x) => x.phase === selectedPhase)
    if (p) {
      setContent(p.content)
      setIsCustom(p.isCustom)
    }
  }, [selectedPhase, prompts])

  const handleExport = async () => {
    const result = await api.exportPrompt(selectedPhase)
    setContent(result.content)
    setIsCustom(result.isCustom)
  }

  const handleImport = async () => {
    await api.importPrompt(selectedPhase, content)
    await loadPrompts()
  }

  const handleReset = async () => {
    await api.resetPrompt(selectedPhase)
    await loadPrompts()
  }

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const text = ev.target?.result as string
      setContent(text)
    }
    reader.readAsText(file)
  }

  const handleFileExport = () => {
    const blob = new Blob([content], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${selectedPhase}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Prompt 管理</DialogTitle>
        <DialogDescription>查看、导入、导出各阶段的 Prompt。导入后自定义 Prompt 优先于内置。</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex gap-2">
          {PHASES.map((p) => (
            <Button
              key={p.key}
              variant={selectedPhase === p.key ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedPhase(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isCustom ? "success" : "secondary"}>
            {isCustom ? "自定义" : "内置"}
          </Badge>
        </div>
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[300px] font-mono text-xs" />
        <div className="flex gap-2 items-center">
          <label className="text-sm text-blue-600 cursor-pointer hover:underline">
            选择文件导入...
            <input type="file" accept=".md,.txt" onChange={handleFileImport} className="hidden" />
          </label>
          <Button variant="outline" size="sm" onClick={handleFileExport}>导出为文件</Button>
          <Button variant="outline" size="sm" onClick={handleExport}>重新加载</Button>
          <Button size="sm" onClick={handleImport}>保存到工具</Button>
          {isCustom && (
            <Button variant="destructive" size="sm" onClick={handleReset}>恢复内置</Button>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>关闭</Button>
      </DialogFooter>
    </Dialog>
  )
}
