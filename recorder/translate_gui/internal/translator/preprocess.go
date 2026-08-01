package translator

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// preprocess 对一次录制的原始数据进行完整预处理
func preprocess(runDir string, logger *Logger) ([]EnrichedAction, Meta, error) {
	logger.Info("========== 数据预处理开始 ==========")

	ensureTranslateLayout(runDir)

	metaData, err := os.ReadFile(getMetaPath(runDir))
	if err != nil {
		return nil, Meta{}, err
	}
	var meta Meta
	if err := json.Unmarshal(metaData, &meta); err != nil {
		return nil, Meta{}, err
	}

	// 兼容 totalActions 字段名
	totalActions := meta.ActionCount
	if totalActions == 0 {
		var raw map[string]interface{}
		json.Unmarshal(metaData, &raw)
		if v, ok := raw["totalActions"]; ok {
			totalActions = int(toInt64(v))
		}
	}

	recPaths := getRecordPaths(runDir)
	transPaths := getTranslatePaths(runDir)

	logger.Info("原始数据: " + intToStr(int64(totalActions)) + " 个操作, 快照目录: " + recPaths.SnapshotsDir)

	// 第1步：读取 action + 语义归并
	logger.Info("[预处理 1/3] 批量读取 action + 语义归并...")
	rawActions := readActionFiles(recPaths.ActionsDir, totalActions)
	mergedActions, mergeReport := mergeActions(rawActions)

	mergeReportData, _ := json.MarshalIndent(mergeReport, "", "  ")
	os.WriteFile(filepath.Join(transPaths.MergedDir, "merge_report.json"), mergeReportData, 0644)
	logger.Info("[预处理 1/3] 归并报告已保存")

	// 第2步：计算 diff
	logger.Info("[预处理 2/3] 计算快照 diff...")
	snapshotFiles := listSnapshotFiles(recPaths.SnapshotsDir)
	totalSnapshots := len(snapshotFiles)
	diffs := computeAllDiffs(recPaths.SnapshotsDir, transPaths.DiffsDir, totalSnapshots)

	// 第3步：逐条富化
	logger.Info("[预处理 3/3] 逐条富化 action 数据...")

	var enrichedActions []EnrichedAction
	var prevFormState map[string]interface{}
	noiseCount := 0
	totalMerged := len(mergedActions)

	for idx := 0; idx < totalMerged; idx++ {
		action := mergedActions[idx]
		i := action.Index

		if action.Skip != "" {
			logger.Info("  action " + intToStr(int64(i)) + "/" + intToStr(int64(totalActions)) + " 已跳过 [" + action.Skip + "]")
			enriched := EnrichedAction{
				Index: i,
				Action: RawAction{
					Type:      action.Type,
					Key:       action.Key,
					Timestamp: action.Timestamp,
					Element:   action.Element,
					URL:       action.URL,
					Title:     action.Title,
				},
				Diff:           "",
				Context:        "",
				FormStateDelta: nil,
				Classification: ActionClassification{Category: "skipped", ElementType: "other", Hints: []string{}},
			}
			enrichedActions = append(enrichedActions, enriched)
			if action.FormStateDelta != nil {
				prevFormState = action.FormStateDelta
			}
			continue
		}

		preSnapshotFile := filepath.Join(recPaths.SnapshotsDir, "snapshot_"+padIndex(i-1)+".txt")
		preSnapshot, _ := os.ReadFile(preSnapshotFile)

		snapshotDiff := diffs[i]
		if snapshotDiff == "" {
			snapshotDiff = "（diff 不可用）"
		}

		var contextExcerpt string
		if len(preSnapshot) > 0 && action.Element != nil {
			contextExcerpt = extractContextExcerpt(string(preSnapshot), action.Element, ContextExcerptMaxSiblings)
		}

		formStateChanges := computeFormStateChanges(prevFormState, action.FormStateDelta)

		classification := classifyAction(action, snapshotDiff, formStateChanges)

		isFirst := idx == 0
		isLast := idx == totalMerged-1
		enriched := EnrichedAction{
			Index: i,
			Action: RawAction{
				Type:      action.Type,
				Key:       action.Key,
				Timestamp: action.Timestamp,
				Element:   action.Element,
				FormState: action.FormStateDelta,
				URL:       action.URL,
				Title:     action.Title,
			},
			Diff:           snapshotDiff,
			Context:        contextExcerpt,
			FormStateDelta: nil,
			Classification: classification,
		}
		if formStateChanges.HasChanges {
			enriched.FormStateDelta = map[string]interface{}{
				"changed": formStateChanges.Changed,
				"added":   formStateChanges.Added,
				"removed": formStateChanges.Removed,
			}
		}

		isNoise, noiseReason := detectNoise(&enriched, isFirst, isLast)
		if isNoise {
			enriched.IsNoise = true
			noiseCount++
			mergeReport.Details = append(mergeReport.Details, MergeDetail{Index: i, Rule: "noise", Reason: noiseReason})
		}

		enrichedActions = append(enrichedActions, enriched)

		// 保存富化后的 action
		enrichedForFile := buildEnrichedForFile(enriched, i)
		enrichedData, _ := json.MarshalIndent(enrichedForFile, "", "  ")
		os.WriteFile(filepath.Join(transPaths.EnrichedDir, "enriched_"+padIndex(i)+".json"), enrichedData, 0644)

		if action.FormStateDelta != nil {
			prevFormState = action.FormStateDelta
		}

		statusTag := classification.Category
		if isNoise {
			statusTag = "noise"
		}
		logger.Info("  action " + intToStr(int64(i)) + "/" + intToStr(int64(totalActions)) + " 富化完成 [" + statusTag + "]")
	}

	mergeReport.NoiseMarked = noiseCount
	mergeReportData, _ = json.MarshalIndent(mergeReport, "", "  ")
	os.WriteFile(filepath.Join(transPaths.MergedDir, "merge_report.json"), mergeReportData, 0644)

	logger.Info("========== 数据预处理完成：" + intToStr(int64(len(enrichedActions))) + " 条富化数据（噪声 " + intToStr(int64(noiseCount)) + " 条, skip " + intToStr(int64(mergeReport.DblclickDeduped)) + " 条）==========")

	return enrichedActions, meta, nil
}

func buildEnrichedForFile(e EnrichedAction, i int) map[string]interface{} {
	return map[string]interface{}{
		"index":            e.Index,
		"type":             e.Action.Type,
		"key":              e.Action.Key,
		"element":          e.Action.Element,
		"timestamp":        e.Action.Timestamp,
		"formStateDelta":   e.Action.FormState,
		"snapshotDiff":     e.Diff,
		"preSnapshot":      "[见 " + RecordSnapshotsRel + "/snapshot_" + padIndex(i-1) + ".txt]",
		"postSnapshot":     "[见 " + RecordSnapshotsRel + "/snapshot_" + padIndex(i) + ".txt]",
		"contextExcerpt":   e.Context,
		"formStateChanges": e.FormStateDelta,
		"classification":   e.Classification,
		"noise":            e.IsNoise,
	}
}

func listSnapshotFiles(snapshotsDir string) []string {
	entries, err := os.ReadDir(snapshotsDir)
	if err != nil {
		return nil
	}
	var files []string
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, "snapshot_") && strings.HasSuffix(name, ".txt") {
			files = append(files, name)
		}
	}
	return files
}

func toInt64(v interface{}) int64 {
	switch val := v.(type) {
	case float64:
		return int64(val)
	case int:
		return int64(val)
	case int64:
		return val
	case string:
		return 0
	}
	return 0
}
