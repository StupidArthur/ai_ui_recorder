# AI Proxy Go Tool

独立的 Go 中转工具，提供：

1. `POST /v1/chat/completions`（OpenAI 兼容转发）
2. `POST /api/chat`（前端验证页使用的简化流式问答接口）
3. `GET /`（内嵌流式验证页面）
4. `GET /health`（健康检查）

## 1. 快速开始（Windows PowerShell）

在项目根目录执行：

```powershell
cd tool/ai-proxy-go
Copy-Item config/proxy.local.example.json config/proxy.local.json
```

编辑 `config/proxy.local.json`，填写：

- `upstream.baseUrl`
- `upstream.apiKey`
- `upstream.model`
- `trialKeys`

启动：

```powershell
go run ./cmd/server
```

访问：

- 验证页：`http://127.0.0.1:8787/`
- 健康检查：`http://127.0.0.1:8787/health`

## 2. 与主工程联调

将主工程 `config/ai.local.json` 调整为：

```json
{
  "baseUrl": "http://127.0.0.1:8787/v1",
  "apiKey": "trial_demo_key_001",
  "model": "Qwen/Qwen3-VL-235B-A22B-Instruct"
}
```

然后照常运行主工程翻译流程即可。

## 3. 关停策略

- **硬关停**：直接停止 Go 进程。
- **软关停**：将 `enabled` 改为 `false`，重启服务后统一拒绝请求。
- **按 key 收回**：从 `trialKeys` 删除某个 key，重启服务后生效。

## 4. 注意事项

- 上游厂商 key 只放在代理配置里，不放到客户端。
- 该工具内置了 `key + IP` 粒度的分钟限流，适合试用场景的基础防滥用。

