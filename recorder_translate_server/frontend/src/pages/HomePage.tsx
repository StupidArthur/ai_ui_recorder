import { Typography, Divider } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { listJobs } from '@/api/jobs'
import { UploadZone } from '@/components/UploadZone'
import { JobList } from '@/components/JobList'
import { AppLayout } from '@/components/Layout'

const { Title, Paragraph } = Typography

export function HomePage() {
  const { data: jobs = [], isLoading, refetch } = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    refetchInterval: 5000,
  })

  return (
    <AppLayout>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <Title level={3} style={{ marginBottom: 8 }}>
            上传录制文件
          </Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            上传包含 meta.json 和 record/ 目录的 ZIP 文件，自动翻译为中文测试用例
          </Paragraph>
        </div>

        <UploadZone refetch={refetch} />

        <Divider style={{ margin: '8px 0' }} />

        <div>
          <Title level={4} style={{ marginBottom: 16 }}>
            任务列表
          </Title>
          <JobList jobs={jobs} isLoading={isLoading} refetch={refetch} />
        </div>
      </div>
    </AppLayout>
  )
}
