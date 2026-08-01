# translate_gui

Wails desktop application that converts `ai_ui_recorder` recordings into executable agent cases and human-readable test records.

## Layout

```text
translate_gui/
├── main.go                  # Wails process entry and frontend embedding
├── app.go                   # Thin Wails API adapter
├── frontend/                # React user interface
├── internal/
│   ├── domain/              # Shared recording and translation data structures
│   ├── llm/                 # Model registry, local AI config, HTTP client
│   └── translator/          # Recording validation, preprocessing, phases 1-4
│       └── prompts/md/      # Embedded prompts used by phases 1 and 2
└── build/                   # Wails metadata and packaged executable
```

The dependency direction is `app -> translator -> llm/domain`. The Wails adapter contains no translation behavior.

## Verification

```powershell
npm.cmd run build
go test ./...
wails build
```

Integration and model-probe tests use the `integration` build tag and require an explicitly supplied API key.
