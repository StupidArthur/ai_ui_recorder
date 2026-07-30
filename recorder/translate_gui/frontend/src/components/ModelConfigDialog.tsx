import { useState, useEffect } from "react"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { api } from "@/lib/api"

interface ModelOption {
  name: string
  baseUrl: string
}

export function ModelConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState("")
  const [testOk, setTestOk] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  const loadConfig = async () => {
    const cfg = await api.loadAIConfig()
    setApiKey("")
    setModel(cfg.model || "")
  }

  useEffect(() => {
    if (open) {
      loadConfig()
      api.listModels().then((list: ModelOption[]) => {
        setModelOptions(list || [])
      })
    }
  }, [open])

  const handleSelectModel = (name: string) => {
    setModel(name)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestMsg("")
    setTestOk(null)
    try {
      const result = await api.testLLMConnection({ apiKey, model })
      setTestOk(result.success)
      setTestMsg(result.success ? `连接成功: ${result.reply}` : result.message)
    } catch (e: any) {
      setTestOk(false)
      setTestMsg(e.message || "测试失败")
    }
    setTesting(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.saveAIConfig({ apiKey, model })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>模型配置</DialogTitle>
        <DialogDescription>配置 LLM API 连接信息。API Key 留空则保持原值。</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Model</label>
          <select
            value={modelOptions.some((o) => o.name === model) ? model : ""}
            onChange={(e) => handleSelectModel(e.target.value)}
            className="mt-1 w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">{model && !modelOptions.some((o) => o.name === model) ? `${model}（自定义）` : "选择模型..."}</option>
            {modelOptions.map((opt) => (
              <option key={opt.name} value={opt.name}>{opt.name}</option>
            ))}
          </select>
          {model && !modelOptions.some((o) => o.name === model) && (
            <p className="mt-1 text-xs text-amber-600">当前模型不在内置列表中，将使用兼容默认参数（reasoning_split=true）。</p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium">API Key</label>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="留空则保持已保存的值" className="mt-1" />
        </div>
        {testMsg && (
          <div className={`text-sm rounded-md p-3 ${testOk ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {testMsg}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={handleTest} disabled={testing}>
          {testing ? "测试中..." : "测试连接"}
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
