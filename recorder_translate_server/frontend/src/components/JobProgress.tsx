import { Progress, Tag, Typography } from 'antd'
import { CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import type { JobView } from '@/api/jobs'

const { Text } = Typography

const PHASE_LABELS: Record<string, string> = {
  preprocess: '预处理',
  phase1: '阶段一',
  phase2: '阶段二',
  phase4: '阶段四',
  finalize: '打包结果',
}

interface JobProgressProps {
  job: JobView
}

export function JobProgress({ job }: JobProgressProps) {
  const pct =
    job.total_steps > 0
      ? Math.round((job.current_step / job.total_steps) * 100)
      : 0

  const isRunning = job.status === 'running'
  const isCompleted = job.status === 'completed'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Progress
        percent={pct}
        status={isCompleted ? 'success' : isRunning ? 'active' : 'normal'}
        strokeColor={{ '0%': '#0070f3', '100%': '#0070f3' }}
        format={() =>
          isCompleted ? (
            <CheckCircleOutlined style={{ color: '#10b981' }} />
          ) : isRunning ? (
            <LoadingOutlined />
          ) : (
            `${pct}%`
          )
        }
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {job.current_phase && (
          <Tag color="blue">{PHASE_LABELS[job.current_phase] ?? job.current_phase}</Tag>
        )}
        {job.message && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            {job.message}
          </Text>
        )}
      </div>

      {job.status === 'queued' && job.queue_ahead > 0 && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          前面还有 {job.queue_ahead} 个任务在排队...
        </Text>
      )}

      {job.status === 'failed' && job.error && (
        <Text type="danger" style={{ fontSize: 13 }}>
          错误: {job.error}
        </Text>
      )}
    </div>
  )
}
