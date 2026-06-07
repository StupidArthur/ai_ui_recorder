import { useState } from 'react'
import { Tabs, Spin, Typography } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getFileUrl } from '@/api/jobs'
import type { JobView } from '@/api/jobs'

const { Text } = Typography

const FILES = [
  { key: 'structured_steps', label: '结构化步骤', path: 'translate/phase1/structured_steps.json' },
  { key: 'cases', label: '测试用例', path: 'translate/phase2/cases.md' },
  { key: 'cases_fallback', label: '用例(兜底)', path: 'translate/phase2/cases_fallback.md' },
  { key: 'coverage', label: '覆盖率', path: 'translate/phase2/coverage.md' },
  { key: 'agents', label: 'Agent 列表', path: 'translate/phase4/agents.txt' },
]

interface ResultPreviewProps {
  job: JobView
}

export function ResultPreview({ job }: ResultPreviewProps) {
  if (job.status !== 'completed') return null

  return (
    <Tabs
      items={FILES.map((f) => ({
        key: f.key,
        label: f.label,
        children: <FilePreview jobId={job.job_id} path={f.path} isMarkdown={f.path.endsWith('.md')} />,
      }))}
    />
  )
}

function FilePreview({
  jobId,
  path,
  isMarkdown,
}: {
  jobId: string
  path: string
  isMarkdown: boolean
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchContent = async () => {
    if (content !== null) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(getFileUrl(jobId, path))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      setContent(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        overflow: 'auto',
        maxHeight: 500,
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <Text
          type="secondary"
          style={{ fontSize: 12, cursor: 'pointer' }}
          onClick={fetchContent}
        >
          {content === null && !loading && !error && '点击加载预览'}
          {loading && '加载中...'}
        </Text>
      </div>
      {loading && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
        </div>
      )}
      {error && (
        <div style={{ padding: 16 }}>
          <Text type="danger">加载失败: {error}</Text>
        </div>
      )}
      {content !== null && !loading && (
        isMarkdown ? (
          <div style={{ padding: 16 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <pre
            style={{
              margin: 0,
              padding: 16,
              fontSize: 12,
              fontFamily: 'monospace',
              overflow: 'auto',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
          >
            {content}
          </pre>
        )
      )}
    </div>
  )
}
