import { useState, useEffect } from "react"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { api } from "@/lib/api"

interface ProfileInfo {
  name: string
  protocol: string
  baseUrl: string
  model: string
  reasoningEffort: string
  hasKey: boolean
}

const PROTOCOLS = [
  { value: "chat_completions", label: "Chat Completions（/chat/completions）" },
  { value: "responses", label: "Responses（/responses）" },
]

const EFFORTS = [
  { value: "", label: "默认（不指定）" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
]

export function ModelConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [active, setActive] = useState("")
  const [name, setName] = useState("")
  const [protocol, setProtocol] = useState("chat_completions")
  const [baseUrl, setBaseUrl] = useState("")
  const [model, setModel] = useState("")
  const [reasoningEffort, setReasoningEffort] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [hasKey, setHasKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState("")
  const [testOk, setTestOk] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  const isExisting = profiles.some((p) => p.name === name)

  const applyProfile = (p: ProfileInfo) => {
    setName(p.name)
    setProtocol(p.protocol || "chat_completions")
    setBaseUrl(p.baseUrl || "")
    setModel(p.model || "")
    setReasoningEffort(p.reasoningEffort || "")
    setApiKey("")
    setHasKey(!!p.hasKey)
    setTestMsg("")
    setTestOk(null)
  }

  const resetForm = () => {
    setName("")
    setProtocol("chat_completions")
    setBaseUrl("")
    setModel("")
    setReasoningEffort("")
    setApiKey("")
    setHasKey(false)
    setTestMsg("")
    setTestOk(null)
  }

  const applyDeepSeekFlashPreset = () => {
    setName("DeepSeek Flash")
    setProtocol("chat_completions")
    setBaseUrl("https://api.deepseek.com")
    setModel("deepseek-v4-flash")
    setReasoningEffort("")
    setApiKey("")
    setHasKey(false)
    setTestMsg("")
    setTestOk(null)
  }

  const refresh = async () => {
    const res = await api.listConfigProfiles()
    const list: ProfileInfo[] = res?.profiles || []
    setProfiles(list)
    setActive(res?.active || "")
    const target = list.find((p) => p.name === res?.active) || list[0]
    if (target) {
      applyProfile(target)
    } else {
      resetForm()
    }
  }

  useEffect(() => {
    if (open) {
      refresh()
    }
  }, [open])

  const currentPayload = () => ({ protocol, baseUrl, model, reasoningEffort, apiKey })

  const handleTest = async () => {
    setTesting(true)
    setTestMsg("")
    setTestOk(null)
    try {
      const result = await api.testLLMConnection(name, currentPayload())
      setTestOk(result.success)
      setTestMsg(result.success ? `连接成功: ${result.reply}` : result.message)
    } catch (e: any) {
      setTestOk(false)
      setTestMsg(e.message || "测试失败")
    }
    setTesting(false)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setTestOk(false)
      setTestMsg("请填写配置名称")
      return
    }
    setSaving(true)
    try {
      const result = await api.saveConfigProfile(name, currentPayload())
      if (!result.success) {
        setTestOk(false)
        setTestMsg(result.message)
        return
      }
      await refresh()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!isExisting) return
    await api.deleteConfigProfile(name)
    await refresh()
  }

  const handleSetActive = async () => {
    if (!isExisting) return
    await api.setActiveConfigProfile(name)
    setActive(name)
  }

  const keyPlaceholder = hasKey ? "已保存，留空则保留原值" : "请输入 API Key"

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>模型配置</DialogTitle>
        <DialogDescription>
          配置保存在 ~/.ui_translator/ai.local.json，下次自动加载当前选用的配置。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">配置选择</label>
          <div className="mt-1 flex items-center gap-2">
            <select
              value={isExisting ? name : ""}
              onChange={(e) => {
                const p = profiles.find((x) => x.name === e.target.value)
                if (p) applyProfile(p)
              }}
              className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">{isExisting || !name ? "选择已保存的配置..." : `${name}（未保存）`}</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}{p.name === active ? "（当前）" : ""}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={applyDeepSeekFlashPreset} className="mt-2">
              套用 DeepSeek Flash 官方预设
            </Button>
            <Button size="sm" variant="outline" onClick={resetForm}>新建配置</Button>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">配置名称</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 minimax / deepseek" className="mt-1" />
        </div>

        <div>
          <label className="text-sm font-medium">协议</label>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            className="mt-1 w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {PROTOCOLS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Base URL</label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className="mt-1" />
        </div>

        <div>
          <label className="text-sm font-medium">模型名</label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="例如 deepseek-flash" className="mt-1" />
        </div>

        <div>
          <label className="text-sm font-medium">推理强度（可选）</label>
          <select
            value={reasoningEffort}
            onChange={(e) => setReasoningEffort(e.target.value)}
            className="mt-1 w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {EFFORTS.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">API Key</label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyPlaceholder}
            className="mt-1"
          />
        </div>

        {testMsg && (
          <div className={`text-sm rounded-md p-3 ${testOk ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {testMsg}
          </div>
        )}
      </div>
      <DialogFooter>
        <div className="flex items-center gap-2">
          {isExisting && name !== active && (
            <Button variant="outline" onClick={handleSetActive}>设为当前</Button>
          )}
          {isExisting && (
            <Button variant="outline" onClick={handleDelete}>删除</Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? "测试中..." : "测试连接"}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
