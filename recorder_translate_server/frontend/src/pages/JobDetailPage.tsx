import { useParams, useNavigate } from 'react-router-dom'
import { Typography, Card, Button, Result, Descriptions } from 'antd'
import { ArrowLeftOutlined, DownloadOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { getJob, getDownloadUrl } from '@/api/jobs'
import { useJobStream } from '@/hooks/useJobStream'
import { StatusBadge } from '@/components/StatusBadge'
import { JobProgress } from '@/components/JobProgress'
import { ResultPreview } from '@/components/ResultPreview'
import { AppLayout } from '@/components/Layout'

const { Title, Text } = Typography

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()

  const { data: job, isLoading, error } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => getJob(jobId!),
    enabled: !!jobId,
    refetchInterval: 3000,
  })

  // Subscribe to SSE for live progress
  useJobStream(jobId)

  if (isLoading) return <AppLayout><Card loading style={{ marginTop: 24 }} /></AppLayout>
  if (error || !job) {
    return (
      <AppLayout>
        <Result
          status="error"
          title="任务不存在"
          extra={
            <Button type="primary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} type="text" />
          <Title level={4} style={{ margin: 0 }}>
            任务详情
          </Title>
          <StatusBadge status={job.status} />
        </div>

        <Card>
          <Descriptions column={2} size="small">
            <Descriptions.Item label="任务 ID">
              <Text copyable style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {job.job_id}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {new Date(job.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
            </Descriptions.Item>
            <Descriptions.Item label="当前阶段">{job.current_phase || '-'}</Descriptions.Item>
            <Descriptions.Item label="进度">
              {job.total_steps > 0
                ? `${job.current_step} / ${job.total_steps} (${Math.round((job.current_step / job.total_steps) * 100)}%)`
                : '-'}
            </Descriptions.Item>
          </Descriptions>

          <div style={{ marginTop: 24 }}>
            <JobProgress job={job} />
          </div>

          {job.status === 'completed' && (
            <div style={{ marginTop: 24 }}>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                href={getDownloadUrl(job.job_id)}
                target="_blank"
              >
                下载结果 ZIP
              </Button>
            </div>
          )}
        </Card>

        {job.status === 'completed' && job.job_id && (
          <Card title="结果预览">
            <ResultPreview job={job} />
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
