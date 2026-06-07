import { Tag } from 'antd'
import type { JobView } from '@/api/jobs'

const STATUS_CONFIG: Record<
  JobView['status'],
  { color: string; label: string }
> = {
  queued: { color: 'default', label: '排队中' },
  running: { color: 'processing', label: '运行中' },
  completed: { color: 'success', label: '已完成' },
  failed: { color: 'error', label: '失败' },
  cancelled: { color: 'default', label: '已取消' },
}

interface StatusBadgeProps {
  status: JobView['status']
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  return (
    <Tag color={config.color} style={{ borderRadius: 4 }}>
      {config.label}
    </Tag>
  )
}
