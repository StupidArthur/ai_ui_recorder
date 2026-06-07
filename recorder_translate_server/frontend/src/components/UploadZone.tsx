import { useNavigate } from 'react-router-dom'
import { Upload, message } from 'antd'
import { uploadJob } from '@/api/jobs'

const { Dragger } = Upload

interface UploadZoneProps {
  refetch?: () => void
}

export function UploadZone({ refetch }: UploadZoneProps) {
  const navigate = useNavigate()

  const props: Parameters<typeof Dragger>[0] = {
    accept: '.zip',
    showUploadList: false,
    beforeUpload: (file: File) => {
      uploadJob(file, ({ loaded, total }) => {
        // progress callback — could be used to show a progress bar
        // Ant Dragger doesn't directly support upload progress, but we keep the reference
        void loaded
        void total
      })
        .then((res) => {
          message.success('上传成功，任务已加入队列')
          refetch?.()
          navigate(`/jobs/${res.job_id}`)
        })
        .catch((err: Error) => {
          message.error(err.message || '上传失败')
        })
      // Return false to prevent antd from trying to upload itself
      return false
    },
  }

  return (
    <Dragger {...props} style={{ padding: '40px 0' }}>
      <p style={{ fontSize: 48, marginBottom: 16 }}>
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          style={{ color: 'var(--color-primary)' }}
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17,8 12,3 7,8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </p>
      <p
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: 'var(--color-text)',
          marginBottom: 8,
        }}
      >
        点击或拖拽 ZIP 文件到这里上传
      </p>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
        上传 UI 录制文件（包含 meta.json 和 record/ 目录）
      </p>
    </Dragger>
  )
}
