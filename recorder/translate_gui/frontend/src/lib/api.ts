declare global {
  interface Window {
    go: {
      main: {
        App: {
          ListRuns: (outputDir: string) => Promise<any[]>
          StartTranslate: (runDir: string) => Promise<any>
          GetProgress: () => Promise<any>
          ReadFile: (runDir: string, relPath: string) => Promise<string>
          GetRunDetail: (runDir: string) => Promise<any>
          LoadAIConfig: () => Promise<any>
          SaveAIConfig: (cfg: any) => Promise<any>
          TestLLMConnection: (cfg: any) => Promise<any>
          ListModels: () => Promise<any[]>
          ListPrompts: () => Promise<any[]>
          ExportPrompt: (phase: string) => Promise<any>
          ImportPrompt: (phase: string, content: string) => Promise<any>
          ResetPrompt: (phase: string) => Promise<any>
          OpenInFolder: (dir: string) => Promise<void>
          SelectDirectory: () => Promise<string>
        }
      }
    }
  }
}

export const api = {
  listRuns: (dir: string) => window.go.main.App.ListRuns(dir),
  startTranslate: (runDir: string) => window.go.main.App.StartTranslate(runDir),
  getProgress: () => window.go.main.App.GetProgress(),
  readFile: (runDir: string, relPath: string) => window.go.main.App.ReadFile(runDir, relPath),
  getRunDetail: (runDir: string) => window.go.main.App.GetRunDetail(runDir),
  loadAIConfig: () => window.go.main.App.LoadAIConfig(),
  saveAIConfig: (cfg: any) => window.go.main.App.SaveAIConfig(cfg),
  testLLMConnection: (cfg: any) => window.go.main.App.TestLLMConnection(cfg),
  listModels: () => window.go.main.App.ListModels(),
  listPrompts: () => window.go.main.App.ListPrompts(),
  exportPrompt: (phase: string) => window.go.main.App.ExportPrompt(phase),
  importPrompt: (phase: string, content: string) => window.go.main.App.ImportPrompt(phase, content),
  resetPrompt: (phase: string) => window.go.main.App.ResetPrompt(phase),
  openInFolder: (dir: string) => window.go.main.App.OpenInFolder(dir),
  selectDirectory: () => window.go.main.App.SelectDirectory(),
}
