import { Layout, Button, Space } from 'antd'
import { MoonOutlined, SunOutlined } from '@ant-design/icons'
import { useThemeStore } from '@/hooks/useTheme'

const { Header, Content } = Layout

interface LayoutProps {
  children: React.ReactNode
}

export function AppLayout({ children }: LayoutProps) {
  const { mode, toggle } = useThemeStore()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="#0070f3" />
            <path
              d="M8 9h12M8 14h8M8 19h10"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span
            style={{
              fontWeight: 600,
              fontSize: 16,
              color: 'var(--color-text)',
            }}
          >
            Recorder Translate
          </span>
        </div>
        <Space>
          <Button
            type="text"
            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggle}
            title="Toggle theme"
          />
        </Space>
      </Header>
      <Content
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '24px',
        }}
      >
        {children}
      </Content>
    </Layout>
  )
}
