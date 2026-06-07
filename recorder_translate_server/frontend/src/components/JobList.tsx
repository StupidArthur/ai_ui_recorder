import { useNavigate } from 'react-router-dom'
import { Button, Space, Typography } from 'antd'
import { type ProColumns, ProTable } from '@ant-design/pro-components'
import { DownloadOutlined, DeleteOutlined } from '@ant-design/icons'
import { StatusBadge } from './StatusBadge'
import type { JobView } from '@/api/jobs'
import { cancelJob, getDownloadUrl } from '@/api/jobs'
import { message } from 'antd'

const { Text } = Typography

interface JobListProps {
  jobs: JobView[]
  isLoading?: boolean
  refetch?: () => void
}

const PHASE_LABELS: Record<string, string> = {
  preprocess: '预处理',
  phase1: '阶段一',
  phase2: '阶段二',
  phase4: '阶段四',
  finalize: '打包结果',
}

export function JobList({ jobs, isLoading, refetch }: JobListProps) {
  const navigate = useNavigate()

  const columns: ProColumns<JobView>[] = [
    {
      title: '任务 ID',
      dataIndex: 'job_id',
      key: 'job_id',
      width: 200,
      render: (_, row) => (
        <Text
          copyable={{ text: row.job_id }}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        >
          {row.job_id.slice(0, 8)}...
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (_, row) => <StatusBadge status={row.status} />,
    },
    {
      title: '阶段',
      dataIndex: 'current_phase',
      key: 'current_phase',
      width: 100,
      render: (_, row) => (PHASE_LABELS[row.current_phase] ?? row.current_phase) || '-',
    },
    {
      title: '进度',
      key: 'progress',
      width: 140,
      render: (_, row) => {
        if (row.total_steps === 0) return '-'
        const pct = Math.round((row.current_step / row.total_steps) * 100)
        return (
          <div>
            <div
              style={{
                height: 4,
                background: 'var(--color-border)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: 'var(--color-primary)',
                  transition: 'width 0.3s',
                }}
              />
            </div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {row.current_step}/{row.total_steps} · {pct}%
            </Text>
          </div>
        )
      },
    },
    {
      title: '消息',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
      render: (_, row) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {row.message || '-'}
        </Text>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      render: (_, row) =>
        new Date(row.created_at).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
        }),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, row) => (
        <Space size={4}>
          {row.status === 'completed' && (
            <Button
              size="small"
              icon={<DownloadOutlined />}
              href={getDownloadUrl(row.job_id)}
              target="_blank"
            >
              下载
            </Button>
          )}
          {(row.status === 'queued' || row.status === 'running') && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={async () => {
                try {
                  await cancelJob(row.job_id)
                  message.success('已取消')
                  refetch?.()
                } catch {
                  message.error('取消失败')
                }
              }}
            >
              取消
            </Button>
          )}
          <Button
            size="small"
            type="link"
            onClick={() => navigate(`/jobs/${row.job_id}`)}
          >
            详情
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <ProTable
      columns={columns}
      dataSource={jobs}
      rowKey="job_id"
      loading={isLoading}
      search={false}
      toolBarRender={false}
      pagination={false}
      options={false}
      style={{ background: 'transparent' }}
    />
  )
}
