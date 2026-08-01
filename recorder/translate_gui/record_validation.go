package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// validateRecordingData 校验 Node 录制端与 Go 翻译端之间的最小数据契约。
// 翻译依赖 action_N: pre=snapshot_{N-1}, post=snapshot_N，因此缺少任意
// action 或 snapshot 都不能静默降级，否则后续 diff 会与操作错位。
func validateRecordingData(runDir string) error {
	metaData, err := os.ReadFile(getMetaPath(runDir))
	if err != nil {
		return fmt.Errorf("读取 meta.json 失败: %w", err)
	}

	var meta Meta
	if err := json.Unmarshal(metaData, &meta); err != nil {
		return fmt.Errorf("解析 meta.json 失败: %w", err)
	}
	if meta.ActionCount <= 0 {
		return fmt.Errorf("录制数据没有可翻译的操作")
	}

	paths := getRecordPaths(runDir)
	var previousTimestamp int64
	for i := 1; i <= meta.ActionCount; i++ {
		actionPath := filepath.Join(paths.ActionsDir, "action_"+padIndex(i)+".json")
		data, err := os.ReadFile(actionPath)
		if err != nil {
			return fmt.Errorf("缺少操作文件 action_%s.json: %w", padIndex(i), err)
		}
		action, err := parseActionFile(data, i)
		if err != nil {
			return fmt.Errorf("解析 action_%s.json 失败: %w", padIndex(i), err)
		}
		if action.Index != i {
			return fmt.Errorf("action_%s.json 的 index=%d，与文件编号不一致", padIndex(i), action.Index)
		}
		if action.Action.Type == "" {
			return fmt.Errorf("action_%s.json 缺少 type", padIndex(i))
		}
		if action.Action.Timestamp <= 0 {
			return fmt.Errorf("action_%s.json 的 timestamp 无效", padIndex(i))
		}
		if previousTimestamp > 0 && action.Action.Timestamp < previousTimestamp {
			return fmt.Errorf("action_%s.json 的 timestamp 早于前一个操作", padIndex(i))
		}
		previousTimestamp = action.Action.Timestamp
	}

	for i := 0; i <= meta.ActionCount; i++ {
		snapshotPath := filepath.Join(paths.SnapshotsDir, "snapshot_"+padIndex(i)+".txt")
		info, err := os.Stat(snapshotPath)
		if err != nil {
			return fmt.Errorf("缺少快照文件 snapshot_%s.txt: %w", padIndex(i), err)
		}
		if info.IsDir() || info.Size() == 0 {
			return fmt.Errorf("快照文件 snapshot_%s.txt 为空或无效", padIndex(i))
		}
	}

	return nil
}
